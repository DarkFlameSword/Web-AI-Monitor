import { isAuthError } from '../../core/http.js';
import template from './template.js';

const ORIGIN = 'https://chatgpt.com';
const USAGE_PATH = '/backend-api/wham/usage';
const SESSION_PATH = '/api/auth/session';
/** The current paid period of an account: GET with ?account_id=. */
const SUBSCRIPTION_PATH = '/backend-api/subscriptions';
/** The period changes about once a month, so it is asked for again only after this long. */
const SUBSCRIPTION_TTL_MS = 6 * 60 * 60_000;
/** Windows up to a day long are the short window; longer ones are weekly. */
const SHORT_WINDOW_MAX_S = 24 * 60 * 60;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A number, or a numeric string (the API sends some amounts as strings). */
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** ISO reset time from `reset_at` (epoch seconds) or `reset_after_seconds`. */
function resetOf(window, now) {
  const at = numberOf(window.reset_at);
  if (at !== null && at > 0) return new Date(at > 1e12 ? at : at * 1000).toISOString();
  const after = numberOf(window.reset_after_seconds);
  return after !== null ? new Date(now + after * 1000).toISOString() : null;
}

function lengthOf(window, fallback) {
  const seconds = numberOf(window.limit_window_seconds);
  if (seconds === null) return fallback;
  return seconds <= SHORT_WINDOW_MAX_S ? 'short' : 'weekly';
}

/**
 * Turn GET /backend-api/wham/usage into meters. Never throws.
 *
 * Shape: { rate_limit: { primary_window, secondary_window }, code_review_rate_limit,
 *          additional_rate_limits: [{ limit_name, metered_feature, rate_limit }],
 *          spend_control: { individual_limit }, credits, rate_limit_reset_credits, plan_type }
 * where a window is { used_percent, limit_window_seconds, reset_after_seconds, reset_at }.
 *
 * @returns {import('../../core/gauges.js').Meter[]}
 */
export function parseUsage(raw, now = Date.now()) {
  if (!isObject(raw)) return [];
  const meters = [];
  const seen = new Set();
  const add = (kind, scope, window) => {
    if (!isObject(window)) return;
    const used = numberOf(window.used_percent);
    if (used === null) return;
    let id = scope ? `${kind}:${slug(scope)}` : kind;
    while (seen.has(id)) id += '+';
    seen.add(id);
    meters.push({ id, kind, scope: scope || null, used: Math.min(100, Math.max(0, used)), resetsAt: resetOf(window, now) });
  };
  const addWindows = (prefix, scope, limit) => {
    if (!isObject(limit)) return;
    if (isObject(limit.primary_window)) add(`${prefix}_${lengthOf(limit.primary_window, 'short')}`, scope, limit.primary_window);
    if (isObject(limit.secondary_window)) add(`${prefix}_${lengthOf(limit.secondary_window, 'weekly')}`, scope, limit.secondary_window);
  };

  addWindows('codex', null, raw.rate_limit);
  addWindows('review', 'Code review', raw.code_review_rate_limit);
  for (const extra of Array.isArray(raw.additional_rate_limits) ? raw.additional_rate_limits : []) {
    if (!isObject(extra)) continue;
    const name = typeof extra.limit_name === 'string' && extra.limit_name
      ? extra.limit_name
      : typeof extra.metered_feature === 'string' && extra.metered_feature ? extra.metered_feature : 'Model';
    addWindows('model', name, extra.rate_limit);
  }
  const workspace = raw.spend_control?.individual_limit;
  if (isObject(workspace)) add('workspace_credits', null, workspace);
  return meters;
}

/**
 * Codex credits (a balance in credits, or unlimited) and limit resets (a count).
 *
 * @returns {import('../../core/wallets.js').Wallet[]}
 */
export function parseWallets(raw) {
  if (!isObject(raw)) return [];
  const wallets = [];
  const credits = raw.credits;
  if (isObject(credits)) {
    const unlimited = credits.unlimited === true;
    wallets.push({
      id: 'codex_credits',
      kind: 'stock',
      unit: 'credits',
      currency: null,
      unlimited,
      balance: numberOf(credits.balance),
      total: null,
      spent: null,
      cap: null,
      expiresAt: null,
      enabled: unlimited || credits.has_credits === true,
      locked: false,
      capReached: credits.overage_limit_reached === true,
    });
  }
  const resets = raw.rate_limit_reset_credits;
  if (isObject(resets) && numberOf(resets.available_count) !== null) {
    wallets.push({
      id: 'limit_resets',
      kind: 'stock',
      unit: 'count',
      currency: null,
      unlimited: false,
      balance: numberOf(resets.available_count),
      total: null,
      spent: null,
      cap: null,
      expiresAt: null,
      enabled: true,
      locked: false,
      capReached: false,
    });
  }
  return wallets;
}

const PLAN_ALIASES = Object.freeze({
  pro_lite: 'prolite',
  'pro-lite': 'prolite',
  chatgptplusplan: 'plus',
  chatgptpro: 'pro',
});

/** The plan id the template knows, from `plan_type` (or the session's planType). */
export function normalizePlan(value) {
  if (typeof value !== 'string' || !value) return null;
  const plan = value.toLowerCase().replace(/\s+/g, '');
  const known = PLAN_ALIASES[plan] ?? plan;
  return template.plans[known] ? known : null;
}

/** An ISO time from an ISO string or epoch seconds / ms, or null. */
function isoOf(value) {
  const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * The current paid period. Never throws.
 *
 * Shape: { id, plan_type, active_start, active_until, billing_period, will_renew, is_delinquent }
 * with the times as ISO strings.
 *
 * @returns {import('../../core/rank.js').Subscription}
 */
export function parseSubscription(raw, now) {
  const data = isObject(raw) ? raw : {};
  return {
    startsAt: isoOf(data.active_start),
    endsAt: isoOf(data.active_until),
    renews: typeof data.will_renew === 'boolean' ? data.will_renew : null,
    checkedAt: now,
  };
}

/** Claims of a JWT access token, or null. Only read, never verified or stored. */
export function tokenClaims(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The page's session: an access token for backend-api when the session
 * endpoint still hands one out, and the account it belongs to. Newer
 * ChatGPT pages may not return a token; the usage request is then sent with
 * cookies only.
 */
async function sessionOf(http) {
  let session = null;
  try {
    session = await http.getJson(SESSION_PATH);
  } catch (error) {
    if (isAuthError(error)) throw error;
  }
  const token = typeof session?.accessToken === 'string' && session.accessToken ? session.accessToken : null;
  const auth = (token ? tokenClaims(token) : null)?.['https://api.openai.com/auth'] ?? {};
  return {
    token,
    accountId: session?.account?.id ?? auth.chatgpt_account_id ?? null,
    planType: session?.account?.planType ?? auth.chatgpt_plan_type ?? null,
  };
}

/** The fields of the subscription reply a tab hands back. */
const SUBSCRIPTION_FIELDS = Object.freeze(['active_start', 'active_until', 'will_renew']);

/**
 * What a ChatGPT tab hands back: for the session request, only the token and
 * the account it belongs to; for the subscription, only its period and
 * whether it renews. The rest (session cookie, email, name, billing details)
 * never leaves the page.
 */
export function proxyBody(path, body) {
  if (path.startsWith(`${SUBSCRIPTION_PATH}?`)) {
    if (!isObject(body)) return null;
    return Object.fromEntries(SUBSCRIPTION_FIELDS
      .filter(key => ['string', 'number', 'boolean'].includes(typeof body[key]))
      .map(key => [key, body[key]]));
  }
  if (path !== SESSION_PATH) return body;
  if (!isObject(body)) return null;
  const pick = {};
  if (typeof body.accessToken === 'string') pick.accessToken = body.accessToken;
  if (isObject(body.account)) {
    pick.account = {};
    if (typeof body.account.id === 'string') pick.account.id = body.account.id;
    if (typeof body.account.planType === 'string') pick.account.planType = body.account.planType;
  }
  return pick;
}

/**
 * The paid period, asked for at most every few hours: the last snapshot's is
 * kept while the plan stays the same and the period has not ended. A free
 * account has none. A failed request does not fail the refresh; the card
 * keeps what it knew, and asks again later.
 *
 * @returns {Promise<import('../../core/rank.js').Subscription|null>}
 */
async function subscriptionOf(http, { headers, accountId, plan, previous, now }) {
  if (plan === 'free') return null;
  const known = isObject(previous?.subscription) ? previous.subscription : null;
  const ended = Date.parse(known?.endsAt ?? '') <= now;
  if (known && previous.plan === plan && !ended && now - known.checkedAt < SUBSCRIPTION_TTL_MS) return known;
  if (!accountId) return known;
  try {
    const raw = await http.getJson(`${SUBSCRIPTION_PATH}?account_id=${encodeURIComponent(accountId)}`, { headers });
    return parseSubscription(raw, now);
  } catch {
    return { ...(known ?? parseSubscription(null, now)), checkedAt: now };
  }
}

/**
 * @param {import('../../core/http.js').Http} http
 * @param {{now?: number, previous?: import('../../core/store.js').Snapshot|null}} [context]
 */
async function fetchUsage(http, { now = Date.now(), previous = null } = {}) {
  const { token, accountId, planType } = await sessionOf(http);
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (accountId) headers['chatgpt-account-id'] = accountId;
  const usage = await http.getJson(USAGE_PATH, { headers });
  const plan = normalizePlan(usage?.plan_type) ?? normalizePlan(planType);
  return {
    meters: parseUsage(usage, now),
    wallets: parseWallets(usage),
    plan,
    subscription: await subscriptionOf(http, { headers, accountId, plan, previous, now }),
  };
}

export default Object.freeze({
  id: 'chatgpt',
  name: 'ChatGPT',
  origin: ORIGIN,
  site: 'chatgpt.com',
  homeUrl: `${ORIGIN}/codex/settings/usage`,
  template,
  /** Not monitored until the user switches it on and allows chatgpt.com. */
  enabledByDefault: false,
  optionalPermission: true,
  proxyPaths: Object.freeze([
    /^\/api\/auth\/session$/,
    /^\/backend-api\/wham\/usage$/,
    /^\/backend-api\/subscriptions\?account_id=[\w%.-]+$/,
  ]),
  /** Headers the usage and subscription requests need on the tab route. */
  proxyHeaders: Object.freeze(['authorization', 'chatgpt-account-id']),
  proxyBody,
  /** A reply or a Codex task just finished streaming. */
  isActivity(path, durationMs) {
    if (!path.startsWith('/backend-api/') || path === USAGE_PATH) return false;
    return /\/conversation(\/|$)/.test(path) || path.includes('/wham/tasks') || durationMs >= 3000;
  },
  fetchUsage,
});
