/**
 * The small HTTP surface a provider sees. The background decides how a request
 * actually travels (straight from the service worker, or through an open tab
 * of the vendor's site), so provider code never touches fetch or chrome.*.
 *
 * @typedef {object} Http
 * @property {(path: string, options?: {headers?: Record<string, string>}) => Promise<any>} getJson
 *           GET a JSON document from the provider's origin. Extra headers must be
 *           listed in the provider's `proxyHeaders` to survive the tab route.
 * @property {(name: string) => Promise<string|null>} getCookie  Read a cookie of the provider's origin.
 */

export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status, or 0 when the request never got a response.
   * @param {string|null} [code]  'not_json' when the body was not JSON (e.g. a bot challenge page).
   */
  constructor(status, code = null) {
    super(code ? `HTTP ${status} (${code})` : `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** A JSON 401/403: the vendor answered and said we are not signed in. */
export function isAuthError(error) {
  return error instanceof HttpError && (error.status === 401 || error.status === 403) && error.code !== 'not_json';
}

/** Plain-object form of an error, for passing across extension messaging. */
export function serializeError(error) {
  if (error instanceof HttpError) return { status: error.status, code: error.code };
  return { status: 0, code: 'network' };
}

export function deserializeError(data) {
  return new HttpError(Number(data?.status) || 0, data?.code ?? null);
}
