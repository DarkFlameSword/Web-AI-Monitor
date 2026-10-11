/**
 * Gemini's plan limit template. Since May 2026 the Gemini app meters compute
 * instead of counting prompts: a 5-hour window inside a weekly cap, the same
 * for every model and feature (heavier work just uses it faster). So this
 * card has MP and HP and no ultimate gauge, and its pouch holds sapphires:
 * the Google AI credits that can top up the limits.
 */
export default Object.freeze({
  gauges: [
    {
      key: 'window',
      role: 'mp',
      match: { kind: 'window_5h', scope: null },
      label: { key: 'gemini.window' },
    },
    {
      key: 'weekly',
      role: 'hp',
      match: { kind: 'weekly', scope: null },
      label: { key: 'gemini.weekly' },
    },
  ],

  wallets: [
    { key: 'credits', treasure: 'sapphire', match: { id: 'ai_credits' }, label: { key: 'gemini.credits' } },
  ],

  /** Google AI plans from the top: Ultra is adventurer rank A, then Pro, Plus and Free. */
  ladder: ['ultra', 'pro', 'plus', 'free'],

  plans: {
    ultra: { name: 'Ultra' },
    pro: { name: 'Pro' },
    plus: { name: 'Plus' },
    free: { name: 'Free' },
  },

  /** Why the vendor may answer without usage data, under the card's notice. */
  noDataHint: { key: 'gemini.noData' },

  messages: {
    zh_CN: {
      'gemini.window': 'Gemini / 5 小时',
      'gemini.weekly': 'Gemini / 每周',
      'gemini.credits': 'Google AI 额度',
      'gemini.noData': 'Gemini「设置 > 用量」里有数据时，这里才会显示',
    },
    ja: {
      'gemini.window': 'Gemini / 5 時間',
      'gemini.weekly': 'Gemini / 週間',
      'gemini.credits': 'Google AI クレジット',
      'gemini.noData': 'Gemini の「設定 > 使用量」にデータがあるときに表示されます',
    },
    en: {
      'gemini.window': 'Gemini / 5 hours',
      'gemini.weekly': 'Gemini / Weekly',
      'gemini.credits': 'Google AI credits',
      'gemini.noData': "Shown once Gemini's Settings > Usage has data",
    },
  },
});
