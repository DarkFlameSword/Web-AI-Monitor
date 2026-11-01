import { EMPTY_GRPC_REQUEST, GRPC_HEADERS, HttpError, deserializeError, isAuthError } from '../core/http.js';

/**
 * Straight from the service worker. The extension holds host permission for
 * the vendor, so the browser sends the vendor's cookies with the request.
 *
 * @returns {import('../core/http.js').Http}
 */
export function directHttp(provider) {
  return {
    async getJson(path, { headers = {} } = {}) {
      let response;
      try {
        response = await fetch(provider.origin + path, {
          credentials: 'include',
          cache: 'no-store',
          headers: { ...headers, accept: 'application/json' },
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
    getText(path, { headers = {} } = {}) {
      return fetchText(provider.origin + path, { headers });
    },
    postForm(path, fields, { headers = {} } = {}) {
      return fetchText(provider.origin + path, { method: 'POST', headers, body: new URLSearchParams(fields) });
    },
    async postJson(path, json, { headers = {} } = {}) {
      let response;
      try {
        response = await fetch(provider.origin + path, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { ...headers, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(json),
        });
      } catch {
        throw new HttpError(0, 'network');
      }
      if (!(response.headers.get('content-type') ?? '').includes('json')) {
        throw new HttpError(response.status, 'not_json');
      }
      if (!response.ok) throw new HttpError(response.status);
      return response.json();
    },
    async postGrpc(path) {
      let response;
      try {
        response = await fetch(provider.origin + path, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: GRPC_HEADERS,
          body: Uint8Array.from(EMPTY_GRPC_REQUEST),
        });
      } catch {
        throw new HttpError(0, 'network');
      }
      if (!response.ok) throw new HttpError(response.status, 'http');
      // A bot challenge answers with an HTML page.
      if (!(response.headers.get('content-type') ?? '').includes('grpc')) throw new HttpError(response.status, 'not_grpc');
      return new Uint8Array(await response.arrayBuffer());
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

async function fetchText(url, { method = 'GET', headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, { method, credentials: 'include', cache: 'no-store', headers, body });
  } catch {
    throw new HttpError(0, 'network');
  }
  if (!response.ok) throw new HttpError(response.status, 'http');
  return response.text();
}

/**
 * Through an open tab of the vendor's site: the content script there fetches
 * as the page itself, which gets past checks a worker request can trip.
 *
 * @returns {import('../core/http.js').Http}
 */
export function tabHttp(provider, tabId) {
  const ask = message => chrome.tabs.sendMessage(tabId, { ...message, providerId: provider.id });
  const proxied = async request => {
    let reply;
    try {
      reply = await ask({ type: 'wam:proxy-request', ...request });
    } catch {
      throw new HttpError(0, 'no_tab');
    }
    if (!reply?.ok) throw deserializeError(reply?.error);
    return reply.body;
  };
  return {
    getJson(path, { headers = {} } = {}) {
      return proxied({ method: 'GET', path, headers, as: 'json' });
    },
    getText(path, { headers = {} } = {}) {
      return proxied({ method: 'GET', path, headers, as: 'text' });
    },
    postForm(path, form, { headers = {} } = {}) {
      return proxied({ method: 'POST', path, headers, form, as: 'text' });
    },
    postJson(path, json, { headers = {} } = {}) {
      return proxied({ method: 'POST', path, headers, json, as: 'json' });
    },
    async postGrpc(path) {
      // Bytes cross extension messaging as a plain array.
      const body = await proxied({ method: 'POST', path, grpc: true, as: 'bytes' });
      return Uint8Array.from(Array.isArray(body) ? body : []);
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
 *
 * @param {{previous?: import('../core/store.js').Snapshot|null}} [context]  Passed on to the provider.
 */
export async function fetchUsage(provider, context = {}) {
  let firstError;
  try {
    return await provider.fetchUsage(directHttp(provider), { ...context, now: Date.now() });
  } catch (error) {
    firstError = error;
  }
  for (const tab of await vendorTabs(provider)) {
    try {
      return await provider.fetchUsage(tabHttp(provider, tab.id), { ...context, now: Date.now() });
    } catch (error) {
      if (isAuthError(error)) throw error;
    }
  }
  throw firstError;
}
