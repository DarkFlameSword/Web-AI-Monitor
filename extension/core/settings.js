import { LANGS } from './messages.js';

export const SETTINGS_KEY = 'settings';
export const POLL_CHOICES = Object.freeze([1, 3, 5, 10, 15, 30]);
export const CORNERS = Object.freeze(['tl', 'tr', 'bl', 'br']);

export const DEFAULT_SETTINGS = Object.freeze({
  /** 'auto' follows the browser; otherwise one of LANGS. */
  lang: 'auto',
  /** Minutes between background refreshes. */
  pollMinutes: 5,
  /**
   * The floating window. It shows on the vendors' own sites; `everywhere`
   * extends it to every site once the user grants that permission.
   * x/y are the gap to the corner it is pinned to.
   */
  hud: Object.freeze({ enabled: true, everywhere: false, collapsed: false, corner: 'br', x: 16, y: 16 }),
  /** Desktop notification when a used gauge is full again (needs the optional permission). */
  notify: Object.freeze({ recovered: false }),
  /** Hostnames where the floating window stays hidden. */
  hiddenHosts: Object.freeze([]),
});

function intIn(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
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
    pollMinutes: POLL_CHOICES.includes(src.pollMinutes) ? src.pollMinutes : DEFAULT_SETTINGS.pollMinutes,
    hud: {
      enabled: bool(hud.enabled, defaults.enabled),
      everywhere: bool(hud.everywhere, defaults.everywhere),
      collapsed: bool(hud.collapsed, defaults.collapsed),
      corner: CORNERS.includes(hud.corner) ? hud.corner : defaults.corner,
      x: intIn(hud.x, defaults.x, 0, 10000),
      y: intIn(hud.y, defaults.y, 0, 10000),
    },
    notify: { recovered: bool(notify.recovered, DEFAULT_SETTINGS.notify.recovered) },
    hiddenHosts: Array.isArray(src.hiddenHosts)
      ? [...new Set(src.hiddenHosts.filter(host => typeof host === 'string' && host))]
      : [],
  };
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
