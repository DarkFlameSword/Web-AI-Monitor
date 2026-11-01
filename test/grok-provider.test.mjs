import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextDecoder, TextEncoder } from 'node:util';

import { buildGaugeViews } from '../extension/core/gauges.js';
import { HttpError, isAuthError } from '../extension/core/http.js';
import { qualificationOf, subscriptionTerm } from '../extension/core/rank.js';
import grok, { FAST_QUERY, parseCredits, parseFast, parseSubscriptions, proxyBody } from '../extension/providers/grok/provider.js';
import { grpcMessage, protoFields } from '../extension/providers/grok/proto.js';
import template from '../extension/providers/grok/template.js';

const NOW = Date.parse('2026-10-20T08:00:00Z');

// ------------------------------------------------- protobuf, by hand

function varint(value) {
  const out = [];
  let rest = value;
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest ? low | 0x80 : low);
  } while (rest);
  return out;
}
const tag = (number, wire) => varint(number * 8 + wire);
const int = (number, value) => [...tag(number, 0), ...varint(value)];
const bytes = (number, payload) => [...tag(number, 2), ...varint(payload.length), ...payload];
const text = (number, value) => bytes(number, [...new TextEncoder().encode(value)]);
function float(number, value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, true);
  return [...tag(number, 5), ...out];
}
const stamp = (number, iso) => bytes(number, int(1, Math.floor(Date.parse(iso) / 1000)));
function frame(message, flag = 0) {
  const out = new Uint8Array(5 + message.length);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, message.length, false);
  out.set(message, 5);
  return [...out];
}
const TRAILERS = frame([...new TextEncoder().encode('grpc-status:0\r\ngrpc-message:\r\n')], 0x80);

const START = '2026-10-15T19:27:46Z';
const END = '2026-10-22T19:27:46Z';

/**
 * A GetGrokCreditsConfig reply as grok.com sends it: the pool 61% used this
 * week (Grok Build 60%, chat 1%), and fields the extension does not read.
 */
function creditsReply({ used = 61, config = null } = {}) {
  const fields = config ?? [
    ...(used ? float(1, used) : []),
    ...bytes(4, [...int(1, 1), ...stamp(2, START), ...stamp(3, END)]),
    ...stamp(5, END),
    ...bytes(7, [...int(1, 2), ...float(2, 60)]),
    ...bytes(7, [...int(1, 4), ...float(2, 1)]),
    ...text(12, 'TOP_UP_METHOD_SAVED_PAYMENT_METHOD'),
  ];
  return Uint8Array.from([...frame([...bytes(1, fields), ...text(2, 'user-0001')]), ...TRAILERS]);
}

/** /rest/subscriptions as a live account answered it (October 2026): Ultra, moved over from SuperGrok Heavy. */
const SUBSCRIPTIONS = {
  subscriptions: [
    {
      xaiUserId: '00000000-0000-4000-8000-000000000001',
      tier: 'SUBSCRIPTION_TIER_SUPER_GROK_PRO',
      status: 'SUBSCRIPTION_STATUS_ACTIVE',
      createTime: '2026-10-14T06:47:23.984030Z',
      billingInterval: 'BILLING_INTERVAL_MONTHLY',
      billingPeriodEnd: '2026-11-14T06:42:19.668067Z',
      cancelAtPeriodEnd: false,
      futureOffers: [],
      billingSystem: 'BILLING_SYSTEM_COMMERCE',
    },
    {
      xaiUserId: '00000000-0000-4000-8000-000000000001',
      tier: 'SUBSCRIPTION_TIER_SUPER_GROK_PRO',
      status: 'SUBSCRIPTION_STATUS_INACTIVE',
      createTime: '2026-09-17T06:36:00.000000Z',
      billingInterval: 'BILLING_INTERVAL_MONTHLY',
      billingPeriodEnd: '2026-10-17T06:35:00.000000Z',
      cancelAtPeriodEnd: false,
      futureOffers: [],
      billingSystem: 'BILLING_SYSTEM_LEGACY',
    },
  ],
  dominantPlan: {
    plan: 'supergrok.heavy',
    surfaceNames: { SURFACE_DISPLAY: 'SuperGrok Heavy', SURFACE_JWT: 'SUBSCRIPTION_TIER_SUPER_GROK_PRO', SURFACE_ANALYTICS: 'SuperGrokPro' },
  },
};

const FREE = { subscriptions: [], dominantPlan: { plan: 'free', surfaceNames: { SURFACE_DISPLAY: 'Free' } } };
const FAST = { windowSizeSeconds: 7200, remainingQueries: 14, totalQueries: 20, remainingTokens: 120000, totalTokens: 160000 };

/** A Grok account as the provider sees it, recording each call. */
function fakeHttp({ subscriptions = SUBSCRIPTIONS, credits = creditsReply(), fast = FAST } = {}) {
  const calls = [];
  const answer = value => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  return {
    calls,
    getJson: path => {
      calls.push(['GET', path]);
      return answer(subscriptions);
    },
    postJson: (path, json) => {
      calls.push(['POST', path, json]);
      return answer(fast);
    },
    postGrpc: path => {
      calls.push(['GRPC', path]);
      return answer(credits);
    },
  };
}

// ------------------------------------------------------------- the tests

test('the subscription: the newest active one gives the plan, when its period ends and whether it renews', () => {
  const account = parseSubscriptions(SUBSCRIPTIONS, NOW);
  assert.equal(account.paid, true);
  assert.equal(account.plan, 'ultra', 'SUPER_GROK_PRO on The X Subscription is Ultra');
  assert.deepEqual(account.subscription, { startsAt: null, endsAt: '2026-11-14T06:42:19.668Z', renews: true, checkedAt: NOW });
  const term = subscriptionTerm(account.subscription, NOW);
  assert.equal(term.renews, true);
  assert.equal(term.expired, false);
  // Cancelled: it runs to the period's end and then lapses.
  const cancelled = structuredClone(SUBSCRIPTIONS);
  cancelled.subscriptions[0].cancelAtPeriodEnd = true;
  assert.equal(parseSubscriptions(cancelled, NOW).subscription.renews, false);
  // Nothing active: a free account, with no paid period.
  assert.deepEqual(parseSubscriptions(FREE, NOW), { paid: false, plan: 'free', subscription: null });
  assert.deepEqual(parseSubscriptions(null, NOW), { paid: false, plan: 'free', subscription: null });
});

test('plans: SuperGrok names on the old billing, The X Subscription names on the new; an unknown tier is not guessed', () => {
  const account = (tier, billingSystem, display = null, plan = null) => parseSubscriptions({
    subscriptions: [{ tier, status: 'SUBSCRIPTION_STATUS_ACTIVE', billingSystem, createTime: '2026-10-01T00:00:00Z' }],
    dominantPlan: display ? { plan, surfaceNames: { SURFACE_DISPLAY: display } } : undefined,
  }, NOW).plan;
  assert.equal(account('SUBSCRIPTION_TIER_SUPER_GROK_PRO', 'BILLING_SYSTEM_LEGACY', 'SuperGrok Heavy'), 'supergrok_heavy');
  assert.equal(account('SUBSCRIPTION_TIER_SUPER_GROK_PLUS', 'BILLING_SYSTEM_COMMERCE'), 'super');
  assert.equal(account('SUBSCRIPTION_TIER_SUPER_GROK_PLUS', 'BILLING_SYSTEM_LEGACY'), 'supergrok_plus');
  assert.equal(account('SUBSCRIPTION_TIER_GROK_PRO', 'BILLING_SYSTEM_LEGACY', 'SuperGrok'), 'supergrok');
  assert.equal(account('SUBSCRIPTION_TIER_GROK_PRO', 'BILLING_SYSTEM_COMMERCE'), 'premium');
  assert.equal(account('SUBSCRIPTION_TIER_X_PLAN', 'BILLING_SYSTEM_COMMERCE', 'X Plus'), 'plus');
  assert.equal(account('SUBSCRIPTION_TIER_X_PLAN', 'BILLING_SYSTEM_COMMERCE', 'Super'), 'super');
  assert.equal(account('SUBSCRIPTION_TIER_X_PLAN', 'BILLING_SYSTEM_COMMERCE', 'Ultra'), 'ultra');
  assert.equal(account('SUBSCRIPTION_TIER_LITE', 'BILLING_SYSTEM_LEGACY', 'SuperGrok Lite'), 'supergrok_lite');
  assert.equal(account('SUBSCRIPTION_TIER_SOMETHING_NEW', 'BILLING_SYSTEM_COMMERCE'), null, 'paid, but no rank is made up');
});

test('ranks from Ultra (A) down to Free (E); a SuperGrok plan ranks as the plan that replaced it', () => {
  const rank = plan => qualificationOf(template, plan);
  assert.deepEqual(['ultra', 'super', 'premium', 'plus', 'free'].map(plan => rank(plan).rank), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(rank('supergrok_heavy'), { name: 'SuperGrok Heavy', rank: 'A' });
  assert.deepEqual(rank('supergrok_plus'), { name: 'SuperGrok Plus', rank: 'B' });
  assert.deepEqual(rank('supergrok'), { name: 'SuperGrok', rank: 'C' });
  assert.deepEqual(rank('supergrok_lite'), { name: 'SuperGrok Lite', rank: 'D' });
  assert.equal(rank(null), null);
});

test('the weekly pool comes from the billing call: the percent used and when the period ends', () => {
  assert.deepEqual(parseCredits(creditsReply()), { id: 'weekly_pool', kind: 'weekly_pool', scope: null, used: 61, resetsAt: '2026-10-22T19:27:46.000Z' });
  // A 0% week leaves the percent out; the period still says it is the same reply.
  assert.equal(parseCredits(creditsReply({ used: 0 })).used, 0);
  // The end only inside the period message: still read.
  const periodOnly = creditsReply({ config: [...float(1, 12.5), ...bytes(4, [...stamp(2, START), ...stamp(3, END)])] });
  assert.equal(parseCredits(periodOnly).resetsAt, '2026-10-22T19:27:46.000Z');
  // A changed shape is no data, not a healthy 0%.
  assert.equal(parseCredits(creditsReply({ config: [...text(3, 'something else')] })), null);
  assert.equal(parseCredits(Uint8Array.from(TRAILERS)), null, 'only trailers: the call failed');
  assert.equal(parseCredits(Uint8Array.from([0, 0, 0, 9, 1])), null, 'cut short');
  assert.equal(parseCredits(new Uint8Array(0)), null);
});

test('the Fast count: what is left of the total; no reset time unless none is left', () => {
  assert.deepEqual(parseFast(FAST, NOW), { id: 'fast', kind: 'fast', scope: null, used: 30, resetsAt: null });
  const spent = parseFast({ remainingQueries: 0, totalQueries: 20, windowSizeSeconds: 7200, waitTimeSeconds: 1800 }, NOW);
  assert.equal(spent.used, 100);
  assert.equal(spent.resetsAt, new Date(NOW + 1_800_000).toISOString());
  assert.equal(parseFast({ remainingQueries: 3 }, NOW), null);
  assert.equal(parseFast({ remainingQueries: 3, totalQueries: 0 }, NOW), null);
  assert.equal(parseFast(null, NOW), null);
});

test('its card: MP for Fast, HP for the weekly pool; the one the account does not have is sealed', () => {
  const paid = buildGaugeViews(template, [parseCredits(creditsReply())], NOW);
  assert.deepEqual(paid.map(view => [view.role, view.state]), [['mp', 'sealed'], ['hp', 'ok']]);
  assert.deepEqual(paid[0].hint, { key: 'grok.noFast' });
  assert.equal(paid[1].value, 39);
  const free = buildGaugeViews(template, [parseFast(FAST, NOW)], NOW);
  assert.deepEqual(free.map(view => [view.role, view.state]), [['mp', 'ok'], ['hp', 'sealed']]);
  assert.equal(free[0].value, 70);
  assert.equal(free[0].resetsAt, null);
  assert.deepEqual(free[0].idle, { key: 'grok.rolling', short: 'grok.rollingShort' }, 'a rolling window, not standby');
  assert.deepEqual(free[1].hint, { key: 'grok.noWeekly' });
});

test('paid: the subscription, then the billing call; free: the subscription, then the Fast count', async () => {
  const paidHttp = fakeHttp();
  const paid = await grok.fetchUsage(paidHttp, { now: NOW });
  assert.deepEqual(paidHttp.calls, [['GET', '/rest/subscriptions'], ['GRPC', '/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig']]);
  assert.equal(paid.plan, 'ultra');
  assert.deepEqual(paid.meters.map(meter => meter.id), ['weekly_pool']);
  assert.equal(paid.subscription.endsAt, '2026-11-14T06:42:19.668Z');
  assert.deepEqual(paid.wallets, []);

  const freeHttp = fakeHttp({ subscriptions: FREE });
  const free = await grok.fetchUsage(freeHttp, { now: NOW });
  assert.deepEqual(freeHttp.calls, [['GET', '/rest/subscriptions'], ['POST', '/rest/rate-limits', { requestKind: 'DEFAULT', modelName: 'grok-3' }]]);
  assert.equal(free.plan, 'free');
  assert.deepEqual(free.meters.map(meter => meter.id), ['fast']);
  assert.equal(free.subscription, null);
});

test('a paid pool that cannot be read falls back to the Fast count; nothing at all is no data', async () => {
  const fallback = await grok.fetchUsage(fakeHttp({ credits: new HttpError(500, 'http') }), { now: NOW });
  assert.deepEqual(fallback.meters.map(meter => meter.id), ['fast']);
  assert.equal(fallback.plan, 'ultra');
  const changed = await grok.fetchUsage(fakeHttp({ credits: creditsReply({ config: [...text(3, 'x')] }) }), { now: NOW });
  assert.deepEqual(changed.meters.map(meter => meter.id), ['fast']);
  await assert.rejects(grok.fetchUsage(fakeHttp({ subscriptions: FREE, fast: {} }), { now: NOW }), error => error.code === 'no_data');
});

test('signed out: grok.com answers the subscription call with 401', async () => {
  await assert.rejects(grok.fetchUsage(fakeHttp({ subscriptions: new HttpError(401) }), { now: NOW }), error => isAuthError(error));
});

test('a tab hands back only what is read: no user id, offers, payment method or use per product', () => {
  const subscriptions = proxyBody('/rest/subscriptions', SUBSCRIPTIONS);
  assert.doesNotMatch(JSON.stringify(subscriptions), /xaiUserId|00000000|futureOffers|BILLING_INTERVAL|SURFACE_JWT/);
  assert.deepEqual(parseSubscriptions(subscriptions, NOW), parseSubscriptions(SUBSCRIPTIONS, NOW), 'the same plan and period');
  assert.deepEqual(proxyBody('/rest/rate-limits', FAST), { windowSizeSeconds: 7200, remainingQueries: 14, totalQueries: 20 });

  const reply = creditsReply();
  const kept = proxyBody('/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', reply);
  assert.ok(kept.length < reply.length);
  const config = protoFields(protoFields(grpcMessage(kept))[0].value);
  assert.deepEqual(config.map(field => field.number), [1, 4, 5], 'the percent and the period, nothing else');
  assert.doesNotMatch(new TextDecoder().decode(kept), /user-0001|TOP_UP|grpc-status/);
  assert.deepEqual(parseCredits(kept), parseCredits(reply));
  assert.deepEqual([...proxyBody('/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', Uint8Array.from(TRAILERS))], []);
});

test('a tab makes only these calls for the background, and replies count as activity', () => {
  const gets = ['/rest/subscriptions', '/rest/subscriptions?x=1', '/rest/app-chat/conversations', '/rest/rate-limits'];
  assert.deepEqual(gets.map(path => grok.proxyPaths.some(pattern => pattern.test(path))), [true, false, false, false]);
  const [rateLimits, credits] = grok.proxyPosts;
  assert.ok(rateLimits.path.test('/rest/rate-limits') && rateLimits.json({ ...FAST_QUERY }));
  assert.equal(rateLimits.json({ requestKind: 'DEFAULT', modelName: 'grok-4-heavy' }), false);
  assert.equal(rateLimits.json({ ...FAST_QUERY, extra: 1 }), false);
  assert.equal(rateLimits.form, undefined);
  assert.ok(credits.grpc && credits.path.test('/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig'));
  assert.equal(credits.path.test('/grok_api_v2.ConsumerUiSvc/UseReset'), false);
  assert.ok(grok.isActivity('/rest/app-chat/conversations/new'));
  assert.ok(grok.isActivity('/rest/app-chat/conversations/7a1c2d3e-0000-4000-8000-000000000001/responses'));
  assert.equal(grok.isActivity('/rest/rate-limits'), false);
  assert.equal(grok.isActivity('/rest/subscriptions'), false);
});

test('protobuf reading never throws on bad input', () => {
  for (const input of [Uint8Array.from([0xff, 0xff, 0xff]), Uint8Array.from([0x0a, 0x10, 1]), Uint8Array.from([0x0d, 1]), null]) {
    assert.ok(Array.isArray(protoFields(input)));
  }
  assert.equal(grpcMessage(Uint8Array.from([0, 0, 0, 0, 3, 1])), null);
});
