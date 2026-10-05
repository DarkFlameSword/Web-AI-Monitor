import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SETTINGS, enabledProviders, normalizeSettings } from '../extension/core/settings.js';

test('missing settings become the defaults', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings, {
    lang: 'auto',
    pollMinutes: 5,
    disabledProviders: [],
    hud: { ...DEFAULT_SETTINGS.hud },
    notify: { recovered: false },
  });
  assert.equal(settings.hud.everywhere, false, 'every-site HUD waits for the permission');
  assert.equal(settings.hud.scale, 1);
});

test('bad values are replaced or clamped, good ones kept', () => {
  const settings = normalizeSettings({
    lang: 'ja',
    pollMinutes: 7.4,
    disabledProviders: ['claude', 'claude', '', 3],
    hud: { enabled: false, everywhere: true, collapsed: 'yes', corner: 'middle', x: 12.6, y: -40, scale: 1.4 },
    notify: { recovered: 'sure' },
    hiddenHosts: ['example.com'],
  });
  assert.deepEqual(settings, {
    lang: 'ja',
    pollMinutes: 7,
    disabledProviders: ['claude'],
    hud: { enabled: false, everywhere: true, collapsed: false, corner: 'br', x: 13, y: 0, scale: 1.5 },
    notify: { recovered: false },
  });
  assert.equal(normalizeSettings({ lang: 'fr' }).lang, 'auto');
});

test('refresh interval is any whole minute from 1 to 30; size from 100% to 200%', () => {
  assert.equal(normalizeSettings({ pollMinutes: 0 }).pollMinutes, 1);
  assert.equal(normalizeSettings({ pollMinutes: 30 }).pollMinutes, 30);
  assert.equal(normalizeSettings({ pollMinutes: 99 }).pollMinutes, 30);
  assert.equal(normalizeSettings({ pollMinutes: '12' }).pollMinutes, 5, 'not a number: default');
  assert.equal(normalizeSettings({ hud: { scale: 0.5 } }).hud.scale, 1);
  assert.equal(normalizeSettings({ hud: { scale: 1.75 } }).hud.scale, 1.75);
  assert.equal(normalizeSettings({ hud: { scale: 3 } }).hud.scale, 2);
});

test('switched-off providers drop out of the monitored list', () => {
  const providers = [{ id: 'claude' }, { id: 'other' }];
  assert.deepEqual(enabledProviders(providers, normalizeSettings({ disabledProviders: ['claude'] })), [{ id: 'other' }]);
  assert.deepEqual(enabledProviders(providers, normalizeSettings({})), providers);
});
