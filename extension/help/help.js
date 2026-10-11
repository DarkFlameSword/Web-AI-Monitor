/**
 * The guide: what the card's gauges, treasures and ranks stand for, read
 * from each vendor's template so it always matches the cards, and answers
 * to the questions the card's notices raise. Opened from settings.
 */
import { PRIVACY_POLICY_URL, WELCOME_PATH } from '../core/consent.js';
import { browserLanguage, createTranslator, label, resolveLang } from '../core/i18n.js';
import { FEEDBACK_URL } from '../core/links.js';
import { LANG_NAMES, LANG_TAGS, LANGS } from '../core/messages.js';
import { qualificationOf } from '../core/rank.js';
import { roleOf, treasureOf } from '../core/roles.js';
import { SETTINGS_KEY, loadSettings, normalizeSettings, updateSettings } from '../core/settings.js';
import { pixelSelect } from '../popup/controls.js';
import { PROVIDERS } from '../providers/index.js';
import { CREST, CREST_PALETTE, TREASURE_ART, h, pixelArt } from '../ui/dom.js';
import { HELP, QUOTED } from './text.js';

const doc = document;
const app = doc.getElementById('app');
const FAQ = Object.freeze(['unreachable', 'signedOut', 'noData', 'pin', 'badge', 'hud', 'refresh', 'permission']);

let settings = normalizeSettings(null);

const langSelect = pixelSelect(doc, { onChange: value => updateSettings(draft => { draft.lang = value; }) });

/** Terms on the left, what they stand for on the right. */
const termList = (className, items) => h(doc, 'dl', { class: className }, items.flatMap(([term, meaning]) => [
  h(doc, 'dt', {}, term),
  h(doc, 'dd', { text: meaning }),
]));

/** One vendor: its gauges, its treasures and its rank ladder, from its template. */
function vendorTerms(provider, lang, t) {
  const tv = createTranslator(lang, provider.template.messages);
  const { template } = provider;
  const gauges = template.gauges.map(gauge => {
    const role = roleOf(gauge.role);
    return [h(doc, 'span', { class: `help-abbr role-${gauge.role}`, text: `${role.abbr} ${tv(role.nameKey)}` }), label(tv, gauge.label)];
  });
  const treasures = (template.wallets ?? []).map(wallet => {
    const [art, palette] = TREASURE_ART[wallet.treasure] ?? TREASURE_ART.coin;
    return [[pixelArt(doc, art, palette), tv(treasureOf(wallet.treasure).nameKey)], label(tv, wallet.label)];
  });
  // The personal plans from the top, then the ones with a rank of their own.
  const plans = [
    ...template.ladder,
    ...Object.entries(template.plans).filter(([id, plan]) => !template.ladder.includes(id) && plan.rank).map(([id]) => id),
  ];
  const ranks = plans
    .map(id => qualificationOf(template, id))
    .filter(qual => qual?.rank)
    .map(qual => [h(doc, 'span', { class: 'seal', text: qual.rank }), qual.name]);
  return h(doc, 'section', { class: 'help-vendor' }, [
    h(doc, 'h3', { class: 'help-vendor-name', text: provider.name }),
    h(doc, 'p', { class: 'help-sub', text: t('help.gauges') }),
    termList('help-grid', gauges),
    treasures.length ? h(doc, 'p', { class: 'help-sub', text: t('help.treasures') }) : null,
    treasures.length ? termList('help-grid', treasures) : null,
    h(doc, 'p', { class: 'help-sub', text: t('help.ranks') }),
    termList('help-grid', ranks),
  ]);
}

function render() {
  const lang = resolveLang(settings.lang, browserLanguage());
  const t = createTranslator(lang, HELP);
  doc.documentElement.lang = LANG_TAGS[lang];
  doc.title = `${t('help.title')} - Web AI Monitor`;
  langSelect.setOptions(['auto', ...LANGS].map(value => ({ value, label: value === 'auto' ? t('settings.langAuto') : LANG_NAMES[value] })));
  langSelect.setValue(settings.lang);
  langSelect.setLabel(t('settings.language'));

  // The card's own words, quoted exactly.
  const vars = Object.fromEntries(Object.entries(QUOTED).map(([name, key]) => [name, t(key)]));
  const para = key => h(doc, 'p', { class: 'help-p', text: t(key, vars) });
  const heading = key => h(doc, 'h2', { class: 'consent-heading', text: t(key) });
  const link = (href, text, external) => h(doc, 'a', { href, text, ...(external ? { target: '_blank', rel: 'noopener' } : {}) });

  app.replaceChildren(
    h(doc, 'header', { class: 'guild-head' }, [
      pixelArt(doc, CREST, CREST_PALETTE),
      h(doc, 'span', { class: 'guild-title', text: t('guild.title') }),
      langSelect.el,
    ]),
    h(doc, 'div', { class: 'rule' }),
    h(doc, 'h1', { class: 'welcome-title', text: t('help.title') }),
    para('help.lead'),
    heading('help.card'),
    ...['help.card.gauge', 'help.card.colors', 'help.card.states', 'help.card.extra', 'help.card.rank'].map(para),
    heading('help.vendors'),
    ...PROVIDERS.map(provider => vendorTerms(provider, lang, t)),
    heading('help.faq'),
    termList('help-faq', FAQ.map(key => [t(`help.q.${key}`), t(`help.a.${key}`, vars)])),
    h(doc, 'div', { class: 'rule' }),
    heading('help.more'),
    para('help.feedbackHint'),
    h(doc, 'p', { class: 'help-links' }, [
      link(`/${WELCOME_PATH}`, t('consent.details')),
      link(PRIVACY_POLICY_URL, t('consent.policy'), true),
      link(FEEDBACK_URL, t('help.report'), true),
    ]),
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
  render();
});

settings = await loadSettings();
render();
