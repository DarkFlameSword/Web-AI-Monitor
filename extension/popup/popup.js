import { ALL_SITES } from '../background/page-hud.js';
import { PRIVACY_POLICY_URL, WELCOME_PATH, giveConsent, hasConsent, withdrawConsent } from '../core/consent.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { FEEDBACK_URL, HELP_PATH } from '../core/links.js';
import { DEFAULT_LANG, LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import { subscriptionTerm } from '../core/rank.js';
import {
  POLL_RANGE,
  SCALE_RANGE,
  SETTINGS_KEY,
  activeProvider,
  enabledProviders,
  loadSettings,
  normalizeSettings,
  updateSettings,
} from '../core/settings.js';
import { STATUS_MESSAGES, providerIdOfKey, readSnapshots } from '../core/store.js';
import { formatDate } from '../core/time.js';
import { PROVIDERS, originPattern } from '../providers/index.js';
import { ProviderCard } from '../ui/card.js';
import { confirmChoice } from '../ui/confirm.js';
import { consentNotice } from '../ui/consent.js';
import { CREST, CREST_PALETTE, h, pixelArt } from '../ui/dom.js';
import { pixelDate, pixelSelect } from './controls.js';

const doc = document;
const app = doc.getElementById('app');

const state = {
  settings: normalizeSettings(null),
  snapshots: {},
  view: 'status',
  refreshing: false,
  /** Optional permissions currently granted; vendors by provider id. */
  perms: { allSites: false, notify: false, vendors: {} },
  /** The permission Chrome last did not grant: 'allSites', 'notify' or 'vendor:<id>'. */
  denied: null,
};

/**
 * Chrome asks for a permission in its own dialog, and the popup may close
 * while it does. So the request is remembered for the browser session, and
 * if the permission is still missing when the popup opens again, it says so.
 */
const ASKING_KEY = 'wam:asking';
const ASKING_FRESH_MS = 10 * 60_000;

/** Must be called inside the click: Chrome only asks during a user gesture. */
function askPermission(what, query) {
  const asked = chrome.permissions.request(query);
  chrome.storage.session.set({ [ASKING_KEY]: { what, at: Date.now() } }).catch(() => {});
  state.denied = null;
  return asked
    .catch(() => false)
    .then(granted => {
      chrome.storage.session.remove(ASKING_KEY).catch(() => {});
      if (!granted) state.denied = what;
      return granted;
    });
}

const isGranted = (what, perms) => (what === 'allSites' ? perms.allSites
  : what === 'notify' ? perms.notify
    : Boolean(perms.vendors[String(what).replace(/^vendor:/, '')]));

/** A request the popup closed on, and Chrome did not grant. */
async function deniedWhileClosed(perms) {
  const asking = (await chrome.storage.session.get(ASKING_KEY).catch(() => ({})))[ASKING_KEY];
  if (!asking) return null;
  await chrome.storage.session.remove(ASKING_KEY).catch(() => {});
  if (Date.now() - asking.at > ASKING_FRESH_MS || isGranted(asking.what, perms)) return null;
  return asking.what;
}

let t = createTranslator(DEFAULT_LANG);
const translators = new Map();
const cards = new Map();

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
    // Leaving settings unanswered is a "no".
    if (state.view !== 'settings') closeWithdrawAsk();
    render();
  },
});
const tabs = h(doc, 'nav', { class: 'vendor-tabs', role: 'tablist' });
const statusView = h(doc, 'div', { class: 'status-view' });
const nothingMonitored = h(doc, 'div', { class: 'notice', role: 'status' });
const settingsView = h(doc, 'div', { class: 'settings' });
const consentView = h(doc, 'div', { class: 'consent-view' });

app.append(
  h(doc, 'header', { class: 'guild-head' }, [
    pixelArt(doc, CREST, CREST_PALETTE),
    title,
    h(doc, 'nav', { class: 'guild-cmds' }, [refreshCmd, settingsCmd]),
  ]),
  h(doc, 'div', { class: 'rule' }),
  consentView,
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
  const show = () => {
    value.textContent = format(Number(input.value));
    // How far the gauge is filled, for the track's gold.
    input.style.setProperty('--pct', String((Number(input.value) - min) / (max - min)));
  };
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
  // What switching it on reads, said before Chrome asks for the site.
  hint: provider.optionalPermission ? h(doc, 'span', { class: 'set-hint wrap' }) : null,
  check: checkbox(checked => {
    if (checked && provider.optionalPermission) {
      // Asking for the vendor's site must start inside the click. Once it is
      // granted the worker also switches the vendor on, in case the popup closed.
      askPermission(`vendor:${provider.id}`, { origins: [originPattern(provider)] })
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

/**
 * Subscription end per vendor, picked on a pixel calendar. A vendor that
 * reports its paid period shows that date instead, with nothing to fill in.
 */
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
  const name = h(doc, 'span', { class: 'set-sub set-name', text: provider.name });
  const auto = h(doc, 'span', { class: 'set-auto' });
  // Clearing lives in the calendar's footer, so the row fits in every language.
  return { provider, picker, auto, wrap: h(doc, 'div', { class: 'set-inline set-date' }, [name, picker.el, auto]) };
});
const expiryHint = h(doc, 'span', { class: 'set-hint wrap' });
const expiryAutoHint = h(doc, 'span', { class: 'set-hint wrap' });

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
    askPermission('allSites', { origins: [...ALL_SITES] })
      .then(granted => granted && updateSettings(draft => { draft.hud.enabled = true; draft.hud.everywhere = true; }))
      .finally(refreshPermissions);
  } else {
    updateSettings(draft => { draft.hud.everywhere = false; });
    chrome.permissions.remove({ origins: [...ALL_SITES] }).finally(refreshPermissions);
  }
});
const hudEverywhereHint = h(doc, 'span', { class: 'set-hint wrap' });
const notifyHint = h(doc, 'span', { class: 'set-hint wrap' });
const notifyRecovered = checkbox(checked => {
  if (checked) {
    askPermission('notify', { permissions: ['notifications'] })
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
  data: h(doc, 'span', { class: 'set-label' }),
  help: h(doc, 'span', { class: 'set-label' }),
};
const privacyNote = h(doc, 'p', { class: 'set-note' });

/** The data use notice again, the privacy policy, and taking consent back. */
function openPage(url) {
  chrome.tabs.create({ url });
  window.close();
}
const dataCmds = {
  details: h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => openPage(chrome.runtime.getURL(WELCOME_PATH)) }),
  policy: h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => openPage(PRIVACY_POLICY_URL) }),
  withdraw: h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => askWithdraw() }),
};
const withdrawHint = h(doc, 'span', { class: 'set-hint wrap' });
/** The guide to what the card shows, and where to report a problem. */
const helpCmds = {
  guide: h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => openPage(chrome.runtime.getURL(HELP_PATH)) }),
  feedback: h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => openPage(FEEDBACK_URL) }),
};

/**
 * Withdrawing stops everything and deletes the usage data, so it asks first:
 * the question takes the command's place until it is answered.
 */
let withdrawAsk = null;
function askWithdraw() {
  withdrawAsk = confirmChoice(doc, {
    question: t('consent.withdrawAsk'),
    yes: t('consent.withdrawYes'),
    no: t('action.cancel'),
    onYes: () => withdrawConsent().then(next => {
      closeWithdrawAsk();
      state.settings = next;
      state.snapshots = {};
      state.view = 'status';
      render();
    }),
    onNo: () => {
      closeWithdrawAsk();
      dataCmds.withdraw.focus();
    },
  });
  dataCmds.withdraw.hidden = true;
  withdrawHint.hidden = true;
  dataCmds.withdraw.after(withdrawAsk.el);
  withdrawAsk.focus();
}
function closeWithdrawAsk() {
  withdrawAsk?.el.remove();
  withdrawAsk = null;
  dataCmds.withdraw.hidden = false;
  withdrawHint.hidden = false;
}
const row = (label, controls) => h(doc, 'div', { class: 'set-row' }, [label, h(doc, 'div', { class: 'set-col' }, controls)]);

settingsView.append(
  row(labels.lang, langSelect.el),
  row(labels.providers, [...providerChecks.flatMap(item => [item.check.wrap, item.hint]), providersMore]),
  row(labels.expiry, [...expiryFields.map(item => item.wrap), expiryHint, expiryAutoHint]),
  row(labels.hud, [hudShow.wrap, hudEverywhere.wrap, hudEverywhereHint, h(doc, 'div', { class: 'set-inline' }, [labels.size, sizeSlider.wrap])]),
  row(labels.notify, [notifyRecovered.wrap, notifyHint]),
  row(labels.poll, pollSlider.wrap),
  row(labels.data, [dataCmds.details, dataCmds.policy, dataCmds.withdraw, withdrawHint]),
  row(labels.help, h(doc, 'div', { class: 'set-cmds' }, [helpCmds.guide, helpCmds.feedback])),
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
  labels.data.textContent = t('settings.data');
  labels.help.textContent = t('settings.help');
  dataCmds.details.textContent = t('consent.details');
  dataCmds.policy.textContent = t('consent.policy');
  dataCmds.withdraw.textContent = t('consent.withdraw');
  withdrawHint.textContent = t('consent.withdrawHint');
  helpCmds.guide.textContent = t('help.title');
  helpCmds.feedback.textContent = t('help.report');
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
  // Chrome did not grant the last permission asked for (and still has not).
  const denied = state.denied && !isGranted(state.denied, state.perms) ? state.denied : null;
  const deniedHint = (el, what, usual) => {
    el.textContent = denied === what ? t('settings.denied') : usual;
    el.classList.toggle('denied', denied === what);
  };
  for (const { provider, check, hint } of providerChecks) {
    check.input.checked = watching.includes(provider);
    check.text.textContent = provider.name;
    check.extra.textContent = provider.optionalPermission && !check.input.checked ? t('settings.needsPermission') : '';
    // What switching it on reads: said before Chrome asks, not needed once it is on.
    if (hint) {
      deniedHint(hint, `vendor:${provider.id}`, t('settings.vendorHint', { site: provider.site }));
      hint.hidden = check.input.checked;
    }
  }
  const now = Date.now();
  const automatic = [];
  for (const { provider, picker, auto, wrap } of expiryFields) {
    wrap.hidden = !watching.includes(provider);
    const term = subscriptionTerm(state.snapshots[provider.id]?.subscription, now);
    picker.el.hidden = Boolean(term);
    auto.hidden = !term;
    auto.textContent = term ? t('settings.rankExpiryAuto', { date: formatDate(term.day, t.tag) }) : '';
    if (term && !wrap.hidden) automatic.push(provider.name);
    picker.setValue(settings.rankExpiry[provider.id] ?? '');
    picker.setLabel(`${provider.name} ${t('settings.rankExpiry')}`);
  }
  expiryAutoHint.hidden = automatic.length === 0;
  expiryAutoHint.textContent = t('settings.rankExpiryAutoHint', { names: automatic.join(t('list.sep')) });

  pollSlider.set(settings.pollMinutes);
  sizeSlider.set(settings.hud.scale);
  sizeSlider.input.disabled = !settings.hud.enabled;
  hudShow.input.checked = settings.hud.enabled;
  hudShow.text.textContent = t('settings.hudShow');
  hudEverywhere.input.checked = settings.hud.everywhere && state.perms.allSites;
  hudEverywhere.input.disabled = !settings.hud.enabled;
  hudEverywhere.text.textContent = t('settings.hudEverywhere');
  deniedHint(hudEverywhereHint, 'allSites', t('settings.hudEverywhereHint'));
  hudEverywhereHint.hidden = hudEverywhere.input.checked;
  notifyRecovered.input.checked = settings.notify.recovered && state.perms.notify;
  notifyRecovered.text.textContent = t('settings.notifyRecovered');
  deniedHint(notifyHint, 'notify', '');
  notifyHint.hidden = denied !== 'notify';
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

function renderTabs(watching, active) {
  tabs.hidden = watching.length < 2 || state.view !== 'status' || !hasConsent(state.settings);
  tabs.setAttribute('aria-label', t('popup.tabs'));
  tabs.replaceChildren(...watching.map(provider => {
    const selected = provider === active;
    // A vendor whose last refresh failed gets a "!", its reason on hover, so
    // it shows while another vendor's card is open.
    const status = state.snapshots[provider.id]?.status;
    const problem = status && status !== 'ok' ? STATUS_MESSAGES[status] ?? STATUS_MESSAGES.unreachable : null;
    const reason = problem ? translatorFor(provider)(problem, { site: provider.site }) : null;
    return h(doc, 'button', {
      class: selected ? 'cmd tab selected' : 'cmd tab',
      type: 'button',
      role: 'tab',
      'aria-selected': String(selected),
      title: reason,
      'aria-label': reason ? `${provider.name}: ${reason}` : null,
      // Saved in settings, so the page HUD and the toolbar icon switch too.
      onclick: () => {
        state.settings = { ...state.settings, activeProvider: provider.id };
        render();
        updateSettings(draft => { draft.activeProvider = provider.id; });
      },
    }, [provider.name, reason ? h(doc, 'span', { class: 'tab-alert', 'aria-hidden': 'true', text: '!' }) : null]);
  }));
}

function renderCards(now) {
  const watching = monitored();
  const active = activeProvider(watching, state.settings);
  nothingMonitored.hidden = watching.length > 0;
  nothingMonitored.textContent = t('popup.noProviders');
  renderTabs(watching, active);
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
    card.el.hidden = provider !== active;
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
  const agreed = hasConsent(state.settings);
  renderConsent(agreed, lang);
  refreshCmd.hidden = !agreed;
  settingsCmd.hidden = !agreed;
  refreshCmd.textContent = t('action.refresh');
  refreshCmd.disabled = state.refreshing;
  settingsCmd.textContent = t(state.view === 'settings' ? 'action.back' : 'action.settings');
  statusView.hidden = !agreed || state.view !== 'status';
  settingsView.hidden = !agreed || state.view !== 'settings';
  renderCards(Date.now());
  renderSettings();
}

/** Before the data use notice is agreed, the popup shows it in short, and nothing else. */
let consentLang = null;
function renderConsent(agreed, lang) {
  consentView.hidden = agreed;
  if (agreed || consentLang === lang) return;
  consentLang = lang;
  consentView.replaceChildren(
    consentNotice(doc, t, { compact: true }),
    h(doc, 'div', { class: 'consent-actions' }, [
      h(doc, 'button', {
        class: 'pix-btn',
        type: 'button',
        text: t('consent.agree'),
        onclick: () => giveConsent().then(next => {
          state.settings = next;
          render();
          requestRefresh('popup');
        }),
      }),
      h(doc, 'button', { class: 'cmd', type: 'button', text: t('consent.details'), onclick: () => openPage(chrome.runtime.getURL(WELCOME_PATH)) }),
    ]),
  );
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
Object.assign(state, { settings, snapshots, perms, denied: await deniedWhileClosed(perms) });
// Said where it was asked for: in settings.
if (state.denied && hasConsent(settings)) state.view = 'settings';
render();
if (hasConsent(settings)) requestRefresh('popup');
