import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DATA_PRACTICES_VERSION, consentOutdated, hasConsent } from '../extension/core/consent.js';
import { MESSAGES } from '../extension/core/messages.js';
import { normalizeSettings } from '../extension/core/settings.js';

test('nothing is agreed until the user agrees to the current notice', () => {
  const fresh = normalizeSettings(undefined);
  assert.equal(hasConsent(fresh), false, 'a new install has not agreed');
  assert.equal(consentOutdated(fresh), false);

  const agreed = normalizeSettings({ consent: { version: DATA_PRACTICES_VERSION, at: 1 } });
  assert.equal(hasConsent(agreed), true);

  // Agreed to an older notice: the practices changed, so ask again.
  const older = { consent: { version: DATA_PRACTICES_VERSION - 1, at: 1 } };
  if (DATA_PRACTICES_VERSION > 1) {
    assert.equal(hasConsent(normalizeSettings(older)), false);
    assert.equal(consentOutdated(normalizeSettings(older)), true);
  }
  assert.equal(hasConsent(normalizeSettings({ consent: 'yes' })), false, 'malformed is not agreed');
});

test('the notice says the same things in every language', () => {
  const keys = lang => Object.keys(MESSAGES[lang]).filter(key => key.startsWith('consent.')).sort();
  assert.ok(keys('zh_CN').length >= 30);
  assert.deepEqual(keys('ja'), keys('zh_CN'));
  assert.deepEqual(keys('en'), keys('zh_CN'));
  // The facts a reviewer looks for are in each language.
  for (const lang of ['zh_CN', 'ja', 'en']) {
    const text = keys(lang).map(key => MESSAGES[lang][key]).join('\n');
    assert.match(text, /lastActiveOrg/);
    assert.match(text, /claude\.ai/);
    assert.match(text, /chatgpt\.com/);
    assert.match(text, /Anthropic/);
    assert.match(text, /OpenAI/);
  }
});
