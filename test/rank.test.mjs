import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDay, qualificationExpiry, qualificationOf } from '../extension/core/rank.js';
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

test('the expiry is the day the user entered, valid until that day is over', () => {
  const day = parseDay('2026-11-03');
  assert.equal(day.start, new Date(2026, 10, 3).getTime());
  assert.equal(day.end, new Date(2026, 10, 4).getTime());
  for (const bad of ['2026-02-30', '2026-13-01', '11/03/2026', '', null, 20261103]) assert.equal(parseDay(bad), null, String(bad));

  const during = new Date(2026, 10, 3, 23, 59).getTime();
  assert.deepEqual(qualificationExpiry('2026-11-03', during), { day: day.start, expired: false, msLeft: day.end - during });
  assert.equal(qualificationExpiry('2026-11-03', day.end).expired, true);
  assert.deepEqual(qualificationExpiry(undefined, during), { day: null, expired: false, msLeft: null });
});
