import { HttpError } from '../../core/http.js';
import template from './template.js';

const ORIGIN = 'https://claude.ai';
const ORG_COOKIE = 'lastActiveOrg';
const ORG_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Older response shape: one key per limit. */
const LEGACY_KEYS = Object.freeze({
  five_hour: { kind: 'session', scope: null },
  seven_day: { kind: 'weekly_all', scope: null },
  seven_day_fable: { kind: 'weekly_scoped', scope: 'Fable' },
  seven_day_opus: { kind: 'weekly_scoped', scope: 'Opus' },
  seven_day_sonnet: { kind: 'weekly_scoped', scope: 'Sonnet' },
  seven_day_oauth_apps: { kind: 'weekly_scoped', scope: 'OAuth apps' },
  seven_day_cowork: { kind: 'weekly_scoped', scope: 'Cowork' },
});

/** Fields that mark an entry as a money balance rather than a rate limit. */
const MONEY_FIELDS = ['limit_dollars', 'monthly_limit', 'used_credits', 'currency'];

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(text) {
  const words = String(text).replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

function nameOf(value) {
  if (typeof value === 'string') return value || null;
  if (!value || typeof value !== 'object') return null;
  for (const field of ['display_name', 'name', 'id']) {
    if (typeof value[field] === 'string' && value[field]) return value[field];
  }
  return null;
}

/** `scope` is null, a string, or {model: {display_name}, surface: {display_name}}. */
function scopeName(scope) {
  if (!scope) return null;
  if (typeof scope !== 'object') return nameOf(scope);
  return nameOf(scope.model) ?? nameOf(scope.surface) ?? nameOf(scope);
}

function percentOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Turn any known shape of GET /api/organizations/{org}/usage into meters.
 * Never throws; unknown entries are skipped.
 *
 * @returns {import('../../core/gauges.js').Meter[]}
 */
export function parseUsage(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const meters = [];
  const seen = new Set();
  const add = (kind, scope, used, resetsAt) => {
    if (!kind || used === null) return;
    const id = scope ? `${kind}:${slug(scope)}` : kind;
    if (seen.has(id)) return;
    seen.add(id);
    meters.push({ id, kind, scope: scope || null, used, resetsAt: isoOrNull(resetsAt) });
  };

  // Current shape: {limits: [{kind, group, percent, resets_at, scope}]}.
  if (Array.isArray(raw.limits)) {
    for (const limit of raw.limits) {
      if (!limit || typeof limit !== 'object' || typeof limit.kind !== 'string') continue;
      add(limit.kind, scopeName(limit.scope), percentOf(limit.percent ?? limit.utilization), limit.resets_at);
    }
    if (meters.length) return meters;
  }

  // Older shape: {five_hour: {utilization, resets_at}, seven_day: {...}, ...}.
  const isLimit = value => value && typeof value === 'object'
    && typeof value.utilization === 'number'
    && MONEY_FIELDS.every(field => value[field] == null);
  for (const [key, def] of Object.entries(LEGACY_KEYS)) {
    const entry = raw[key];
    if (isLimit(entry)) add(def.kind, def.scope, percentOf(entry.utilization), entry.resets_at);
  }
  for (const [key, entry] of Object.entries(raw)) {
    if (key in LEGACY_KEYS || key === 'extra_usage' || !isLimit(entry)) continue;
    const scoped = /^(seven_day|five_hour)_(.+)$/.exec(key);
    if (scoped) {
      add(scoped[1] === 'seven_day' ? 'weekly_scoped' : 'session_scoped', titleCase(scoped[2]), percentOf(entry.utilization), entry.resets_at);
    } else {
      add(key, null, percentOf(entry.utilization), entry.resets_at);
    }
  }
  return meters;
}

/** The organization to read: the one claude.ai last used, else the first chat one. */
export function pickOrg(orgs, preferredId) {
  const list = Array.isArray(orgs) ? orgs.filter(org => org && typeof org.uuid === 'string') : [];
  if (!list.length) return null;
  const preferred = preferredId ? list.find(org => org.uuid === preferredId) : null;
  if (preferred) return preferred;
  return list.find(org => Array.isArray(org.capabilities) && org.capabilities.includes('chat')) ?? list[0];
}

/** Best guess at the plan from an organization record; null when unsure. */
export function detectPlan(org) {
  if (!org || typeof org !== 'object') return null;
  const tier = String(org.rate_limit_tier ?? '').toLowerCase();
  const caps = Array.isArray(org.capabilities) ? org.capabilities.map(cap => String(cap).toLowerCase()) : [];
  const has = cap => caps.includes(cap);
  if (tier.includes('enterprise') || has('enterprise') || String(org.raven_type ?? '').toLowerCase() === 'enterprise') return 'enterprise';
  if (tier.includes('raven') || tier.includes('team') || has('raven')) return 'team';
  if (tier.includes('20x')) return 'max_20x';
  if (tier.includes('5x')) return 'max_5x';
  if (tier.includes('max') || has('claude_max')) return 'max';
  if (tier.includes('pro') || has('claude_pro')) return 'pro';
  if (has('chat')) return 'free';
  return null;
}

const usagePath = orgId => `/api/organizations/${encodeURIComponent(orgId)}/usage`;

/**
 * @param {import('../../core/http.js').Http} http
 */
async function fetchUsage(http) {
  const orgs = await http.getJson('/api/organizations');
  const preferred = await http.getCookie(ORG_COOKIE).catch(() => null);
  let org = pickOrg(orgs, preferred);
  if (!org) throw new HttpError(404, 'no_org');

  let usage;
  try {
    usage = await http.getJson(usagePath(org.uuid));
  } catch (error) {
    // A stale cookie can point at an organization this login cannot read.
    const fallback = pickOrg(orgs, null);
    const retry = error instanceof HttpError && (error.status === 403 || error.status === 404)
      && fallback && fallback.uuid !== org.uuid;
    if (!retry) throw error;
    org = fallback;
    usage = await http.getJson(usagePath(org.uuid));
  }
  return { meters: parseUsage(usage), plan: detectPlan(org) };
}

export default Object.freeze({
  id: 'claude',
  name: 'Claude',
  origin: ORIGIN,
  site: 'claude.ai',
  homeUrl: `${ORIGIN}/settings/usage`,
  template,
  /** API paths an open claude.ai tab may fetch for the background. */
  proxyPaths: Object.freeze([
    /^\/api\/organizations$/,
    new RegExp(`^/api/organizations/${ORG_ID}/usage$`, 'i'),
  ]),
  /** A page request that just spent quota: a reply finished streaming. */
  isActivity(path, durationMs) {
    if (!path.startsWith('/api/') || path.endsWith('/usage')) return false;
    return path.includes('completion') || durationMs >= 3000;
  },
  fetchUsage,
});
