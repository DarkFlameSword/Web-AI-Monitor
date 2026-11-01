import { HttpError } from '../../core/http.js';
import { fieldValue, grpcFrame, grpcMessage, keepFields, lengthField, protoFields, timestampOf } from './proto.js';
import template from './template.js';

const ORIGIN = 'https://grok.com';
/** Every subscription the account has held, with its tier and paid period. */
const SUBSCRIPTIONS_PATH = '/rest/subscriptions';
/** A paid plan's weekly pool: the billing call behind grok.com's usage page (gRPC-web). */
const CREDITS_PATH = '/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
/** A free account's query count. */
const RATE_LIMITS_PATH = '/rest/rate-limits';
/** The Fast mode's count, the one a free account can use. */
export const FAST_QUERY = Object.freeze({ requestKind: 'DEFAULT', modelName: 'grok-3' });

const ACTIVE = 'SUBSCRIPTION_STATUS_ACTIVE';
/** Plans bought before The X Subscription (October 2026) bill on the old system. */
const LEGACY_BILLING = 'BILLING_SYSTEM_LEGACY';

/**
 * Plan families, from any of the names an account reports: the tier enum
 * (which keeps its old name after a move: an Ultra account still says
 * SUPER_GROK_PRO), the display name or the plan id. Each family is an X
 * Subscription plan and the SuperGrok plan it replaced.
 */
const FAMILIES = Object.freeze([
  [/heavy|ultra|super_grok_pro/i, 'ultra', 'supergrok_heavy'],
  [/super[\s._-]*grok[\s._-]*plus|^(x[\s._-]*)?super$/i, 'super', 'supergrok_plus'],
  [/super[\s._-]*grok[\s._-]*lite|^(x[\s._-]*)?plus$/i, 'plus', 'supergrok_lite'],
  [/super[\s._-]*grok|grok_pro|premium/i, 'premium', 'supergrok'],
]);

const isObject = value => Boolean(value) && typeof value === 'object';
const clampPercent = value => Math.min(100, Math.max(0, value));

/** Epoch ms, epoch seconds or an ISO string as ISO, or null. */
function isoOf(value) {
  if (typeof value === 'string' && value && !/^\d+(\.\d+)?$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number > 1e12 ? number : number * 1000).toISOString();
}

/**
 * The account's plan and paid period from /rest/subscriptions. Never throws.
 *
 * Shape: { subscriptions: [{ tier, status, billingSystem, createTime,
 * billingPeriodEnd, cancelAtPeriodEnd, ... }], dominantPlan: { plan,
 * surfaceNames: { SURFACE_DISPLAY } } }. Several subscriptions can be active
 * while a plan changes (the old one runs to its period's end); the newest
 * is the one the user chose.
 *
 * @returns {{paid: boolean, plan: string|null, subscription: import('../../core/rank.js').Subscription|null}}
 */
export function parseSubscriptions(body, now) {
  const list = Array.isArray(body?.subscriptions) ? body.subscriptions.filter(isObject) : [];
  const active = list
    .filter(entry => entry.status === ACTIVE)
    .sort((a, b) => String(b.createTime ?? '').localeCompare(String(a.createTime ?? '')))[0];
  if (!active) return { paid: false, plan: 'free', subscription: null };
  const names = [active.tier, body?.dominantPlan?.surfaceNames?.SURFACE_DISPLAY, body?.dominantPlan?.plan]
    .filter(name => typeof name === 'string' && name);
  const family = names.map(name => FAMILIES.find(([pattern]) => pattern.test(name))).find(Boolean);
  const plan = family ? family[active.billingSystem === LEGACY_BILLING ? 2 : 1] : null;
  return {
    paid: true,
    plan,
    subscription: {
      startsAt: null,
      endsAt: isoOf(active.billingPeriodEnd),
      renews: typeof active.cancelAtPeriodEnd === 'boolean' ? !active.cancelAtPeriodEnd : null,
      checkedAt: now,
    },
  };
}

/**
 * The weekly pool from a GetGrokCreditsConfig reply, as a meter, or null.
 * Never throws.
 *
 * The reply's message holds the config in field 1. In it: the percent of the
 * pool used (field 1, a float; proto3 leaves a 0 out), the current period
 * (field 4: type, start, end), its end again as a timestamp (field 5), and
 * the use per product (field 7).
 *
 * @param {Uint8Array} bytes
 * @returns {import('../../core/gauges.js').Meter|null}
 */
export function parseCredits(bytes) {
  const message = grpcMessage(bytes);
  const config = message ? fieldValue(protoFields(message), 1) : undefined;
  if (!(config instanceof Uint8Array)) return null;
  const fields = protoFields(config);
  const used = fieldValue(fields, 1);
  const period = fieldValue(fields, 4);
  const resetsAt = timestampOf(fieldValue(fields, 5))
    ?? (period instanceof Uint8Array ? timestampOf(fieldValue(protoFields(period), 3)) : null);
  const known = typeof used === 'number' && Number.isFinite(used);
  // A 0% week leaves the percent out, but then the rest is there; with
  // nothing recognizable at all, the reply has changed shape.
  if (!known && !resetsAt && !fields.some(field => field.number === 7)) return null;
  return { id: 'weekly_pool', kind: 'weekly_pool', scope: null, used: known ? clampPercent(used) : 0, resetsAt };
}

/**
 * The Fast queries left, as a meter, or null. Never throws.
 *
 * Shape: { remainingQueries, totalQueries, windowSizeSeconds, waitTimeSeconds? }.
 * The window rolls: grok.com does not say when a query frees up, only how
 * long to wait once none is left.
 *
 * @returns {import('../../core/gauges.js').Meter|null}
 */
export function parseFast(body, now) {
  const total = Number(body?.totalQueries);
  const remaining = Number(body?.remainingQueries);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining)) return null;
  const wait = Number(body?.waitTimeSeconds);
  return {
    id: 'fast',
    kind: 'fast',
    scope: null,
    used: clampPercent(100 - (Math.max(0, remaining) / total) * 100),
    resetsAt: remaining <= 0 && wait > 0 ? new Date(now + wait * 1000).toISOString() : null,
  };
}

/** The fields of each subscription a tab hands back. */
const SUBSCRIPTION_FIELDS = Object.freeze(['tier', 'status', 'billingSystem', 'createTime', 'billingPeriodEnd', 'cancelAtPeriodEnd']);
const RATE_LIMIT_FIELDS = Object.freeze(['remainingQueries', 'totalQueries', 'windowSizeSeconds', 'waitTimeSeconds']);
/** The config fields of the billing reply a tab hands back: percent used, period, period end. */
const CREDITS_CONFIG_FIELDS = Object.freeze([1, 4, 5]);

const pick = (source, keys) => Object.fromEntries(keys
  .filter(key => ['string', 'number', 'boolean'].includes(typeof source?.[key]))
  .map(key => [key, source[key]]));

/**
 * What a Grok tab hands back: for the subscriptions, only each one's tier,
 * status, billing system and period, and the plan's display name; for the
 * query count, only the counts; for the billing call, only the pool's
 * percent and period. The rest (the account's user id, offers, the use per
 * product) never leaves the page.
 */
export function proxyBody(path, body) {
  if (path === SUBSCRIPTIONS_PATH) {
    if (!isObject(body)) return null;
    const display = body.dominantPlan?.surfaceNames?.SURFACE_DISPLAY;
    return {
      subscriptions: (Array.isArray(body.subscriptions) ? body.subscriptions : []).filter(isObject).map(entry => pick(entry, SUBSCRIPTION_FIELDS)),
      dominantPlan: {
        ...pick(body.dominantPlan, ['plan']),
        ...(typeof display === 'string' ? { surfaceNames: { SURFACE_DISPLAY: display } } : {}),
      },
    };
  }
  if (path === RATE_LIMITS_PATH) return isObject(body) ? pick(body, RATE_LIMIT_FIELDS) : null;
  if (path === CREDITS_PATH) {
    const message = grpcMessage(body);
    const config = message ? fieldValue(protoFields(message), 1) : undefined;
    if (!(config instanceof Uint8Array)) return new Uint8Array(0);
    return grpcFrame(lengthField(1, keepFields(config, CREDITS_CONFIG_FIELDS)));
  }
  return body;
}

/** The only query count a tab may ask for: Fast mode's. */
function isFastQuery(body) {
  return isObject(body) && Object.keys(body).length === 2
    && body.requestKind === FAST_QUERY.requestKind && body.modelName === FAST_QUERY.modelName;
}

/**
 * A paid plan is metered by the weekly pool, a free account by its Fast
 * queries. A signed-out session answers the subscriptions call with 401.
 *
 * @param {import('../../core/http.js').Http} http
 * @param {{now?: number}} [context]
 */
async function fetchUsage(http, { now = Date.now() } = {}) {
  const account = parseSubscriptions(await http.getJson(SUBSCRIPTIONS_PATH), now);
  let meter = null;
  if (account.paid) {
    try {
      meter = parseCredits(await http.postGrpc(CREDITS_PATH));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  // Free, or a paid account whose pool could not be read: its query count.
  meter ??= parseFast(await http.postJson(RATE_LIMITS_PATH, FAST_QUERY), now);
  if (!meter) throw new HttpError(200, 'no_data');
  return { meters: [meter], wallets: [], plan: account.plan, subscription: account.subscription };
}

export default Object.freeze({
  id: 'grok',
  name: 'Grok',
  origin: ORIGIN,
  site: 'grok.com',
  homeUrl: `${ORIGIN}/`,
  template,
  /** Not monitored until the user switches it on and allows grok.com. */
  enabledByDefault: false,
  optionalPermission: true,
  proxyPaths: Object.freeze([/^\/rest\/subscriptions$/]),
  /** POST: the Fast query count, with exactly its body, and the billing call, which takes no arguments. */
  proxyPosts: Object.freeze([
    Object.freeze({ path: /^\/rest\/rate-limits$/, json: isFastQuery }),
    Object.freeze({ path: /^\/grok_api_v2\.GrokBuildBilling\/GetGrokCreditsConfig$/, grpc: true }),
  ]),
  proxyBody,
  /** A reply finished streaming: a new conversation, or one more turn of one. */
  isActivity(path) {
    return /^\/rest\/app-chat\/conversations\/(new|[\w-]+\/responses)$/.test(path);
  },
  fetchUsage,
});
