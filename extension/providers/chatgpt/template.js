/**
 * ChatGPT's plan limit template. ChatGPT chats have no message cap; what runs
 * out is Codex: a 5-hour window and a weekly window, per-model extras, and
 * credits. So this card has MP and HP but no ultimate gauge, and its pouch
 * holds mana crystals (Codex credits) and potions (limit resets) instead of
 * Claude's coins and emeralds.
 */
export default Object.freeze({
  gauges: [
    {
      key: 'short',
      role: 'mp',
      match: { kind: 'codex_short', scope: null },
      label: { key: 'chatgpt.short' },
      // Some plans only have the weekly window.
      optional: true,
      sealedHint: { key: 'chatgpt.noShort' },
    },
    {
      key: 'weekly',
      role: 'hp',
      match: { kind: 'codex_weekly', scope: null },
      label: { key: 'chatgpt.weekly' },
    },
  ],

  /** Labels for limits the gauges above do not name (shown as EX rows in the popup). */
  extraLabels: {
    model_short: 'chatgpt.modelShort',
    model_weekly: 'chatgpt.modelWeekly',
    review_short: 'chatgpt.modelShort',
    review_weekly: 'chatgpt.modelWeekly',
    workspace_credits: 'chatgpt.workspace',
  },

  wallets: [
    { key: 'credits', treasure: 'crystal', match: { id: 'codex_credits' }, label: { key: 'chatgpt.credits' } },
    { key: 'resets', treasure: 'potion', match: { id: 'limit_resets' }, label: { key: 'chatgpt.resets' } },
  ],

  /** Personal plans from the top: Pro is adventurer rank A, then B, C, D, E. */
  ladder: ['pro', 'prolite', 'plus', 'go', 'free'],

  plans: {
    pro: { name: 'Pro' },
    prolite: { name: 'Pro Lite' },
    plus: { name: 'Plus' },
    go: { name: 'Go' },
    free: { name: 'Free' },
    team: { name: 'Team', rank: 'B' },
    business: { name: 'Business', rank: 'B' },
    edu: { name: 'Edu', rank: 'C' },
    enterprise: { name: 'Enterprise', rank: 'S' },
  },

  messages: {
    zh_CN: {
      'chatgpt.short': 'Codex / 5 小时',
      'chatgpt.weekly': 'Codex / 每周',
      'chatgpt.noShort': '当前方案没有 5 小时窗口',
      'chatgpt.modelShort': '{name} / 5 小时',
      'chatgpt.modelWeekly': '{name} / 每周',
      'chatgpt.workspace': '工作区额度',
      'chatgpt.credits': 'Codex 额度',
      'chatgpt.resets': '限额重置次数',
    },
    ja: {
      'chatgpt.short': 'Codex / 5 時間',
      'chatgpt.weekly': 'Codex / 週間',
      'chatgpt.noShort': '現在のプランには 5 時間枠がありません',
      'chatgpt.modelShort': '{name} / 5 時間',
      'chatgpt.modelWeekly': '{name} / 週間',
      'chatgpt.workspace': 'ワークスペース枠',
      'chatgpt.credits': 'Codex クレジット',
      'chatgpt.resets': '制限リセット回数',
    },
    en: {
      'chatgpt.short': 'Codex / 5 hours',
      'chatgpt.weekly': 'Codex / Weekly',
      'chatgpt.noShort': 'Your plan has no 5-hour window',
      'chatgpt.modelShort': '{name} / 5 hours',
      'chatgpt.modelWeekly': '{name} / Weekly',
      'chatgpt.workspace': 'Workspace credits',
      'chatgpt.credits': 'Codex credits',
      'chatgpt.resets': 'Limit resets',
    },
  },
});
