/**
 * Claude's plan limit template: which limits a claude.ai plan has, and which
 * gauge each one plays. Data only; provider.js turns the API into meters and
 * the theme draws the roles. To support another vendor, write one of these
 * next to its provider (see README).
 */
export default Object.freeze({
  gauges: [
    {
      key: 'session',
      role: 'mp',
      match: { kind: 'session', scope: null },
      label: { key: 'meter.session' },
    },
    {
      key: 'weekly',
      role: 'hp',
      match: { kind: 'weekly_all', scope: null },
      label: { key: 'meter.weeklyAll' },
    },
    {
      key: 'fable',
      role: 'sp',
      match: { kind: 'weekly_scoped', scope: 'fable' },
      label: { key: 'meter.weeklyScoped', vars: { name: 'Fable' } },
      // Pro and standard Team seats pay for Fable with credits instead.
      optional: true,
      sealedHint: { key: 'claude.fableSealed' },
    },
  ],

  /** The treasure pouch: money next to the limits, in this order. */
  wallets: [
    { key: 'cloud', treasure: 'emerald', match: { id: 'cloud_session' }, label: { key: 'claude.cloudCredits' } },
    { key: 'usage', treasure: 'coin', match: { id: 'usage_credits' }, label: { key: 'claude.usageCredits' } },
  ],

  /** Personal plans from the top: the best is adventurer rank A, then B, C, D. */
  ladder: ['max_20x', 'max_5x', 'pro', 'free'],

  /** Plan id (from provider.js) -> name on the card; plans off the ladder say their rank. */
  plans: {
    max_20x: { name: 'Max 20x' },
    max_5x: { name: 'Max 5x' },
    pro: { name: 'Pro' },
    free: { name: 'Free' },
    // Max with an unknown multiplier counts as the lower Max tier.
    max: { name: 'Max', rankAs: 'max_5x' },
    team: { name: 'Team', rank: 'B' },
    enterprise: { name: 'Enterprise', rank: 'S' },
  },

  /** Strings only this vendor needs. */
  messages: {
    zh_CN: {
      'claude.fableSealed': '当前方案没有 Fable 周额度',
      'claude.cloudCredits': '云端会话额度',
      'claude.usageCredits': '用量额度',
    },
    ja: {
      'claude.fableSealed': '現在のプランには Fable の週間枠がありません',
      'claude.cloudCredits': 'クラウドセッション枠',
      'claude.usageCredits': '利用クレジット',
    },
    en: {
      'claude.fableSealed': 'Your plan has no weekly Fable limit',
      'claude.cloudCredits': 'Cloud session credits',
      'claude.usageCredits': 'Usage credits',
    },
  },
});
