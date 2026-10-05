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
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  DAY,
  HOUR,
  MIN,
  ORG,
  SEC,
  extensionDir,
  grantedBuild,
  hudOn,
  hudText,
  launch,
  overflowing,
  root,
  sleep,
  usageBody,
  waitFor,
} from './harness.mjs';

const outDir = join(root, 'preview-out');

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const results = [];
  // Each check reports as it starts, and fails rather than hangs past its limit.
  const check = async (name, fn, limitMs = 120_000) => {
    const started = Date.now();
    console.log(`...  ${name}`);
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`still running after ${limitMs / 1000} s`)), limitMs);
    });
    try {
      await Promise.race([fn(), late]);
      results.push(`ok   ${name} (${Math.round((Date.now() - started) / 1000)} s)`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    } finally {
      clearTimeout(timer);
      console.log(results.at(-1));
    }
  };
  const shoot = (target, name) => target.screenshot({ path: join(outDir, `${name}.png`) });

  // ------------------------------------------------- default build
  {
    const mock = { usage: usageBody({ session: 38, weekly: 19, fable: 0 }), counts: { worker: 0, page: 0 } };
    // A fresh install: the data use notice is not agreed yet.
    const app = await launch(extensionDir, mock, { consent: false });
    try {
      await check('consent: a welcome tab on install; nothing is read until the user agrees there', async () => {
        const welcome = await waitFor(() => app.context.pages().find(page => page.url().endsWith('/welcome/welcome.html')), 'the welcome tab');
        await app.storage.set({ settings: { lang: 'zh_CN', consent: { version: 0 } } });
        const claude = await app.context.newPage();
        await claude.goto('https://claude.ai/new');
        // A reply finishing on the page must not start anything either.
        await claude.evaluate(() => fetch('/api/organizations/x/chat_conversations/y/completion', { method: 'POST' }).catch(() => null));
        await sleep(2500);
        assert.equal(mock.counts.worker + mock.counts.page, 1, 'only the page itself asked; the extension asked nothing');
        assert.equal(await app.storage.get('snapshot:claude'), undefined, 'no usage stored');
        assert.equal(await hudOn(claude), false, 'no HUD before consent');
        assert.match(await app.ask(() => chrome.action.getTitle({})), /数据说明/);

        const popup = await app.openPopup();
        const text = await popup.locator('body').innerText();
        assert.match(text, /使用前请确认/);
        assert.doesNotMatch(text, /冒险者资质|设置/, 'only the notice, no cards or settings');
        assert.deepEqual(await overflowing(popup), []);
        await shoot(popup.locator('body'), '25-popup-consent');

        await welcome.bringToFront();
        await welcome.evaluate(() => document.fonts.ready);
        await waitFor(async () => /冒险者登记/.test(await welcome.locator('body').innerText()), 'the notice in Chinese');
        for (const expected of [/lastActiveOrg/, /不读取对话内容/, /不修改、绕过或重置任何限额/, /只在内存中/, /与 Anthropic、OpenAI 无关联/]) {
          assert.match(await welcome.locator('body').innerText(), expected);
        }
        await welcome.setViewportSize({ width: 960, height: 1100 });
        assert.doesNotMatch(await welcome.locator('body').innerText(), /\bnull\b|undefined/);
        const card = await welcome.locator('#app').boundingBox();
        assert.ok(Math.abs(card.x + card.width / 2 - 480) <= 2, `the card is centred (${card.x}, ${card.width})`);
        await shoot(welcome, '26-welcome');
        await welcome.getByRole('button', { name: '同意并开始' }).click();
        const snap = await waitFor(async () => {
          const value = await app.storage.get('snapshot:claude');
          return value?.status === 'ok' && value;
        }, 'the first fetch after agreeing');
        assert.equal(snap.plan, 'max_20x');
        await waitFor(() => hudOn(claude), 'HUD after agreeing');
        assert.match(await welcome.locator('body').innerText(), /登记完成/);
        assert.match(await welcome.locator('body').innerText(), /已于 .* 同意数据说明/);
        await popup.reload();
        await sleep(900);
        assert.match(await popup.locator('body').innerText(), /冒险者资质/);
        await popup.close();
        await claude.close();
      });

      await check('consent: withdrawing stops reading and deletes the usage data; agreeing again resumes', async () => {
        const claude = await app.context.newPage();
        await claude.goto('https://claude.ai/new');
        await waitFor(() => hudOn(claude), 'HUD on claude.ai');
        const popup = await app.openPopup();
        await popup.getByRole('button', { name: '设置' }).click();
        await popup.getByRole('button', { name: '撤回同意' }).click();
        await waitFor(async () => (await app.storage.get('snapshot:claude')) === undefined, 'usage data deleted');
        await waitFor(async () => !(await hudOn(claude)), 'HUD hidden');
        assert.match(await popup.locator('body').innerText(), /使用前请确认/);
        const asked = mock.counts.worker + mock.counts.page;
        await popup.close();
        const again = await app.openPopup();
        await sleep(1500);
        assert.equal(mock.counts.worker + mock.counts.page, asked, 'opening the popup reads nothing');
        await again.getByRole('button', { name: '同意并开始' }).click();
        await waitFor(async () => (await app.storage.get('snapshot:claude'))?.status === 'ok', 'fetched again');
        await waitFor(() => hudOn(claude), 'HUD back');
        await again.close();
        await claude.close();
      });

      await check('default build: HUD on claude.ai, none elsewhere, nothing registered', async () => {
        const claude = await app.context.newPage();
        await claude.goto('https://claude.ai/new');
        await waitFor(() => hudOn(claude), 'HUD on claude.ai');
        const other = await app.context.newPage();
        await other.goto('https://example.com/');
        await sleep(1500);
        assert.equal(await other.locator('web-ai-monitor-hud').count(), 0, 'HUD injected without permission');
        const registered = await app.ask(() => chrome.scripting.getRegisteredContentScripts());
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
      const registered = await app.ask(() => chrome.scripting.getRegisteredContentScripts());
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
      // Clear sits in the calendar's footer while a date is set.
      await page.getByRole('button', { name: '设置' }).click();
      await page.getByRole('button', { name: 'Claude 订阅过期时间' }).click();
      await calendar.getByRole('button', { name: '清除' }).click();
      await waitFor(async () => !(await app.storage.get('settings'))?.rankExpiry?.claude, 'cleared date');
      await page.getByRole('button', { name: 'Claude 订阅过期时间' }).click();
      assert.equal(await calendar.getByRole('button', { name: '清除' }).isHidden(), true, 'nothing to clear');
      // Delete on the focused day clears too.
      await calendar.locator(`[data-day="${day}"]`).click();
      await waitFor(async () => (await app.storage.get('settings'))?.rankExpiry?.claude === day, 'saved again');
      await page.getByRole('button', { name: 'Claude 订阅过期时间' }).click();
      await page.keyboard.press('Delete');
      await waitFor(async () => !(await app.storage.get('settings'))?.rankExpiry?.claude, 'cleared with Delete');
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
      await page.close();
      await gpt.close();
    });

    await check('the popup tab picks the vendor the HUD and the toolbar icon show', async () => {
      const gpt = await app.context.newPage();
      await gpt.goto('https://chatgpt.com/');
      const other = await app.context.newPage();
      await other.goto('https://example.com/');
      await waitFor(() => hudOn(gpt), 'HUD on chatgpt.com');
      await waitFor(() => hudOn(other), 'HUD on example.com');
      const page = await app.openPopup();
      const shows = async (target, vendor) => {
        // The HUD card is compact: vendor, rank, plan, then its gauges.
        const lines = (await hudText(target)).split('\n');
        return vendor === 'chatgpt'
          ? lines[0] === 'ChatGPT' && lines.includes('Plus') && lines.includes('HP') && !lines.includes('SP')
          : lines[0] === 'Claude' && lines.includes('SP') && !lines.includes('ChatGPT');
      };

      await page.getByRole('tab', { name: 'ChatGPT' }).click();
      await waitFor(async () => (await app.storage.get('settings'))?.activeProvider === 'chatgpt', 'ChatGPT saved as the vendor on show');
      await waitFor(() => shows(gpt, 'chatgpt'), 'the chatgpt.com HUD on the ChatGPT panel');
      await waitFor(() => shows(other, 'chatgpt'), 'the example.com HUD on the ChatGPT panel');
      await waitFor(async () => (await app.ask(() => chrome.action.getTitle({}))).startsWith('ChatGPT'), 'toolbar on ChatGPT');
      await sleep(500);
      await shoot(gpt.locator('web-ai-monitor-hud'), '16-hud-chatgpt');

      await page.getByRole('tab', { name: 'Claude' }).click();
      await waitFor(() => shows(gpt, 'claude'), 'the chatgpt.com HUD back on the Claude panel');
      await waitFor(() => shows(other, 'claude'), 'the example.com HUD back on the Claude panel');
      await waitFor(async () => (await app.ask(() => chrome.action.getTitle({}))).startsWith('Claude'), 'toolbar on Claude');
      await sleep(500);
      await shoot(gpt.locator('web-ai-monitor-hud'), '17-hud-claude');

      // Collapsed, the chip has no SP bar for a vendor without one.
      await page.getByRole('tab', { name: 'ChatGPT' }).click();
      await waitFor(() => shows(other, 'chatgpt'), 'the HUD on ChatGPT again');
      const settings = await app.storage.get('settings');
      await app.storage.set({ settings: { ...settings, hud: { ...settings.hud, collapsed: true } } });
      await sleep(600);
      await shoot(other.locator('web-ai-monitor-hud'), '18-chip-chatgpt');
      await app.storage.set({ settings: { ...settings, activeProvider: 'claude' } });
      await page.close();
      await gpt.close();
      await other.close();
    });

    await check('the popup and its settings fit the card in every language, dates set, calendar open', async () => {
      const settings = await app.storage.get('settings');
      const later = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
      for (const lang of ['zh_CN', 'ja', 'en']) {
        await app.storage.set({ settings: { ...settings, lang, rankExpiry: { claude: later(29), chatgpt: later(12) } } });
        const page = await app.openPopup();
        for (const tab of ['Claude', 'ChatGPT']) {
          await page.getByRole('tab', { name: tab }).click();
          await sleep(300);
          assert.deepEqual(await overflowing(page), [], `${lang} ${tab} card`);
        }
        await page.locator('.guild-cmds .cmd').last().click(); // settings
        await sleep(300);
        assert.deepEqual(await overflowing(page), [], `${lang} settings`);
        await shoot(page.locator('body'), `27-settings-${lang}`);
        await page.locator('.pix-date-btn').first().click();
        await page.getByRole('dialog').first().waitFor();
        assert.deepEqual(await overflowing(page), [], `${lang} calendar`);
        await page.close();
        // And the short data use notice, before agreeing.
        await app.storage.set({ settings: { ...settings, lang, consent: { version: 0 } } });
        const notice = await app.openPopup();
        assert.deepEqual(await overflowing(notice), [], `${lang} notice`);
        await notice.close();
      }
      await app.storage.set({ settings });
    });

    await check('English screenshots: both vendors in the popup and the HUD, settings, calendar', async () => {
      const settings = await app.storage.get('settings');
      const later = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
      await app.storage.set({
        settings: { ...settings, lang: 'en', activeProvider: 'claude', hud: { ...settings.hud, collapsed: false }, rankExpiry: { claude: later(29), chatgpt: later(12) } },
      });
      const other = await app.context.newPage();
      await other.goto('https://example.com/');
      await waitFor(() => hudOn(other), 'HUD on example.com');
      const page = await app.openPopup();
      assert.match(await page.locator('body').innerText(), /Adventurer rank/);
      await shoot(page.locator('body'), '19-en-popup-claude');
      await waitFor(async () => (await hudText(other)).startsWith('Claude'), 'HUD on Claude');
      await sleep(500);
      await shoot(other.locator('web-ai-monitor-hud'), '20-en-hud-claude');

      await page.getByRole('tab', { name: 'ChatGPT' }).click();
      await sleep(600);
      assert.match(await page.locator('body').innerText(), /Mana crystal/);
      await shoot(page.locator('body'), '21-en-popup-chatgpt');
      await waitFor(async () => (await hudText(other)).startsWith('ChatGPT'), 'HUD on ChatGPT');
      await sleep(500);
      await shoot(other.locator('web-ai-monitor-hud'), '22-en-hud-chatgpt');

      await page.getByRole('button', { name: 'Settings' }).click();
      await sleep(400);
      await shoot(page.locator('body'), '23-en-settings');
      await page.locator('.pix-date-btn').first().click();
      await page.getByRole('dialog').first().waitFor();
      await page.waitForTimeout(200);
      await shoot(page.locator('body'), '24-en-calendar');

      await app.storage.set({ settings: { ...settings, activeProvider: 'claude' } });
      await page.close();
      await other.close();
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
        const value = await app.ask(() => chrome.alarms.get('wam:poll'));
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
        const all = await app.ask(() => chrome.notifications.getAll());
        const found = Object.keys(all).filter(id => id.startsWith('wam:recovered:claude:'));
        return found.length && found;
      }, 'a recovery notification');
      assert.equal(ids.length, 1);
      // Asking again for the same window must not notify twice.
      const again = await app.storage.get('snapshot:claude');
      await app.storage.set({ 'snapshot:claude': { ...again, meters: snap.meters.map(m => (m.id === 'session' ? { ...m, used: 55, resetsAt: ended } : m)), attemptedAt: 0 } });
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wam:refresh', reason: 'manual' }));
      await sleep(800);
      const all = await app.ask(() => chrome.notifications.getAll());
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
      const title = await app.ask(() => chrome.action.getTitle({}));
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
