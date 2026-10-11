/**
 * Adventurer rank from the plan. A template lists the vendor's personal
 * plans from the top in `ladder`: the best is A, each step down is one
 * letter lower. Other plans name their rank, or rank as another plan.
 *
 * @returns {{name: string, rank: string|null}|null}
 */
export function qualificationOf(template, planId) {
  const plan = planId ? template.plans?.[planId] : null;
  if (!plan) return null;
  return { name: plan.name, rank: rankOf(template, planId, new Set()) };
}

function rankOf(template, planId, seen) {
  if (seen.has(planId)) return null;
  seen.add(planId);
  const plan = template.plans?.[planId];
  if (!plan) return null;
  if (plan.rank) return plan.rank;
  if (plan.rankAs) return rankOf(template, plan.rankAs, seen);
  const step = (template.ladder ?? []).indexOf(planId);
  return step >= 0 ? String.fromCharCode(65 + step) : null;
}

/**
 * A calendar day typed as YYYY-MM-DD (what a date input gives), as the
 * local start of that day and the moment it is over. Null when invalid.
 *
 * @returns {{start: number, end: number}|null}
 */
export function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === 'string' ? text : '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  return { start: start.getTime(), end: new Date(year, month - 1, day + 1).getTime() };
}

/**
 * When the qualification lapses: the date the user entered in settings
 * (the last day it is valid).
 *
 * @param {string|null|undefined} day  YYYY-MM-DD.
 * @param {number} now  Epoch ms.
 * @returns {{day: number|null, expired: boolean, msLeft: number|null}}
 */
export function qualificationExpiry(day, now) {
  const parsed = parseDay(day);
  if (!parsed) return { day: null, expired: false, msLeft: null };
  return { day: parsed.start, expired: now >= parsed.end, msLeft: parsed.end - now };
}

/**
 * The paid period as the vendor reports it, for vendors that do (ChatGPT).
 * Times are ISO strings.
 *
 * @typedef {object} Subscription
 * @property {string|null} startsAt  When the current period began.
 * @property {string|null} endsAt    When it ends: the renewal, or the last moment if it will not renew.
 * @property {boolean|null} renews   Whether it renews then; null when the vendor does not say.
 * @property {number} checkedAt      Epoch ms of the last time it was asked for.
 */

/**
 * When the qualification lapses or renews, from the period the vendor
 * reported. Null when it reported no end, so the date the user entered is
 * used instead (see qualificationExpiry).
 *
 * @param {Subscription|null|undefined} subscription
 * @param {number} now  Epoch ms.
 * @returns {{day: number, expired: boolean, msLeft: number, renews: boolean, startDay: number|null}|null}
 */
export function subscriptionTerm(subscription, now) {
  const end = Date.parse(subscription?.endsAt ?? '');
  if (!Number.isFinite(end)) return null;
  const start = Date.parse(subscription.startsAt ?? '');
  const renews = subscription.renews === true;
  return { day: end, expired: !renews && now >= end, msLeft: end - now, renews, startDay: Number.isFinite(start) ? start : null };
}
