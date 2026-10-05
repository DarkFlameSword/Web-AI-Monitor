import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SETTINGS, activeProvider, enabledProviders, normalizeSettings } from '../extension/core/settings.js';

test('missing settings become the defaults', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings, {
    lang: 'auto',
    pollMinutes: 5,
    providers: {},
    activeProvider: null,
    rankExpiry: {},
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
    providers: { chatgpt: true, other: 'yes' },
    activeProvider: 'chatgpt',
    disabledProviders: ['claude', 'claude', '', 3],
    rankExpiry: { claude: '2026-11-03', other: '2026-02-30', third: 'soon' },
    hud: { enabled: false, everywhere: true, collapsed: 'yes', corner: 'middle', x: 12.6, y: -40, scale: 1.4 },
    notify: { recovered: 'sure' },
    hiddenHosts: ['example.com'],
  });
  assert.deepEqual(settings, {
    lang: 'ja',
    pollMinutes: 7,
    providers: { claude: false, chatgpt: true },
    activeProvider: 'chatgpt',
    rankExpiry: { claude: '2026-11-03' },
    hud: { enabled: false, everywhere: true, collapsed: false, corner: 'br', x: 13, y: 0, scale: 1.5 },
    notify: { recovered: false },
  });
  assert.equal(normalizeSettings({ lang: 'fr' }).lang, 'auto');
  assert.equal(normalizeSettings({ activeProvider: '' }).activeProvider, null);
  assert.equal(normalizeSettings({ activeProvider: 3 }).activeProvider, null);
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

test('providers follow their switch, else their own default', () => {
  const claude = { id: 'claude' };
  const chatgpt = { id: 'chatgpt', enabledByDefault: false };
  const all = [claude, chatgpt];
  assert.deepEqual(enabledProviders(all, normalizeSettings({})), [claude]);
  assert.deepEqual(enabledProviders(all, normalizeSettings({ providers: { chatgpt: true } })), all);
  assert.deepEqual(enabledProviders(all, normalizeSettings({ providers: { claude: false, chatgpt: true } })), [chatgpt]);
  // Older settings listed switched-off providers.
  assert.deepEqual(enabledProviders(all, normalizeSettings({ disabledProviders: ['claude'] })), []);
});

test('the vendor on show is the one picked while it is monitored, else the first', () => {
  const claude = { id: 'claude' };
  const chatgpt = { id: 'chatgpt', enabledByDefault: false };
  const both = [claude, chatgpt];
  assert.equal(activeProvider(both, normalizeSettings({})), claude);
  assert.equal(activeProvider(both, normalizeSettings({ activeProvider: 'chatgpt' })), chatgpt);
  // Picked, then switched off: the popup, HUD and toolbar fall back together.
  assert.equal(activeProvider([claude], normalizeSettings({ activeProvider: 'chatgpt' })), claude);
  assert.equal(activeProvider([], normalizeSettings({ activeProvider: 'chatgpt' })), null);
});
