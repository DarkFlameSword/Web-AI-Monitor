/**
 * Pixel form controls for the settings page: a dropdown and a calendar that
 * look like the rest of the guild card instead of the browser's own widgets.
 * Both are keyboard operable and close on Escape or a click elsewhere.
 */
import { parseDay } from '../core/rank.js';
import { h, pixelArt } from '../ui/dom.js';

const CALENDAR_ICON = [
  '.k.....k.',
  'kkkkkkkkk',
  'ksssssssk',
  'kpppppppk',
  'kpkpkpkpk',
  'kpppppppk',
  'kpkpkpkpk',
  'kpppppppk',
  'kkkkkkkkk',
];
const CALENDAR_PALETTE = { k: 'var(--ink)', s: 'var(--seal)', p: 'var(--paper)' };

let openPopover = null;

/** Close whatever popover is open (only one at a time). */
function closeOpen() {
  openPopover?.close();
}

function onOutsidePointer(event) {
  if (openPopover && !openPopover.root.contains(event.target)) closeOpen();
}

function trackOpen(control) {
  closeOpen();
  openPopover = control;
  control.root.ownerDocument.addEventListener('pointerdown', onOutsidePointer, true);
}

function untrack(control) {
  if (openPopover === control) openPopover = null;
  control.root.ownerDocument.removeEventListener('pointerdown', onOutsidePointer, true);
}

/**
 * @param {Document} doc
 * @param {{onChange: (value: string) => void}} options
 */
export function pixelSelect(doc, { onChange }) {
  const text = h(doc, 'span', { class: 'pix-dd-text' });
  const button = h(doc, 'button', { class: 'pix-dd-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, text);
  const list = h(doc, 'ul', { class: 'pix-menu', role: 'listbox', tabindex: '-1', hidden: true });
  const root = h(doc, 'span', { class: 'pix-dd' }, [button, list]);
  let options = [];
  let optionsKey = '';
  let value = null;

  const items = () => [...list.children];
  const focusItem = item => item?.focus();

  const control = {
    root,
    close(returnFocus = false) {
      if (list.hidden) return;
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      untrack(control);
      if (returnFocus) button.focus();
    },
  };

  function open() {
    trackOpen(control);
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    focusItem(items().find(item => item.dataset.value === value) ?? items()[0]);
  }

  function choose(next) {
    control.close(true);
    if (next !== value) {
      value = next;
      render();
      onChange(next);
    }
  }

  function render() {
    const current = options.find(option => option.value === value);
    text.textContent = current?.label ?? '';
    for (const item of items()) item.setAttribute('aria-selected', String(item.dataset.value === value));
  }

  button.addEventListener('click', () => (list.hidden ? open() : control.close()));
  button.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', event => {
    const all = items();
    const at = all.indexOf(doc.activeElement);
    const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      focusItem(all[(moves[event.key] + all.length) % all.length]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (at >= 0) choose(all[at].dataset.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      control.close(true);
    } else if (event.key === 'Tab') {
      control.close();
    }
  });

  return {
    el: root,
    /** @param {{value: string, label: string}[]} next */
    setOptions(next) {
      // Rebuilding the list would drop keyboard focus while it is open.
      const key = JSON.stringify(next);
      if (key === optionsKey) return;
      optionsKey = key;
      options = next;
      list.replaceChildren(...next.map(option => {
        const item = h(doc, 'li', { class: 'pix-opt', role: 'option', tabindex: '-1', 'data-value': option.value }, option.label);
        item.addEventListener('click', () => choose(option.value));
        item.addEventListener('pointermove', () => item.focus());
        return item;
      }));
      render();
    },
    setValue(next) {
      value = next;
      render();
    },
    setLabel(label) {
      button.setAttribute('aria-label', label);
      list.setAttribute('aria-label', label);
    },
  };
}

const pad = n => String(n).padStart(2, '0');
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * A date field with a pixel calendar. Values are YYYY-MM-DD strings ('' for none).
 * The calendar's footer has Today, and Clear while a date is set (also Delete).
 *
 * @param {Document} doc
 * @param {{onChange: (day: string) => void, translator: () => Function, format: (ms: number) => string}} options
 */
export function pixelDate(doc, { onChange, translator, format }) {
  const text = h(doc, 'span', { class: 'pix-dd-text' });
  const button = h(doc, 'button', { class: 'pix-dd-btn pix-date-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [
    text,
    pixelArt(doc, CALENDAR_ICON, CALENDAR_PALETTE),
  ]);
  const title = h(doc, 'span', { class: 'pix-cal-title' });
  const prev = h(doc, 'button', { class: 'pix-cal-nav prev', type: 'button' });
  const next = h(doc, 'button', { class: 'pix-cal-nav next', type: 'button' });
  const grid = h(doc, 'div', { class: 'pix-cal-grid', role: 'grid' });
  const clear = h(doc, 'button', { class: 'cmd pix-cal-clear', type: 'button' });
  const today = h(doc, 'button', { class: 'cmd pix-cal-today', type: 'button' });
  const panel = h(doc, 'div', { class: 'pix-cal', role: 'dialog', hidden: true }, [
    h(doc, 'div', { class: 'pix-cal-head' }, [prev, title, next]),
    grid,
    h(doc, 'div', { class: 'pix-cal-foot' }, [clear, today]),
  ]);
  const root = h(doc, 'span', { class: 'pix-dd' }, [button, panel]);

  let value = '';
  /** The month on show, and the day that has keyboard focus. */
  let cursor = new Date();

  const control = {
    root,
    close(returnFocus = false) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      untrack(control);
      if (returnFocus) button.focus();
    },
  };

  function renderButton() {
    const t = translator();
    const day = parseDay(value);
    text.textContent = day ? format(day.start) : t('settings.pickDate');
    button.classList.toggle('empty', !day);
  }

  function renderMonth(focus = false) {
    const t = translator();
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const months = t('cal.months').split(',');
    title.textContent = t('cal.title', { y: year, m: month + 1, month: months[month] });
    prev.setAttribute('aria-label', t('cal.prev'));
    next.setAttribute('aria-label', t('cal.next'));
    today.textContent = t('cal.today');
    clear.textContent = t('action.clear');
    clear.hidden = !value;

    const weekStart = Number(t('cal.weekStart')) || 0;
    const names = t('cal.weekdays').split(',');
    const cells = [];
    for (let i = 0; i < 7; i += 1) cells.push(h(doc, 'span', { class: 'pix-cal-wd', role: 'columnheader' }, names[(weekStart + i) % 7]));
    const first = new Date(year, month, 1);
    const lead = (first.getDay() - weekStart + 7) % 7;
    for (let i = 0; i < lead; i += 1) cells.push(h(doc, 'span', { class: 'pix-cal-blank' }));
    const todayKey = dayKey(new Date());
    const days = new Date(year, month + 1, 0).getDate();
    let focusTarget = null;
    for (let d = 1; d <= days; d += 1) {
      const key = dayKey(new Date(year, month, d));
      const cell = h(doc, 'button', {
        class: 'pix-cal-day',
        type: 'button',
        role: 'gridcell',
        tabindex: d === cursor.getDate() ? '0' : '-1',
        'data-day': key,
        'aria-selected': String(key === value),
      }, String(d));
      if (key === todayKey) cell.classList.add('today');
      if (key === value) cell.classList.add('selected');
      cell.addEventListener('click', () => choose(key));
      if (d === cursor.getDate()) focusTarget = cell;
      cells.push(cell);
    }
    grid.replaceChildren(...cells);
    if (focus) focusTarget?.focus();
  }

  function moveCursor(days, months = 0) {
    const target = new Date(cursor.getFullYear(), cursor.getMonth() + months, cursor.getDate() + days);
    // Moving by months keeps the day where the month allows.
    if (months && target.getDate() !== cursor.getDate()) target.setDate(0);
    cursor = target;
    renderMonth(true);
  }

  function open() {
    trackOpen(control);
    const day = parseDay(value);
    cursor = day ? new Date(day.start) : new Date();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    renderMonth(true);
  }

  function choose(key) {
    control.close(true);
    if (key !== value) {
      value = key;
      renderButton();
      onChange(key);
    }
  }

  button.addEventListener('click', () => (panel.hidden ? open() : control.close()));
  prev.addEventListener('click', () => moveCursor(0, -1));
  next.addEventListener('click', () => moveCursor(0, 1));
  today.addEventListener('click', () => choose(dayKey(new Date())));
  clear.addEventListener('click', () => choose(''));
  panel.addEventListener('keydown', event => {
    const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [-7, 0], ArrowDown: [7, 0], PageUp: [0, -1], PageDown: [0, 1] };
    const onDay = event.target.classList?.contains('pix-cal-day');
    if (event.key === 'Escape') {
      event.preventDefault();
      control.close(true);
    } else if (onDay && (event.key === 'Delete' || event.key === 'Backspace') && value) {
      event.preventDefault();
      choose('');
    } else if (onDay && event.key in keys) {
      event.preventDefault();
      moveCursor(...keys[event.key]);
    }
  });

  return {
    el: root,
    button,
    setValue(day) {
      const next = parseDay(day) ? day : '';
      if (next !== value) {
        value = next;
        if (!panel.hidden) renderMonth();
      }
      renderButton();
    },
    setLabel(label) {
      button.setAttribute('aria-label', label);
      panel.setAttribute('aria-label', label);
    },
  };
}
