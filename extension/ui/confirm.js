/**
 * A question with two answers, like an RPG's "Are you sure? Yes / No", for
 * actions that cannot simply be undone. The safe answer has the focus, and
 * Escape picks it.
 */
import { h } from './dom.js';

/**
 * @param {Document} doc
 * @param {{question: string, yes: string, no: string, onYes: () => void, onNo: () => void}} options
 * @returns {{el: HTMLElement, focus: () => void}}
 */
export function confirmChoice(doc, { question, yes, no, onYes, onNo }) {
  const noButton = h(doc, 'button', { class: 'cmd confirm-no', type: 'button', text: no, onclick: onNo });
  const yesButton = h(doc, 'button', { class: 'cmd confirm-yes', type: 'button', text: yes, onclick: onYes });
  const el = h(doc, 'div', { class: 'confirm', role: 'group', 'aria-label': question }, [
    h(doc, 'p', { class: 'confirm-q', text: question }),
    h(doc, 'div', { class: 'confirm-choices' }, [yesButton, noButton]),
  ]);
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onNo();
    }
  });
  return { el, focus: () => noButton.focus() };
}
