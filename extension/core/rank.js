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
