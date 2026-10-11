import { PROVIDERS, originPattern } from '../providers/index.js';

/** Asked for only when the user turns on "every site" for the floating window. */
export const ALL_SITES = Object.freeze(['http://*/*', 'https://*/*']);
const SCRIPT_ID = 'wam-page-hud';

export async function hasAllSites() {
  try {
    return await chrome.permissions.contains({ origins: [...ALL_SITES] });
  } catch {
    return false;
  }
}

/**
 * The vendors' own sites always get the content script from the manifest.
 * Every other site gets it from this registration, which exists exactly
 * while the user allows all sites.
 *
 * @returns {Promise<boolean>} whether all sites are allowed.
 */
export async function syncPageScripts() {
  const granted = await hasAllSites();
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  if (granted && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: [...ALL_SITES],
      excludeMatches: PROVIDERS.map(originPattern),
      js: ['content/loader.js'],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    }]);
  } else if (!granted && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return granted;
}

/**
 * Tabs opened before the grant get the floating window without a reload.
 *
 * @returns {Promise<number>} how many tabs were given the script.
 */
export async function injectOpenTabs() {
  const vendors = new Set(PROVIDERS.map(provider => provider.origin));
  const tabs = (await chrome.tabs.query({ url: [...ALL_SITES] }))
    .filter(tab => typeof tab.id === 'number' && !tab.discarded && tab.url && !vendors.has(new URL(tab.url).origin));
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/loader.js'] })));
  return tabs.length;
}

const vendorScriptId = provider => `wam-vendor-${provider.id}`;

/** Is the vendor's site allowed (by itself, or as part of "every site")? */
export async function hasVendorSite(provider) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(provider)] });
  } catch {
    return false;
  }
}

/**
 * Vendors behind an optional permission get their page script (vendor hooks
 * and the HUD) from a registration that exists exactly while their site is
 * allowed.
 *
 * @returns {Promise<Record<string, boolean>>} provider id -> site allowed.
 */
export async function syncVendorScripts() {
  const allowed = {};
  for (const provider of PROVIDERS.filter(item => item.optionalPermission)) {
    const id = vendorScriptId(provider);
    const granted = await hasVendorSite(provider);
    allowed[provider.id] = granted;
    const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length > 0;
    if (granted && !registered) {
      await chrome.scripting.registerContentScripts([{
        id,
        matches: [originPattern(provider)],
        js: ['content/loader.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      }]);
    } else if (!granted && registered) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
  }
  return allowed;
}

/**
 * The vendor's tabs opened before its site was allowed get the script now.
 *
 * @returns {Promise<number>} how many tabs were given the script.
 */
export async function injectVendorTabs(provider) {
  const tabs = (await chrome.tabs.query({ url: originPattern(provider) }))
    .filter(tab => typeof tab.id === 'number' && !tab.discarded);
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/loader.js'] })));
  return tabs.length;
}

/**
 * Pages already open when the extension is installed, updated or agreed to
 * have no live page script: the manifest's scripts only reach pages loaded
 * later, and an update orphans the old ones. Give them one now, so the HUD
 * shows and those tabs can fetch for the background without a reload. Only
 * sites the extension may already script; the loader keeps a running copy.
 *
 * @param {object[]} providers  the vendors the user monitors.
 * @param {{everywhere: boolean}} hud  the HUD settings.
 * @returns {Promise<number>} how many tabs were given the script.
 */
export async function injectOpenPages(providers, hud) {
  let reached = 0;
  for (const provider of providers) {
    if (await hasVendorSite(provider)) reached += await injectVendorTabs(provider);
  }
  if (hud.everywhere && await hasAllSites()) reached += await injectOpenTabs();
  return reached;
}
