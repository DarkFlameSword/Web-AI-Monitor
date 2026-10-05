// Checks the extension against the Chrome Web Store's package rules and
// writes the upload: dist/web-ai-monitor-<version>.zip, manifest at its root.
//
//   npm run package
//
// The zip is reproducible (sorted entries, fixed timestamps) and built with
// Node alone, so it works the same on every system.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const distDir = join(root, 'dist');

/** Store limits on the localized name, description and short name. */
const LIMITS = Object.freeze({ name: 75, description: 132, shortName: 12 });
/** Files that must never ship: editor and OS clutter, source maps, keys. */
const NEVER_SHIP = [/(^|\/)\./, /\.map$/, /\.pem$/, /(^|\/)Thumbs\.db$/i];

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const posix = path => path.split(sep).join('/');

/** @returns {string[]} problems; empty when the package can be uploaded. */
export function checkExtension(dir = extensionDir, packageVersion = null) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const has = path => existsSync(join(dir, path));

  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  const parts = String(manifest.version ?? '').split('.');
  if (!(parts.length >= 1 && parts.length <= 4 && parts.every(p => /^(0|[1-9]\d{0,4})$/.test(p) && Number(p) <= 65535))) {
    problems.push(`version "${manifest.version}" is not 1-4 dot-separated integers (0-65535, no leading zeros)`);
  }
  if (packageVersion && manifest.version !== packageVersion) {
    problems.push(`manifest version ${manifest.version} differs from package.json ${packageVersion}`);
  }
  for (const key of ['key', 'update_url']) {
    if (key in manifest) problems.push(`"${key}" must not be in a store upload`);
  }
  if (manifest.content_security_policy) problems.push('a custom content_security_policy needs review: the default is used');

  // Every file the manifest names exists.
  const named = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...(manifest.content_scripts ?? []).flatMap(script => [...(script.js ?? []), ...(script.css ?? [])]),
  ].filter(Boolean);
  for (const path of named) if (!has(path)) problems.push(`manifest names a missing file: ${path}`);
  if (!manifest.icons?.['128']) problems.push('a 128x128 icon is required');

  // Localized name and description: every locale has them, within the store's limits.
  const locales = has('_locales') ? readdirSync(join(dir, '_locales')) : [];
  if (manifest.default_locale && !locales.includes(manifest.default_locale)) {
    problems.push(`default_locale ${manifest.default_locale} has no _locales folder`);
  }
  const keyOf = value => /^__MSG_(\w+)__$/.exec(value ?? '')?.[1];
  for (const locale of locales) {
    const messages = JSON.parse(readFileSync(join(dir, '_locales', locale, 'messages.json'), 'utf8'));
    const text = field => {
      const key = keyOf(manifest[field]);
      return key ? messages[key]?.message : manifest[field];
    };
    for (const [field, limit] of [['name', LIMITS.name], ['description', LIMITS.description], ['short_name', LIMITS.shortName]]) {
      const value = text(field);
      if (value === undefined && field !== 'short_name') problems.push(`${locale}: no ${field}`);
      else if (value !== undefined && [...value].length > limit) problems.push(`${locale}: ${field} is ${[...value].length} characters, over ${limit}`);
    }
  }

  for (const file of listFiles(dir)) {
    const path = posix(relative(dir, file));
    if (NEVER_SHIP.some(pattern => pattern.test(path))) problems.push(`must not ship: ${path}`);
    // Chrome reserves names starting with "_" for itself (only _locales is allowed).
    else if (path.split('/').some((part, i) => part.startsWith('_') && !(i === 0 && part === '_locales'))) {
      problems.push(`reserved "_" name: ${path}`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 2026-01-01 00:00 in DOS time, for every entry, so the same sources give the same zip. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** @param {{name: string, data: Buffer}[]} entries */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function main() {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const problems = checkExtension(extensionDir, version);
  if (problems.length) {
    console.error(`Not packaged:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  const entries = listFiles(extensionDir)
    .map(file => ({ name: posix(relative(extensionDir, file)), data: readFileSync(file) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  mkdirSync(distDir, { recursive: true });
  const out = join(distDir, `web-ai-monitor-${version}.zip`);
  writeFileSync(out, zip(entries));
  const size = statSync(out).size;
  console.log(`${posix(relative(root, out))}: ${entries.length} files, ${(size / 1024).toFixed(1)} KB`);
}

/** Run directly (npm run package), not imported by the tests. Windows paths differ in case only. */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const invoked = pathToFileURL(resolve(process.argv[1])).href;
  return process.platform === 'win32' ? invoked.toLowerCase() === import.meta.url.toLowerCase() : invoked === import.meta.url;
}

if (invokedDirectly()) main();
