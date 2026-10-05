/**
 * Tiny DOM helpers. Styles are only ever set through CSSOM (el.style), never
 * through style attributes, so the page HUD keeps working on sites with a
 * strict Content-Security-Policy.
 */

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, any>} [props]  class, text, on<event>, or attributes.
 * @param {Array<Node|string|null>|Node|string|null} [children]
 */
export function h(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined) el.append(child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Pixel art as inline SVG. Each row is a string; each character a pixel whose
 * colour comes from `palette` ('.' or a missing key is transparent).
 * Runs of the same colour on a row become one rect.
 */
export function pixelArt(doc, rows, palette, scale = 1) {
  const width = Math.max(...rows.map(row => row.length));
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${rows.length}`);
  svg.setAttribute('width', String(width * scale));
  svg.setAttribute('height', String(rows.length * scale));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      const fill = palette[ch];
      if (fill) {
        const rect = doc.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(end - x));
        rect.setAttribute('height', '1');
        // Through CSSOM so palette entries can be CSS variables.
        rect.style.setProperty('fill', fill);
        svg.append(rect);
      }
      x = end;
    }
  });
  return svg;
}

/** The guild crest: a red shield with a gold sword. */
export const CREST = [
  'fffffffffff',
  'fgggghggggf',
  'fgggghggggf',
  'fgghhhhhggf',
  'fgggghggggf',
  'fgggghggggf',
  'fgggghggggf',
  '.fggghgggf.',
  '.fggghgggf.',
  '..fgggggf..',
  '...fgggf...',
  '....fff....',
];
export const CREST_PALETTE = { f: 'var(--ink)', g: 'var(--seal)', h: 'var(--sp-hi)' };

/** The gold pouch: a leather bag with a coin on it. */
export const POUCH = [
  '...k...k...',
  '....kkk....',
  '...kohok...',
  '..koooook..',
  '.kohoooook.',
  'koooyyyoook',
  'kooyyyyyook',
  'koooyyyoook',
  'koooooooook',
  '.koooooook.',
  '..kkkkkkk..',
];
export const POUCH_PALETTE = { k: 'var(--ink)', o: 'var(--frame-2)', h: 'var(--paper-3)', y: 'var(--sp-hi)' };
