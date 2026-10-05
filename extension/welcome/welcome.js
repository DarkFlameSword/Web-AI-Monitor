/**
 * The data use notice in full. It opens in a tab when the extension is
 * installed (and after an update while it is not agreed); nothing is read
 * from any vendor until the user agrees here or in the popup.
 */
import { PRIVACY_POLICY_URL, giveConsent, hasConsent, withdrawConsent } from '../core/consent.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import { SETTINGS_KEY, loadSettings, normalizeSettings, updateSettings } from '../core/settings.js';
import { formatDate } from '../core/time.js';
import { pixelSelect } from '../popup/controls.js';
import { consentNotice } from '../ui/consent.js';
import { CREST, CREST_PALETTE, h, pixelArt } from '../ui/dom.js';

const doc = document;
const app = doc.getElementById('app');

let settings = normalizeSettings(null);
/** What just happened, shown above the buttons: 'done', 'declined' or 'withdrawn'. */
let note = null;

const langSelect = pixelSelect(doc, { onChange: value => updateSettings(draft => { draft.lang = value; }) });

function render() {
  const lang = resolveLang(settings.lang, browserLanguage());
  const t = createTranslator(lang);
  doc.documentElement.lang = LANG_TAGS[lang];
  doc.title = `${t('consent.title')} - Web AI Monitor`;
  langSelect.setOptions(['auto', ...LANGS].map(value => ({ value, label: value === 'auto' ? t('settings.langAuto') : LANG_NAMES[value] })));
  langSelect.setValue(settings.lang);
  langSelect.setLabel(t('settings.language'));

  const button = (props, text) => h(doc, 'button', { type: 'button', ...props, text });
  const actions = hasConsent(settings)
    ? [
      h(doc, 'p', { class: 'welcome-status', text: t('consent.agreed', { date: formatDate(settings.consent.at ?? Date.now(), t.tag) }) }),
      button({ class: 'cmd', onclick: withdraw }, t('consent.withdraw')),
      h(doc, 'span', { class: 'welcome-hint', text: t('consent.withdrawHint') }),
    ]
    : [
      button({ class: 'pix-btn', onclick: agree }, t('consent.agree')),
      button({ class: 'cmd', onclick: decline }, t('consent.decline')),
    ];

  // replaceChildren would print a null as the text "null".
  app.replaceChildren(...[
    h(doc, 'header', { class: 'guild-head' }, [
      pixelArt(doc, CREST, CREST_PALETTE),
      h(doc, 'span', { class: 'guild-title', text: t('guild.title') }),
      langSelect.el,
    ]),
    h(doc, 'div', { class: 'rule' }),
    h(doc, 'h1', { class: 'welcome-title', text: t('consent.title') }),
    consentNotice(doc, t),
    h(doc, 'div', { class: 'rule' }),
    note ? h(doc, 'p', { class: 'welcome-note', role: 'status', text: t(`consent.${note}`) }) : null,
    h(doc, 'div', { class: 'welcome-actions' }, actions),
    h(doc, 'p', { class: 'welcome-foot' }, h(doc, 'a', { href: PRIVACY_POLICY_URL, target: '_blank', rel: 'noopener', text: t('consent.policy') })),
  ].filter(Boolean));
}

async function agree() {
  note = 'done';
  settings = await giveConsent();
  render();
}

function decline() {
  note = 'declined';
  render();
}

async function withdraw() {
  note = 'withdrawn';
  settings = await withdrawConsent();
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
  render();
});

settings = await loadSettings();
render();
