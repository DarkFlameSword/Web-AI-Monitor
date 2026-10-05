import { HttpError, deserializeError, isAuthError } from '../core/http.js';

/**
 * Straight from the service worker. The extension holds host permission for
 * the vendor, so the browser sends the vendor's cookies with the request.
 *
 * @returns {import('../core/http.js').Http}
 */
export function directHttp(provider) {
  return {
    async getJson(path) {
      let response;
      try {
        response = await fetch(provider.origin + path, {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
      } catch {
        throw new HttpError(0, 'network');
      }
      // A bot challenge answers with an HTML page; that is not a sign-out.
      if (!(response.headers.get('content-type') ?? '').includes('json')) {
        throw new HttpError(response.status, 'not_json');
      }
      if (!response.ok) throw new HttpError(response.status);
      return response.json();
    },
    async getCookie(name) {
      try {
        return (await chrome.cookies.get({ url: provider.origin, name }))?.value ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Through an open tab of the vendor's site: the content script there fetches
 * as the page itself, which gets past checks a worker request can trip.
 *
 * @returns {import('../core/http.js').Http}
 */
export function tabHttp(provider, tabId) {
  const ask = message => chrome.tabs.sendMessage(tabId, { ...message, providerId: provider.id });
  return {
    async getJson(path) {
      let reply;
      try {
        reply = await ask({ type: 'wam:proxy-get', path });
      } catch {
        throw new HttpError(0, 'no_tab');
      }
      if (!reply?.ok) throw deserializeError(reply?.error);
      return reply.body;
    },
    async getCookie(name) {
      try {
        return (await ask({ type: 'wam:proxy-cookie', name }))?.value ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Open tabs of the vendor's site, most recently used first. */
async function vendorTabs(provider) {
  try {
    const tabs = await chrome.tabs.query({ url: `${provider.origin}/*` });
    return tabs
      .filter(tab => typeof tab.id === 'number' && !tab.discarded)
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
      .slice(0, 2);
  } catch {
    return [];
  }
}

/**
 * Ask the worker route first; if it fails for any reason, try an open vendor
 * tab before giving up. A sign-in error from a tab is final.
 */
export async function fetchUsage(provider) {
  let firstError;
  try {
    return await provider.fetchUsage(directHttp(provider));
  } catch (error) {
    firstError = error;
  }
  for (const tab of await vendorTabs(provider)) {
    try {
      return await provider.fetchUsage(tabHttp(provider, tab.id));
    } catch (error) {
      if (isAuthError(error)) throw error;
    }
  }
  throw firstError;
}
