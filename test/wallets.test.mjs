import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recoveredGauges } from '../extension/core/gauges.js';
import { buildWalletViews } from '../extension/core/wallets.js';
import { parseWallets } from '../extension/providers/claude/provider.js';
import template from '../extension/providers/claude/template.js';

const NOW = Date.parse('2026-10-05T08:00:00Z');

const USAGE = {
  limits: [{ kind: 'session', percent: 10, resets_at: '2026-10-05T09:00:00Z', scope: null }],
  iguana_necktie: {
    limit_dollars: 250,
    used_dollars: 62.5,
    remaining_dollars: 187.5,
    utilization: 25,
    resets_at: '2026-10-07T07:00:00Z',
    locked_reason: null,
  },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 5000,
    used_credits: 1240,
    currency: 'usd',
    decimal_places: 2,
    spend_limit_reached: false,
    credits_ever_enabled: true,
  },
};

test('reads the cloud session credit (dollars) and usage credits (minor units)', () => {
  assert.deepEqual(parseWallets(USAGE), [
    {
      id: 'cloud_session', kind: 'grant', unit: 'money', currency: 'USD', balance: 187.5, total: 250, spent: 62.5, cap: null,
      expiresAt: '2026-10-07T07:00:00Z', enabled: true, locked: false, capReached: false,
    },
    {
      id: 'usage_credits', kind: 'spend', unit: 'money', currency: 'USD', balance: null, total: null, spent: 12.4, cap: 50,
      expiresAt: null, enabled: true, locked: false, capReached: false,
    },
  ]);
});

test('fills in a missing amount, honours decimal places, and skips what is absent', () => {
  const [cloud, usage] = parseWallets({
    remote_session_credit: { limit_dollars: 100, used_dollars: 30, resets_at: null, locked_reason: 'not_eligible' },
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: 0, currency: 'JPY', decimal_places: 0 },
  });
  assert.equal(cloud.balance, 70);
  assert.equal(cloud.locked, true);
  assert.equal(usage.currency, 'JPY');
  assert.equal(usage.cap, null);
  assert.equal(usage.enabled, false);
  assert.deepEqual(parseWallets({ iguana_necktie: null, extra_usage: null }), []);
  assert.deepEqual(parseWallets(null), []);
});

test('pouch views carry state: active, low, expired, capped, disabled', () => {
  const wallets = parseWallets(USAGE);
  const views = buildWalletViews(template, wallets, NOW);
  assert.deepEqual(views.map(v => [v.key, v.state, v.low]), [['cloud', 'active', false], ['usage', 'active', false]]);
  assert.equal(views[0].expiresAt, Date.parse('2026-10-07T07:00:00Z'));

  const later = buildWalletViews(template, wallets, Date.parse('2026-10-08T00:00:00Z'));
  assert.equal(later[0].state, 'expired');

  const low = buildWalletViews(template, [{ ...wallets[0], balance: 20 }, { ...wallets[1], capReached: true }], NOW);
  assert.deepEqual(low.map(v => [v.state, v.low]), [['active', true], ['capped', false]]);

  const spentAll = buildWalletViews(template, [{ ...wallets[1], spent: 50 }], NOW);
  assert.equal(spentAll[0].state, 'capped', 'spending the whole cap counts as capped');

  const off = buildWalletViews(template, [{ ...wallets[1], enabled: false }], NOW);
  assert.deepEqual(off.map(v => [v.key, v.state]), [['usage', 'disabled']]);
});

test('a used gauge whose window ended counts as recovered; an unused one does not', () => {
  const meters = [
    { id: 'session', kind: 'session', scope: null, used: 40, resetsAt: '2026-10-05T07:59:00Z' },
    { id: 'weekly_all', kind: 'weekly_all', scope: null, used: 0, resetsAt: '2026-10-05T07:59:00Z' },
    { id: 'weekly_scoped:fable', kind: 'weekly_scoped', scope: 'Fable', used: 5, resetsAt: '2026-10-09T00:00:00Z' },
  ];
  assert.deepEqual(recoveredGauges(template, meters, NOW).map(r => [r.def.role, r.meter.id]), [['mp', 'session']]);
  assert.deepEqual(recoveredGauges(template, [], NOW), []);
});
