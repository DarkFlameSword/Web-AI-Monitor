/**
 * Grok's plan limit template. Since August 2026 grok.com meters paid plans
 * with one weekly pool shared by every Grok product (chat, Imagine, voice,
 * Grok Build...), and free accounts with a count of Fast-mode queries in a
 * rolling window. An account has one or the other, so both gauges are
 * optional: the one its plan does not have is sealed. No pouch: grok.com
 * reports no credits next to the limits.
 */
export default Object.freeze({
  gauges: [
    {
      key: 'fast',
      role: 'mp',
      match: { kind: 'fast', scope: null },
      label: { key: 'grok.fast' },
      optional: true,
      sealedHint: { key: 'grok.noFast' },
      // grok.com does not say when a query frees up: the window rolls.
      idle: { key: 'grok.rolling', short: 'grok.rollingShort' },
    },
    {
      key: 'weekly',
      role: 'hp',
      match: { kind: 'weekly_pool', scope: null },
      label: { key: 'grok.weekly' },
      optional: true,
      sealedHint: { key: 'grok.noWeekly' },
    },
  ],

  /**
   * The X Subscription plans (from October 2026) from the top: Ultra is
   * adventurer rank A, then Super, Premium, Plus and Free. The SuperGrok
   * plans bought before it keep their names and rank as the plan that
   * replaced them.
   */
  ladder: ['ultra', 'super', 'premium', 'plus', 'free'],

  plans: {
    ultra: { name: 'Ultra' },
    super: { name: 'Super' },
    premium: { name: 'Premium' },
    plus: { name: 'Plus' },
    free: { name: 'Free' },
    supergrok_heavy: { name: 'SuperGrok Heavy', rankAs: 'ultra' },
    supergrok_plus: { name: 'SuperGrok Plus', rankAs: 'super' },
    supergrok: { name: 'SuperGrok', rankAs: 'premium' },
    supergrok_lite: { name: 'SuperGrok Lite', rankAs: 'plus' },
  },

  /** Why the vendor may answer without usage data, under the card's notice. */
  noDataHint: { key: 'grok.noData' },

  messages: {
    zh_CN: {
      'grok.fast': 'Grok / Fast 模式',
      'grok.weekly': 'Grok / 每周',
      'grok.noFast': '付费方案只按每周额度计算',
      'grok.noWeekly': '免费账户没有每周额度',
      'grok.rolling': '滚动恢复',
      'grok.rollingShort': '滚动',
      'grok.noData': 'Grok「设置 > 用量」里有数据时，这里才会显示',
    },
    ja: {
      'grok.fast': 'Grok / Fast モード',
      'grok.weekly': 'Grok / 週間',
      'grok.noFast': '有料プランは週間枠だけで計算されます',
      'grok.noWeekly': '無料アカウントには週間枠がありません',
      'grok.rolling': '順次回復',
      'grok.rollingShort': '順次',
      'grok.noData': 'Grok の「設定 > 使用量」にデータがあるときに表示されます',
    },
    en: {
      'grok.fast': 'Grok / Fast mode',
      'grok.weekly': 'Grok / Weekly',
      'grok.noFast': 'Paid plans only have the weekly pool',
      'grok.noWeekly': 'Free accounts have no weekly pool',
      'grok.rolling': 'Rolling window',
      'grok.rollingShort': 'Rolling',
      'grok.noData': "Shown once Grok's Settings > Usage has data",
    },
  },
});
