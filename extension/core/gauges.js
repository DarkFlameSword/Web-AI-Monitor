import { ROLES, roleOf } from './roles.js';
import { parseIso } from './time.js';

/**
 * A limit as every provider reports it, whatever the vendor's own format is.
 *
 * @typedef {object} Meter
 * @property {string} id              Stable id, e.g. "session" or "weekly_scoped:fable".
 * @property {string} kind            Vendor's kind of limit, e.g. "session", "weekly_all", "weekly_scoped".
 * @property {string|null} scope      Model or surface the limit applies to, e.g. "Fable".
 * @property {number} used            Percent of the limit used, 0-100.
 * @property {string|null} resetsAt   ISO time the window resets; null when no window is running.
 */

/**
 * One row of the guild card.
 *
 * @typedef {object} GaugeView
 * @property {string} key
 * @property {string} role                     Key into ROLES.
 * @property {{key: string, vars?: object}} label
 * @property {boolean} primary                 Named by the plan template (shown in the page HUD).
 * @property {'ok'|'sealed'|'missing'} state   sealed: the plan has no such limit.
 * @property {{key: string, vars?: object}|null} hint
 * @property {number} value                    Remaining, 0-100, as shown to the user.
 * @property {number|null} resetsAt            Epoch ms.
 * @property {boolean} recovering              The window ended; fresh numbers not fetched yet.
 * @property {'ok'|'low'|'critical'|'empty'} level
 * @property {boolean} ready                   Full ultimate gauge.
 */

export function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/**
 * Remaining percent as an integer. It reads 100 only when nothing was used and
 * 0 only when nothing is left, so "full" and "empty" are never rounding noise.
 */
export function displayRemaining(used) {
  const remaining = 100 - used;
  if (remaining >= 100) return 100;
  if (remaining <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(remaining)));
}

export function levelOf(value) {
  if (value <= 0) return 'empty';
  if (value < 20) return 'critical';
  if (value < 50) return 'low';
  return 'ok';
}

/**
 * Does a meter satisfy a template's match rule?
 * `kind` must be equal. `scope: null` asks for an unscoped meter; a string
 * matches a scope that contains it, ignoring case ("fable" matches "Fable 5.1").
 */
export function matchMeter(meter, match) {
  if (!meter || !match) return false;
  if (match.kind !== undefined && meter.kind !== match.kind) return false;
  if (match.scope === null) return !meter.scope;
  if (typeof match.scope === 'string') {
    return typeof meter.scope === 'string' && meter.scope.toLowerCase().includes(match.scope.toLowerCase());
  }
  return true;
}

function humanize(kind) {
  const words = String(kind || '').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '?';
}

/** Label for a limit the template does not name. */
export function extraLabel(template, meter) {
  const name = meter.scope || humanize(meter.kind);
  const key = template.extraLabels?.[meter.kind]
    ?? (/^week|seven_day/.test(meter.kind) ? 'meter.weeklyScoped'
      : /^session|five_hour/.test(meter.kind) ? 'meter.sessionScoped'
        : 'meter.other');
  return { key, vars: { name } };
}

function gaugeView(def, meter, now) {
  const role = ROLES[def.role] ? def.role : 'ex';
  const base = {
    key: def.key,
    role,
    label: def.label,
    primary: def.primary !== false,
    hint: null,
  };
  if (!meter) {
    return {
      ...base,
      state: def.optional ? 'sealed' : 'missing',
      hint: def.optional ? def.sealedHint ?? null : null,
      value: 0,
      resetsAt: null,
      recovering: false,
      level: 'empty',
      ready: false,
    };
  }

  let used = clampPercent(meter.used) ?? 0;
  let resetsAt = parseIso(meter.resetsAt);
  let recovering = false;
  // Once the window is over the pool is full again, even before we refetch.
  if (resetsAt !== null && now >= resetsAt) {
    used = 0;
    resetsAt = null;
    recovering = true;
  }
  const value = displayRemaining(used);
  return {
    ...base,
    state: 'ok',
    value,
    resetsAt,
    recovering,
    level: levelOf(value),
    ready: roleOf(role).readyWhenFull && value === 100,
  };
}

/**
 * Lay a provider's meters onto its plan template: the template's gauges come
 * first in its order, then any meter the template does not name.
 *
 * @param {object} template
 * @param {Meter[]} meters
 * @param {number} now  Epoch ms.
 * @returns {GaugeView[]}
 */
export function buildGaugeViews(template, meters, now) {
  const { pairs, rest } = pairGauges(template, meters);
  return [
    ...pairs.map(({ def, meter }) => gaugeView(def, meter, now)),
    ...rest.map(meter => gaugeView({ key: meter.id, role: 'ex', label: extraLabel(template, meter), primary: false }, meter, now)),
  ];
}

/** Each template gauge with the meter it claims (or null), plus the unclaimed meters. */
function pairGauges(template, meters) {
  const list = Array.isArray(meters) ? meters : [];
  const taken = new Set();
  const pairs = template.gauges.map(def => {
    const meter = list.find(m => !taken.has(m.id) && matchMeter(m, def.match)) ?? null;
    if (meter) taken.add(meter.id);
    return { def, meter };
  });
  return { pairs, rest: list.filter(meter => !taken.has(meter.id)) };
}

/**
 * The template's gauges whose window has ended by `now` after some use:
 * they are full again. Used for the "fully restored" notification.
 *
 * @returns {{def: object, meter: Meter, resetsAt: number}[]}
 */
export function recoveredGauges(template, meters, now) {
  return pairGauges(template, meters).pairs
    .map(({ def, meter }) => ({ def, meter, resetsAt: parseIso(meter?.resetsAt) }))
    .filter(({ meter, resetsAt }) => meter && resetsAt !== null && resetsAt <= now && meter.used > 0);
}

/** The view for one role, e.g. the MP gauge for the toolbar badge. */
export function viewForRole(views, role) {
  return views.find(v => v.role === role && v.primary) ?? null;
}
