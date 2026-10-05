import { parseIso } from './time.js';

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
 * When the qualification lapses: the subscription's end or renewal date.
 *
 * @param {{endsAt?: string|null, renews?: boolean|null}|null|undefined} subscription
 * @returns {{expiresAt: number|null, renews: boolean|null}}
 */
export function qualificationExpiry(subscription) {
  return {
    expiresAt: parseIso(subscription?.endsAt),
    renews: typeof subscription?.renews === 'boolean' ? subscription.renews : null,
  };
}
