import { buildGaugeViews } from '../core/gauges.js';
import { label } from '../core/i18n.js';
import { qualificationExpiry, qualificationOf } from '../core/rank.js';
import { roleOf, treasureOf } from '../core/roles.js';
import { formatAgo, formatClock, formatCountdown, formatCountdownShort, formatDate } from '../core/time.js';
import { buildWalletViews } from '../core/wallets.js';
import { POUCH, POUCH_PALETTE, TREASURE_ART, h, pixelArt } from './dom.js';

/** A qualification about to lapse is shown in red this early. */
const RANK_EXPIRY_WARNING_MS = 3 * 24 * 60 * 60_000;

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

/** An amount in the wallet's own unit: money, plain credits, or a count of items. */
function amountOf(view, value, t) {
  if (view.unit === 'count') return t('wallet.count', { n: Math.round(value ?? 0) });
  if (view.unit === 'credits') return new Intl.NumberFormat(t.tag, { maximumFractionDigits: 2 }).format(value ?? 0);
  return money(value ?? 0, view.currency, t);
}

function money(amount, currency, t) {
  try {
    return new Intl.NumberFormat(t.tag, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const WALLET_STATE_KEYS = Object.freeze({
  disabled: 'wallet.disabled',
  locked: 'wallet.locked',
  expired: 'wallet.expired',
  empty: 'wallet.empty',
  capped: 'wallet.capped',
});

/**
 * One line of the treasure pouch, laid out like a gauge: treasure and amount,
 * then what it really is and its cap, expiry or state.
 */
class WalletRow {
  constructor(doc) {
    this.doc = doc;
    this.view = null;
    this.icon = h(doc, 'span', { class: 'w-icon' });
    this.name = h(doc, 'span', { class: 'w-name' });
    this.label = h(doc, 'span', { class: 'w-label' });
    this.amount = h(doc, 'span', { class: 'w-amount' });
    this.status = h(doc, 'span', { class: 'w-status' });
    this.el = h(doc, 'div', { class: 'wallet' }, [
      h(doc, 'div', { class: 'w-top' }, [h(doc, 'span', { class: 'w-title' }, [this.icon, this.name]), this.amount]),
      h(doc, 'div', { class: 'w-bot' }, [this.label, this.status]),
    ]);
  }

  update(view, t, now) {
    const treasureChanged = this.view?.treasure !== view.treasure;
    this.view = view;
    const classes = ['wallet', `kind-${view.kind}`, `state-${view.state}`, `treasure-${view.treasure}`];
    if (view.low) classes.push('low');
    this.el.className = classes.join(' ');
    if (treasureChanged) {
      const [art, palette] = TREASURE_ART[view.treasure] ?? TREASURE_ART.coin;
      this.icon.replaceChildren(pixelArt(this.doc, art, palette));
    }
    this.name.textContent = t(treasureOf(view.treasure).nameKey);
    this.label.textContent = label(t, view.label);
    const cash = amount => amountOf(view, amount, t);
    if (view.state === 'disabled') {
      this.amount.textContent = t('wallet.disabled');
    } else if (view.kind === 'grant') {
      this.amount.textContent = t('wallet.left', { amount: cash(view.balance), total: cash(view.total) });
    } else if (view.kind === 'stock') {
      this.amount.textContent = view.unlimited ? t('wallet.unlimited') : t('wallet.have', { amount: cash(view.balance) });
    } else {
      this.amount.textContent = t('wallet.spent', { amount: cash(view.spent) });
    }
    this.el.title = view.expiresAt ? t('wallet.expiresAt', { t: formatClock(view.expiresAt, t.tag, now) }) : '';
    this.tick(t, now);
  }

  tick(t, now) {
    const view = this.view;
    if (!view) return;
    let text = '';
    if (view.state === 'disabled') text = '';
    else if (view.state === 'capped' && view.cap !== null) text = `${t('wallet.capped')} ${amountOf(view, view.cap, t)}`;
    else if (view.state !== 'active') text = t(WALLET_STATE_KEYS[view.state]);
    else if (view.kind === 'grant' && view.expiresAt !== null) text = t('wallet.expiresIn', { t: formatCountdown(view.expiresAt - now, t) });
    else if (view.kind === 'spend') text = view.cap !== null ? t('wallet.cap', { amount: amountOf(view, view.cap, t) }) : t('wallet.noCap');
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.hidden = !text;
  }
}

/** The treasure pouch under the gauges: credits the account can spend. */
class Pouch {
  constructor(doc) {
    this.doc = doc;
    this.rows = new Map();
    this.title = h(doc, 'span', { class: 'pouch-title' });
    this.list = h(doc, 'div', { class: 'pouch-rows' });
    this.el = h(doc, 'div', { class: 'pouch' }, [
      h(doc, 'div', { class: 'pouch-head' }, [pixelArt(this.doc, POUCH, POUCH_PALETTE), this.title]),
      this.list,
    ]);
  }

  update(views, t, now) {
    this.el.hidden = views.length === 0;
    this.title.textContent = t('pouch.title');
    const keep = new Set();
    for (const view of views) {
      let row = this.rows.get(view.key);
      if (!row) {
        row = new WalletRow(this.doc);
        this.rows.set(view.key, row);
      }
      row.update(view, t, now);
      this.list.append(row.el);
      keep.add(view.key);
    }
    for (const [key, row] of this.rows) {
      if (!keep.has(key)) {
        row.el.remove();
        this.rows.delete(key);
      }
    }
  }

  /** @returns {boolean} true when a grant just expired and the views need rebuilding. */
  tick(t, now) {
    let expired = false;
    for (const row of this.rows.values()) {
      if (row.view?.state === 'active' && row.view.expiresAt !== null && row.view.expiresAt <= now) expired = true;
      else row.tick(t, now);
    }
    return expired;
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
  constructor(doc, provider, { compact = false, onOpenSite = null, onEditExpiry = null } = {}) {
    this.doc = doc;
    this.provider = provider;
    this.compact = compact;
    this.onOpenSite = onOpenSite;
    this.rows = new Map();
    this.snapshot = null;
    /** While a refresh is running the footer says so instead of "updated ago". */
    this.busy = false;
    /** The rank expiry the user entered for this provider (YYYY-MM-DD), from settings. */
    this.rankExpiry = null;

    this.nameEl = h(doc, 'span', { class: 'm-name', text: provider.name });
    this.sealEl = h(doc, 'span', { class: 'seal' });
    this.planEl = h(doc, 'span', { class: 'm-plan' });
    if (compact) {
      // HUD: name, rank seal and plan on one line; the expiry is in the tooltip.
      this.head = h(doc, 'div', { class: 'member' }, [
        this.nameEl,
        h(doc, 'span', { class: 'm-rank' }, [this.sealEl, this.planEl]),
      ]);
    } else {
      // Popup: name and plan, then adventurer rank and when it lapses.
      this.rankLabel = h(doc, 'span', { class: 'q-label' });
      // Clicking the expiry opens settings, where the user fills it in.
      this.expiryEl = onEditExpiry
        ? h(doc, 'button', { class: 'q-expiry', type: 'button', onclick: () => onEditExpiry(provider) })
        : h(doc, 'span', { class: 'q-expiry' });
      this.qualification = h(doc, 'div', { class: 'qualification' }, [
        h(doc, 'span', { class: 'q-rank' }, [this.rankLabel, this.sealEl]),
        this.expiryEl,
      ]);
      this.head = h(doc, 'div', { class: 'member-block' }, [
        h(doc, 'div', { class: 'member' }, [this.nameEl, this.planEl]),
        this.qualification,
      ]);
    }
    this.noticeText = h(doc, 'span');
    this.noticeAction = h(doc, 'button', { class: 'cmd', type: 'button', onclick: () => this.onOpenSite?.(provider) });
    this.notice = h(doc, 'div', { class: 'notice', role: 'status' }, [this.noticeText, this.noticeAction]);
    this.gauges = h(doc, 'div', { class: 'gauges' });
    // The page HUD has no room for money; the popup shows it under the gauges.
    this.pouch = compact ? null : new Pouch(doc);
    this.footer = compact ? null : h(doc, 'div', { class: 'card-foot' });
    this.el = h(doc, 'section', { class: compact ? 'card compact' : 'card' }, [
      this.head,
      this.notice,
      this.gauges,
      this.pouch?.el ?? null,
      this.footer,
    ]);
  }

  render(snapshot, t, now) {
    this.snapshot = snapshot;
    this.t = t;
    const { template } = this.provider;

    this.renderQualification(snapshot, t, now);

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
    this.pouch?.update(buildWalletViews(template, snapshot?.wallets ?? [], now), t, now);
    this.tickFooter(t, now);
  }

  /** Adventurer rank from the plan, and the expiry date the user entered in settings. */
  renderQualification(snapshot, t, now) {
    const qual = qualificationOf(this.provider.template, snapshot?.plan);
    const rank = qual?.rank ?? null;
    this.sealEl.textContent = rank ?? '';
    this.sealEl.hidden = !rank;
    this.planEl.textContent = qual?.name ?? '';

    const { day, expired, msLeft } = qualificationExpiry(this.rankExpiry, now);
    let expiryText = '';
    if (day !== null) {
      const date = formatDate(day, t.tag);
      expiryText = expired ? t('rank.expired', { date }) : t('rank.expires', { date });
    } else if (snapshot?.plan && snapshot.plan !== 'free') {
      expiryText = t('rank.unset');
    }
    this.sealEl.title = [rank ? `${t('rank')} ${rank}` : '', expiryText].filter(Boolean).join('\n');

    if (!this.qualification) return;
    this.qualification.hidden = !rank;
    this.rankLabel.textContent = t('rank');
    this.expiryEl.textContent = expiryText;
    this.expiryEl.hidden = !expiryText;
    this.expiryEl.classList.toggle('unset', day === null);
    this.expiryEl.classList.toggle('soon', day !== null && (expired || msLeft < RANK_EXPIRY_WARNING_MS));
  }

  /** Called every second: countdowns and "updated ago". */
  tick(t, now) {
    // A window that just ended flips its gauge to full; rebuild the views then.
    const ended = [...this.rows.values()].some(row => row.view?.resetsAt !== null && row.view?.resetsAt <= now);
    if (ended || this.pouch?.tick(t, now)) {
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
