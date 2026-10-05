import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGaugeViews, displayRemaining, levelOf, matchMeter, viewForRole } from '../extension/core/gauges.js';
import template from '../extension/providers/claude/template.js';

const NOW = Date.parse('2026-10-05T08:00:00Z');

const meters = [
  { id: 'session', kind: 'session', scope: null, used: 38, resetsAt: '2026-10-05T09:40:00Z' },
  { id: 'weekly_all', kind: 'weekly_all', scope: null, used: 19, resetsAt: '2026-10-09T16:00:00Z' },
  { id: 'weekly_scoped:fable', kind: 'weekly_scoped', scope: 'Fable', used: 0, resetsAt: '2026-10-09T16:00:00Z' },
];

test('maps Claude limits onto MP / HP / SP as remaining amounts', () => {
  const views = buildGaugeViews(template, meters, NOW);
  assert.deepEqual(views.map(v => [v.key, v.role, v.state, v.value, v.level, v.ready]), [
    ['session', 'mp', 'ok', 62, 'ok', false],
    ['weekly', 'hp', 'ok', 81, 'ok', false],
    ['fable', 'sp', 'ok', 100, 'ok', true],
  ]);
  assert.equal(views[0].resetsAt, Date.parse('2026-10-05T09:40:00Z'));
  assert.equal(viewForRole(views, 'hp').key, 'weekly');
});

test('a plan without a Fable limit shows the ultimate gauge as sealed', () => {
  const views = buildGaugeViews(template, meters.slice(0, 2), NOW);
  const sp = viewForRole(views, 'sp');
  assert.equal(sp.state, 'sealed');
  assert.deepEqual(sp.hint, { key: 'claude.fableSealed' });
  assert.equal(sp.ready, false);
});

test('a missing required limit is reported as missing', () => {
  const views = buildGaugeViews(template, [], NOW);
  assert.deepEqual(views.map(v => v.state), ['missing', 'missing', 'sealed']);
});

test('a window that has ended reads as full and recovering until refetched', () => {
  const later = Date.parse('2026-10-05T09:41:00Z');
  const mp = buildGaugeViews(template, meters, later)[0];
  assert.equal(mp.value, 100);
  assert.equal(mp.recovering, true);
  assert.equal(mp.resetsAt, null);
});

test('limits the template does not name are appended as extra gauges', () => {
  const views = buildGaugeViews(template, [
    ...meters,
    { id: 'weekly_scoped:opus', kind: 'weekly_scoped', scope: 'Opus', used: 90, resetsAt: null },
    { id: 'monthly_thing', kind: 'monthly_thing', scope: null, used: 10, resetsAt: null },
  ], NOW);
  assert.equal(views.length, 5);
  assert.deepEqual(views.slice(3).map(v => [v.role, v.primary, v.value, v.level, v.label]), [
    ['ex', false, 10, 'critical', { key: 'meter.weeklyScoped', vars: { name: 'Opus' } }],
    ['ex', false, 90, 'ok', { key: 'meter.other', vars: { name: 'Monthly thing' } }],
  ]);
});

test('scope rules: null asks for unscoped, strings match case-insensitively', () => {
  const scoped = { kind: 'session', scope: 'Fable 5.1' };
  assert.equal(matchMeter(scoped, { kind: 'session', scope: null }), false);
  assert.equal(matchMeter(scoped, { kind: 'session', scope: 'fable' }), true);
  assert.equal(matchMeter(scoped, { kind: 'session' }), true);
  assert.equal(matchMeter(scoped, { kind: 'weekly_all' }), false);
});

test('remaining is 100 only when untouched and 0 only when spent', () => {
  assert.equal(displayRemaining(0), 100);
  assert.equal(displayRemaining(0.4), 99);
  assert.equal(displayRemaining(38), 62);
  assert.equal(displayRemaining(99.6), 1);
  assert.equal(displayRemaining(100), 0);
  assert.deepEqual([100, 50, 49, 20, 19, 1, 0].map(levelOf), ['ok', 'ok', 'low', 'low', 'critical', 'critical', 'empty']);
});
