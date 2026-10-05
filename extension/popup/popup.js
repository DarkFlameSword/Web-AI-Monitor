import { ALL_SITES } from '../background/page-hud.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import {
  DEFAULT_SETTINGS,
  POLL_RANGE,
  SCALE_RANGE,
  SETTINGS_KEY,
  enabledProviders,
  loadSettings,
  normalizeSettings,
  updateSettings,
} from '../core/settings.js';
import { providerIdOfKey, readSnapshots } from '../core/store.js';
import { PROVIDERS } from '../providers/index.js';
import { ProviderCard } from '../ui/card.js';
import { CREST, CREST_PALETTE, h, pixelArt } from '../ui/dom.js';

const doc = document;
const app = doc.getElementById('app');

const state = {
  settings: normalizeSettings(null),
  snapshots: {},
  view: 'status',
  refreshing: false,
  /** Optional permissions currently granted. */
  perms: { allSites: false, notify: false },
};

let t = createTranslator('zh_CN');
const translators = new Map();
const cards = new Map();

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
  statusView,
  settingsView,
);
statusView.append(nothingMonitored);

// --------------------------------------------------------------- settings

function select(options, onChange) {
  const el = h(doc, 'select', { onchange: () => onChange(el.value) });
  for (const value of options) el.append(h(doc, 'option', { value: String(value) }));
  return { wrap: h(doc, 'span', { class: 'pix-select' }, el), el };
}

function checkbox(onChange) {
  const input = h(doc, 'input', { type: 'checkbox', onchange: () => onChange(input.checked) });
  const text = h(doc, 'span');
  return { wrap: h(doc, 'label', { class: 'pix-check' }, [input, h(doc, 'span', { class: 'box' }), text]), input, text };
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

const langSelect = select(['auto', ...LANGS], value => updateSettings(draft => { draft.lang = value; }));
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
const providerChecks = PROVIDERS.map(provider => ({
  provider,
  check: checkbox(checked => {
    updateSettings(draft => {
      const off = new Set(draft.disabledProviders);
      if (checked) off.delete(provider.id);
      else off.add(provider.id);
      draft.disabledProviders = [...off];
    }).then(() => checked && requestRefresh('manual'));
  }),
}));
const providersMore = h(doc, 'span', { class: 'set-hint' });

/** Rank expiry, typed by the user per provider (YYYY-MM-DD from a date input). */
const expiryInputs = PROVIDERS.map(provider => {
  const saveDay = day => updateSettings(draft => {
    if (day) draft.rankExpiry[provider.id] = day;
    else delete draft.rankExpiry[provider.id];
  });
  const input = h(doc, 'input', { type: 'date', onchange: () => saveDay(input.value) });
  const clear = h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => saveDay('') });
  const name = h(doc, 'span', { class: 'set-sub', text: provider.name });
  return {
    provider,
    input,
    clear,
    wrap: h(doc, 'div', { class: 'set-inline' }, [name, h(doc, 'span', { class: 'pix-select pix-date' }, input), clear]),
  };
});
const expiryHint = h(doc, 'span', { class: 'set-hint' });
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
const hudReset = h(doc, 'button', {
  class: 'cmd',
  type: 'button',
  onclick: () => updateSettings(draft => { draft.hud = { ...DEFAULT_SETTINGS.hud }; }),
});

const langLabel = h(doc, 'span', { class: 'set-label' });
const hudLabel = h(doc, 'span', { class: 'set-label' });
const pollLabel = h(doc, 'span', { class: 'set-label' });
const notifyLabel = h(doc, 'span', { class: 'set-label' });
const providersLabel = h(doc, 'span', { class: 'set-label' });
const sizeLabel = h(doc, 'span', { class: 'set-sub' });
const expiryLabel = h(doc, 'span', { class: 'set-label' });
const privacyNote = h(doc, 'p', { class: 'set-note' });

settingsView.append(
  h(doc, 'div', { class: 'set-row' }, [langLabel, h(doc, 'div', { class: 'set-col' }, langSelect.wrap)]),
  h(doc, 'div', { class: 'set-row' }, [
    providersLabel,
    h(doc, 'div', { class: 'set-col' }, [...providerChecks.map(item => item.check.wrap), providersMore]),
  ]),
  h(doc, 'div', { class: 'set-row' }, [
    expiryLabel,
    h(doc, 'div', { class: 'set-col' }, [...expiryInputs.map(item => item.wrap), expiryHint]),
  ]),
  h(doc, 'div', { class: 'set-row' }, [
    hudLabel,
    h(doc, 'div', { class: 'set-col' }, [
      hudShow.wrap,
      hudEverywhere.wrap,
      h(doc, 'div', { class: 'set-inline' }, [sizeLabel, sizeSlider.wrap]),
      hudReset,
    ]),
  ]),
  h(doc, 'div', { class: 'set-row' }, [notifyLabel, h(doc, 'div', { class: 'set-col' }, notifyRecovered.wrap)]),
  h(doc, 'div', { class: 'set-row' }, [pollLabel, h(doc, 'div', { class: 'set-col' }, pollSlider.wrap)]),
  h(doc, 'div', { class: 'rule' }),
  privacyNote,
);

function renderSettings() {
  const { settings } = state;
  langLabel.textContent = t('settings.language');
  hudLabel.textContent = t('settings.hud');
  pollLabel.textContent = t('settings.poll');
  notifyLabel.textContent = t('settings.notify');
  providersLabel.textContent = t('settings.providers');
  sizeLabel.textContent = t('settings.hudSize');
  providersMore.textContent = t('settings.providersMore');
  expiryLabel.textContent = t('settings.rankExpiry');
  expiryHint.textContent = t('settings.rankExpiryHint');
  const monitored = enabledProviders(PROVIDERS, settings);
  for (const { provider, input, clear, wrap } of expiryInputs) {
    wrap.hidden = !monitored.includes(provider);
    const day = settings.rankExpiry[provider.id] ?? '';
    if (doc.activeElement !== input) input.value = day;
    input.setAttribute('aria-label', `${provider.name} ${t('settings.rankExpiry')}`);
    clear.textContent = t('action.clear');
    clear.hidden = !day;
  }
  privacyNote.textContent = t('settings.privacy');

  for (const { provider, check } of providerChecks) {
    check.input.checked = !settings.disabledProviders.includes(provider.id);
    check.text.textContent = provider.name;
  }

  for (const option of langSelect.el.options) {
    option.textContent = option.value === 'auto' ? t('settings.langAuto') : LANG_NAMES[option.value];
  }
  langSelect.el.value = settings.lang;
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
  hudReset.textContent = t('settings.hudResetPos');
}

// ----------------------------------------------------------------- status

function translatorFor(provider) {
  return translators.get(provider.id) ?? t;
}

/** From the card's expiry line: jump to the provider's date field in settings. */
function editExpiry(provider) {
  state.view = 'settings';
  render();
  expiryInputs.find(item => item.provider === provider)?.input.focus();
}

function openSite(provider) {
  chrome.tabs.create({ url: provider.homeUrl });
  window.close();
}

function renderCards(now) {
  const monitored = enabledProviders(PROVIDERS, state.settings);
  nothingMonitored.hidden = monitored.length > 0;
  nothingMonitored.textContent = t('popup.noProviders');
  for (const provider of PROVIDERS) {
    let card = cards.get(provider.id);
    if (!monitored.includes(provider)) {
      card?.el.remove();
      cards.delete(provider.id);
      continue;
    }
    if (!card) {
      card = new ProviderCard(doc, provider, { onOpenSite: openSite, onEditExpiry: editExpiry });
      cards.set(provider.id, card);
    }
    statusView.append(card.el); // keeps registry order
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
  const [allSites, notify] = await Promise.all([
    chrome.permissions.contains({ origins: [...ALL_SITES] }),
    chrome.permissions.contains({ permissions: ['notifications'] }),
  ]);
  return { allSites, notify };
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
