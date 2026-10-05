// Writes extension/assets/icons/icon-{16,32,48,128}.png from ui/pixel-icon.js.
// Usage: node scripts/build-icons.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { iconPixels } from '../extension/ui/pixel-icon.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'extension', 'assets', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LEVELS = { mp: 70, hp: 90, sp: 100 };

for (const size of [16, 32, 48, 128]) {
  // 128 is also the store icon: a 96px drawing (6x the 16px design) inside
  // 16px of transparent padding, as the Chrome Web Store asks.
  const pixels = size === 128 ? pad(iconPixels(LEVELS, 96), 96, 128) : iconPixels(LEVELS, size);
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, pixels));
  console.log(`wrote ${file}`);
}

function pad(pixels, from, to) {
  const out = new Uint8ClampedArray(to * to * 4);
  const shift = (to - from) / 2;
  for (let y = 0; y < from; y += 1) {
    out.set(pixels.subarray(y * from * 4, (y + 1) * from * 4), ((y + shift) * to + shift) * 4);
  }
  return out;
}
