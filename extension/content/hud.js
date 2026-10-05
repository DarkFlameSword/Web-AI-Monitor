import { buildGaugeViews, viewForRole } from '../core/gauges.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { SETTINGS_KEY, enabledProviders, loadSettings, normalizeSettings, updateSettings } from '../core/settings.js';
import { providerIdOfKey, readSnapshots } from '../core/store.js';
import { PROVIDERS, providersForOrigin } from '../providers/index.js';
import { ProviderCard } from '../ui/card.js';
import { h } from '../ui/dom.js';

const FONT_FAMILY = 'WAM Guild Pixel';
const HOST_TAG = 'web-ai-monitor-hud';
/** Ask for fresh numbers when a tab comes back and the last ones are older than this. */
const STALE_AFTER_MS = 2 * 60_000;
const DRAG_THRESHOLD_PX = 4;
/** A reply's request ends when its stream ends; give the vendor a moment to count it. */
const ACTIVITY_SETTLE_MS = 1200;

/** False once the extension was reloaded or removed under this page. */
function alive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function send(message) {
  if (!alive()) return;
  chrome.runtime.sendMessage(message).catch(() => {});
}

function viewport() {
  const el = document.documentElement;
  return {
    width: Math.min(innerWidth, el.clientWidth || innerWidth),
    height: Math.min(innerHeight, el.clientHeight || innerHeight),
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// -------------------------------------------------------- vendor page hooks

function readCookie(name) {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** GET one of the provider's allow-listed API paths as this page (its cookies, its origin). */
async function proxyGet(provider, path) {
  if (typeof path !== 'string' || !provider.proxyPaths.some(pattern => pattern.test(path))) {
    return { ok: false, error: { status: 0, code: 'forbidden' } };
  }
  try {
    const response = await fetch(new URL(path, location.origin), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      return { ok: false, error: { status: response.status, code: 'not_json' } };
    }
    if (!response.ok) return { ok: false, error: { status: response.status, code: null } };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: { status: 0, code: 'network' } };
  }
}

/**
 * On a vendor's own site: answer the background's proxy requests, and report
 * when a reply has finished so the gauges update right after it.
 */
function hookVendorPage() {
  const providers = providersForOrigin(location.origin);
  if (!providers.length) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const provider = providers.find(p => p.id === message?.providerId);
    if (!provider) return false;
    if (message.type === 'wam:proxy-get') {
      proxyGet(provider, message.path).then(sendResponse);
      return true;
    }
    if (message.type === 'wam:proxy-cookie') {
      sendResponse({ value: typeof message.name === 'string' ? readCookie(message.name) : null });
    }
    return false;
  });

  let timer = 0;
  try {
    new PerformanceObserver(list => {
      const spent = list.getEntries().some(entry => {
        let url;
        try {
          url = new URL(entry.name);
        } catch {
          return false;
        }
        return url.origin === location.origin && providers.some(p => p.isActivity(url.pathname, entry.duration));
      });
      if (!spent) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        send({ type: 'wam:refresh', reason: 'activity', providerIds: providers.map(p => p.id) });
      }, ACTIVITY_SETTLE_MS);
    }).observe({ type: 'resource', buffered: false });
  } catch {
    // No resource timing here; the background poll still runs.
  }
}

// ------------------------------------------------------------- resources

async function loadCss() {
  const paths = ['ui/theme.css', 'content/hud.css'];
  const texts = await Promise.all(paths.map(path => fetch(chrome.runtime.getURL(path)).then(r => r.text())));
  return texts.join('\n');
}

/**
 * The pixel font, added to the page from bytes: a FontFace built from an
 * ArrayBuffer needs no URL, so the page's CSP font-src cannot block it.
 */
async function loadFont() {
  for (const face of document.fonts) {
    if (face.family.replace(/["']/g, '') === FONT_FAMILY) return;
  }
  const response = await fetch(chrome.runtime.getURL('assets/fonts/guild-pixel-12.woff2'));
  const face = new FontFace(FONT_FAMILY, await response.arrayBuffer());
  await face.load();
  document.fonts.add(face);
}

function applyStyles(shadow, css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.append(h(document, 'style', { text: css }));
  }
}

// -------------------------------------------------------------------- HUD

class Hud {
  constructor(css, settings, snapshots) {
    this.settings = settings;
    this.snapshots = snapshots;
    this.lang = null;
    this.t = createTranslator('zh_CN');
    this.translators = new Map();
    this.cards = new Map();
    this.drag = null;
    this.vendorPage = providersForOrigin(location.origin).length > 0;

    this.host = document.createElement(HOST_TAG);
    const style = this.host.style;
    style.setProperty('all', 'initial', 'important');
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('z-index', '2147483647', 'important');
    style.setProperty('display', 'none', 'important');

    const shadow = this.host.attachShadow({ mode: 'closed' });
    applyStyles(shadow, css);

    this.cardsEl = h(document, 'div', { class: 'hud-cards' });
    this.toggle = h(document, 'button', { class: 'hud-btn', type: 'button', text: '-', onclick: () => this.setCollapsed(true) });
    this.sheet = h(document, 'div', { class: 'sheet hud-sheet', role: 'region' }, [this.cardsEl, this.toggle]);
    this.chip = h(document, 'div', { class: 'sheet hud-chip', role: 'button', tabindex: '0' });
    this.minis = ['mp', 'hp', 'sp'].map(role => {
      const fill = h(document, 'b');
      const el = h(document, 'i', { class: `mini role-${role}` }, fill);
      this.chip.append(el);
      return { role, el, fill };
    });
    this.root = h(document, 'div', { class: 'wam hud' }, [this.sheet, this.chip]);
    shadow.append(this.root);

    for (const surface of [this.sheet, this.chip]) {
      surface.addEventListener('pointerdown', event => this.onPointerDown(event));
      surface.addEventListener('pointermove', event => this.onPointerMove(event));
      surface.addEventListener('pointerup', event => this.onPointerUp(event));
      surface.addEventListener('pointercancel', () => this.endDrag());
    }
    this.chip.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.setCollapsed(false);
      }
    });
  }

  mount() {
    document.documentElement.append(this.host);
    this.render();

    this.onStorage = (changes, area) => this.storageChanged(changes, area);
    chrome.storage.onChanged.addListener(this.onStorage);
    this.onVisible = () => {
      if (document.hidden) return;
      this.tick();
      this.refreshIfStale();
    };
    document.addEventListener('visibilitychange', this.onVisible);
    this.onLayout = () => this.place();
    addEventListener('resize', this.onLayout);
    this.onFullscreen = () => this.applyVisibility();
    document.addEventListener('fullscreenchange', this.onFullscreen);
    this.timer = setInterval(() => this.tick(), 1000);
    this.refreshIfStale();
  }

  destroy() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    removeEventListener('resize', this.onLayout);
    try {
      chrome.storage.onChanged.removeListener(this.onStorage);
    } catch {
      // The extension context is already gone.
    }
    this.host.remove();
  }

  storageChanged(changes, area) {
    if (area !== 'local') return;
    let dirty = false;
    if (changes[SETTINGS_KEY]) {
      this.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      dirty = true;
    }
    for (const [key, change] of Object.entries(changes)) {
      const id = providerIdOfKey(key);
      if (id) {
        this.snapshots[id] = change.newValue ?? null;
        dirty = true;
      }
    }
    if (dirty) this.render();
  }

  /** The providers the user monitors. */
  providers() {
    return enabledProviders(PROVIDERS, this.settings);
  }

  refreshIfStale() {
    if (document.hidden || !this.shouldShow()) return;
    const now = Date.now();
    const stale = this.providers().some(p => !this.snapshots[p.id] || now - (this.snapshots[p.id].attemptedAt ?? 0) > STALE_AFTER_MS);
    if (stale) send({ type: 'wam:refresh', reason: 'visible' });
  }

  shouldShow() {
    const { hud } = this.settings;
    // Vendors' own sites always qualify; other sites only with "every site" on.
    const allowedHere = this.vendorPage || hud.everywhere;
    return hud.enabled && allowedHere && this.providers().length > 0 && !document.fullscreenElement;
  }

  translatorFor(provider) {
    return this.translators.get(provider.id) ?? this.t;
  }

  render() {
    const lang = resolveLang(this.settings.lang, browserLanguage());
    if (lang !== this.lang) {
      this.lang = lang;
      this.t = createTranslator(lang);
      for (const provider of PROVIDERS) this.translators.set(provider.id, createTranslator(lang, provider.template.messages));
    }
    const { t } = this;
    this.sheet.setAttribute('aria-label', t('hud.label'));
    this.toggle.title = t('action.collapse');
    this.toggle.setAttribute('aria-label', t('action.collapse'));
    this.chip.setAttribute('aria-label', `${t('hud.label')}: ${t('action.expand')}`);

    // Size: a zoom on the whole window; the pixel art stays crisp at 100% and 200%.
    this.root.style.setProperty('zoom', String(this.settings.hud.scale));

    const now = Date.now();
    const monitored = new Set(this.providers().map(provider => provider.id));
    for (const provider of PROVIDERS) {
      let card = this.cards.get(provider.id);
      if (!monitored.has(provider.id)) {
        card?.el.remove();
        this.cards.delete(provider.id);
        continue;
      }
      if (!card) {
        card = new ProviderCard(document, provider, {
          compact: true,
          onOpenSite: p => window.open(p.homeUrl, '_blank', 'noopener'),
        });
        this.cards.set(provider.id, card);
      }
      this.cardsEl.append(card.el); // keeps registry order
      card.rankExpiry = this.settings.rankExpiry[provider.id] ?? null;
      card.render(this.snapshots[provider.id] ?? null, this.translatorFor(provider), now);
    }
    this.renderChip(now);
    this.applyVisibility();
  }

  /** The collapsed tab mirrors the first monitored provider's MP / HP / SP. */
  renderChip(now) {
    const [provider] = this.providers();
    if (!provider) return;
    const views = buildGaugeViews(provider.template, this.snapshots[provider.id]?.meters ?? [], now);
    const t = this.translatorFor(provider);
    const summary = [provider.name];
    for (const mini of this.minis) {
      const view = viewForRole(views, mini.role);
      const shown = view?.state === 'ok';
      mini.el.hidden = !shown && view?.state === 'sealed';
      mini.el.className = `mini role-${mini.role} level-${view?.level ?? 'empty'}`;
      mini.fill.style.width = `${shown ? view.value : 0}%`;
      if (shown) summary.push(`${mini.role.toUpperCase()} ${view.value}`);
    }
    this.chip.title = `${summary.join('  ')}\n${t('action.expand')}`;
  }

  applyVisibility() {
    const show = this.shouldShow();
    this.host.style.setProperty('display', show ? 'block' : 'none', 'important');
    const { collapsed } = this.settings.hud;
    this.sheet.hidden = collapsed;
    this.chip.hidden = !collapsed;
    if (show) this.place();
  }

  /** Pin to the saved corner, pulled back inside the window if it shrank. */
  place() {
    if (this.drag?.moved) return;
    const { corner, x, y } = this.settings.hud;
    const { width, height } = viewport();
    const rect = this.host.getBoundingClientRect();
    const style = this.host.style;
    for (const side of ['top', 'right', 'bottom', 'left']) style.removeProperty(side);
    style.setProperty(corner[0] === 't' ? 'top' : 'bottom', `${clamp(y, 0, Math.max(0, height - rect.height))}px`, 'important');
    style.setProperty(corner[1] === 'l' ? 'left' : 'right', `${clamp(x, 0, Math.max(0, width - rect.width))}px`, 'important');
  }

  tick() {
    if (!alive()) {
      this.destroy();
      return;
    }
    if (document.hidden || !this.shouldShow()) return;
    const now = Date.now();
    if (this.settings.hud.collapsed) {
      this.renderChip(now);
      return;
    }
    for (const provider of this.providers()) this.cards.get(provider.id)?.tick(this.translatorFor(provider), now);
  }

  setCollapsed(collapsed) {
    this.settings = { ...this.settings, hud: { ...this.settings.hud, collapsed } };
    this.applyVisibility();
    this.tick();
    updateSettings(draft => { draft.hud.collapsed = collapsed; }).catch(() => {});
  }

  // ------------------------------------------------------------------ drag

  onPointerDown(event) {
    if (event.button !== 0 || event.target.closest?.('button')) return;
    const rect = this.host.getBoundingClientRect();
    this.drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    this.root.classList.add('dragging');
    const { width, height } = viewport();
    const rect = this.host.getBoundingClientRect();
    const style = this.host.style;
    style.removeProperty('right');
    style.removeProperty('bottom');
    style.setProperty('left', `${clamp(drag.left + dx, 0, Math.max(0, width - rect.width))}px`, 'important');
    style.setProperty('top', `${clamp(drag.top + dy, 0, Math.max(0, height - rect.height))}px`, 'important');
  }

  onPointerUp(event) {
    const drag = this.endDrag();
    if (!drag) return;
    if (!drag.moved) {
      if (event.currentTarget === this.chip) this.setCollapsed(false);
      return;
    }
    // Snap to the nearest corner and remember the gap to it.
    const rect = this.host.getBoundingClientRect();
    const { width, height } = viewport();
    const top = rect.top + rect.height / 2 < height / 2;
    const left = rect.left + rect.width / 2 < width / 2;
    const hud = {
      ...this.settings.hud,
      corner: `${top ? 't' : 'b'}${left ? 'l' : 'r'}`,
      x: Math.max(0, Math.round(left ? rect.left : width - rect.right)),
      y: Math.max(0, Math.round(top ? rect.top : height - rect.bottom)),
    };
    this.settings = { ...this.settings, hud };
    this.place();
    updateSettings(draft => { draft.hud = { ...draft.hud, corner: hud.corner, x: hud.x, y: hud.y }; }).catch(() => {});
  }

  endDrag() {
    const drag = this.drag;
    this.drag = null;
    this.root.classList.remove('dragging');
    return drag;
  }
}

export async function start() {
  if (!alive()) return;
  hookVendorPage();
  const [css, settings, snapshots] = await Promise.all([
    loadCss(),
    loadSettings(),
    readSnapshots(PROVIDERS.map(provider => provider.id)),
  ]);
  loadFont().catch(() => {});
  new Hud(css, settings, snapshots).mount();
}
