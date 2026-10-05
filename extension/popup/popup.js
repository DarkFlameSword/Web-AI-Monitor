import { ALL_SITES } from '../background/page-hud.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import {
  POLL_RANGE,
  SCALE_RANGE,
  SETTINGS_KEY,
  enabledProviders,
  loadSettings,
  normalizeSettings,
  updateSettings,
} from '../core/settings.js';
import { providerIdOfKey, readSnapshots } from '../core/store.js';
import { formatDate } from '../core/time.js';
import { PROVIDERS, originPattern } from '../providers/index.js';
import { ProviderCard } from '../ui/card.js';
import { CREST, CREST_PALETTE, h, pixelArt } from '../ui/dom.js';
import { pixelDate, pixelSelect } from './controls.js';

const doc = document;
const app = doc.getElementById('app');
const TAB_KEY = 'wam.activeProvider';

const state = {
  settings: normalizeSettings(null),
  snapshots: {},
  view: 'status',
  refreshing: false,
  /** Optional permissions currently granted; vendors by provider id. */
  perms: { allSites: false, notify: false, vendors: {} },
  /** The vendor tab on show when several are monitored. */
  active: readTab(),
};

let t = createTranslator('zh_CN');
const translators = new Map();
const cards = new Map();

function readTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function saveTab(id) {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    // Only a convenience.
  }
}

/** Monitored: switched on, and for vendors behind a permission, allowed. */
function monitored() {
  return enabledProviders(PROVIDERS, state.settings)
    .filter(provider => !provider.optionalPermission || state.perms.vendors[provider.id]);
}

// ------------------------------------------------------------------ shell

const title = h(doc, 'span', { class: 'guild-title' });
const refreshCmd = h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => requestRefresh('manual') });
const settingsCmd = h(doc, 'button', {
  class: 'cmd',
  type: 'button',
  onclick: () => {
    state.view = state.view === 'settings' ? 'status' : 'settings';
    render();
  },
});
const tabs = h(doc, 'nav', { class: 'vendor-tabs', role: 'tablist' });
const statusView = h(doc, 'div', { class: 'status-view' });
const nothingMonitored = h(doc, 'div', { class: 'notice', role: 'status' });
const settingsView = h(doc, 'div', { class: 'settings' });

app.append(
  h(doc, 'header', { class: 'guild-head' }, [
    pixelArt(doc, CREST, CREST_PALETTE),
    title,
    h(doc, 'nav', { class: 'guild-cmds' }, [refreshCmd, settingsCmd]),
  ]),
  h(doc, 'div', { class: 'rule' }),
  tabs,
  statusView,
  settingsView,
);
statusView.append(nothingMonitored);

// --------------------------------------------------------------- settings

function checkbox(onChange) {
  const input = h(doc, 'input', { type: 'checkbox', onchange: () => onChange(input.checked) });
  const text = h(doc, 'span');
  const extra = h(doc, 'span', { class: 'set-hint' });
  return { wrap: h(doc, 'label', { class: 'pix-check' }, [input, h(doc, 'span', { class: 'box' }), text, extra]), input, text, extra };
}

/**
 * A pixel slider: drag it, use the arrow keys, or roll the mouse wheel over
 * it. The label follows at once; the setting is saved when it settles.
 */
function slider({ min, max, step, format, onCommit }) {
  const input = h(doc, 'input', { type: 'range', min: String(min), max: String(max), step: String(step) });
  const value = h(doc, 'span', { class: 'pix-range-value' });
  let timer = 0;
  const commit = () => {
    clearTimeout(timer);
    onCommit(Number(input.value));
  };
  const show = () => { value.textContent = format(Number(input.value)); };
  input.addEventListener('input', show);
  input.addEventListener('change', commit);
  input.addEventListener('wheel', event => {
    event.preventDefault();
    const next = Number(input.value) + (event.deltaY < 0 ? step : -step);
    input.value = String(Math.min(max, Math.max(min, next)));
    show();
    clearTimeout(timer);
    timer = setTimeout(commit, 350);
  }, { passive: false });
  return {
    wrap: h(doc, 'span', { class: 'pix-range' }, [input, value]),
    input,
    set(current) {
      // Do not yank the thumb from under the user.
      if (doc.activeElement !== input) input.value = String(current);
      show();
    },
  };
}

const langSelect = pixelSelect(doc, { onChange: value => updateSettings(draft => { draft.lang = value; }) });

const providerChecks = PROVIDERS.map(provider => ({
  provider,
  check: checkbox(checked => {
    if (checked && provider.optionalPermission) {
      // Asking for the vendor's site must start inside the click. Once it is
      // granted the worker also switches the vendor on, in case the popup closed.
      chrome.permissions.request({ origins: [originPattern(provider)] })
        .then(granted => granted && updateSettings(draft => { draft.providers[provider.id] = true; }))
        .then(saved => saved && requestRefresh('manual'))
        .finally(refreshPermissions);
      return;
    }
    updateSettings(draft => { draft.providers[provider.id] = checked; }).then(() => checked && requestRefresh('manual'));
    if (!checked && provider.optionalPermission) {
      chrome.permissions.remove({ origins: [originPattern(provider)] }).catch(() => false).finally(refreshPermissions);
    }
  }),
}));
const providersMore = h(doc, 'span', { class: 'set-hint' });

/** Subscription end per vendor, picked on a pixel calendar. */
const expiryFields = PROVIDERS.map(provider => {
  const saveDay = day => updateSettings(draft => {
    if (day) draft.rankExpiry[provider.id] = day;
    else delete draft.rankExpiry[provider.id];
  });
  const picker = pixelDate(doc, {
    onChange: saveDay,
    translator: () => t,
    format: ms => formatDate(ms, t.tag),
  });
  const clear = h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => saveDay('') });
  const name = h(doc, 'span', { class: 'set-sub set-name', text: provider.name });
  return { provider, picker, clear, wrap: h(doc, 'div', { class: 'set-inline' }, [name, picker.el, clear]) };
});
const expiryHint = h(doc, 'span', { class: 'set-hint' });

const pollSlider = slider({
  ...POLL_RANGE,
  step: 1,
  format: n => t('settings.minutes', { n }),
  onCommit: n => updateSettings(draft => { draft.pollMinutes = n; }),
});
const sizeSlider = slider({
  ...SCALE_RANGE,
  format: n => `${Math.round(n * 100)}%`,
  onCommit: n => updateSettings(draft => { draft.hud.scale = n; }),
});
const hudShow = checkbox(checked => updateSettings(draft => { draft.hud.enabled = checked; }));
// Permission requests must start inside the click. The worker also mirrors
// grants into settings, in case the popup closes while Chrome asks.
const hudEverywhere = checkbox(checked => {
  if (checked) {
    chrome.permissions.request({ origins: [...ALL_SITES] })
      .then(granted => granted && updateSettings(draft => { draft.hud.enabled = true; draft.hud.everywhere = true; }))
      .finally(refreshPermissions);
  } else {
    updateSettings(draft => { draft.hud.everywhere = false; });
    chrome.permissions.remove({ origins: [...ALL_SITES] }).finally(refreshPermissions);
  }
});
const notifyRecovered = checkbox(checked => {
  if (checked) {
    chrome.permissions.request({ permissions: ['notifications'] })
      .then(granted => granted && updateSettings(draft => { draft.notify.recovered = true; }))
      .finally(refreshPermissions);
  } else {
    updateSettings(draft => { draft.notify.recovered = false; });
    chrome.permissions.remove({ permissions: ['notifications'] }).finally(refreshPermissions);
  }
});

const labels = {
  lang: h(doc, 'span', { class: 'set-label' }),
  providers: h(doc, 'span', { class: 'set-label' }),
  expiry: h(doc, 'span', { class: 'set-label' }),
  hud: h(doc, 'span', { class: 'set-label' }),
  size: h(doc, 'span', { class: 'set-sub' }),
  notify: h(doc, 'span', { class: 'set-label' }),
  poll: h(doc, 'span', { class: 'set-label' }),
};
const privacyNote = h(doc, 'p', { class: 'set-note' });
const row = (label, controls) => h(doc, 'div', { class: 'set-row' }, [label, h(doc, 'div', { class: 'set-col' }, controls)]);

settingsView.append(
  row(labels.lang, langSelect.el),
  row(labels.providers, [...providerChecks.map(item => item.check.wrap), providersMore]),
  row(labels.expiry, [...expiryFields.map(item => item.wrap), expiryHint]),
  row(labels.hud, [hudShow.wrap, hudEverywhere.wrap, h(doc, 'div', { class: 'set-inline' }, [labels.size, sizeSlider.wrap])]),
  row(labels.notify, notifyRecovered.wrap),
  row(labels.poll, pollSlider.wrap),
  h(doc, 'div', { class: 'rule' }),
  privacyNote,
);

function renderSettings() {
  const { settings } = state;
  labels.lang.textContent = t('settings.language');
  labels.providers.textContent = t('settings.providers');
  labels.expiry.textContent = t('settings.rankExpiry');
  labels.hud.textContent = t('settings.hud');
  labels.size.textContent = t('settings.hudSize');
  labels.notify.textContent = t('settings.notify');
  labels.poll.textContent = t('settings.poll');
  providersMore.textContent = t('settings.providersMore');
  expiryHint.textContent = t('settings.rankExpiryHint');
  privacyNote.textContent = t('settings.privacy');

  langSelect.setOptions(['auto', ...LANGS].map(value => ({
    value,
    label: value === 'auto' ? t('settings.langAuto') : LANG_NAMES[value],
  })));
  langSelect.setValue(settings.lang);
  langSelect.setLabel(t('settings.language'));

  const watching = monitored();
  for (const { provider, check } of providerChecks) {
    check.input.checked = watching.includes(provider);
    check.text.textContent = provider.name;
    check.extra.textContent = provider.optionalPermission && !check.input.checked ? t('settings.needsPermission') : '';
  }
  for (const { provider, picker, clear, wrap } of expiryFields) {
    wrap.hidden = !watching.includes(provider);
    const day = settings.rankExpiry[provider.id] ?? '';
    picker.setValue(day);
    picker.setLabel(`${provider.name} ${t('settings.rankExpiry')}`);
    clear.textContent = t('action.clear');
    clear.hidden = !day;
  }

  pollSlider.set(settings.pollMinutes);
  sizeSlider.set(settings.hud.scale);
  sizeSlider.input.disabled = !settings.hud.enabled;
  hudShow.input.checked = settings.hud.enabled;
  hudShow.text.textContent = t('settings.hudShow');
  hudEverywhere.input.checked = settings.hud.everywhere && state.perms.allSites;
  hudEverywhere.input.disabled = !settings.hud.enabled;
  hudEverywhere.text.textContent = t('settings.hudEverywhere');
  notifyRecovered.input.checked = settings.notify.recovered && state.perms.notify;
  notifyRecovered.text.textContent = t('settings.notifyRecovered');
}

// ----------------------------------------------------------------- status

function translatorFor(provider) {
  return translators.get(provider.id) ?? t;
}

function openSite(provider) {
  chrome.tabs.create({ url: provider.homeUrl });
  window.close();
}

/** From a card's expiry line: open settings at that vendor's calendar. */
function editExpiry(provider) {
  state.view = 'settings';
  render();
  expiryFields.find(item => item.provider === provider)?.picker.button.click();
}

function renderTabs(watching) {
  tabs.hidden = watching.length < 2 || state.view !== 'status';
  tabs.setAttribute('aria-label', t('popup.tabs'));
  tabs.replaceChildren(...watching.map(provider => {
    const selected = provider.id === state.active;
    return h(doc, 'button', {
      class: selected ? 'cmd tab selected' : 'cmd tab',
      type: 'button',
      role: 'tab',
      'aria-selected': String(selected),
      onclick: () => {
        state.active = provider.id;
        saveTab(provider.id);
        render();
      },
    }, provider.name);
  }));
}

function renderCards(now) {
  const watching = monitored();
  if (!watching.some(provider => provider.id === state.active)) state.active = watching[0]?.id ?? null;
  nothingMonitored.hidden = watching.length > 0;
  nothingMonitored.textContent = t('popup.noProviders');
  renderTabs(watching);
  for (const provider of PROVIDERS) {
    let card = cards.get(provider.id);
    if (!watching.includes(provider)) {
      card?.el.remove();
      cards.delete(provider.id);
      continue;
    }
    if (!card) {
      card = new ProviderCard(doc, provider, { onOpenSite: openSite, onEditExpiry: editExpiry });
      cards.set(provider.id, card);
    }
    statusView.append(card.el); // keeps registry order
    card.el.hidden = provider.id !== state.active;
    card.busy = state.refreshing;
    card.rankExpiry = state.settings.rankExpiry[provider.id] ?? null;
    card.render(state.snapshots[provider.id] ?? null, translatorFor(provider), now);
  }
}

function render() {
  const lang = resolveLang(state.settings.lang, browserLanguage());
  if (t.lang !== lang || translators.size === 0) {
    t = createTranslator(lang);
    for (const provider of PROVIDERS) translators.set(provider.id, createTranslator(lang, provider.template.messages));
    doc.documentElement.lang = LANG_TAGS[lang];
  }
  title.textContent = t('guild.title');
  refreshCmd.textContent = t('action.refresh');
  refreshCmd.disabled = state.refreshing;
  settingsCmd.textContent = t(state.view === 'settings' ? 'action.back' : 'action.settings');
  statusView.hidden = state.view !== 'status';
  settingsView.hidden = state.view !== 'settings';
  renderCards(Date.now());
  renderSettings();
}

async function requestRefresh(reason) {
  if (state.refreshing) return;
  state.refreshing = true;
  render();
  try {
    await chrome.runtime.sendMessage({ type: 'wam:refresh', reason });
  } catch {
    // The worker answers once it has written the snapshot; a failure shows on the card.
  }
  state.refreshing = false;
  render();
}

async function readPermissions() {
  const has = query => chrome.permissions.contains(query).catch(() => false);
  const vendors = {};
  for (const provider of PROVIDERS.filter(item => item.optionalPermission)) {
    vendors[provider.id] = await has({ origins: [originPattern(provider)] });
  }
  const [allSites, notify] = await Promise.all([
    has({ origins: [...ALL_SITES] }),
    has({ permissions: ['notifications'] }),
  ]);
  return { allSites, notify, vendors };
}

async function refreshPermissions() {
  state.perms = await readPermissions();
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let dirty = false;
  if (changes[SETTINGS_KEY]) {
    state.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    dirty = true;
  }
  for (const [key, change] of Object.entries(changes)) {
    const id = providerIdOfKey(key);
    if (id) {
      state.snapshots[id] = change.newValue ?? null;
      dirty = true;
    }
  }
  if (dirty) render();
});

chrome.permissions.onAdded.addListener(refreshPermissions);
chrome.permissions.onRemoved.addListener(refreshPermissions);

setInterval(() => {
  const now = Date.now();
  for (const provider of PROVIDERS) cards.get(provider.id)?.tick(translatorFor(provider), now);
}, 1000);

const [settings, snapshots, perms] = await Promise.all([
  loadSettings(),
  readSnapshots(PROVIDERS.map(provider => provider.id)),
  readPermissions(),
]);
Object.assign(state, { settings, snapshots, perms });
render();
requestRefresh('popup');
