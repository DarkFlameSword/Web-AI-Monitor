import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import { DEFAULT_SETTINGS, POLL_CHOICES, SETTINGS_KEY, loadSettings, normalizeSettings, updateSettings } from '../core/settings.js';
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
  /** Hostname of the active tab when it is a web page, for "hide on this site". */
  host: null,
  refreshing: false,
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

const langSelect = select(['auto', ...LANGS], value => updateSettings(draft => { draft.lang = value; }));
const pollSelect = select(POLL_CHOICES, value => updateSettings(draft => { draft.pollMinutes = Number(value); }));
const hudShow = checkbox(checked => updateSettings(draft => { draft.hud.enabled = checked; }));
const hudHideHere = checkbox(checked => updateSettings(draft => {
  const hosts = new Set(draft.hiddenHosts);
  if (checked) hosts.add(state.host);
  else hosts.delete(state.host);
  draft.hiddenHosts = [...hosts];
}));
const hudReset = h(doc, 'button', {
  class: 'cmd',
  type: 'button',
  onclick: () => updateSettings(draft => { draft.hud = { ...DEFAULT_SETTINGS.hud }; }),
});

const langLabel = h(doc, 'span', { class: 'set-label' });
const hudLabel = h(doc, 'span', { class: 'set-label' });
const pollLabel = h(doc, 'span', { class: 'set-label' });
const privacyNote = h(doc, 'p', { class: 'set-note' });

settingsView.append(
  h(doc, 'div', { class: 'set-row' }, [langLabel, h(doc, 'div', { class: 'set-col' }, langSelect.wrap)]),
  h(doc, 'div', { class: 'set-row' }, [hudLabel, h(doc, 'div', { class: 'set-col' }, [hudShow.wrap, hudHideHere.wrap, hudReset])]),
  h(doc, 'div', { class: 'set-row' }, [pollLabel, h(doc, 'div', { class: 'set-col' }, pollSelect.wrap)]),
  h(doc, 'div', { class: 'rule' }),
  privacyNote,
);

function renderSettings() {
  const { settings } = state;
  langLabel.textContent = t('settings.language');
  hudLabel.textContent = t('settings.hud');
  pollLabel.textContent = t('settings.poll');
  privacyNote.textContent = t('settings.privacy');

  for (const option of langSelect.el.options) {
    option.textContent = option.value === 'auto' ? t('settings.langAuto') : LANG_NAMES[option.value];
  }
  langSelect.el.value = settings.lang;
  for (const option of pollSelect.el.options) option.textContent = t('settings.minutes', { n: option.value });
  pollSelect.el.value = String(settings.pollMinutes);

  hudShow.input.checked = settings.hud.enabled;
  hudShow.text.textContent = t('settings.hudShow');
  hudHideHere.wrap.hidden = !state.host;
  hudHideHere.input.checked = Boolean(state.host) && settings.hiddenHosts.includes(state.host);
  hudHideHere.text.textContent = t('settings.hudHideHere', { host: state.host ?? '' });
  hudReset.textContent = t('settings.hudResetPos');
}

// ----------------------------------------------------------------- status

function translatorFor(provider) {
  return translators.get(provider.id) ?? t;
}

function openSite(provider) {
  chrome.tabs.create({ url: provider.homeUrl });
  window.close();
}

function renderCards(now) {
  for (const provider of PROVIDERS) {
    let card = cards.get(provider.id);
    if (!card) {
      card = new ProviderCard(doc, provider, { onOpenSite: openSite });
      cards.set(provider.id, card);
      statusView.append(card.el);
    }
    card.busy = state.refreshing;
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

async function activeHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
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

setInterval(() => {
  const now = Date.now();
  for (const provider of PROVIDERS) cards.get(provider.id)?.tick(translatorFor(provider), now);
}, 1000);

const [settings, snapshots, host] = await Promise.all([
  loadSettings(),
  readSnapshots(PROVIDERS.map(provider => provider.id)),
  activeHost(),
]);
Object.assign(state, { settings, snapshots, host });
render();
requestRefresh('popup');
