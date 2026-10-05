import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualificationExpiry, qualificationOf } from '../extension/core/rank.js';
import template from '../extension/providers/claude/template.js';

test('the best personal plan is rank A, each step down one letter', () => {
  const rank = plan => qualificationOf(template, plan)?.rank;
  assert.equal(rank('max_20x'), 'A');
  assert.equal(rank('max_5x'), 'B');
  assert.equal(rank('pro'), 'C');
  assert.equal(rank('free'), 'D');
  assert.equal(rank('max'), 'B', 'Max with an unknown multiplier ranks as Max 5x');
  assert.equal(rank('team'), 'B');
  assert.equal(rank('enterprise'), 'S');
  assert.equal(qualificationOf(template, 'max_20x').name, 'Max 20x');
  assert.equal(qualificationOf(template, null), null);
  assert.equal(qualificationOf(template, 'nonsense'), null);
});

test('a ladder works for any vendor, and loops cannot hang it', () => {
  const other = {
    ladder: ['ultra', 'plus'],
    plans: { ultra: { name: 'Ultra' }, plus: { name: 'Plus' }, a: { name: 'A', rankAs: 'b' }, b: { name: 'B', rankAs: 'a' } },
  };
  assert.equal(qualificationOf(other, 'plus').rank, 'B');
  assert.equal(qualificationOf(other, 'a').rank, null);
});

test('qualification expiry reads the stored subscription', () => {
  assert.deepEqual(qualificationExpiry({ endsAt: '2026-11-03T00:00:00Z', renews: true }), {
    expiresAt: Date.parse('2026-11-03T00:00:00Z'),
    renews: true,
  });
  assert.deepEqual(qualificationExpiry(null), { expiresAt: null, renews: null });
});
