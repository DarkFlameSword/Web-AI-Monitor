// Loads the unpacked extension in Chromium, runs it against a mocked claude.ai,
// checks the data path end to end, and saves screenshots to preview-out/.
//
//   npm install && npx playwright install chromium
//   npm run preview
//
// Two builds are loaded in turn:
//   default  the manifest as shipped: no optional permissions granted.
//   granted  a copy whose optional permissions (every site, notifications)
//            are granted at install, standing in for the user saying yes.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const outDir = join(root, 'preview-out');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ORG = '7f0c2a52-3b1e-4c55-9d1a-6e2f8b0c4d11';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A usage response in claude.ai's current shape, with both kinds of credits. */
function usageBody({
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

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Field notes</title>
<style>body{margin:0;font:16px/1.6 Georgia,serif;color:#222;background:#fafafa}
main{max-width:640px;margin:48px auto;padding:0 24px}h1{font-size:32px;margin:0 0 16px}p{margin:0 0 16px;color:#444}</style>
</head><body><main><h1>Field notes</h1>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla.</p>'.repeat(6)}
</main></body></html>`;

/** A copy of the extension whose optional permissions are granted on install. */
function grantedBuild() {
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

async function launch(extensionPath, mock) {
  const profile = mkdtempSync(join(tmpdir(), 'wam-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 960, height: 600 },
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
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: ARTICLE }));
  await context.route('https://strict.example.com/**', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'" },
    body: ARTICLE.replace('Field notes', 'Strict CSP page'),
  }));

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // The worker can be reported before its extension APIs are bound.
  for (let i = 0; i < 40 && !(await worker.evaluate(() => typeof chrome?.storage?.local === 'object')); i += 1) await sleep(100);
  const storage = {
    get: async key => (await worker.evaluate(k => chrome.storage.local.get(k), key))[key],
    set: data => worker.evaluate(d => chrome.storage.local.set(d), data),
    clear: () => worker.evaluate(() => chrome.storage.local.clear()),
  };
  // Let the install-time refresh and permission sync finish.
  for (let i = 0; i < 40 && !(await storage.get('snapshot:claude')); i += 1) await sleep(250);
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
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  };
  return { context, worker, storage, openPopup, close };
}

async function waitFor(fn, what, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const hudOn = page => page.locator('web-ai-monitor-hud').evaluate(el => window.getComputedStyle(el).display !== 'none').catch(() => false);

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(`ok   ${name}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    }
  };
  const shoot = (target, name) => target.screenshot({ path: join(outDir, `${name}.png`) });

  // ------------------------------------------------- default build
  {
    const mock = { usage: usageBody({ session: 38, weekly: 19, fable: 0 }), counts: { worker: 0, page: 0 } };
    const app = await launch(extensionDir, mock);
    try {
      await check('default build: HUD on claude.ai, none elsewhere, nothing registered', async () => {
        const claude = await app.context.newPage();
        await claude.goto('https://claude.ai/new');
        await waitFor(() => hudOn(claude), 'HUD on claude.ai');
        const other = await app.context.newPage();
        await other.goto('https://example.com/');
        await sleep(1500);
        assert.equal(await other.locator('web-ai-monitor-hud').count(), 0, 'HUD injected without permission');
        const registered = await app.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
        assert.deepEqual(registered, []);
        const settings = await app.storage.get('settings');
        assert.equal(settings?.hud?.everywhere ?? false, false);
        await other.close();
        await claude.close();
      });

      await check('default build: settings show the permission toggles unchecked', async () => {
        await app.storage.set({ settings: { lang: 'zh_CN' } });
        const page = await app.openPopup();
        await page.getByRole('button', { name: '设置' }).click();
        await sleep(300);
        assert.equal(await page.getByLabel('所有网页都显示（需授权）').isChecked(), false);
        assert.equal(await page.getByLabel('能量完全恢复时提醒').isChecked(), false);
        await shoot(page.locator('body'), '07-popup-settings');
        await page.close();
      });
    } finally {
      await app.close();
    }
  }

  // ------------------------------------------------- granted build
  const build = grantedBuild();
  const mock = { usage: usageBody({ session: 38, weekly: 19, fable: 0 }), counts: { worker: 0, page: 0 } };
  const app = await launch(build, mock);
  try {
    const claude = await app.context.newPage();
    await claude.goto('https://claude.ai/new');
    await sleep(1200);

    await check('refresh through an open claude.ai tab when the worker route is blocked', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } }, 'snapshot:claude': null });
      const page = await app.openPopup(); // the popup asks for a refresh when it opens
      const snap = await waitFor(async () => {
        const value = await app.storage.get('snapshot:claude');
        return value?.status === 'ok' && value;
      }, 'an ok snapshot');
      assert.equal(snap.plan, 'max_20x');
      assert.deepEqual(snap.meters.map(m => [m.id, m.used]), [['session', 38], ['weekly_all', 19], ['weekly_scoped:fable', 0]]);
      assert.deepEqual(snap.wallets.map(w => [w.id, w.balance ?? w.spent]), [['cloud_session', 187.5], ['usage_credits', 12.4]]);
      assert.ok(mock.counts.worker > 0 && mock.counts.page > 0, JSON.stringify(mock.counts));
      await sleep(700);
      await shoot(page.locator('body'), '01-popup-zh');
      const text = await page.locator('body').innerText();
      for (const expected of [/62\/100/, /81\/100/, /READY!/, /距恢复 2:1\d:\d\d/, /金币袋/, /剩余 \$187\.50 \/ \$250\.00/, /距失效 1天 17:4\d:\d\d/, /本月已用 \$12\.40/, /上限 \$50\.00/]) {
        assert.match(text, expected);
      }
      await page.close();
    });

    await check('a finished reply on claude.ai refreshes the gauges', async () => {
      mock.usage = usageBody({ session: 55, weekly: 24, fable: 10 });
      await sleep(4200); // past the "activity" freshness window
      const before = (await app.storage.get('snapshot:claude')).attemptedAt;
      await claude.evaluate(org => fetch(`/api/organizations/${org}/chat_conversations/abc/completion`, { method: 'POST' }), ORG);
      const snap = await waitFor(async () => {
        const value = await app.storage.get('snapshot:claude');
        return value.attemptedAt > before && value;
      }, 'a refresh after the reply');
      assert.equal(snap.meters[0].used, 55);
    });

    await check('every-site HUD: registered, shown on a strict-CSP page with the pixel font', async () => {
      const registered = await app.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
      assert.deepEqual(registered.map(script => script.id), ['wam-page-hud']);
      const page = await app.context.newPage();
      await page.goto('https://strict.example.com/');
      await waitFor(() => hudOn(page), 'HUD on the strict page');
      await sleep(1200);
      const fontLoaded = await page.evaluate(() => [...document.fonts].some(f => f.family.includes('WAM Guild Pixel') && f.status === 'loaded'));
      assert.ok(fontLoaded, 'font not loaded');
      await shoot(page.locator('web-ai-monitor-hud'), '06-hud-strict-csp');
      await page.close();
    });

    await check('turning "every site" off hides the HUD there but not on claude.ai', async () => {
      const page = await app.context.newPage();
      await page.goto('https://example.com/');
      await waitFor(() => hudOn(page), 'HUD on example.com');
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: false } } });
      await waitFor(async () => !(await hudOn(page)), 'HUD hidden on example.com');
      assert.equal(await hudOn(claude), true);
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } } });
      await page.close();
    });

    await check('a used gauge that resets sends one "fully restored" notification', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true }, notify: { recovered: true } } });
      const snap = await app.storage.get('snapshot:claude');
      const ended = new Date(Date.now() - 10 * SEC).toISOString();
      await app.storage.set({
        'snapshot:claude': { ...snap, meters: snap.meters.map(m => (m.id === 'session' ? { ...m, used: 55, resetsAt: ended } : m)), attemptedAt: 0 },
      });
      const page = await app.openPopup(); // triggers a refresh, which looks for recoveries first
      const ids = await waitFor(async () => {
        const all = await app.worker.evaluate(() => chrome.notifications.getAll());
        const found = Object.keys(all).filter(id => id.startsWith('wam:recovered:claude:'));
        return found.length && found;
      }, 'a recovery notification');
      assert.equal(ids.length, 1);
      // Asking again for the same window must not notify twice.
      const again = await app.storage.get('snapshot:claude');
      await app.storage.set({ 'snapshot:claude': { ...again, meters: snap.meters.map(m => (m.id === 'session' ? { ...m, used: 55, resetsAt: ended } : m)), attemptedAt: 0 } });
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wam:refresh', reason: 'manual' }));
      await sleep(800);
      const all = await app.worker.evaluate(() => chrome.notifications.getAll());
      assert.equal(Object.keys(all).filter(id => id.startsWith('wam:recovered:claude:')).length, 1);
      await page.close();
    });

    // ---------------------------------------------------------- scenes
    const scene = async (name, settings, usage, plan = 'max_20x') => {
      await check(`scene ${name}`, async () => {
        mock.usage = usage;
        await app.storage.set({ settings: { hud: { everywhere: true }, ...settings }, 'snapshot:claude': { attemptedAt: 0 } });
        const page = await app.openPopup();
        await waitFor(async () => (await app.storage.get('snapshot:claude'))?.status === 'ok', 'scene data');
        if (plan !== 'max_20x') {
          const snap = await app.storage.get('snapshot:claude');
          await app.storage.set({ 'snapshot:claude': { ...snap, plan } });
        }
        await sleep(900);
        await shoot(page.locator('body'), name);
        await page.close();
      });
    };
    await scene('02-popup-low-ja', { lang: 'ja' }, usageBody({ session: 88, weekly: 64, fable: 72, cloud: { limit: 250, used: 221, expiresIn: 9 * HOUR } }), 'max_5x');
    await scene('03-popup-empty-en', { lang: 'en' }, usageBody({ session: 100, weekly: 83, fable: 100, sessionIn: 47 * MIN, cloud: null, extra: { enabled: true, used: 5000, limit: 5000 } }));
    await scene('04-popup-pro-sealed', { lang: 'zh_CN' }, usageBody({ session: 12, weekly: 40, sessionIn: null, cloud: { limit: 100, used: 0, expiresIn: 2 * DAY }, extra: { enabled: false, used: 0, limit: null } }), 'pro');

    await check('scene 08-popup-signed-out', async () => {
      await app.storage.set({ 'snapshot:claude': { provider: 'claude', status: 'signed_out', meters: [], wallets: [], plan: null, fetchedAt: null, attemptedAt: Date.now() } });
      const page = await app.openPopup();
      await shoot(page.locator('body'), '08-popup-signed-out');
      await page.close();
    });

    await check('scene 09/10/11 HUD expanded and collapsed on a normal page', async () => {
      mock.usage = usageBody({ session: 38, weekly: 19, fable: 0 });
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } }, 'snapshot:claude': { attemptedAt: 0 } });
      const popup = await app.openPopup();
      await waitFor(async () => (await app.storage.get('snapshot:claude'))?.status === 'ok', 'HUD data');
      await popup.close();
      const page = await app.context.newPage();
      await page.goto('https://example.com/');
      await waitFor(() => hudOn(page), 'HUD on example.com');
      await sleep(1500);
      await shoot(page, '09-hud-page');
      await shoot(page.locator('web-ai-monitor-hud'), '10-hud-zoom');
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true, collapsed: true } } });
      await sleep(600);
      await shoot(page.locator('web-ai-monitor-hud'), '11-hud-collapsed');
      await page.close();
    });

    await check('the toolbar tooltip follows the numbers', async () => {
      const title = await app.worker.evaluate(() => chrome.action.getTitle({}));
      assert.match(title, /MP \d+\/100/);
    });
  } finally {
    await app.close();
    rmSync(build, { recursive: true, force: true });
  }

  console.log(results.join('\n'));
  console.log(`screenshots: ${outDir}`);
  if (results.some(line => line.startsWith('FAIL'))) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
