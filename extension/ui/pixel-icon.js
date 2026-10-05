/**
 * The toolbar icon: a tiny guild card holding the MP / HP / SP gauges.
 * Drawn from a 16x16 design at any whole multiple, so the service worker can
 * paint live levels and scripts/build-icons.mjs can write the static PNGs
 * from the same picture.
 */

const COLORS = Object.freeze({
  frame: [91, 58, 30],
  paper: [242, 227, 196],
  ink: [59, 36, 18],
  empty: [220, 196, 147],
  mp: [58, 110, 165],
  hp: [78, 143, 58],
  hpLow: [201, 150, 30],
  hpCrit: [178, 58, 43],
  sp: [217, 142, 31],
});

function hpColor(value) {
  if (value < 20) return COLORS.hpCrit;
  if (value < 50) return COLORS.hpLow;
  return COLORS.hp;
}

/** Halfway to paper: how the icon looks while its numbers are stale. */
function fade(color) {
  return color.map((channel, i) => Math.round((channel + COLORS.paper[i]) / 2));
}

const GAUGE_COLORS = Object.freeze({ mp: () => COLORS.mp, hp: hpColor, sp: () => COLORS.sp });
/** Top rows of the 2px bars inside the ink box (rows 3-12), evenly spaced for one to three gauges. */
const ROWS = Object.freeze({ 1: [7], 2: [5, 9], 3: [4, 7, 10] });

/**
 * @param {{mp?: number|null, hp?: number|null, sp?: number|null}} levels  Remaining 0-100, null when unknown.
 * @param {number} size  Edge in device pixels; a multiple of 16.
 * @param {{dim?: boolean, roles?: string[]}} [options]  `roles`: the gauges the vendor's scheme
 *   has, top to bottom (default MP, HP, SP). A vendor without SP gets two bars, not an empty third.
 * @returns {Uint8ClampedArray} RGBA, row-major.
 */
export function iconPixels(levels, size, { dim = false, roles = ['mp', 'hp', 'sp'] } = {}) {
  const scale = Math.max(1, Math.round(size / 16));
  const pixels = new Uint8ClampedArray(size * size * 4);
  const offset = Math.floor((size - 16 * scale) / 2);

  // Device-pixel rectangle.
  const fillDevice = (x, y, w, h, color) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        const i = (row * size + col) * 4;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = 255;
      }
    }
  };
  // Design-pixel rectangle.
  const fill = (x, y, w, h, color) => fillDevice(offset + x * scale, offset + y * scale, w * scale, h * scale, color);

  // Card with stepped corners.
  fill(2, 0, 12, 1, COLORS.frame);
  fill(2, 15, 12, 1, COLORS.frame);
  fill(1, 1, 1, 1, COLORS.frame);
  fill(14, 1, 1, 1, COLORS.frame);
  fill(1, 14, 1, 1, COLORS.frame);
  fill(14, 14, 1, 1, COLORS.frame);
  fill(0, 2, 1, 12, COLORS.frame);
  fill(15, 2, 1, 12, COLORS.frame);
  fill(2, 1, 12, 14, COLORS.paper);
  fill(1, 2, 14, 12, COLORS.paper);

  // The gauges in one inked box, ten pixels wide: rows 4-5, 7-8, 10-11 for three.
  fill(2, 3, 12, 10, COLORS.ink);
  const shown = roles.filter(role => role in GAUGE_COLORS).slice(0, 3);
  for (const [i, role] of shown.entries()) {
    const y = ROWS[shown.length][i];
    const colorOf = GAUGE_COLORS[role];
    fill(3, y, 10, 2, COLORS.empty);
    const value = levels?.[role];
    if (typeof value !== 'number' || value <= 0) continue;
    const width = Math.max(1, Math.round((Math.min(100, value) / 100) * 10 * scale));
    const color = dim ? fade(colorOf(value)) : colorOf(value);
    fillDevice(offset + 3 * scale, offset + y * scale, width, 2 * scale, color);
  }
  return pixels;
}
