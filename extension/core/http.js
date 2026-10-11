/**
 * The small HTTP surface a provider sees. The background decides how a request
 * actually travels (straight from the service worker, or through an open tab
 * of the vendor's site), so provider code never touches fetch or chrome.*.
 *
 * @typedef {object} Http
 * @property {(path: string, options?: {headers?: Record<string, string>}) => Promise<any>} getJson
 *           GET a JSON document from the provider's origin. Extra headers must be
 *           listed in the provider's `proxyHeaders` to survive the tab route.
 * @property {(path: string, options?: {headers?: Record<string, string>}) => Promise<string>} getText
 *           GET a page as text. On the tab route the path must be in `proxyPaths`,
 *           and the provider's `proxyBody` decides what of it leaves the tab.
 * @property {(path: string, fields: Record<string, string>, options?: {headers?: Record<string, string>}) => Promise<string>} postForm
 *           POST a form and read the reply as text. On the tab route the path and
 *           the form must pass one of the provider's `proxyPosts` rules.
 * @property {(name: string) => Promise<string|null>} getCookie  Read a cookie of the provider's origin.
 */

export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status, or 0 when the request never got a response.
   * @param {string|null} [code]  null for a JSON error reply; 'not_json' when the body was not JSON
   *   (e.g. a bot challenge page); 'http' for a failed text request; 'signed_out' when the
   *   provider can tell the user is not signed in.
   */
  constructor(status, code = null) {
    super(code ? `HTTP ${status} (${code})` : `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Not signed in: a JSON 401/403 (the vendor answered and said so), or the
 * provider found it out itself. A failed page request is not proof of it.
 */
export function isAuthError(error) {
  if (!(error instanceof HttpError)) return false;
  return error.code === 'signed_out' || ((error.status === 401 || error.status === 403) && error.code === null);
}

/** Plain-object form of an error, for passing across extension messaging. */
export function serializeError(error) {
  if (error instanceof HttpError) return { status: error.status, code: error.code };
  return { status: 0, code: 'network' };
}

export function deserializeError(data) {
  return new HttpError(Number(data?.status) || 0, data?.code ?? null);
}
