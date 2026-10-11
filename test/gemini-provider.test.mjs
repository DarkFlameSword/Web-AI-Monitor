import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGaugeViews } from '../extension/core/gauges.js';
import { HttpError, isAuthError } from '../extension/core/http.js';
import { qualificationOf } from '../extension/core/rank.js';
import { buildWalletViews } from '../extension/core/wallets.js';
import gemini, {
  USAGE_FREQ,
  forgetSession,
  pageSession,
  parseUsageInfo,
  proxyBody,
  rpcParts,
  usageInfoOf,
} from '../extension/providers/gemini/provider.js';
import template from '../extension/providers/gemini/template.js';

const NOW = Date.parse('2026-10-11T08:00:00Z');
const at = ms => Math.floor((NOW + ms) / 1000);
const HOUR = 3_600_000;

/** A GetUsageInfo result: Pro, the 5-hour window 35% used, the week 62% used, 1,500 AI credits. */
const USAGE = [2, [
  [812.5, 0.35, 1, [[at(2 * HOUR), 0]]],
  [4100, 0.62, 2, [[at(80 * HOUR), 0]]],
  [1500, null, 3],
], true];

/** A batchexecute reply as the page gets it: a guard line, then length-prefixed frames. */
function batchReply(...frames) {
  return `)]}'\n${frames.map(parts => {
    const payload = `\n${JSON.stringify(parts)}\n`;
    return `${payload.length}${payload}`;
  }).join('')}`;
}

const usageReply = body => batchReply(
  [['wrb.fr', 'jSf9Qc', JSON.stringify(body), null, null, null, 'generic'], ['di', 42], ['af.httprm', 41, '-123', 3]],
  [['e', 4, null, null, 512]],
);

/** The app page, with its WIZ_global_data and things that must never leave it. */
const APP_PAGE = `<!doctype html><html><head><script>window.WIZ_global_data = {"cfb2h":"boq_assistant-bard-web-server_20261008.07_p0","oPEP7c":"someone@example.com","SNlM0e":"AFkVSc:1791190000000","FdrFJe":"-4021337","TuX5cc":"ja"};</script></head><body>Someone's chats</body></html>`;

function fakeHttp({ page = APP_PAGE, reply = usageReply(USAGE), failFirstPost = null } = {}) {
  const calls = [];
  let posts = 0;
  return {
    calls,
    async getText(path) {
      calls.push(['get', path]);
      return page;
    },
    async postForm(path, form, options = {}) {
      calls.push(['post', path, form, options.headers ?? {}]);
      posts += 1;
      if (failFirstPost && posts === 1) throw failFirstPost;
      return typeof reply === 'function' ? reply() : reply;
    },
    async getJson() {
      throw new HttpError(404);
    },
    async getCookie() {
      return null;
    },
  };
}

test('the usage reply becomes MP / HP meters, the AI credits and the plan', () => {
  assert.deepEqual(parseUsageInfo(USAGE), {
    meters: [
      { id: 'window_5h', kind: 'window_5h', scope: null, used: 35, resetsAt: new Date(at(2 * HOUR) * 1000).toISOString() },
      { id: 'weekly', kind: 'weekly', scope: null, used: 62, resetsAt: new Date(at(80 * HOUR) * 1000).toISOString() },
    ],
    wallets: [{
      id: 'ai_credits', kind: 'stock', unit: 'credits', currency: null, unlimited: false, balance: 1500,
      total: null, spent: null, cap: null, expiresAt: null, enabled: true, locked: false, capReached: false,
    }],
    plan: 'pro',
  });
  // A window Google adds later still shows, as an EX row.
  const later = parseUsageInfo([1, [[1, 0.5, 9, null]], false]);
  assert.deepEqual(later.meters.map(m => [m.kind, m.used, m.resetsAt]), [['limit_9', 50, null]]);
  assert.deepEqual(parseUsageInfo(null), { meters: [], wallets: [], plan: null });
  assert.deepEqual(parseUsageInfo([2, 'nonsense']).meters, []);
});

test('frames are read by their length in UTF-16 units, as the page does', () => {
  const text = batchReply([['di', '\u{1F642} wide'], ['x', 1]], [['wrb.fr', 'jSf9Qc', '[4,[]]', null, null, null, 'generic']]);
  assert.deepEqual(rpcParts(text), [['di', '\u{1F642} wide'], ['x', 1], ['wrb.fr', 'jSf9Qc', '[4,[]]', null, null, null, 'generic']]);
  assert.deepEqual(usageInfoOf(text), [4, []]);
  // Not framed: one JSON document.
  assert.deepEqual(usageInfoOf(`)]}'\n${JSON.stringify([['wrb.fr', 'jSf9Qc', '[1]', null, null, null, 'generic']])}`), [1]);
  assert.equal(usageInfoOf('<html>error</html>'), null);
  assert.throws(() => usageInfoOf(batchReply([['wrb.fr', 'jSf9Qc', null, null, null, [7]]])), error => isAuthError(error));
});

test('plans rank from Ultra (A) down to Free (D)', () => {
  const plan = tier => parseUsageInfo([tier, []]).plan;
  assert.deepEqual([1, 2, 3, 4, 6, 99].map(plan), ['free', 'pro', 'ultra', 'plus', 'ultra', null]);
  const rank = id => qualificationOf(template, id)?.rank;
  assert.deepEqual(['ultra', 'pro', 'plus', 'free'].map(rank), ['A', 'B', 'C', 'D']);
});

test('its card: MP for the 5-hour window, HP for the week, no ultimate; sapphires in the pouch', () => {
  const { meters, wallets } = parseUsageInfo(USAGE);
  const views = buildGaugeViews(template, meters, NOW);
  assert.deepEqual(views.map(v => [v.role, v.value]), [['mp', 65], ['hp', 38]]);
  assert.ok(!views.some(v => v.role === 'sp'));
  assert.deepEqual(buildWalletViews(template, wallets, NOW).map(v => [v.treasure, v.balance, v.state]), [['sapphire', 1500, 'active']]);
  assert.ok(!template.wallets.some(w => ['coin', 'emerald', 'crystal', 'potion'].includes(w.treasure)));
});

test('the session token comes from the app page; the usage call carries it', async () => {
  forgetSession();
  const http = fakeHttp();
  const result = await gemini.fetchUsage(http, NOW);
  assert.equal(result.plan, 'pro');
  assert.deepEqual(result.meters.map(m => m.used), [35, 62]);
  const [get, post] = http.calls;
  assert.deepEqual(get, ['get', '/app']);
  const [, path, form, headers] = post;
  assert.match(path, /^\/_\/BardChatUi\/data\/batchexecute\?rpcids=jSf9Qc&/);
  const query = new URL(path, 'https://gemini.google.com').searchParams;
  assert.equal(query.get('source-path'), '/usage');
  assert.equal(query.get('bl'), 'boq_assistant-bard-web-server_20261008.07_p0');
  assert.equal(query.get('f.sid'), '-4021337');
  assert.equal(query.get('hl'), 'ja');
  assert.equal(query.get('rt'), 'c');
  assert.deepEqual(form, { at: 'AFkVSc:1791190000000', 'f.req': USAGE_FREQ });
  assert.deepEqual(headers, { 'x-same-domain': '1' });
});

test('the token is reused for 30 minutes, and fetched again when it goes stale', async () => {
  forgetSession();
  await gemini.fetchUsage(fakeHttp(), NOW);

  const soon = fakeHttp();
  await gemini.fetchUsage(soon, NOW + 10 * 60_000);
  assert.deepEqual(soon.calls.map(call => call[0]), ['post'], 'no page fetch within 30 minutes');

  const stale = fakeHttp({ failFirstPost: new HttpError(400, 'http') });
  const result = await gemini.fetchUsage(stale, NOW + 20 * 60_000);
  assert.equal(result.plan, 'pro');
  assert.deepEqual(stale.calls.map(call => call[0]), ['post', 'get', 'post'], 'a refused token: the page again, then one retry');

  const later = fakeHttp();
  await gemini.fetchUsage(later, NOW + 60 * 60_000);
  assert.deepEqual(later.calls.map(call => call[0]), ['get', 'post'], 'after 30 minutes: the page again');
});

test('signed out: no token in the page, or the call refused as unauthenticated', async () => {
  forgetSession();
  await assert.rejects(gemini.fetchUsage(fakeHttp({ page: '<html>Sign in</html>' }), NOW), error => isAuthError(error));
  forgetSession();
  const refused = batchReply([['wrb.fr', 'jSf9Qc', null, null, null, [7]]]);
  await assert.rejects(gemini.fetchUsage(fakeHttp({ reply: refused }), NOW), error => isAuthError(error));
  forgetSession();
  await assert.rejects(gemini.fetchUsage(fakeHttp({ reply: ")]}'\n" }), NOW), error => error.code === 'no_data' && !isAuthError(error));
  // A failed page request is not a sign-out.
  assert.equal(isAuthError(new HttpError(403, 'http')), false);
});

test('a tab hands back only the session values of the app page', () => {
  const trimmed = proxyBody('/app', APP_PAGE);
  assert.doesNotMatch(trimmed, /someone@example\.com|chats|<html/);
  assert.deepEqual(pageSession(trimmed), pageSession(APP_PAGE));
  assert.deepEqual(pageSession(APP_PAGE), { at: 'AFkVSc:1791190000000', bl: 'boq_assistant-bard-web-server_20261008.07_p0', sid: '-4021337', hl: 'ja' });
  assert.equal(proxyBody('/app', '<html>guest</html>'), '');
  const reply = usageReply(USAGE);
  assert.equal(proxyBody('/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&rt=c', reply), reply, 'the usage reply passes as it is');
});

test('a tab makes only the usage call for the background, and replies count as activity', () => {
  const get = path => gemini.proxyPaths.some(pattern => pattern.test(path));
  assert.deepEqual(['/app', '/app/abc123', '/usage', '/_/BardChatUi/data/batchexecute'].map(get), [true, false, false, false]);

  const usage = '/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&source-path=%2Fusage&hl=en&_reqid=123456&rt=c';
  const post = (path, form) => gemini.proxyPosts.some(rule => rule.path.test(path) && rule.form(form));
  const form = { at: 'token', 'f.req': USAGE_FREQ };
  assert.equal(post(usage, form), true);
  assert.equal(post(usage.replace('jSf9Qc', 'MaZiqc'), form), false, 'another RPC (listing chats)');
  assert.equal(post(usage.replace('rpcids=jSf9Qc', 'rpcids=jSf9Qc,MaZiqc'), form), false, 'a second RPC in the batch');
  assert.equal(post(usage, { ...form, 'f.req': JSON.stringify([[['MaZiqc', '[]', null, 'generic']]]) }), false);
  assert.equal(post(usage, { ...form, extra: '1' }), false);
  assert.deepEqual([...gemini.proxyHeaders], ['x-same-domain']);

  assert.equal(gemini.isActivity('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate', 900), true);
  assert.equal(gemini.isActivity('/_/BardChatUi/data/batchexecute', 9000), false);
  assert.equal(gemini.enabledByDefault, false);
  assert.equal(gemini.optionalPermission, true);
});
