/**
 * The data use notice, as the welcome page shows it in full and the popup in
 * short. Both list the same facts; the wording lives in core/messages.js.
 */
import { h } from './dom.js';

/** Section heading key, then its items. */
const SECTIONS = Object.freeze([
  ['consent.reads', ['consent.read.claude', 'consent.read.org', 'consent.read.chatgpt', 'consent.read.activity']],
  ['consent.never', ['consent.never.content', 'consent.never.limits', 'consent.never.share']],
  ['consent.where', ['consent.where.local', 'consent.where.requests']],
  ['consent.optional', ['consent.optional.text']],
]);
const SHORT = Object.freeze(['consent.short.reads', 'consent.short.never', 'consent.short.local', 'consent.short.optional']);

const list = (doc, t, keys) => h(doc, 'ul', { class: 'consent-list' }, keys.map(key => h(doc, 'li', { text: t(key) })));

/**
 * @param {Document} doc
 * @param {(key: string, vars?: object) => string} t
 * @param {{compact?: boolean}} [options]  compact: the popup's short version.
 */
export function consentNotice(doc, t, { compact = false } = {}) {
  if (compact) {
    return h(doc, 'div', { class: 'consent compact' }, [
      h(doc, 'p', { class: 'consent-lead', text: t('consent.short.lead') }),
      list(doc, t, SHORT),
    ]);
  }
  return h(doc, 'div', { class: 'consent' }, [
    h(doc, 'p', { class: 'consent-lead', text: t('consent.lead') }),
    ...SECTIONS.map(([heading, items]) => h(doc, 'section', { class: 'consent-section' }, [
      h(doc, 'h2', { class: 'consent-heading', text: t(heading) }),
      list(doc, t, items),
    ])),
    h(doc, 'p', { class: 'consent-disclaimer', text: t('consent.disclaimer') }),
  ]);
}
