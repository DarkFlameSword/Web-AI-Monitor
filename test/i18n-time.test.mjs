import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTranslator, resolveLang } from '../extension/core/i18n.js';
import { LANGS, MESSAGES } from '../extension/core/messages.js';
import { formatAgo, formatBadgeDuration, formatCountdown, formatCountdownShort } from '../extension/core/time.js';
import { PROVIDERS } from '../extension/providers/index.js';

const zh = createTranslator('zh_CN');
const ja = createTranslator('ja');
const en = createTranslator('en');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('every language has exactly the same keys', () => {
  const reference = Object.keys(MESSAGES.zh_CN).sort();
  for (const lang of LANGS) assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), reference, lang);
});

test('every provider template translates its own strings in every language', () => {
  for (const provider of PROVIDERS) {
    const messages = provider.template.messages ?? {};
    const keys = Object.keys(messages.zh_CN ?? {}).sort();
    for (const lang of LANGS) assert.deepEqual(Object.keys(messages[lang] ?? {}).sort(), keys, `${provider.id} ${lang}`);
  }
});

test('language follows the browser unless chosen, Chinese by default', () => {
  assert.equal(resolveLang('auto', 'zh-TW'), 'zh_CN');
  assert.equal(resolveLang('auto', 'ja-JP'), 'ja');
  assert.equal(resolveLang('auto', 'en-GB'), 'en');
  assert.equal(resolveLang('auto', 'fr-FR'), 'zh_CN');
  assert.equal(resolveLang('en', 'ja'), 'en');
  assert.equal(resolveLang(undefined, ''), 'zh_CN');
});

test('translator formats variables and lets vendor strings in', () => {
  const t = createTranslator('ja', { ja: { 'x.only': '{name} だけ' }, zh_CN: { 'x.zh': '中文' } });
  assert.equal(t('x.only', { name: 'Fable' }), 'Fable だけ');
  assert.equal(t('x.zh'), '中文');
  assert.equal(t('time.resetsIn', { t: '1:00:00' }), '回復まで 1:00:00');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(createTranslator('xx').lang, 'zh_CN');
});

test('countdowns', () => {
  assert.equal(formatCountdown(0, zh), '0:00:00');
  assert.equal(formatCountdown(59 * SEC + 900, zh), '0:00:59');
  assert.equal(formatCountdown(2 * HOUR + 13 * MIN + 45 * SEC, en), '2:13:45');
  assert.equal(formatCountdown(3 * DAY + 4 * HOUR + 12 * MIN + 9 * SEC, zh), '3天 04:12:09');
  assert.equal(formatCountdown(3 * DAY + 4 * HOUR, en), '3d 04:00:00');
  assert.equal(formatCountdown(-5000, en), '0:00:00');
  assert.equal(formatCountdownShort(3 * DAY + 4 * HOUR + 59 * MIN, zh), '3天4时');
  assert.equal(formatCountdownShort(3 * DAY + 4 * HOUR, ja), '3日4時間');
  assert.equal(formatCountdownShort(2 * HOUR + 5 * SEC, en), '2:00:05');
});

test('badge durations stay within four characters', () => {
  assert.equal(formatBadgeDuration(30 * SEC), '1m');
  assert.equal(formatBadgeDuration(45 * MIN), '45m');
  assert.equal(formatBadgeDuration(2 * HOUR + 13 * MIN), '2h');
  assert.equal(formatBadgeDuration(47 * HOUR), '47h');
  assert.equal(formatBadgeDuration(3 * DAY + 4 * HOUR), '3d');
});

test('"updated ago" moves in ten-second steps', () => {
  assert.equal(formatAgo(4 * SEC, zh), '刚刚更新');
  assert.equal(formatAgo(27 * SEC, zh), '20 秒前更新');
  assert.equal(formatAgo(5 * MIN, en), 'Updated 5m ago');
  assert.equal(formatAgo(3 * HOUR, ja), '3時間前に更新');
});
