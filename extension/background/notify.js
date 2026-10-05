import { recoveredGauges } from '../core/gauges.js';
import { label } from '../core/i18n.js';
import { roleOf } from '../core/roles.js';
import { getProvider } from '../providers/index.js';

const SEEN_PREFIX = 'notices:';
/** A reset older than this is not news any more (the browser was closed through it). */
const NEWS_WINDOW_MS = 60 * 60_000;
const ID_PREFIX = 'wam:recovered:';

/** Opt-in setting and the optional permission must both be there. */
async function allowed(settings) {
  if (!settings.notify.recovered || !chrome.notifications) return false;
  try {
    return await chrome.permissions.contains({ permissions: ['notifications'] });
  } catch {
    return false;
  }
}

/**
 * "Fully restored": once per window, for the gauges that were used and whose
 * window has just ended. Reads the snapshot from before the refetch.
 */
export async function notifyRecoveries(provider, snapshot, settings, t, now) {
  const recovered = recoveredGauges(provider.template, snapshot?.meters ?? [], now)
    .filter(({ resetsAt }) => now - resetsAt < NEWS_WINDOW_MS);
  if (!recovered.length || !(await allowed(settings))) return;

  const key = SEEN_PREFIX + provider.id;
  const seen = (await chrome.storage.local.get(key))[key] ?? {};
  const fresh = recovered.filter(({ meter }) => seen[meter.id] !== meter.resetsAt);
  if (!fresh.length) return;
  const next = {};
  for (const { meter } of recovered) next[meter.id] = meter.resetsAt;
  await chrome.storage.local.set({ [key]: next });

  const names = fresh.map(({ def }) => t(roleOf(def.role).nameKey)).join(t('list.sep'));
  await chrome.notifications.create(`${ID_PREFIX}${provider.id}:${now}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: `${provider.name} - ${t('guild.title')}`,
    message: t('notify.recovered', { names }),
    contextMessage: fresh.map(({ def }) => label(t, def.label)).join(t('list.sep')),
  });
}

let listening = false;

/**
 * Clicking the notice opens the vendor's site. The notifications API only
 * exists once the optional permission is granted, so this is called again
 * when it is.
 */
export function listenForClicks() {
  if (listening || !chrome.notifications) return;
  listening = true;
  chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith(ID_PREFIX)) return;
    const provider = getProvider(id.slice(ID_PREFIX.length).split(':')[0]);
    if (provider) chrome.tabs.create({ url: provider.origin });
    chrome.notifications.clear(id);
  });
}
