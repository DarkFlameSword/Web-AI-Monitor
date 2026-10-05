import { buildGaugeViews, viewForRole } from '../core/gauges.js';
import { label } from '../core/i18n.js';
import { roleOf } from '../core/roles.js';
import { formatBadgeDuration, formatClock } from '../core/time.js';
import { iconPixels } from '../ui/pixel-icon.js';

const BADGE_TEXT = '#f7ead0';
const BADGE_ALERT = '#9e2b25';
const BADGE_QUIET = '#74553a';

const STATUS_KEYS = Object.freeze({
  signed_out: 'error.signedOut',
  unreachable: 'error.unreachable',
  no_data: 'error.noData',
});

/**
 * Paint the toolbar button: live mini gauges in the icon, a badge only when
 * MP is low or spent, and the numbers in the tooltip.
 *
 * @returns {Promise<boolean>} true while the badge shows a countdown that needs repainting.
 */
export async function paintAction(provider, snapshot, t, now) {
  const meters = snapshot?.meters ?? [];
  const views = buildGaugeViews(provider.template, meters, now);
  const levelOf = role => {
    const view = viewForRole(views, role);
    return view?.state === 'ok' ? view.value : null;
  };
  const levels = { mp: levelOf('mp'), hp: levelOf('hp'), sp: levelOf('sp') };
  const dim = !snapshot || snapshot.status !== 'ok';
  // Only the bars this vendor's scheme has (ChatGPT: MP and HP).
  const roles = ['mp', 'hp', 'sp'].filter(role => provider.template.gauges.some(gauge => gauge.role === role));
  const imageData = {};
  for (const size of [16, 32]) imageData[size] = new ImageData(iconPixels(levels, size, { dim, roles }), size, size);
  await chrome.action.setIcon({ imageData });

  const mp = viewForRole(views, 'mp');
  let text = '';
  let color = BADGE_ALERT;
  let ticking = false;
  if (!meters.length && snapshot && snapshot.status !== 'ok') {
    text = '!';
    color = BADGE_QUIET;
  } else if (mp?.state === 'ok' && mp.value === 0 && mp.resetsAt) {
    text = formatBadgeDuration(mp.resetsAt - now);
    ticking = true;
  } else if (mp?.state === 'ok' && mp.value < 20) {
    text = String(mp.value);
  }
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeTextColor?.({ color: BADGE_TEXT });
  }

  const lines = [`${provider.name} - ${t('guild.title')}`];
  for (const view of views) {
    if (view.state !== 'ok') continue;
    let line = `${roleOf(view.role).abbr} ${view.value}/100  ${label(t, view.label)}`;
    if (view.resetsAt) line += `  ${t('time.resetsAt', { t: formatClock(view.resetsAt, t.tag, now) })}`;
    lines.push(line);
  }
  if (snapshot && snapshot.status !== 'ok') {
    lines.push(t(STATUS_KEYS[snapshot.status] ?? 'error.unreachable', { site: provider.site }));
  }
  await chrome.action.setTitle({ title: lines.join('\n') });
  return ticking;
}

/** Nothing monitored: the plain icon, no badge, and a hint in the tooltip. */
export async function paintIdle(t) {
  await chrome.action.setIcon({ path: { 16: '/assets/icons/icon-16.png', 32: '/assets/icons/icon-32.png' } });
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: t('popup.noProviders') });
}
