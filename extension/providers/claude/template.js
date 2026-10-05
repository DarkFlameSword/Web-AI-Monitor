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

  /** Plan id (from provider.js) -> name shown on the card and guild rank. */
  plans: {
    free: { name: 'Free', rank: 'F' },
    pro: { name: 'Pro', rank: 'C' },
    max: { name: 'Max', rank: 'B' },
    max_5x: { name: 'Max 5x', rank: 'B' },
    max_20x: { name: 'Max 20x', rank: 'A' },
    team: { name: 'Team', rank: 'B' },
    enterprise: { name: 'Enterprise', rank: 'S' },
  },

  /** Strings only this vendor needs. */
  messages: {
    zh_CN: { 'claude.fableSealed': '当前方案没有 Fable 周额度' },
    ja: { 'claude.fableSealed': '現在のプランには Fable の週間枠がありません' },
    en: { 'claude.fableSealed': 'Your plan has no weekly Fable limit' },
  },
});
