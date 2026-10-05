import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkExtension } from '../scripts/package.mjs';

const extensionDir = new URL('../extension', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the extension as it is passes the store package checks', () => {
  assert.deepEqual(checkExtension(extensionDir, version), []);
});

test('the checks catch what the store would reject', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wam-pkg-'));
  try {
    cpSync(extensionDir, dir, { recursive: true });
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '1.02', key: 'abc', icons: { ...manifest.icons, 48: 'assets/icons/nope.png' } }));
    const en = join(dir, '_locales/en/messages.json');
    const messages = JSON.parse(readFileSync(en, 'utf8'));
    messages.extDescription.message = 'x'.repeat(133);
    writeFileSync(en, JSON.stringify(messages));
    writeFileSync(join(dir, 'popup/.DS_Store'), '');
    writeFileSync(join(dir, '_notes.txt'), '');

    const problems = checkExtension(dir, version).join('\n');
    assert.match(problems, /version "1\.02"/);
    assert.match(problems, /"key" must not be/);
    assert.match(problems, /missing file: assets\/icons\/nope\.png/);
    assert.match(problems, /en: description is 133 characters, over 132/);
    assert.match(problems, /must not ship: popup\/\.DS_Store/);
    assert.match(problems, /reserved "_" name: _notes\.txt/);
    assert.doesNotMatch(problems, /_locales/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
