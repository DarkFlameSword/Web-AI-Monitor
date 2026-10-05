import { HttpError, isAuthError } from '../core/http.js';
import { browserLanguage, createTranslator, resolveLang } from '../core/i18n.js';
import { SETTINGS_KEY, activeProvider, enabledProviders, isProviderEnabled, loadSettings, updateSettings } from '../core/settings.js';
import { providerIdOfKey, readSnapshot, writeSnapshot } from '../core/store.js';
import { PROVIDERS, getProvider, originPattern } from '../providers/index.js';
import { paintAction, paintIdle } from './action-icon.js';
import { listenForClicks, notifyRecoveries } from './notify.js';
import { ALL_SITES, injectOpenTabs, injectVendorTabs, syncPageScripts, syncVendorScripts } from './page-hud.js';
import { fetchUsage } from './transport.js';

/*
 * The only writer of usage snapshots. It refreshes on a timer, right after a
 * reply finishes on a vendor's site, the moment a limit window resets, and
 * when the popup or a page HUD asks. Everything else reads chrome.storage.
 */

const POLL_ALARM = 'wam:poll';
const RESET_ALARM_PREFIX = 'wam:reset:';
const BADGE_ALARM = 'wam:badge';

/** Per reason: a refresh is skipped if the last attempt is more recent than this. */
const FRESH_ENOUGH_MS = Object.freeze({
  install: 0,
  startup: 0,
  poll: 0,
  reset: 0,
  manual: 2_000,
  activity: 4_000,
  popup: 30_000,
  visible: 90_000,
});
/** Reasons a page (content script) may give. */
const PAGE_REASONS = new Set(['activity', 'visible']);
/** While signed out, the timer only checks this often. */
const SIGNED_OUT_POLL_BACKOFF_MS = 30 * 60_000;

const running = new Map();

function classify(error) {
  if (isAuthError(error)) return 'signed_out';
  if (error instanceof HttpError && error.code === 'no_org') return 'no_data';
  return 'unreachable';
}

function translatorFor(provider, settings) {
  return createTranslator(resolveLang(settings.lang, browserLanguage()), provider.template.messages);
}

async function runRefresh(provider, reason) {
  const [previous, settings] = await Promise.all([readSnapshot(provider.id), loadSettings()]);
  // Switched off in settings: leave it alone.
  if (!isProviderEnabled(provider, settings)) return previous;
  const now = Date.now();
  // Before refetching: did a used window just end?
  await notifyRecoveries(provider, previous, settings, translatorFor(provider, settings), now)
    .catch(error => console.warn('[Web AI Monitor] notification failed:', error));
  const lastAttempt = previous?.attemptedAt ?? 0;
  if (now - lastAttempt < (FRESH_ENOUGH_MS[reason] ?? 10_000)) return previous;
  if (reason === 'poll' && previous?.status === 'signed_out' && now - lastAttempt < SIGNED_OUT_POLL_BACKOFF_MS) {
    return previous;
  }

  // On failure keep the last good numbers; the UI dims them.
  const kept = {
    meters: previous?.meters ?? [],
    wallets: previous?.wallets ?? [],
    plan: previous?.plan ?? null,
    fetchedAt: previous?.fetchedAt ?? null,
  };
  let result;
  try {
    const { meters, wallets = [], plan } = await fetchUsage(provider);
    result = meters.length
      ? { status: 'ok', meters, wallets, plan, fetchedAt: now }
      : { ...kept, status: 'no_data' };
  } catch (error) {
    result = { ...kept, status: classify(error) };
  }
  const snapshot = { provider: provider.id, ...result, attemptedAt: now };
  await writeSnapshot(provider.id, snapshot);
  await scheduleReset(provider, snapshot);
  return snapshot;
}

function refresh(provider, reason) {
  const current = running.get(provider.id);
  if (current) return current;
  const job = runRefresh(provider, reason).finally(() => running.delete(provider.id));
  running.set(provider.id, job);
  return job;
}

async function refreshAll(reason) {
  const providers = enabledProviders(PROVIDERS, await loadSettings());
  return Promise.allSettled(providers.map(provider => refresh(provider, reason)));
}

/** Wake up a few seconds after the earliest window resets, to show the refill. */
async function scheduleReset(provider, snapshot) {
  const now = Date.now();
  const next = snapshot.meters
    .map(meter => Date.parse(meter.resetsAt ?? ''))
    .filter(ms => Number.isFinite(ms) && ms > now)
    .sort((a, b) => a - b)[0];
  const name = RESET_ALARM_PREFIX + provider.id;
  if (next) await chrome.alarms.create(name, { when: next + 5_000 });
  else await chrome.alarms.clear(name);
}

async function ensurePollAlarm() {
  const { pollMinutes } = await loadSettings();
  const alarm = await chrome.alarms.get(POLL_ALARM);
  if (alarm?.periodInMinutes === pollMinutes) return;
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: pollMinutes, delayInMinutes: pollMinutes });
}

// The toolbar shows the vendor on show (picked in the popup). Repaints are queued so they never interleave.
let paintQueue = Promise.resolve();

function repaint() {
  paintQueue = paintQueue.then(async () => {
    const settings = await loadSettings();
    const provider = activeProvider(enabledProviders(PROVIDERS, settings), settings);
    if (!provider) {
      await paintIdle(createTranslator(resolveLang(settings.lang, browserLanguage())));
      await chrome.alarms.clear(BADGE_ALARM);
      return;
    }
    const snapshot = await readSnapshot(provider.id);
    const ticking = await paintAction(provider, snapshot, translatorFor(provider, settings), Date.now());
    if (!ticking) await chrome.alarms.clear(BADGE_ALARM);
    else if (!(await chrome.alarms.get(BADGE_ALARM))) await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  }).catch(error => console.warn('[Web AI Monitor] toolbar repaint failed:', error));
  return paintQueue;
}

/**
 * Optional permissions and the settings that depend on them must agree:
 * "every site" is on exactly while all sites are allowed, the recovery
 * notice is off without the notifications permission, and a vendor behind
 * an optional permission is off while its site is not allowed.
 */
async function syncPermissions({ added = false } = {}) {
  const everywhere = await syncPageScripts();
  const vendorSites = await syncVendorScripts();
  const notifications = await chrome.permissions.contains({ permissions: ['notifications'] });
  const settings = await loadSettings();
  const lostVendors = Object.entries(vendorSites).filter(([id, allowed]) => !allowed && settings.providers[id] === true);
  if (settings.hud.everywhere !== everywhere || (settings.notify.recovered && !notifications) || lostVendors.length) {
    await updateSettings(draft => {
      draft.hud.everywhere = everywhere;
      if (everywhere) draft.hud.enabled = true;
      if (!notifications) draft.notify.recovered = false;
      for (const [id] of lostVendors) draft.providers[id] = false;
    });
  }
  if (added && everywhere) await injectOpenTabs();
}

function setUp(reason) {
  listenForClicks();
  ensurePollAlarm();
  syncPermissions().catch(error => console.warn('[Web AI Monitor] permission sync failed:', error));
  repaint();
  refreshAll(reason);
}

listenForClicks();

chrome.runtime.onInstalled.addListener(() => setUp('install'));
chrome.runtime.onStartup.addListener(() => setUp('startup'));

chrome.permissions.onAdded.addListener(async ({ permissions = [], origins = [] }) => {
  if (permissions.includes('notifications')) {
    listenForClicks();
    // Granted from the settings checkbox (the popup may have closed meanwhile).
    await updateSettings(draft => { draft.notify.recovered = true; });
  }
  if (origins.some(origin => ALL_SITES.includes(origin))) await syncPermissions({ added: true });
  // A vendor's own site was allowed from its monitoring switch: turn it on and fetch.
  for (const provider of PROVIDERS.filter(item => item.optionalPermission && origins.includes(originPattern(item)))) {
    await syncVendorScripts();
    await updateSettings(draft => { draft.providers[provider.id] = true; });
    await injectVendorTabs(provider);
    refresh(provider, 'manual');
  }
});

chrome.permissions.onRemoved.addListener(() => {
  syncPermissions().catch(error => console.warn('[Web AI Monitor] permission sync failed:', error));
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM) {
    refreshAll('poll');
  } else if (alarm.name === BADGE_ALARM) {
    repaint();
  } else if (alarm.name.startsWith(RESET_ALARM_PREFIX)) {
    repaint();
    const provider = getProvider(alarm.name.slice(RESET_ALARM_PREFIX.length));
    if (provider) refresh(provider, 'reset');
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'wam:refresh') return false;
  let reason = Object.hasOwn(FRESH_ENOUGH_MS, message.reason) ? message.reason : 'visible';
  if (sender.tab && !PAGE_REASONS.has(reason)) reason = 'visible';
  loadSettings()
    .then(settings => {
      const wanted = Array.isArray(message.providerIds) ? message.providerIds.map(getProvider).filter(Boolean) : PROVIDERS;
      const providers = enabledProviders(wanted, settings);
      return Promise.allSettled(providers.map(provider => refresh(provider, reason)));
    })
    .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SETTINGS_KEY]) ensurePollAlarm();
  if (changes[SETTINGS_KEY] || Object.keys(changes).some(key => providerIdOfKey(key))) repaint();
});
