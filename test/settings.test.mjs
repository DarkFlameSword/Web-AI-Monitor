import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SETTINGS, normalizeSettings } from '../extension/core/settings.js';

test('missing settings become the defaults', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings, {
    lang: 'auto',
    pollMinutes: 5,
    hud: { ...DEFAULT_SETTINGS.hud },
    notify: { recovered: false },
    hiddenHosts: [],
  });
  assert.equal(settings.hud.everywhere, false, 'every-site HUD waits for the permission');
});

test('bad values are replaced and good ones kept', () => {
  const settings = normalizeSettings({
    lang: 'ja',
    pollMinutes: 7,
    hud: { enabled: false, everywhere: true, collapsed: 'yes', corner: 'middle', x: 12.6, y: -40 },
    notify: { recovered: 'sure' },
    hiddenHosts: ['example.com', 'example.com', '', 3, 'mail.google.com'],
  });
  assert.deepEqual(settings, {
    lang: 'ja',
    pollMinutes: 5,
    hud: { enabled: false, everywhere: true, collapsed: false, corner: 'br', x: 13, y: 0 },
    notify: { recovered: false },
    hiddenHosts: ['example.com', 'mail.google.com'],
  });
  assert.equal(normalizeSettings({ lang: 'fr' }).lang, 'auto');
});
