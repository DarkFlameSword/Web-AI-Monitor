import { PROVIDERS } from '../providers/index.js';

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
      excludeMatches: PROVIDERS.map(provider => `${provider.origin}/*`),
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

/** Tabs opened before the grant get the floating window without a reload. */
export async function injectOpenTabs() {
  const vendors = new Set(PROVIDERS.map(provider => provider.origin));
  const tabs = await chrome.tabs.query({ url: [...ALL_SITES] });
  await Promise.allSettled(tabs
    .filter(tab => typeof tab.id === 'number' && !tab.discarded && tab.url && !vendors.has(new URL(tab.url).origin))
    .map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/loader.js'] })));
}
