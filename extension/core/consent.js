/**
 * Consent to the data use notice. Nothing is read from any vendor until the
 * user agrees in the extension's own UI (the welcome page or the popup), as
 * the Chrome Web Store's disclosure rules require.
 */
import { loadSettings, updateSettings } from './settings.js';
import { providerIdOfKey } from './store.js';

/**
 * Bump whenever what the extension reads, keeps or sends changes. Everyone
 * who agreed to an older version sees the notice again, and nothing runs
 * until they agree to the new one.
 */
export const DATA_PRACTICES_VERSION = 1;

export const PRIVACY_POLICY_URL = 'https://github.com/DarkFlameSword/Web-AI-Monitor/blob/main/PRIVACY.md';
export const WELCOME_PATH = 'welcome/welcome.html';

/** Has the user agreed to the current notice? */
export function hasConsent(settings) {
  return settings.consent.version >= DATA_PRACTICES_VERSION;
}

/** Agreed once, to an older notice: the practices changed since. */
export function consentOutdated(settings) {
  return settings.consent.version > 0 && settings.consent.version < DATA_PRACTICES_VERSION;
}

export function giveConsent(now = Date.now()) {
  return updateSettings(draft => { draft.consent = { version: DATA_PRACTICES_VERSION, at: now }; });
}

/**
 * Stop reading, and delete what was read: usage snapshots and notice
 * bookkeeping. The user's own settings (language, dates they typed) stay.
 */
export async function withdrawConsent() {
  await updateSettings(draft => { draft.consent = { version: 0, at: null }; });
  const stored = await chrome.storage.local.get(null);
  const fetched = Object.keys(stored).filter(key => providerIdOfKey(key) || key.startsWith('notices:'));
  if (fetched.length) await chrome.storage.local.remove(fetched);
  return loadSettings();
}
