// Renders the Chrome Web Store listing images into docs/store/images/:
//
//   <locale>/screenshot-1..5.png   1280x800, per store locale
//   promo-small.png                440x280  (small promo tile)
//   promo-marquee.png              1400x560 (marquee promo tile)
//   store-icon.png                 128x128
//
// Promo tiles cannot be localized in the store, so they carry only the
// name and the icon (and an English HUD on the marquee).
//
// The popup and the page HUD in them are the extension's own, captured from
// Chromium against the mocked vendor sites (scripts/harness.mjs). Captions
// are set in the full Fusion Pixel Font, so they are not limited to the
// glyphs the extension ships.
//
//   npm run store:assets
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';

import { DAY, grantedBuild, hudOn, hudText, launch, root, sleep, usageBody, waitFor } from './harness.mjs';
import { chromium } from './playwright.mjs';

const outDir = join(root, 'docs', 'store', 'images');
const FONT_PACKAGE = '@vp-tw/cjk-web-fonts-fusion-pixel-font@0.0.1';

/** Listing copy per store locale. Lines are short so no caption ever wraps into an image. */
const COPY = {
  zh_CN: {
    lang: 'zh_CN',
    font: ['zh_hans', 'Simplified Chinese'],
    shots: [
      { title: 'AI 用量，一眼看清', lines: ['魔力 MP：当前会话', '体力 HP：每周全部模型', '奥义 SP：每周 Fable', '都显示剩余量和恢复倒计时'] },
      { title: '页内悬浮窗', lines: ['在 claude.ai 上直接显示', '授权后可在任意网页显示', '可拖动、收起', '大小 100% - 200%'] },
      { title: '每家 AI 一套方案', lines: ['Claude：绿宝石、金币', 'ChatGPT：魔晶石、回复药水', 'ChatGPT 按需开启', '冒险者资质按订阅方案评定'] },
      { title: '悬浮窗跟着切换', lines: ['在弹窗里切换 AI', '悬浮窗随之切换', '工具栏图标随之切换', '收起后只留迷你能量条'] },
      { title: '像素风设置', lines: ['选择监控哪些 AI', '填写订阅过期时间', '悬浮窗、通知、刷新间隔', '数据只保存在本机'] },
    ],
  },
  en: {
    lang: 'en',
    font: ['zh_hans', 'Simplified Chinese'],
    shots: [
      { title: 'Your AI limits at a glance', lines: ['MP Mana: current session', 'HP Health: weekly limit', 'SP Ultimate: weekly Fable', 'Live reset countdowns'] },
      { title: 'A HUD on the page', lines: ['Shown on claude.ai', 'Any site, if you allow it', 'Drag it or collapse it', 'Size 100% - 200%'] },
      { title: 'One scheme per AI', lines: ['Claude: emeralds, gold', 'ChatGPT: crystals, potions', 'ChatGPT is opt-in', 'Rank comes from your plan'] },
      { title: 'The HUD follows along', lines: ['Switch AI in the popup', 'The HUD switches too', 'So does the toolbar icon', 'Collapse to mini gauges'] },
      { title: 'Pixel settings', lines: ['Pick which AI to monitor', 'Set when your plan ends', 'HUD, alerts, refresh rate', 'Data stays in this browser'] },
    ],
  },
  ja: {
    lang: 'ja',
    font: ['ja', 'Japanese'],
    shots: [
      { title: 'AI の残量がひと目で', lines: ['魔力 MP：現在のセッション', '体力 HP：週間・全モデル', '奥義 SP：週間 Fable', '残量と回復までの時間を表示'] },
      { title: 'ページ上の HUD', lines: ['claude.ai ではそのまま表示', '許可すればどのサイトでも', 'ドラッグ・折りたたみ可能', 'サイズ 100% - 200%'] },
      { title: 'AI ごとに専用の表示', lines: ['Claude：エメラルド、金貨', 'ChatGPT：魔晶石、回復薬', 'ChatGPT は任意で有効化', 'ランクはプランで決定'] },
      { title: 'HUD も一緒に切り替え', lines: ['ポップアップで AI を切替', 'HUD も同時に切り替わる', 'アイコンも同時に切り替わる', '折りたたむとミニゲージ'] },
      { title: 'ピクセル風の設定', lines: ['監視する AI を選ぶ', 'サブスクの終了日を入力', 'HUD・通知・更新間隔', 'データはこのブラウザだけに'] },
    ],
  },
};

// ------------------------------------------------------------ font

/** The upstream font, split into unicode-range blocks, as build-font.py fetches it. */
function fontPackage() {
  const cache = join(root, '.cache');
  const dir = join(cache, 'package');
  if (existsSync(dir)) return dir;
  mkdirSync(cache, { recursive: true });
  // On Windows npm is npm.cmd, which only starts through a shell.
  const tarball = execFileSync('npm', ['pack', FONT_PACKAGE, '--silent'], { cwd: cache, encoding: 'utf8', shell: process.platform === 'win32' })
    .trim().split(/\r?\n/).pop();
  execFileSync('tar', ['-xzf', tarball], { cwd: cache });
  return dir;
}

// --------------------------------------------------------- capture

/** The extension's popup and HUD in every state the images need, for one locale at one scale. */
async function capture(app, locale, scale) {
  const shots = {};
  const later = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
  const base = {
    lang: locale.lang,
    hud: { enabled: true, everywhere: true, collapsed: false, scale: 1 },
    rankExpiry: { claude: later(29), chatgpt: later(12) },
  };
  const shoot = async (target, name) => { shots[name] = await target.screenshot({ type: 'png', omitBackground: true }); };

  // Claude alone: the gauges, pouch hidden, for the first image.
  await app.storage.set({ settings: { ...base, providers: { chatgpt: false }, activeProvider: 'claude' } });
  let page = await app.openPopup();
  await page.addStyleTag({ content: '.pouch, .card-foot { display: none !important; }' });
  await sleep(200);
  await shoot(page.locator('body'), 'gauges');
  await page.close();

  // Both vendors: their full cards, the settings, the calendar.
  await app.storage.set({ settings: { ...base, providers: { chatgpt: true }, activeProvider: 'claude' } });
  page = await app.openPopup();
  await waitFor(async () => (await app.storage.get('snapshot:chatgpt'))?.status === 'ok', 'ChatGPT data');
  await page.getByRole('tab', { name: 'Claude' }).click();
  await sleep(300);
  await shoot(page.locator('body'), 'claude');
  await page.getByRole('tab', { name: 'ChatGPT' }).click();
  await sleep(300);
  await shoot(page.locator('body'), 'chatgpt');
  await page.locator('.guild-cmds .cmd').last().click();
  await sleep(300);
  await shoot(page.locator('body'), 'settings');
  await page.locator('.pix-date-btn').first().click();
  await page.getByRole('dialog').first().waitFor();
  await sleep(200);
  await shoot(page.locator('body'), 'calendar');
  await page.close();

  // The HUD for each vendor, open and collapsed.
  const tab = await app.context.newPage();
  await tab.goto('https://example.com/');
  await waitFor(() => hudOn(tab), 'HUD');
  // A transparent page, so the HUD's notched corners keep the stage behind them.
  await tab.addStyleTag({ content: 'html, body { background: transparent !important; } main { visibility: hidden; }' });
  for (const id of ['claude', 'chatgpt']) {
    const name = id === 'claude' ? 'Claude' : 'ChatGPT';
    await app.storage.set({ settings: { ...base, providers: { chatgpt: true }, activeProvider: id } });
    await waitFor(async () => (await hudText(tab)).startsWith(name), `HUD on ${name}`);
    await sleep(400);
    await shoot(tab.locator('web-ai-monitor-hud'), `hud-${id}`);
    await app.storage.set({ settings: { ...base, providers: { chatgpt: true }, activeProvider: id, hud: { ...base.hud, collapsed: true } } });
    await sleep(500);
    await shoot(tab.locator('web-ai-monitor-hud'), `chip-${id}`);
  }
  await tab.close();
  await app.storage.set({ settings: { ...base, providers: { chatgpt: true }, activeProvider: 'claude' } });
  return Object.fromEntries(Object.entries(shots).map(([name, png]) => [`${name}@${scale}x`, png]));
}

async function captureAll(scale) {
  const build = grantedBuild();
  const mock = {
    usage: usageBody({ session: 35, weekly: 22, fable: 8 }),
    counts: { worker: 0, page: 0 },
    chatgptToken: 'header.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC0xIn19.sig',
  };
  const app = await launch(build, mock, { deviceScaleFactor: scale });
  try {
    // The vendor tabs carry the requests the mocks refuse to the worker.
    for (const url of ['https://claude.ai/new', 'https://chatgpt.com/']) await (await app.context.newPage()).goto(url);
    await sleep(1200);
    // With no snapshot, the popup's own refresh goes through the tabs now open.
    await app.storage.set({ settings: { providers: { chatgpt: true }, hud: { everywhere: true } }, 'snapshot:claude': null, 'snapshot:chatgpt': null });
    const popup = await app.openPopup();
    for (const id of ['claude', 'chatgpt']) {
      await waitFor(async () => (await app.storage.get(`snapshot:${id}`))?.status === 'ok', `${id} data`);
    }
    await popup.close();
    const out = {};
    for (const [id, locale] of Object.entries(COPY)) out[id] = await capture(app, locale, scale);
    return out;
  } finally {
    await app.close();
  }
}

// ----------------------------------------------------------- stage

const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function stageCss(locale) {
  const [variant, family] = locale.font;
  return `
@import url("/fonts/${variant}/Fusion-Pixel-12px-Proportional-${family.replace(/ /g, '-')}.css");
@import url("/fonts/latin/Fusion-Pixel-12px-Proportional-Latin.css");
* { box-sizing: border-box; }
html, body { margin: 0; background: #2b1a0d; }
body {
  font-family: "Fusion Pixel 12px Proportional ${family}", "Fusion Pixel 12px Proportional Latin", monospace;
  -webkit-font-smoothing: none;
  font-synthesis: none;
}
.stage { position: relative; overflow: hidden; color: #3b2412;
  background:
    linear-gradient(45deg, rgba(255,255,255,0.025) 25%, transparent 25% 75%, rgba(255,255,255,0.025) 75%) 0 0 / 16px 16px,
    #2b1a0d; }
img { display: block; }
.pixel { image-rendering: pixelated; }
/* The guild card's notched pixel frame, at 2x. */
.parchment { background: #f2e3c4;
  box-shadow: 0 -4px 0 0 #5b3a1e, 0 4px 0 0 #5b3a1e, -4px 0 0 0 #5b3a1e, 4px 0 0 0 #5b3a1e, 8px 8px 0 0 #1c1008; }
.caption { position: absolute; left: 56px; top: 50%; transform: translateY(-50%); width: 440px; padding: 32px 32px 28px; }
.caption h1 { margin: 0 0 20px; font-size: 36px; line-height: 48px; font-weight: 400; color: #3b2412; }
.caption p { margin: 0; font-size: 24px; line-height: 40px; color: #74553a; white-space: nowrap; }
.caption p::before { content: ''; display: inline-block; width: 8px; height: 8px; margin: 0 14px 4px 0; background: #9e2b25; vertical-align: middle; }
.media { position: absolute; left: 544px; right: 40px; top: 40px; bottom: 40px; display: flex; align-items: center; justify-content: center; gap: 32px; }
.media .col { display: flex; flex-direction: column; align-items: center; gap: 32px; }
.media .row { display: flex; align-items: flex-end; gap: 24px; }
`;
}

/** A plain browser window around a page, for the HUD-on-a-page image. */
function browserScene(images, caption) {
  const lines = widths => widths.map(width => `<div class="sk" style="width:${width}%"></div>`).join('');
  return `
<style>
.win { position: absolute; inset: 0; background: #fafafa; }
.tabs { height: 40px; background: #dee1e6; display: flex; align-items: flex-end; padding-left: 16px; }
.tab { width: 220px; height: 32px; background: #fafafa; border-radius: 8px 8px 0 0; }
.bar { height: 44px; background: #fafafa; border-bottom: 1px solid #dadce0; display: flex; align-items: center; gap: 16px; padding: 0 16px; }
.url { flex: 1; height: 30px; border-radius: 15px; background: #f1f3f4; }
.icon { width: 32px; height: 32px; }
.page { position: absolute; left: 0; right: 0; top: 84px; bottom: 0; }
.article { position: absolute; left: 520px; width: 300px; top: 56px; }
.article .h { height: 28px; width: 80%; background: #c7c7c7; margin-bottom: 32px; }
.article .sk { height: 12px; background: #e3e3e3; margin-bottom: 20px; }
.page .caption { top: 56px; transform: none; }
.hud { position: absolute; right: 32px; bottom: 32px; }
</style>
<div class="win">
  <div class="tabs"><div class="tab"></div></div>
  <div class="bar"><div class="url"></div><img class="icon pixel" src="/icon.png" alt=""></div>
  <div class="page">
    ${caption}
    <div class="article"><div class="h"></div>${lines([100, 92, 96, 70, 100, 88, 94, 60])}<div class="h" style="margin-top:40px;width:60%"></div>${lines([100, 90, 96, 84, 52])}</div>
    <img class="hud" src="${images.hud}" alt="">
  </div>
</div>`;
}

function captionHtml(shot) {
  return `<div class="caption parchment"><h1>${esc(shot.title)}</h1>${shot.lines.map(line => `<p>${esc(line)}</p>`).join('')}</div>`;
}

function screenshotHtml(index, locale, img) {
  const shot = locale.shots[index];
  const caption = captionHtml(shot);
  switch (index) {
    case 0:
      return `${caption}<div class="media">${img('gauges@2x')}</div>`;
    case 1:
      return browserScene({ hud: `/img/hud-claude@2x.png` }, caption);
    case 2:
      return `${caption}<div class="media">${img('claude@1x')}${img('chatgpt@1x')}</div>`;
    case 3:
      return `${caption}<div class="media"><div class="col">
        <div class="row">${img('hud-claude@2x')}${img('chip-claude@2x')}</div>
        <div class="row">${img('hud-chatgpt@2x')}${img('chip-chatgpt@2x')}</div></div></div>`;
    default:
      return `${caption}<div class="media">${img('settings@1x')}${img('calendar@1x')}</div>`;
  }
}

function promoHtml(kind) {
  if (kind === 'small') {
    return `
<style>
.tile { position: absolute; left: 24px; top: 24px; right: 32px; bottom: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.tile .icon { width: 96px; height: 96px; flex: none; margin-bottom: 12px; }
.tile h1 { margin: 0; font-size: 24px; line-height: 32px; font-weight: 400; color: #3b2412; white-space: nowrap; }
.tile h2 { margin: 4px 0 0; font-size: 24px; line-height: 32px; font-weight: 400; color: #9e2b25; white-space: nowrap; }
</style>
<div class="tile parchment"><img class="icon pixel" src="/icon.png" alt=""><h1>Web AI Monitor</h1></div>`;
  }
  return `
<style>
.tile { position: absolute; left: 56px; top: 56px; bottom: 64px; width: 780px; display: flex; align-items: center; gap: 48px; padding: 0 48px; }
.tile .icon { width: 192px; height: 192px; flex: none; }
.tile h1 { margin: 0; font-size: 48px; line-height: 64px; font-weight: 400; color: #3b2412; white-space: nowrap; }
.tile h2 { margin: 8px 0 0; font-size: 36px; line-height: 48px; font-weight: 400; color: #9e2b25; white-space: nowrap; }
.tile p { margin: 24px 0 0; font-size: 24px; line-height: 32px; color: #74553a; white-space: nowrap; }
.side { position: absolute; left: 880px; right: 40px; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; }
</style>
<div class="tile parchment"><img class="icon pixel" src="/icon.png" alt=""><div><h1>Web AI Monitor</h1></div></div>
<div class="side"><img src="/img/hud-claude@2x.png" alt=""></div>`;
}

const SIZES = { screenshot: [1280, 800], small: [440, 280], marquee: [1400, 560] };

async function render(browser, captures, fonts) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let current = { html: '', images: {}, css: '' };
  await page.route('https://stage.local/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>${current.css}</style>${current.html}` });
    }
    if (pathname === '/icon.png') return route.fulfill({ path: join(root, 'extension', 'assets', 'icons', 'icon-16.png') });
    if (pathname.startsWith('/img/')) {
      const png = current.images[decodeURIComponent(pathname.slice(5, -4))];
      return png ? route.fulfill({ contentType: 'image/png', body: png }) : route.fulfill({ status: 404 });
    }
    if (pathname.startsWith('/fonts/')) {
      const file = join(fonts, decodeURIComponent(pathname.slice(7)));
      const type = { '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ?? 'application/octet-stream';
      return existsSync(file) ? route.fulfill({ contentType: type, body: readFileSync(file) }) : route.fulfill({ status: 404 });
    }
    return route.fulfill({ status: 404 });
  });

  const draw = async (file, [width, height], locale, inner, images) => {
    current = {
      css: stageCss(locale),
      images,
      html: `<div class="stage" style="width:${width}px;height:${height}px">${inner}</div>`,
    };
    await page.setViewportSize({ width, height });
    await page.goto('https://stage.local/');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    // Nothing may cross the stage's edge or lie on top of another block.
    const clash = await page.evaluate(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.caption, .tile, .media img, .side img, .hud, .article')]
        .map(el => ({ el, r: el.getBoundingClientRect() }));
      const out = blocks.filter(({ r }) => r.left < stage.left || r.top < stage.top || r.right > stage.right || r.bottom > stage.bottom)
        .map(({ el }) => `outside: ${el.className || el.tagName}`);
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          const a = blocks[i].r;
          const b = blocks[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            out.push(`overlap: ${blocks[i].el.className || blocks[i].el.tagName} / ${blocks[j].el.className || blocks[j].el.tagName}`);
          }
        }
      }
      // Every line of text stays inside its card, with the card's padding.
      for (const el of document.querySelectorAll('.caption h1, .caption p, .tile h1, .tile h2, .tile p')) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const card = el.closest('.caption, .tile');
        const box = card.getBoundingClientRect();
        const pad = parseFloat(window.getComputedStyle(card).paddingLeft) || 16;
        if (text.left < box.left + pad - 1 || text.right > box.right - pad + 1 || text.top < box.top || text.bottom > box.bottom) {
          out.push(`text leaves its card: "${el.textContent}"`);
        }
      }
      return out;
    });
    if (clash.length) throw new Error(`${file}: ${clash.join(', ')}`);
    mkdirSync(join(file, '..'), { recursive: true });
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
    console.log(`wrote ${file.slice(root.length + 1)}`);
  };

  for (const [id, locale] of Object.entries(COPY)) {
    const shots = captures[id];
    const images = Object.fromEntries(Object.entries(shots).map(([name, png]) => [name, png]));
    // A capture is shown at its own size: @2x ones at twice the popup's size, @1x ones as the popup is.
    const img = name => `<img src="/img/${encodeURIComponent(name)}.png" alt="">`;
    for (let i = 0; i < locale.shots.length; i += 1) {
      await draw(join(outDir, id, `screenshot-${i + 1}.png`), SIZES.screenshot, locale, screenshotHtml(i, locale, img), images);
    }
  }
  const en = captures.en;
  await draw(join(outDir, 'promo-small.png'), SIZES.small, COPY.en, promoHtml('small'), en);
  await draw(join(outDir, 'promo-marquee.png'), SIZES.marquee, COPY.en, promoHtml('marquee'), en);
  await page.close();
}

async function main() {
  const fonts = join(fontPackage(), 'dist', '12px', 'proportional');
  // Start clean, so an image the script no longer makes cannot linger.
  rmSync(outDir, { recursive: true, force: true });
  const one = await captureAll(1);
  const two = await captureAll(2);
  const captures = Object.fromEntries(Object.keys(COPY).map(id => [id, { ...one[id], ...two[id] }]));
  const browser = await chromium.launch({ headless: true });
  try {
    await render(browser, captures, fonts);
  } finally {
    await browser.close();
  }
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(root, 'extension', 'assets', 'icons', 'icon-128.png'), join(outDir, 'store-icon.png'));
  console.log('wrote docs/store/images/store-icon.png');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
