import { HttpError } from '../../core/http.js';
import template from './template.js';

const ORIGIN = 'https://gemini.google.com';
/** The app page: it carries the session's request token. */
const APP_PATH = '/app';
const BATCH_PATH = '/_/BardChatUi/data/batchexecute';
/** GetUsageInfo, the RPC behind the app's Settings > Usage page. */
const USAGE_RPC = 'jSf9Qc';
/** f.req of one GetUsageInfo call, which takes no arguments. */
export const USAGE_FREQ = JSON.stringify([[[USAGE_RPC, '[]', null, 'generic']]]);
/** Session values in the app page's WIZ_global_data: the request token, build label, session id, language. */
const PAGE_KEYS = Object.freeze({ at: 'SNlM0e', bl: 'cfb2h', sid: 'FdrFJe', hl: 'TuX5cc' });
/** The app page is large; its token is reused for this long (memory only). */
const SESSION_TTL_MS = 30 * 60_000;

/** Usage metric types in the reply. Type 3 is the AI credits balance, not a window. */
const METRIC_KINDS = Object.freeze({ 1: 'window_5h', 2: 'weekly' });
const AI_CREDITS = 3;
/** Plan tiers in the reply. */
const TIERS = Object.freeze({ 1: 'free', 2: 'pro', 3: 'ultra', 4: 'plus', 6: 'ultra' });

const isObject = value => Boolean(value) && typeof value === 'object';

/**
 * The page's session values, or null when the page has no request token (a
 * signed-out, guest page). Works on the full app page and on the trimmed
 * form a tab hands back (see proxyBody).
 */
export function pageSession(html) {
  if (typeof html !== 'string') return null;
  const read = key => {
    const match = new RegExp(`"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
    if (!match) return null;
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return null;
    }
  };
  const at = read(PAGE_KEYS.at);
  if (!at) return null;
  return { at, bl: read(PAGE_KEYS.bl), sid: read(PAGE_KEYS.sid), hl: read(PAGE_KEYS.hl) };
}

/**
 * The parts of a batchexecute reply: after the ")]}'" guard come frames, each
 * a length (in UTF-16 units, so JS string length, counted from the newline
 * after the number) followed by a JSON array of parts. Never throws.
 */
export function rpcParts(text) {
  const body = String(text ?? '').replace(/^\)\]\}'/, '');
  const parts = [];
  const marker = /\s*(\d+)\n/y;
  let pos = 0;
  for (;;) {
    marker.lastIndex = pos;
    const match = marker.exec(body);
    if (!match) break;
    const start = marker.lastIndex - 1;
    const end = start + Number(match[1]);
    if (end > body.length) break;
    try {
      const value = JSON.parse(body.slice(start, end));
      if (Array.isArray(value)) parts.push(...value);
    } catch {
      // Not a frame of JSON: skip it.
    }
    pos = end;
  }
  if (parts.length) return parts;
  // Not framed: one JSON document, or one per line.
  for (const chunk of [body, ...body.split('\n')]) {
    try {
      const value = JSON.parse(chunk.trim());
      if (Array.isArray(value)) parts.push(...value);
      if (chunk === body && parts.length) break;
    } catch {
      // Not JSON.
    }
  }
  return parts;
}

/** Epoch seconds (or ms) as ISO, or null. */
function isoOf(stamp) {
  const value = Number(stamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value > 1e12 ? value : value * 1000).toISOString();
}

/**
 * Turn a GetUsageInfo result into meters, the AI credits wallet and the plan.
 * Never throws.
 *
 * Shape: [tier, [[remaining, usedFraction, metricType, [[resetEpochSeconds, nanos]]], ...], useOverageAiCredits]
 *
 * @returns {{meters: import('../../core/gauges.js').Meter[], wallets: import('../../core/wallets.js').Wallet[], plan: string|null}}
 */
export function parseUsageInfo(body) {
  const meters = [];
  const wallets = [];
  const items = Array.isArray(body?.[1]) ? body[1] : [];
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const [remaining, fraction, type] = item;
    if (type === AI_CREDITS) {
      const balance = Number(remaining);
      if (!Number.isFinite(balance)) continue;
      wallets.push({
        id: 'ai_credits',
        kind: 'stock',
        unit: 'credits',
        currency: null,
        unlimited: false,
        balance,
        total: null,
        spent: null,
        cap: null,
        expiresAt: null,
        enabled: true,
        locked: false,
        capReached: false,
      });
      continue;
    }
    const used = Number(fraction);
    if (typeof fraction !== 'number' || !Number.isFinite(used)) continue;
    const kind = METRIC_KINDS[type] ?? `limit_${type}`;
    if (meters.some(meter => meter.id === kind)) continue;
    meters.push({
      id: kind,
      kind,
      scope: null,
      used: Math.min(100, Math.max(0, used * 100)),
      resetsAt: isoOf(isObject(item[3]) ? item[3]?.[0]?.[0] : null),
    });
  }
  return { meters, wallets, plan: TIERS[body?.[0]] ?? null };
}

/** The GetUsageInfo result in a batchexecute reply. A permission-denied part means signed out. */
export function usageInfoOf(text) {
  for (const part of rpcParts(text)) {
    if (!Array.isArray(part) || part[0] !== 'wrb.fr' || part[1] !== USAGE_RPC) continue;
    if (Array.isArray(part[5]) && part[5][0] === 7) throw new HttpError(401, 'signed_out');
    if (typeof part[2] !== 'string') continue;
    try {
      return JSON.parse(part[2]);
    } catch {
      // Keep looking.
    }
  }
  return null;
}

/**
 * What a Gemini tab hands back for the app page: only the four session
 * values, as `"key":"value"` pairs pageSession() reads. The rest of the page
 * (the account's name, email, chats) never leaves it.
 */
export function proxyBody(path, body) {
  if (path !== APP_PATH) return body;
  const session = pageSession(body);
  if (!session) return '';
  return Object.entries(PAGE_KEYS)
    .filter(([field]) => session[field])
    .map(([field, key]) => `"${key}":${JSON.stringify(session[field])}`)
    .join(',');
}

/** The only form a tab may post for the background: one GetUsageInfo call. */
function isUsageForm(fields) {
  const keys = Object.keys(fields).sort();
  return keys.length === 2 && keys[0] === 'at' && keys[1] === 'f.req'
    && typeof fields.at === 'string' && fields['f.req'] === USAGE_FREQ;
}

function usagePath(session) {
  const params = new URLSearchParams({
    rpcids: USAGE_RPC,
    'source-path': '/usage',
    hl: session.hl || 'en',
    _reqid: String(100000 + Math.floor(Math.random() * 900000)),
    rt: 'c',
  });
  if (session.bl) params.set('bl', session.bl);
  if (session.sid) params.set('f.sid', session.sid);
  return `${BATCH_PATH}?${params}`;
}

/** The session values, kept in the worker's memory only (never stored). */
let cached = null;

/** Drop the remembered session values (a new sign-in, or a test). */
export function forgetSession() {
  cached = null;
}

async function sessionOf(http, now) {
  if (cached && now - cached.at < SESSION_TTL_MS) return { session: cached.session, reused: true };
  const session = pageSession(await http.getText(APP_PATH));
  // No request token in the app page: not signed in to Google.
  if (!session) throw new HttpError(401, 'signed_out');
  cached = { session, at: now };
  return { session, reused: false };
}

/**
 * @param {import('../../core/http.js').Http} http
 */
async function fetchUsage(http, now = Date.now()) {
  for (;;) {
    const { session, reused } = await sessionOf(http, now);
    let body;
    try {
      const text = await http.postForm(usagePath(session), { at: session.at, 'f.req': USAGE_FREQ }, { headers: { 'x-same-domain': '1' } });
      body = usageInfoOf(text);
    } catch (error) {
      // A remembered token may have gone stale: fetch the page once more.
      if (reused && error instanceof HttpError) {
        forgetSession();
        continue;
      }
      throw error;
    }
    if (!body) throw new HttpError(200, 'no_data');
    return parseUsageInfo(body);
  }
}

export default Object.freeze({
  id: 'gemini',
  name: 'Gemini',
  origin: ORIGIN,
  site: 'gemini.google.com',
  homeUrl: `${ORIGIN}${APP_PATH}`,
  template,
  /** Not monitored until the user switches it on and allows gemini.google.com. */
  enabledByDefault: false,
  optionalPermission: true,
  /** GET: the app page, for its session values (the tab hands back only those). */
  proxyPaths: Object.freeze([/^\/app$/]),
  /** POST: only the read-only usage call, with exactly its form. */
  proxyPosts: Object.freeze([
    Object.freeze({ path: /^\/_\/BardChatUi\/data\/batchexecute\?rpcids=jSf9Qc&[^#]*$/, form: isUsageForm }),
  ]),
  proxyHeaders: Object.freeze(['x-same-domain']),
  proxyBody,
  /** A reply finished streaming. */
  isActivity(path) {
    return path.endsWith('/StreamGenerate');
  },
  fetchUsage,
});
