// Shared by the end-to-end preview and the store asset builder: Chromium with
// the unpacked extension loaded, and the vendor sites mocked.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { DATA_PRACTICES_VERSION } from '../extension/core/consent.js';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const extensionDir = join(root, 'extension');

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const ORG = '7f0c2a52-3b1e-4c55-9d1a-6e2f8b0c4d11';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A usage response in claude.ai's current shape, with both kinds of credits. */
export function usageBody({
  session, weekly, fable,
  sessionIn = 2 * HOUR + 13 * MIN + 45 * SEC,
  weeklyIn = 3 * DAY + 4 * HOUR + 12 * MIN,
  cloud = { limit: 250, used: 62.5, expiresIn: 1 * DAY + 17 * HOUR + 45 * MIN },
  extra = { enabled: true, used: 1240, limit: 5000 },
}) {
  const at = ms => (ms === null ? null : new Date(Date.now() + ms).toISOString());
  const limits = [
    { kind: 'session', group: 'session', percent: session, resets_at: at(sessionIn), scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: weekly, resets_at: at(weeklyIn), scope: null },
  ];
  if (fable !== undefined) {
    limits.push({
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: fable,
      resets_at: at(weeklyIn),
      scope: { model: { display_name: 'Fable' }, surface: null },
    });
  }
  return {
    limits,
    iguana_necktie: cloud && {
      limit_dollars: cloud.limit,
      used_dollars: cloud.used,
      remaining_dollars: cloud.limit - cloud.used,
      utilization: (cloud.used / cloud.limit) * 100,
      resets_at: at(cloud.expiresIn),
      locked_reason: null,
    },
    extra_usage: extra && {
      is_enabled: extra.enabled,
      monthly_limit: extra.limit,
      used_credits: extra.used,
      currency: 'USD',
      decimal_places: 2,
      spend_limit_reached: false,
    },
  };
}

/** A wham/usage response, as chatgpt.com answers it. */
export function chatgptUsage() {
  const at = ms => Math.floor((Date.now() + ms) / 1000);
  return {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 41, limit_window_seconds: 18000, reset_after_seconds: 7000, reset_at: at(1 * HOUR + 56 * MIN) },
      secondary_window: { used_percent: 73, limit_window_seconds: 604800, reset_at: at(4 * DAY + 2 * HOUR) },
    },
    additional_rate_limits: [{
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_spark',
      rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: at(4 * DAY + 2 * HOUR) } },
    }],
    credits: { has_credits: true, unlimited: false, overage_limit_reached: false, balance: '1250' },
    rate_limit_reset_credits: { available_count: 3 },
    spend_control: null,
  };
}

export const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Field notes</title>
<style>body{margin:0;font:16px/1.6 Georgia,serif;color:#222;background:#fafafa}
main{max-width:640px;margin:48px auto;padding:0 24px}h1{font-size:32px;margin:0 0 16px}p{margin:0 0 16px;color:#444}</style>
</head><body><main><h1>Field notes</h1>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla.</p>'.repeat(6)}
</main></body></html>`;

/** A copy of the extension whose optional permissions are granted on install. */
export function grantedBuild() {
  const dir = mkdtempSync(join(tmpdir(), 'wam-granted-'));
  cpSync(extensionDir, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  manifest.permissions = [...manifest.permissions, ...manifest.optional_permissions];
  delete manifest.optional_host_permissions;
  delete manifest.optional_permissions;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

/**
 * Settings written by a check keep the data use notice agreed, unless the
 * check sets `consent` itself (to test the notice).
 */
function withConsent(data) {
  if (!data?.settings || typeof data.settings !== 'object' || 'consent' in data.settings) return data;
  return { ...data, settings: { ...data.settings, consent: { version: DATA_PRACTICES_VERSION, at: Date.now() } } };
}

/**
 * Chromium with the extension loaded and claude.ai / chatgpt.com / example.com mocked.
 * @param {{deviceScaleFactor?: number, viewport?: {width: number, height: number}, consent?: boolean}} [options]
 *   consent: agree to the data use notice right away (default), as a returning user has.
 */
export async function launch(extensionPath, mock, { deviceScaleFactor = 2, viewport = { width: 960, height: 600 }, consent = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'wam-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor,
    viewport,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  await context.route('https://claude.ai/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const fromWorker = Boolean(request.serviceWorker());
    if (pathname.startsWith('/api/')) mock.counts[fromWorker ? 'worker' : 'page'] += 1;
    // Pretend the worker route is stopped by a bot challenge, to exercise the tab fallback.
    if (fromWorker) return route.fulfill({ status: 403, contentType: 'text/html', body: '<html>challenge</html>' });
    if (pathname === '/api/organizations') {
      return route.fulfill({ json: [{ uuid: ORG, name: 'Guild', capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_20x' }] });
    }
    if (pathname === `/api/organizations/${ORG}/usage`) return route.fulfill({ json: mock.usage });
    if (pathname.endsWith('/completion')) return route.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' });
    return route.fulfill({ contentType: 'text/html', body: ARTICLE.replace('Field notes', 'claude.ai (mock)') });
  });
  await context.route('https://chatgpt.com/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    // Like claude.ai: the worker route is stopped, the page route works.
    if (request.serviceWorker()) return route.fulfill({ status: 403, contentType: 'text/html', body: '<html>challenge</html>' });
    if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { id: 'u' }, accessToken: mock.chatgptToken } });
    if (pathname === '/backend-api/wham/usage') {
      mock.chatgptAuth = request.headers().authorization ?? null;
      return route.fulfill({ json: chatgptUsage() });
    }
    if (pathname.includes('/conversation')) return route.fulfill({ contentType: 'text/event-stream', body: 'data: [DONE]\n\n' });
    return route.fulfill({ contentType: 'text/html', body: ARTICLE.replace('Field notes', 'chatgpt.com (mock)') });
  });
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: ARTICLE }));
  await context.route('https://strict.example.com/**', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'" },
    body: ARTICLE.replace('Field notes', 'Strict CSP page'),
  }));

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // The worker can be reported before its extension APIs are bound.
  for (let i = 0; i < 40 && !(await worker.evaluate(() => typeof chrome?.storage?.local === 'object')); i += 1) await sleep(100);
  // Chrome stops an extension service worker after ~30 s without events (as
  // before consent, when it has nothing to do), and Playwright's handle to a
  // stopped worker never answers. An extension API call resets that timer.
  const keepAlive = setInterval(() => {
    worker.evaluate(() => chrome.runtime.getPlatformInfo()).catch(() => {});
  }, 10_000);
  /** Run fn in the service worker; fail instead of hanging if it does not answer. */
  const ask = (fn, arg) => {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('the service worker did not answer')), 15_000);
    });
    return Promise.race([worker.evaluate(fn, arg), late]).finally(() => clearTimeout(timer));
  };
  const storage = {
    get: async key => (await ask(k => chrome.storage.local.get(k), key))[key],
    set: data => ask(d => chrome.storage.local.set(d), withConsent(data)),
    clear: () => ask(() => chrome.storage.local.clear()),
  };
  if (consent) {
    // Agreeing starts the first refresh; let it and the permission sync finish.
    await storage.set({ settings: {} });
    for (let i = 0; i < 40 && !(await storage.get('snapshot:claude')); i += 1) await sleep(250);
  }
  await sleep(500);

  const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup/popup.html`;
  const openPopup = async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 312, height: 760 });
    await page.goto(popupUrl);
    await page.evaluate(() => document.fonts.ready);
    await sleep(900);
    return page;
  };
  const close = async () => {
    clearInterval(keepAlive);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  };
  return { context, worker, ask, storage, openPopup, close };
}

export async function waitFor(fn, what, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const hudOn = page => page.locator('web-ai-monitor-hud').evaluate(el => window.getComputedStyle(el).display !== 'none').catch(() => false);

/** What in the popup sticks out past the card's padding box (should be nothing). */
export const overflowing = page => page.evaluate(() => {
  const app = document.getElementById('app');
  const box = app.getBoundingClientRect();
  const style = window.getComputedStyle(app);
  const left = box.left + parseFloat(style.paddingLeft) - 0.5;
  const right = box.right - parseFloat(style.paddingRight) + 0.5;
  return [...app.querySelectorAll('*')]
    .filter(el => el.getClientRects().length && !el.closest('[hidden]'))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 1 && (r.right > right || r.left < left))
    .map(({ el, r }) => `${el.className || el.tagName} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.left)}-${Math.round(r.right)}`);
});

/** Text inside the HUD. Its shadow root is closed, so it is read over CDP. */
export async function hudText(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => {
      if (node.nodeName === 'WEB-AI-MONITOR-HUD') return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    const host = find(root);
    const shadow = host?.shadowRoots?.[0];
    if (!shadow) return '';
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId });
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { return [...this.querySelectorAll(".hud-sheet")].map(el => el.innerText).join("\\n"); }',
      returnByValue: true,
    });
    return result.value ?? '';
  } finally {
    await cdp.detach();
  }
}
