import { DEFAULT_LANG, LANGS, LANG_TAGS, MESSAGES } from './messages.js';

/**
 * Pick the UI language: an explicit choice wins, otherwise follow the
 * browser, and fall back to English.
 */
export function resolveLang(preference, uiLanguage) {
  if (LANGS.includes(preference)) return preference;
  const tag = String(uiLanguage || '').toLowerCase();
  if (tag.startsWith('zh')) return 'zh_CN';
  if (tag.startsWith('ja')) return 'ja';
  if (tag.startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

export function browserLanguage() {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return globalThis.navigator?.language ?? '';
  }
}

export function format(text, vars) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (vars && vars[name] !== undefined ? String(vars[name]) : whole));
}

/**
 * @param {string} lang
 * @param {Record<string, Record<string, string>>} [extra]  Vendor strings from a plan template, by language.
 * @returns {((key: string, vars?: object) => string) & {lang: string, tag: string}}
 */
export function createTranslator(lang, extra) {
  const tables = [extra?.[lang], MESSAGES[lang], extra?.[DEFAULT_LANG], MESSAGES[DEFAULT_LANG]].filter(Boolean);
  const t = (key, vars) => {
    for (const table of tables) {
      if (table[key] !== undefined) return format(table[key], vars);
    }
    return key;
  };
  t.lang = MESSAGES[lang] ? lang : DEFAULT_LANG;
  t.tag = LANG_TAGS[t.lang];
  return t;
}

/** Render a `{key, vars}` label from a template or gauge view. */
export function label(t, spec) {
  return spec ? t(spec.key, spec.vars) : '';
}
