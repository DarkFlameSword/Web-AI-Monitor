import { parseIso } from './time.js';

/**
 * Money an account holds next to its rate limits, as every provider reports
 * it. Amounts are in major units (dollars, not cents).
 *
 * @typedef {object} Wallet
 * @property {string} id                e.g. "cloud_session", "usage_credits".
 * @property {'grant'|'spend'} kind     grant: a balance that runs down; spend: money spent against an optional cap.
 * @property {string} currency          ISO 4217 code.
 * @property {number|null} balance      Left to spend (grant).
 * @property {number|null} total        Granted in total (grant).
 * @property {number|null} spent        Spent so far (spend: this month).
 * @property {number|null} cap          Spending cap (spend); null for none.
 * @property {string|null} expiresAt    ISO time a grant expires.
 * @property {boolean} enabled
 * @property {boolean} locked
 * @property {boolean} capReached
 */

/**
 * One line of the gold pouch.
 *
 * @typedef {object} WalletView
 * @property {string} key
 * @property {{key: string, vars?: object}} label
 * @property {'grant'|'spend'} kind
 * @property {string} currency
 * @property {number|null} balance
 * @property {number|null} total
 * @property {number|null} spent
 * @property {number|null} cap
 * @property {number|null} expiresAt   Epoch ms.
 * @property {'active'|'disabled'|'locked'|'expired'|'empty'|'capped'} state
 * @property {boolean} low             Under a fifth of a grant left.
 */

function walletView(def, wallet, now) {
  const expiresAt = parseIso(wallet.expiresAt);
  let state = 'active';
  if (!wallet.enabled) state = 'disabled';
  else if (wallet.locked) state = 'locked';
  else if (expiresAt !== null && now >= expiresAt) state = 'expired';
  else if (wallet.capReached || (wallet.kind === 'spend' && wallet.cap !== null && wallet.spent >= wallet.cap)) state = 'capped';
  else if (wallet.kind === 'grant' && wallet.balance !== null && wallet.balance <= 0) state = 'empty';
  const low = wallet.kind === 'grant' && state === 'active'
    && wallet.total > 0 && wallet.balance !== null && wallet.balance / wallet.total < 0.2;
  return {
    key: def.key,
    label: def.label,
    kind: wallet.kind,
    currency: wallet.currency,
    balance: wallet.balance,
    total: wallet.total,
    spent: wallet.spent,
    cap: wallet.cap,
    expiresAt,
    state,
    low,
  };
}

/**
 * The template's wallets that the account has, in template order.
 *
 * @param {object} template
 * @param {Wallet[]} wallets
 * @param {number} now  Epoch ms.
 * @returns {WalletView[]}
 */
export function buildWalletViews(template, wallets, now) {
  const list = Array.isArray(wallets) ? wallets : [];
  const views = [];
  for (const def of template.wallets ?? []) {
    const wallet = list.find(item => item && item.id === def.match.id);
    if (wallet) views.push(walletView(def, wallet, now));
  }
  return views;
}
