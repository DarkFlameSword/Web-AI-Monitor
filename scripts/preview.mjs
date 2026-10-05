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

/** A wham/usage response, as chatgpt.com answers it. */
function chatgptUsage() {
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
        const gpt = page.locator('label.pix-check', { hasText: 'ChatGPT' });
        assert.equal(await gpt.locator('input').isChecked(), false, 'ChatGPT is off by default');
        assert.match(await gpt.innerText(), /需授权/);
        assert.equal(await page.getByText('悬浮窗归位').count(), 0);
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
      const expiryDay = new Date(Date.now() + 29 * DAY).toISOString().slice(0, 10);
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true }, rankExpiry: { claude: expiryDay } }, 'snapshot:claude': null });
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
      const [y, m, d] = expiryDay.split('-').map(Number);
      const expiry = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(y, m - 1, d));
      for (const expected of [
        /62\/100/, /81\/100/, /READY!/, /距恢复 2:1\d:\d\d/,
        /冒险者资质\s*A/, new RegExp(`资质过期时间 ${expiry}`),
        /宝物袋/, /绿宝石/, /剩余 \$187\.50 \/ \$250\.00/, /距失效 1天 17:4\d:\d\d/,
        /金币/, /本月已用 \$12\.40/, /上限 \$50\.00/,
      ]) {
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
      assert.deepEqual(registered.map(script => script.id).sort(), ['wam-page-hud', 'wam-vendor-chatgpt']);
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

    await check('rank expiry: unset shows a hint that opens settings, where the date is filled in', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } } });
      const page = await app.openPopup();
      const hint = page.getByRole('button', { name: '资质过期时间 未填写' });
      await hint.click();
      // The hint opens settings with that vendor's pixel calendar already open.
      const calendar = page.getByRole('dialog', { name: 'Claude 订阅过期时间' });
      await calendar.waitFor();
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-24`;
      await page.waitForTimeout(200);
      await shoot(page.locator('body'), '13-calendar');
      await page.keyboard.press('PageDown');
      await page.keyboard.press('PageUp');
      await calendar.locator(`[data-day="${day}"]`).click();
      await waitFor(async () => (await app.storage.get('settings'))?.rankExpiry?.claude === day, 'saved date');
      assert.equal(await calendar.isHidden(), true, 'calendar closes after picking');
      await page.getByRole('button', { name: '返回' }).click();
      const shown = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getFullYear(), now.getMonth(), 24));
      assert.match(await page.locator('body').innerText(), new RegExp(`资质过期时间 ${shown}`));
      await page.getByRole('button', { name: '设置' }).click();
      await page.getByRole('button', { name: '清除' }).click();
      await waitFor(async () => !(await app.storage.get('settings'))?.rankExpiry?.claude, 'cleared date');
      await page.close();
    });

    await check('pixel dropdown: opens, moves with the keyboard, saves the language', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } } });
      const page = await app.openPopup();
      await page.getByRole('button', { name: '设置' }).click();
      // The first dropdown is the language; its label changes with the language itself.
      const button = page.locator('.set-row').first().locator('.pix-dd-btn');
      await button.click();
      const list = page.locator('.set-row').first().getByRole('listbox');
      await list.waitFor();
      await page.waitForTimeout(150);
      await shoot(page.locator('body'), '14-dropdown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await waitFor(async () => (await app.storage.get('settings'))?.lang === 'ja', 'language ja');
      assert.equal(await list.isHidden(), true);
      await button.click();
      await page.mouse.click(5, 5);
      assert.equal(await list.isHidden(), true, 'closes on an outside click');
      await page.close();
    });

    await check('ChatGPT: switched on in settings, fetched through its tab, on its own card', async () => {
      mock.chatgptToken = 'header.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC0xIn19.sig';
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true } } });
      const gpt = await app.context.newPage();
      await gpt.goto('https://chatgpt.com/');
      await sleep(1200);
      const page = await app.openPopup();
      await page.getByRole('button', { name: '设置' }).click();
      await page.locator('label.pix-check', { hasText: 'ChatGPT' }).click();
      await waitFor(async () => (await app.storage.get('settings'))?.providers?.chatgpt === true, 'ChatGPT on');
      const snap = await waitFor(async () => {
        const value = await app.storage.get('snapshot:chatgpt');
        return value?.status === 'ok' && value;
      }, 'a ChatGPT snapshot');
      assert.equal(snap.plan, 'plus');
      assert.equal(mock.chatgptAuth, `Bearer ${mock.chatgptToken}`);
      await page.getByRole('button', { name: '返回' }).click();
      await page.getByRole('tab', { name: 'ChatGPT' }).click();
      await sleep(600);
      const text = await page.locator('body').innerText();
      for (const expected of [/Codex \/ 5 小时/, /Codex \/ 每周/, /GPT-5\.3-Codex-Spark \/ 每周/, /魔晶石/, /持有 1,250/, /回复药水/, /持有 x3/, /冒险者资质\s*C/]) {
        assert.match(text, expected);
      }
      assert.doesNotMatch(text, /绿宝石|金币|奥义|Fable/);
      await shoot(page.locator('body'), '15-popup-chatgpt');
      await waitFor(() => hudOn(gpt), 'HUD on chatgpt.com');
      await sleep(800);
      await shoot(gpt.locator('web-ai-monitor-hud'), '16-hud-two-vendors');
      await page.getByRole('tab', { name: 'Claude' }).click();
      await page.close();
      await gpt.close();
    });

    await check('refresh interval: the mouse wheel and arrow keys move it, the alarm follows', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true }, pollMinutes: 5 } });
      const page = await app.openPopup();
      await page.getByRole('button', { name: '设置' }).click();
      const range = page.locator('.pix-range input').last();
      await range.hover();
      await page.mouse.wheel(0, -100);
      await page.mouse.wheel(0, -100);
      await page.mouse.wheel(0, -100);
      await waitFor(async () => (await app.storage.get('settings'))?.pollMinutes === 8, 'pollMinutes 8 after three wheel steps');
      await range.focus();
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowRight');
      await waitFor(async () => (await app.storage.get('settings'))?.pollMinutes === 30, 'pollMinutes clamped at 30');
      const alarm = await waitFor(async () => {
        const value = await app.worker.evaluate(() => chrome.alarms.get('wam:poll'));
        return value?.periodInMinutes === 30 && value;
      }, 'the poll alarm at 30 minutes');
      assert.equal(alarm.periodInMinutes, 30);
      assert.match(await page.locator('.pix-range-value').last().innerText(), /30 分钟/);
      await page.close();
    });

    await check('HUD size: 200% doubles the floating window', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true, scale: 1 } } });
      const page = await app.context.newPage();
      await page.goto('https://example.com/');
      await waitFor(() => hudOn(page), 'HUD on example.com');
      await sleep(800);
      const small = await page.locator('web-ai-monitor-hud').boundingBox();
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true, scale: 2 } } });
      await sleep(800);
      const big = await page.locator('web-ai-monitor-hud').boundingBox();
      assert.ok(Math.abs(big.width / small.width - 2) < 0.05, `${small.width} -> ${big.width}`);
      assert.ok(big.x + big.width <= 960 && big.y + big.height <= 600, 'stays inside the window');
      await shoot(page, '12-hud-200');
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true, scale: 1 } } });
      await page.close();
    });

    await check('switching Claude off empties the popup and hides the HUD', async () => {
      await app.storage.set({ settings: { lang: 'zh_CN', hud: { everywhere: true }, disabledProviders: ['claude'] } });
      const page = await app.openPopup();
      assert.match(await page.locator('body').innerText(), /没有正在监控的 AI/);
      await waitFor(async () => !(await hudOn(claude)), 'HUD hidden on claude.ai');
      await page.getByRole('button', { name: '设置' }).click();
      await page.locator('label.pix-check', { hasText: 'Claude' }).click();
      await waitFor(async () => (await app.storage.get('settings'))?.providers?.claude === true, 'Claude back on');
      await waitFor(() => hudOn(claude), 'HUD back on claude.ai');
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
    const soonDay = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    await scene('04-popup-pro-sealed', { lang: 'zh_CN', rankExpiry: { claude: soonDay } }, usageBody({ session: 12, weekly: 40, sessionIn: null, cloud: { limit: 100, used: 0, expiresIn: 2 * DAY }, extra: { enabled: false, used: 0, limit: null } }), 'pro');

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
