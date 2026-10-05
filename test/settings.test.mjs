import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SETTINGS, normalizeSettings } from '../extension/core/settings.js';

test('missing settings become the defaults', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings, {
    lang: 'auto',
    pollMinutes: 5,
    hud: { ...DEFAULT_SETTINGS.hud },
    hiddenHosts: [],
  });
});

test('bad values are replaced and good ones kept', () => {
  const settings = normalizeSettings({
    lang: 'ja',
    pollMinutes: 7,
    hud: { enabled: false, collapsed: 'yes', corner: 'middle', x: 12.6, y: -40 },
    hiddenHosts: ['example.com', 'example.com', '', 3, 'mail.google.com'],
  });
  assert.deepEqual(settings, {
    lang: 'ja',
    pollMinutes: 5,
    hud: { enabled: false, collapsed: false, corner: 'br', x: 13, y: 0 },
    hiddenHosts: ['example.com', 'mail.google.com'],
  });
  assert.equal(normalizeSettings({ lang: 'fr' }).lang, 'auto');
});
