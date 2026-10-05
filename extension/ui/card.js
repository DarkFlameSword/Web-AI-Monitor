import { buildGaugeViews } from '../core/gauges.js';
import { label } from '../core/i18n.js';
import { roleOf } from '../core/roles.js';
import { formatAgo, formatClock, formatCountdown, formatCountdownShort } from '../core/time.js';
import { h } from './dom.js';

/**
 * One gauge row. `compact` is the single-line page HUD form; otherwise it is
 * the three-line popup form (name / bar / meaning + countdown).
 */
class GaugeRow {
  constructor(doc, compact) {
    this.compact = compact;
    this.view = null;
    this.shown = null;
    this.abbr = h(doc, 'span', { class: 'g-abbr' });
    this.value = h(doc, 'span', { class: 'g-val' });
    this.time = h(doc, 'span', { class: 'g-time' });
    this.lag = h(doc, 'i', { class: 'lag' });
    this.fill = h(doc, 'i', { class: 'fill' });
    this.bar = h(doc, 'span', { class: 'bar' }, [this.lag, this.fill]);
    this.el = h(doc, 'div', { class: 'gauge', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100' });
    if (compact) {
      this.el.append(this.abbr, this.bar, this.value, this.time);
    } else {
      this.name = h(doc, 'span', { class: 'g-name' });
      this.label = h(doc, 'span', { class: 'g-label' });
      this.el.append(
        h(doc, 'div', { class: 'g-top' }, [this.abbr, this.name, this.value]),
        this.bar,
        h(doc, 'div', { class: 'g-bot' }, [this.label, this.time]),
      );
    }
  }

  update(view, t, now) {
    this.view = view;
    const role = roleOf(view.role);
    const classes = ['gauge', `role-${view.role}`, `level-${view.level}`, `state-${view.state}`];
    if (view.ready) classes.push('ready');
    if (view.recovering) classes.push('recovering');
    this.el.className = classes.join(' ');

    this.abbr.textContent = role.abbr;
    const meaning = label(t, view.label);
    if (this.name) this.name.textContent = t(role.nameKey);
    if (this.label) this.label.textContent = view.state === 'sealed' && view.hint ? label(t, view.hint) : meaning;

    if (view.state === 'ok') {
      this.value.textContent = String(view.value);
      if (!this.compact) this.value.append(h(this.value.ownerDocument, 'small', { text: '/100' }));
    } else {
      this.value.textContent = t(view.state === 'sealed' ? 'status.sealed' : 'status.missing');
    }

    this.el.setAttribute('aria-valuenow', String(view.state === 'ok' ? view.value : 0));
    this.el.setAttribute('aria-label', `${role.abbr} ${t(role.nameKey)} ${meaning}`);
    this.el.title = view.resetsAt
      ? `${meaning}\n${t('time.resetsAt', { t: formatClock(view.resetsAt, t.tag, now) })}`
      : meaning;

    this.setFill(view.state === 'ok' ? view.value : 0);
    this.tick(t, now);
  }

  /**
   * Losing points leaves a pale "lag" segment that drains a moment later, the
   * way fighting games show damage; gaining points fills up in steps.
   */
  setFill(next) {
    const prev = this.shown;
    this.shown = next;
    const width = `${next}%`;
    if (prev !== null && next < prev) {
      this.fill.style.transition = 'none';
      this.fill.style.width = width;
      this.lag.style.transition = 'none';
      this.lag.style.width = `${prev}%`;
      void this.lag.offsetWidth; // commit the old width before animating
      this.lag.style.transition = '';
      this.lag.style.width = width;
      this.fill.style.transition = '';
    } else {
      this.lag.style.width = width;
      this.fill.style.width = width;
    }
  }

  tick(t, now) {
    const view = this.view;
    if (!view) return;
    let text;
    if (view.state === 'missing') text = t('status.missing');
    else if (view.state === 'sealed') text = '';
    else if (view.recovering) text = t('time.recovering');
    else if (view.ready) text = t('status.ready');
    else if (view.resetsAt === null) text = t('time.standby');
    else if (this.compact) text = formatCountdownShort(view.resetsAt - now, t);
    else text = t('time.resetsIn', { t: formatCountdown(view.resetsAt - now, t) });
    if (this.time.textContent !== text) this.time.textContent = text;
  }
}

/** The notice a card shows for its snapshot status, or null when all is well. */
function noticeFor(snapshot) {
  if (!snapshot) return { key: 'updated.loading', tone: 'info' };
  switch (snapshot.status) {
    case 'ok':
      return null;
    case 'signed_out':
      return { key: 'error.signedOut', tone: 'warn', action: true };
    case 'no_data':
      return { key: 'error.noData', tone: 'warn' };
    default:
      return { key: 'error.unreachable', tone: 'warn' };
  }
}

/**
 * A vendor's guild card: name, rank, gauges and status.
 * The popup uses the full form, the page HUD the compact one.
 */
export class ProviderCard {
  /**
   * @param {Document} doc
   * @param {object} provider
   * @param {{compact?: boolean, onOpenSite?: (provider: object) => void}} [options]
   */
  constructor(doc, provider, { compact = false, onOpenSite = null } = {}) {
    this.doc = doc;
    this.provider = provider;
    this.compact = compact;
    this.onOpenSite = onOpenSite;
    this.rows = new Map();
    this.snapshot = null;
    /** While a refresh is running the footer says so instead of "updated ago". */
    this.busy = false;

    this.nameEl = h(doc, 'span', { class: 'm-name', text: provider.name });
    this.sealEl = h(doc, 'span', { class: 'seal' });
    this.planEl = h(doc, 'span', { class: 'm-plan' });
    this.head = h(doc, 'div', { class: 'member' }, [
      this.nameEl,
      h(doc, 'span', { class: 'm-rank' }, [this.sealEl, this.planEl]),
    ]);
    this.noticeText = h(doc, 'span');
    this.noticeAction = h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => this.onOpenSite?.(provider) });
    this.notice = h(doc, 'div', { class: 'notice', role: 'status' }, [this.noticeText, this.noticeAction]);
    this.gauges = h(doc, 'div', { class: 'gauges' });
    this.footer = compact ? null : h(doc, 'div', { class: 'card-foot' });
    this.el = h(doc, 'section', { class: compact ? 'card compact' : 'card' }, [this.head, this.notice, this.gauges, this.footer]);
  }

  render(snapshot, t, now) {
    this.snapshot = snapshot;
    this.t = t;
    const { template } = this.provider;

    const plan = snapshot?.plan ? template.plans?.[snapshot.plan] : null;
    this.sealEl.textContent = plan?.rank ?? '';
    this.sealEl.hidden = !plan?.rank;
    this.sealEl.title = plan?.rank ? `${t('rank')} ${plan.rank}` : '';
    this.planEl.textContent = plan?.name ?? '';

    const notice = noticeFor(snapshot);
    this.notice.hidden = !notice;
    if (notice) {
      this.notice.dataset.tone = notice.tone;
      this.noticeText.textContent = t(notice.key, { site: this.provider.site });
      this.noticeAction.hidden = !notice.action || !this.onOpenSite;
      this.noticeAction.textContent = t('action.open', { site: this.provider.site });
    }

    const meters = snapshot?.meters ?? [];
    this.el.classList.toggle('stale', Boolean(snapshot) && snapshot.status !== 'ok' && meters.length > 0);
    this.el.classList.toggle('empty', meters.length === 0);

    let views = buildGaugeViews(template, meters, now);
    // The HUD only has room for the plan's own gauges that exist.
    if (this.compact) views = views.filter(view => view.primary && view.state !== 'sealed');
    if (meters.length === 0) views = [];

    const keep = new Set();
    for (const view of views) {
      let row = this.rows.get(view.key);
      if (!row) {
        row = new GaugeRow(this.doc, this.compact);
        this.rows.set(view.key, row);
      }
      row.update(view, t, now);
      this.gauges.append(row.el); // re-appending keeps rows in template order
      keep.add(view.key);
    }
    for (const [key, row] of this.rows) {
      if (!keep.has(key)) {
        row.el.remove();
        this.rows.delete(key);
      }
    }
    this.tickFooter(t, now);
  }

  /** Called every second: countdowns and "updated ago". */
  tick(t, now) {
    // A window that just ended flips its gauge to full; rebuild the views then.
    const ended = [...this.rows.values()].some(row => row.view?.resetsAt !== null && row.view?.resetsAt <= now);
    if (ended) {
      this.render(this.snapshot, t, now);
      return true;
    }
    for (const row of this.rows.values()) row.tick(t, now);
    this.tickFooter(t, now);
    return false;
  }

  tickFooter(t, now) {
    if (!this.footer) return;
    const fetchedAt = this.snapshot?.fetchedAt;
    let text;
    if (this.busy) text = t('updated.loading');
    else if (fetchedAt) text = formatAgo(now - fetchedAt, t);
    else text = t('updated.never');
    if (this.footer.textContent !== text) this.footer.textContent = text;
  }

  /** Views as currently shown, for summaries such as the collapsed HUD chip. */
  views() {
    return [...this.rows.values()].map(row => row.view).filter(Boolean);
  }
}
