// Loads the unpacked extension in Chromium, runs it against a mocked claude.ai,
// checks the data path end to end, and saves screenshots to preview-out/.
//
//   npm i -D playwright && npx playwright install chromium
//   npm run preview
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = join(root, 'extension');
const outDir = join(root, 'preview-out');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ORG = '7f0c2a52-3b1e-4c55-9d1a-6e2f8b0c4d11';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A usage response in claude.ai's current shape. */
function usageBody({ session, weekly, fable, sessionIn = 2 * HOUR + 13 * MIN + 45 * SEC, weeklyIn = 3 * DAY + 4 * HOUR + 12 * MIN }) {
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
  return { limits };
}

/** A stored snapshot, as the background would write it. */
function snapshot(usage, { plan = 'max_20x', status = 'ok', fetchedAgo = 12 * SEC } = {}) {
  const meters = usage.limits.map(limit => ({
    id: limit.scope ? `${limit.kind}:${limit.scope.model.display_name.toLowerCase()}` : limit.kind,
    kind: limit.kind,
    scope: limit.scope ? limit.scope.model.display_name : null,
    used: limit.percent,
    resetsAt: limit.resets_at,
  }));
  const now = Date.now();
  return { provider: 'claude', status, meters, plan, fetchedAt: now - fetchedAgo, attemptedAt: now };
}

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Field notes</title>
<style>body{margin:0;font:16px/1.6 Georgia,serif;color:#222;background:#fafafa}
main{max-width:640px;margin:48px auto;padding:0 24px}h1{font-size:32px;margin:0 0 16px}p{margin:0 0 16px;color:#444}</style>
</head><body><main><h1>Field notes</h1>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla.</p>'.repeat(6)}
</main></body></html>`;

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'wam-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 960, height: 600 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push(`ok   ${name}`);
    } catch (error) {
      checks.push(`FAIL ${name}: ${error.message}`);
    }
  };

  try {
    // ---------------------------------------------------------- mock web
    let usage = usageBody({ session: 38, weekly: 19, fable: 0 });
    const counts = { worker: 0, page: 0, completion: 0 };
    await context.route('https://claude.ai/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const fromWorker = Boolean(request.serviceWorker());
      if (pathname.startsWith('/api/')) counts[fromWorker ? 'worker' : 'page'] += 1;
      // Pretend the worker route is stopped by a bot challenge, to exercise the tab fallback.
      if (fromWorker) return route.fulfill({ status: 403, contentType: 'text/html', body: '<html>challenge</html>' });
      if (pathname === '/api/organizations') {
        return route.fulfill({ json: [{ uuid: ORG, name: 'Guild', capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_20x' }] });
      }
      if (pathname === `/api/organizations/${ORG}/usage`) return route.fulfill({ json: usage });
      if (pathname.endsWith('/completion')) {
        counts.completion += 1;
        return route.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' });
      }
      return route.fulfill({ contentType: 'text/html', body: ARTICLE.replace('Field notes', 'claude.ai (mock)') });
    });
    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: ARTICLE }));
    await context.route('https://strict.example.com/**', route => route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'" },
      body: ARTICLE.replace('Field notes', 'Strict CSP page'),
    }));

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    // The worker can be reported before its extension APIs are bound.
    for (let i = 0; i < 40 && !(await worker.evaluate(() => typeof chrome?.storage?.local === 'object')); i += 1) await sleep(100);
    const storage = {
      get: keys => worker.evaluate(k => chrome.storage.local.get(k), keys),
      set: data => worker.evaluate(d => chrome.storage.local.set(d), data),
      clear: () => worker.evaluate(() => chrome.storage.local.clear()),
    };
    // Let the install-time refresh finish before setting up scenes.
    for (let i = 0; i < 40 && !(await storage.get('snapshot:claude'))['snapshot:claude']; i += 1) await sleep(250);

    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const openPopup = async () => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 312, height: 640 });
      await page.goto(popupUrl);
      await page.evaluate(() => document.fonts.ready);
      await sleep(900);
      return page;
    };
    const shootPopup = async (page, name) => page.locator('body').screenshot({ path: join(outDir, `${name}.png`) });

    // ------------------------------------------------- end-to-end checks
    const claudePage = await context.newPage();
    await claudePage.goto('https://claude.ai/new');
    await sleep(1200);

    await check('refresh through an open claude.ai tab when the worker route is blocked', async () => {
      await storage.clear();
      await storage.set({ settings: { lang: 'zh_CN' } });
      const page = await openPopup(); // the popup asks for a refresh when it opens
      let snap;
      for (let i = 0; i < 40; i += 1) {
        snap = (await storage.get('snapshot:claude'))['snapshot:claude'];
        if (snap?.status === 'ok') break;
        await sleep(250);
      }
      assert.equal(snap?.status, 'ok', `status ${snap?.status}`);
      assert.equal(snap.plan, 'max_20x');
      assert.deepEqual(snap.meters.map(m => [m.id, m.used]), [['session', 38], ['weekly_all', 19], ['weekly_scoped:fable', 0]]);
      assert.ok(counts.worker > 0 && counts.page > 0, JSON.stringify(counts));
      await sleep(700);
      await shootPopup(page, '01-popup-zh');
      const text = await page.locator('body').innerText();
      assert.match(text, /62\/100/);
      assert.match(text, /81\/100/);
      assert.match(text, /READY!/);
      assert.match(text, /距恢复 2:1\d:\d\d/);
      await page.close();
    });

    await check('a finished reply on claude.ai refreshes the gauges', async () => {
      usage = usageBody({ session: 55, weekly: 24, fable: 10 });
      await sleep(4200); // past the "activity" freshness window
      const before = (await storage.get('snapshot:claude'))['snapshot:claude'].attemptedAt;
      await claudePage.evaluate(org => fetch(`/api/organizations/${org}/chat_conversations/abc/completion`, { method: 'POST' }), ORG);
      let snap;
      for (let i = 0; i < 40; i += 1) {
        snap = (await storage.get('snapshot:claude'))['snapshot:claude'];
        if (snap.attemptedAt > before) break;
        await sleep(250);
      }
      assert.ok(snap.attemptedAt > before, 'no refresh after the reply');
      assert.equal(snap.meters[0].used, 55);
      await sleep(1500);
      await claudePage.screenshot({ path: join(outDir, '05-hud-claude.png') });
    });

    await check('the page HUD renders on a strict-CSP page with the pixel font', async () => {
      const page = await context.newPage();
      await page.goto('https://strict.example.com/');
      const host = page.locator('web-ai-monitor-hud');
      await host.waitFor({ state: 'attached', timeout: 5000 });
      await sleep(1200);
      const box = await host.boundingBox();
      assert.ok(box && box.width > 150 && box.height > 50, `HUD box ${JSON.stringify(box)}`);
      const fontLoaded = await page.evaluate(() => [...document.fonts].some(f => f.family.includes('WAM Guild Pixel') && f.status === 'loaded'));
      assert.ok(fontLoaded, 'font not loaded');
      await host.screenshot({ path: join(outDir, '06-hud-strict-csp.png') });
      await page.close();
    });

    // ------------------------------------------------------------ scenes
    const scenes = [
      ['02-popup-low-ja', { lang: 'ja' }, snapshot(usageBody({ session: 88, weekly: 64, fable: 72 }), { plan: 'max_5x' })],
      ['03-popup-empty-en', { lang: 'en' }, snapshot(usageBody({ session: 100, weekly: 83, fable: 100, sessionIn: 47 * MIN }), { plan: 'max_20x' })],
      ['04-popup-pro-sealed', { lang: 'zh_CN' }, snapshot(usageBody({ session: 12, weekly: 40, sessionIn: null }), { plan: 'pro' })],
    ];
    for (const [name, settings, snap] of scenes) {
      await check(`scene ${name}`, async () => {
        await storage.set({ settings, 'snapshot:claude': { ...snap, attemptedAt: Date.now() } });
        const page = await openPopup();
        await shootPopup(page, name);
        await page.close();
      });
    }

    await check('scene 07-popup-settings', async () => {
      await storage.set({ settings: { lang: 'zh_CN' } });
      const page = await openPopup();
      await page.getByRole('button', { name: '设置' }).click();
      await sleep(300);
      await shootPopup(page, '07-popup-settings');
      await page.close();
    });

    await check('scene 08-popup-signed-out', async () => {
      await storage.set({ 'snapshot:claude': { provider: 'claude', status: 'signed_out', meters: [], plan: null, fetchedAt: null, attemptedAt: Date.now() } });
      const page = await openPopup();
      await shootPopup(page, '08-popup-signed-out');
      await page.close();
    });

    await check('scene 09/10 HUD expanded and collapsed on a normal page', async () => {
      await storage.set({
        settings: { lang: 'zh_CN' },
        'snapshot:claude': { ...snapshot(usageBody({ session: 38, weekly: 19, fable: 0 })), attemptedAt: Date.now() },
      });
      const page = await context.newPage();
      await page.goto('https://example.com/');
      const host = page.locator('web-ai-monitor-hud');
      await host.waitFor({ state: 'attached', timeout: 5000 });
      await sleep(1500);
      await page.screenshot({ path: join(outDir, '09-hud-page.png') });
      await host.screenshot({ path: join(outDir, '10-hud-zoom.png') });
      await storage.set({ settings: { lang: 'zh_CN', hud: { collapsed: true } } });
      await sleep(600);
      await host.screenshot({ path: join(outDir, '11-hud-collapsed.png') });
      await page.close();
    });

    await check('the toolbar icon and tooltip follow the numbers', async () => {
      const title = await worker.evaluate(() => chrome.action.getTitle({}));
      assert.match(title, /MP \d+\/100/);
    });
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
  console.log(checks.join('\n'));
  console.log(`screenshots: ${outDir}`);
  if (checks.some(line => line.startsWith('FAIL'))) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
