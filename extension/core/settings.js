import { LANGS } from './messages.js';
import { parseDay } from './rank.js';

export const SETTINGS_KEY = 'settings';
/** Background refresh, in whole minutes. */
export const POLL_RANGE = Object.freeze({ min: 1, max: 30 });
/** Floating window size, as a zoom factor. */
export const SCALE_RANGE = Object.freeze({ min: 1, max: 2, step: 0.25 });
export const CORNERS = Object.freeze(['tl', 'tr', 'bl', 'br']);

export const DEFAULT_SETTINGS = Object.freeze({
  /** 'auto' follows the browser; otherwise one of LANGS. */
  lang: 'auto',
  /** Minutes between background refreshes, POLL_RANGE.min to POLL_RANGE.max. */
  pollMinutes: 5,
  /**
   * Which providers are monitored: { [providerId]: boolean }. A provider not
   * listed follows its own `enabledByDefault`. Providers behind an optional
   * permission are only switched on once it is granted.
   */
  providers: Object.freeze({}),
  /**
   * The vendor on show, picked from the popup's tabs. The popup, the page
   * HUD and the toolbar icon all follow it. Null: the first monitored one.
   */
  activeProvider: null,
  /** Adventurer rank expiry per provider, entered by the user: { [providerId]: 'YYYY-MM-DD' }. */
  rankExpiry: Object.freeze({}),
  /**
   * The floating window. It shows on the vendors' own sites; `everywhere`
   * extends it to every site once the user grants that permission.
   * x/y are the gap to the corner it is pinned to; scale is its zoom.
   */
  hud: Object.freeze({ enabled: true, everywhere: false, collapsed: false, corner: 'br', x: 16, y: 16, scale: 1 }),
  /** Desktop notification when a used gauge is full again (needs the optional permission). */
  notify: Object.freeze({ recovered: false }),
});

function intIn(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function scaleOf(value) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.hud.scale;
  const { min, max, step } = SCALE_RANGE;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

/** Fill in defaults and drop anything malformed, so readers never have to check. */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hud = src.hud && typeof src.hud === 'object' ? src.hud : {};
  const notify = src.notify && typeof src.notify === 'object' ? src.notify : {};
  const defaults = DEFAULT_SETTINGS.hud;
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  return {
    lang: src.lang === 'auto' || LANGS.includes(src.lang) ? src.lang : DEFAULT_SETTINGS.lang,
    pollMinutes: intIn(src.pollMinutes, DEFAULT_SETTINGS.pollMinutes, POLL_RANGE.min, POLL_RANGE.max),
    providers: providerSwitches(src),
    activeProvider: typeof src.activeProvider === 'string' && src.activeProvider ? src.activeProvider : null,
    rankExpiry: Object.fromEntries(Object.entries(src.rankExpiry && typeof src.rankExpiry === 'object' ? src.rankExpiry : {})
      .filter(([id, day]) => id && parseDay(day))),
    hud: {
      enabled: bool(hud.enabled, defaults.enabled),
      everywhere: bool(hud.everywhere, defaults.everywhere),
      collapsed: bool(hud.collapsed, defaults.collapsed),
      corner: CORNERS.includes(hud.corner) ? hud.corner : defaults.corner,
      x: intIn(hud.x, defaults.x, 0, 10000),
      y: intIn(hud.y, defaults.y, 0, 10000),
      scale: scaleOf(hud.scale),
    },
    notify: { recovered: bool(notify.recovered, DEFAULT_SETTINGS.notify.recovered) },
  };
}

function providerSwitches(src) {
  const switches = {};
  // Older settings kept a list of switched-off providers.
  if (Array.isArray(src.disabledProviders)) {
    for (const id of src.disabledProviders) if (typeof id === 'string' && id) switches[id] = false;
  }
  if (src.providers && typeof src.providers === 'object') {
    for (const [id, on] of Object.entries(src.providers)) if (id && typeof on === 'boolean') switches[id] = on;
  }
  return switches;
}

export function isProviderEnabled(provider, settings) {
  return settings.providers[provider.id] ?? provider.enabledByDefault !== false;
}

/** The providers the user monitors, in registry order. */
export function enabledProviders(providers, settings) {
  return providers.filter(provider => isProviderEnabled(provider, settings));
}

/** The vendor on show among `monitored`: the one picked, else the first. */
export function activeProvider(monitored, settings) {
  return monitored.find(provider => provider.id === settings.activeProvider) ?? monitored[0] ?? null;
}

export async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

/**
 * @param {(draft: ReturnType<typeof normalizeSettings>) => void} mutate  Edits a copy in place.
 */
export async function updateSettings(mutate) {
  const draft = structuredClone(await loadSettings());
  mutate(draft);
  const next = normalizeSettings(draft);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
