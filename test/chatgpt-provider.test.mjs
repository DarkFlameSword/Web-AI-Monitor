import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HttpError } from '../extension/core/http.js';
import { buildGaugeViews } from '../extension/core/gauges.js';
import { qualificationOf } from '../extension/core/rank.js';
import { buildWalletViews } from '../extension/core/wallets.js';
import chatgpt, { normalizePlan, parseUsage, parseWallets, tokenClaims } from '../extension/providers/chatgpt/provider.js';
import template from '../extension/providers/chatgpt/template.js';

const NOW = Date.parse('2026-10-05T08:00:00Z');
const at = ms => Math.floor((NOW + ms) / 1000);
const HOUR = 3_600_000;

const USAGE = {
  plan_type: 'plus',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 41, limit_window_seconds: 18000, reset_after_seconds: 7200, reset_at: at(2 * HOUR) },
    secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: at(80 * HOUR) },
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_spark',
      rate_limit: { primary_window: { used_percent: '30', limit_window_seconds: 604800, reset_after_seconds: 3600 } },
    },
  ],
  credits: { has_credits: true, unlimited: false, overage_limit_reached: false, balance: '1234.5' },
  rate_limit_reset_credits: { available_count: 3 },
  spend_control: null,
};

test('Codex windows become meters by their length; extras keep their names', () => {
  assert.deepEqual(parseUsage(USAGE, NOW), [
    { id: 'codex_short', kind: 'codex_short', scope: null, used: 41, resetsAt: new Date(at(2 * HOUR) * 1000).toISOString() },
    { id: 'codex_weekly', kind: 'codex_weekly', scope: null, used: 12, resetsAt: new Date(at(80 * HOUR) * 1000).toISOString() },
    {
      id: 'model_weekly:gpt-5-3-codex-spark',
      kind: 'model_weekly',
      scope: 'GPT-5.3-Codex-Spark',
      used: 30,
      resetsAt: new Date(NOW + HOUR).toISOString(),
    },
  ]);
  const workspace = parseUsage({ spend_control: { individual_limit: { used_percent: 20, reset_at: at(HOUR) } } }, NOW);
  assert.deepEqual(workspace.map(m => [m.id, m.used]), [['workspace_credits', 20]]);
  for (const junk of [null, 'x', [], {}, { rate_limit: { primary_window: { used_percent: 'n/a' } } }]) {
    assert.deepEqual(parseUsage(junk, NOW), []);
  }
});

test('the ChatGPT card is its own scheme: MP and HP, no ultimate gauge, extras as EX', () => {
  const views = buildGaugeViews(template, parseUsage(USAGE, NOW), NOW);
  assert.deepEqual(views.map(v => [v.role, v.value, v.primary]), [['mp', 59, true], ['hp', 88, true], ['ex', 70, false]]);
  assert.deepEqual(views[2].label, { key: 'chatgpt.modelWeekly', vars: { name: 'GPT-5.3-Codex-Spark' } });
  assert.ok(!views.some(v => v.role === 'sp'));

  const weeklyOnly = buildGaugeViews(template, parseUsage({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 604800 } } }, NOW), NOW);
  assert.deepEqual(weeklyOnly.map(v => [v.key, v.state]), [['short', 'sealed'], ['weekly', 'ok']]);
});

test('its pouch holds mana crystals and potions, never coins or emeralds', () => {
  const wallets = parseWallets(USAGE);
  assert.deepEqual(wallets.map(w => [w.id, w.kind, w.unit, w.balance, w.enabled]), [
    ['codex_credits', 'stock', 'credits', 1234.5, true],
    ['limit_resets', 'stock', 'count', 3, true],
  ]);
  const views = buildWalletViews(template, wallets, NOW);
  assert.deepEqual(views.map(v => [v.treasure, v.state]), [['crystal', 'active'], ['potion', 'active']]);
  assert.ok(!template.wallets.some(w => ['coin', 'emerald'].includes(w.treasure)));

  const none = buildWalletViews(template, parseWallets({ credits: { has_credits: false, balance: null }, rate_limit_reset_credits: { available_count: 0 } }), NOW);
  assert.deepEqual(none.map(v => [v.treasure, v.state]), [['crystal', 'disabled'], ['potion', 'empty']]);
  const unlimited = buildWalletViews(template, parseWallets({ credits: { has_credits: true, unlimited: true, balance: null } }), NOW);
  assert.deepEqual(unlimited.map(v => [v.unlimited, v.state]), [[true, 'active']]);
});

test('plans rank from Pro (A) down to Free (E)', () => {
  const rank = plan => qualificationOf(template, normalizePlan(plan))?.rank;
  assert.deepEqual(['pro', 'prolite', 'plus', 'go', 'free'].map(rank), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(rank('Plus'), 'C');
  assert.equal(rank('enterprise'), 'S');
  assert.equal(normalizePlan('mystery'), null);
});

function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    async getJson(path, options = {}) {
      calls.push([path, options.headers ?? {}]);
      const answer = routes[path];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new HttpError(404);
      return typeof answer === 'function' ? answer(options) : answer;
    },
    async getCookie() {
      return null;
    },
  };
}

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'pro' } })}.sig`;

test('uses the session token and account when the page hands them out', async () => {
  assert.equal(tokenClaims(TOKEN)['https://api.openai.com/auth'].chatgpt_account_id, 'acct-1');
  const http = fakeHttp({
    '/api/auth/session': { user: { id: 'u' }, accessToken: TOKEN },
    '/backend-api/wham/usage': USAGE,
  });
  const result = await chatgpt.fetchUsage(http);
  assert.equal(result.plan, 'plus');
  assert.equal(result.meters.length, 3);
  assert.deepEqual(http.calls[1], ['/backend-api/wham/usage', { authorization: `Bearer ${TOKEN}`, 'chatgpt-account-id': 'acct-1' }]);
});

test('without a token it still asks with cookies, and a 401 means signed out', async () => {
  const http = fakeHttp({ '/api/auth/session': { WARNING_BANNER: 'x' }, '/backend-api/wham/usage': { ...USAGE, plan_type: undefined } });
  const result = await chatgpt.fetchUsage(http);
  assert.deepEqual(http.calls[1], ['/backend-api/wham/usage', {}]);
  assert.equal(result.plan, null);

  const signedOut = fakeHttp({ '/api/auth/session': {}, '/backend-api/wham/usage': new HttpError(401) });
  await assert.rejects(chatgpt.fetchUsage(signedOut), error => error.status === 401);
});

test('replies and Codex tasks count as activity; only the two API paths may be proxied', () => {
  assert.equal(chatgpt.isActivity('/backend-api/f/conversation', 900), true);
  assert.equal(chatgpt.isActivity('/backend-api/conversation/abc', 200), true);
  assert.equal(chatgpt.isActivity('/backend-api/conversations', 200), false);
  assert.equal(chatgpt.isActivity('/backend-api/wham/tasks/123', 300), true);
  assert.equal(chatgpt.isActivity('/backend-api/wham/usage', 9000), false);
  const allowed = path => chatgpt.proxyPaths.some(pattern => pattern.test(path));
  assert.deepEqual(['/api/auth/session', '/backend-api/wham/usage', '/backend-api/me', '/backend-api/conversation'].map(allowed), [true, true, false, false]);
  assert.deepEqual([...chatgpt.proxyHeaders], ['authorization', 'chatgpt-account-id']);
  assert.equal(chatgpt.enabledByDefault, false);
});
