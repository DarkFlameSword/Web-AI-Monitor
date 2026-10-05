import assert from 'node:assert/strict';
import { test } from 'node:test';

import { iconPixels } from '../extension/ui/pixel-icon.js';

const MP = [58, 110, 165];
const SP = [217, 142, 31];
const EMPTY = [220, 196, 147];

/** Design rows (16x16) where a color appears in the bar column x = 3. */
function rowsOf(pixels, color) {
  const rows = [];
  for (let y = 0; y < 16; y += 1) {
    const i = (y * 16 + 3) * 4;
    if (pixels[i] === color[0] && pixels[i + 1] === color[1] && pixels[i + 2] === color[2]) rows.push(y);
  }
  return rows;
}

test('three bars by default; a vendor without SP gets two, not an empty third', () => {
  const full = { mp: 80, hp: 80, sp: 80 };
  const three = iconPixels(full, 16);
  assert.deepEqual(rowsOf(three, MP), [4, 5]);
  assert.deepEqual(rowsOf(three, SP), [10, 11]);

  const two = iconPixels({ mp: 80, hp: 80, sp: null }, 16, { roles: ['mp', 'hp'] });
  assert.deepEqual(rowsOf(two, MP), [5, 6]);
  assert.deepEqual(rowsOf(two, SP), [], 'no SP bar');
  assert.deepEqual(rowsOf(iconPixels({ mp: 0, hp: 0 }, 16, { roles: ['mp', 'hp'] }), EMPTY), [5, 6, 9, 10], 'only two empty tracks');
});
