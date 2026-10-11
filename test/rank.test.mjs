import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDay, qualificationExpiry, qualificationOf, subscriptionTerm } from '../extension/core/rank.js';
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

test('a period the vendor reports: renewing is never "expired", lapsing is once its end passes', () => {
  const end = Date.parse('2026-11-03T13:27:01Z');
  const start = Date.parse('2026-10-03T13:26:19Z');
  const sub = { startsAt: '2026-10-03T13:26:19Z', endsAt: '2026-11-03T13:27:01Z', renews: true, checkedAt: 1 };
  assert.deepEqual(subscriptionTerm(sub, end - 1000), { day: end, expired: false, msLeft: 1000, renews: true, startDay: start });
  assert.equal(subscriptionTerm(sub, end + 1000).expired, false, 'it renewed; the next refresh reads the new period');

  const lapsing = { ...sub, renews: false };
  assert.equal(subscriptionTerm(lapsing, end - 1).expired, false);
  assert.equal(subscriptionTerm(lapsing, end).expired, true);
  assert.equal(subscriptionTerm({ ...sub, renews: null }, end).expired, true, 'unknown counts as lapsing');
  assert.equal(subscriptionTerm({ ...sub, startsAt: null }, end).startDay, null);

  // No end reported: the date the user entered is used instead.
  for (const none of [null, undefined, {}, { endsAt: null }, { endsAt: 'soon' }]) assert.equal(subscriptionTerm(none, end), null);
});
