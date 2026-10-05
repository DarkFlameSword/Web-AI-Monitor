import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HttpError } from '../extension/core/http.js';
import claude, { detectPlan, parseUsage, pickOrg } from '../extension/providers/claude/provider.js';

const CURRENT_SHAPE = {
  limits: [
    { kind: 'session', group: 'session', percent: 38, resets_at: '2026-10-05T09:40:00Z', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 19, resets_at: '2026-10-09T16:00:00Z', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 0,
      resets_at: '2026-10-09T16:00:00Z',
      scope: { model: { display_name: 'Fable' }, surface: null },
    },
  ],
  five_hour: { utilization: 99, resets_at: '2026-10-05T09:40:00Z' },
};

test('parses the current `limits` shape and ignores the legacy keys next to it', () => {
  assert.deepEqual(parseUsage(CURRENT_SHAPE), [
    { id: 'session', kind: 'session', scope: null, used: 38, resetsAt: '2026-10-05T09:40:00Z' },
    { id: 'weekly_all', kind: 'weekly_all', scope: null, used: 19, resetsAt: '2026-10-09T16:00:00Z' },
    { id: 'weekly_scoped:fable', kind: 'weekly_scoped', scope: 'Fable', used: 0, resetsAt: '2026-10-09T16:00:00Z' },
  ]);
});

test('parses the legacy shape, including unknown seven_day_* keys', () => {
  const meters = parseUsage({
    five_hour: { utilization: 12.5, resets_at: '2026-10-05T09:40:00Z' },
    seven_day: { utilization: 40, resets_at: '2026-10-09T16:00:00Z' },
    seven_day_opus: { utilization: 0, resets_at: null },
    seven_day_new_thing: { utilization: 7, resets_at: '2026-10-09T16:00:00Z' },
    seven_day_oauth_apps: null,
    extra_usage: { utilization: 50, used_credits: 5, monthly_limit: 10 },
    spend: { limit_dollars: 20, utilization: 10 },
  });
  assert.deepEqual(meters.map(m => [m.id, m.kind, m.scope, m.used, m.resetsAt]), [
    ['session', 'session', null, 12.5, '2026-10-05T09:40:00Z'],
    ['weekly_all', 'weekly_all', null, 40, '2026-10-09T16:00:00Z'],
    ['weekly_scoped:opus', 'weekly_scoped', 'Opus', 0, null],
    ['weekly_scoped:new-thing', 'weekly_scoped', 'New thing', 7, '2026-10-09T16:00:00Z'],
  ]);
});

test('falls back to the legacy keys when `limits` is empty', () => {
  const meters = parseUsage({ limits: [], five_hour: { utilization: 3, resets_at: null } });
  assert.deepEqual(meters, [{ id: 'session', kind: 'session', scope: null, used: 3, resetsAt: null }]);
});

test('clamps percentages, drops bad dates, and survives junk', () => {
  const meters = parseUsage({
    limits: [
      { kind: 'session', percent: 140, resets_at: 'not a date' },
      { kind: 'weekly_all', percent: 'n/a' },
      null,
      { percent: 5 },
      { kind: 'weekly_scoped', percent: 1, scope: 'Cowork' },
    ],
  });
  assert.deepEqual(meters, [
    { id: 'session', kind: 'session', scope: null, used: 100, resetsAt: null },
    { id: 'weekly_scoped:cowork', kind: 'weekly_scoped', scope: 'Cowork', used: 1, resetsAt: null },
  ]);
  for (const junk of [null, undefined, 42, 'x', [], {}]) assert.deepEqual(parseUsage(junk), []);
});

test('picks the organization from the cookie, else the first chat organization', () => {
  const orgs = [
    { uuid: 'api-org', capabilities: ['api'] },
    { uuid: 'chat-org', capabilities: ['chat', 'claude_max'] },
    { uuid: 'team-org', capabilities: ['chat', 'raven'] },
  ];
  assert.equal(pickOrg(orgs, 'team-org').uuid, 'team-org');
  assert.equal(pickOrg(orgs, 'gone').uuid, 'chat-org');
  assert.equal(pickOrg(orgs, null).uuid, 'chat-org');
  assert.equal(pickOrg([{ uuid: 'only' }], null).uuid, 'only');
  assert.equal(pickOrg([], null), null);
  assert.equal(pickOrg({ error: 'nope' }, null), null);
});

test('detects the plan from tier and capabilities', () => {
  assert.equal(detectPlan({ rate_limit_tier: 'default_claude_max_20x', capabilities: ['chat', 'claude_max'] }), 'max_20x');
  assert.equal(detectPlan({ rate_limit_tier: 'default_claude_max_5x', capabilities: ['chat', 'claude_max'] }), 'max_5x');
  assert.equal(detectPlan({ capabilities: ['chat', 'claude_max'] }), 'max');
  assert.equal(detectPlan({ capabilities: ['chat', 'claude_pro'] }), 'pro');
  assert.equal(detectPlan({ rate_limit_tier: 'default_raven', capabilities: ['chat', 'raven'] }), 'team');
  assert.equal(detectPlan({ capabilities: ['chat', 'raven'], raven_type: 'enterprise' }), 'enterprise');
  assert.equal(detectPlan({ capabilities: ['chat'] }), 'free');
  assert.equal(detectPlan({ capabilities: ['api'] }), null);
  assert.equal(detectPlan(null), null);
});

function fakeHttp(routes, cookie = null) {
  const calls = [];
  return {
    calls,
    async getJson(path) {
      calls.push(path);
      const answer = routes[path];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new HttpError(404);
      return answer;
    },
    async getCookie() {
      return cookie;
    },
  };
}

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

test('fetchUsage reads the cookie organization and reports its plan', async () => {
  const http = fakeHttp({
    '/api/organizations': [
      { uuid: ORG_A, capabilities: ['chat', 'claude_pro'] },
      { uuid: ORG_B, capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_20x' },
    ],
    [`/api/organizations/${ORG_B}/usage`]: CURRENT_SHAPE,
  }, ORG_B);
  const result = await claude.fetchUsage(http);
  assert.equal(result.plan, 'max_20x');
  assert.equal(result.meters.length, 3);
  assert.deepEqual(http.calls, ['/api/organizations', `/api/organizations/${ORG_B}/usage`]);
});

test('fetchUsage falls back when the cookie organization is not readable', async () => {
  const http = fakeHttp({
    '/api/organizations': [
      { uuid: ORG_A, capabilities: ['chat', 'claude_pro'] },
      { uuid: ORG_B, capabilities: ['api'] },
    ],
    [`/api/organizations/${ORG_B}/usage`]: new HttpError(403),
    [`/api/organizations/${ORG_A}/usage`]: CURRENT_SHAPE,
  }, ORG_B);
  const result = await claude.fetchUsage(http);
  assert.equal(result.plan, 'pro');
  assert.equal(result.meters[0].id, 'session');
});

test('fetchUsage passes sign-in errors through', async () => {
  const http = fakeHttp({ '/api/organizations': new HttpError(401) });
  await assert.rejects(claude.fetchUsage(http), error => error instanceof HttpError && error.status === 401);
});

test('only reply-like requests count as activity, and only allowed paths may be proxied', () => {
  assert.equal(claude.isActivity(`/api/organizations/${ORG_A}/chat_conversations/abc/completion`, 900), true);
  assert.equal(claude.isActivity(`/api/organizations/${ORG_A}/chat_conversations/abc`, 120), false);
  assert.equal(claude.isActivity('/api/some/slow/stream', 5000), true);
  assert.equal(claude.isActivity(`/api/organizations/${ORG_A}/usage`, 5000), false);
  assert.equal(claude.isActivity('/static/app.js', 9000), false);

  const allowed = path => claude.proxyPaths.some(pattern => pattern.test(path));
  assert.equal(allowed('/api/organizations'), true);
  assert.equal(allowed(`/api/organizations/${ORG_A}/usage`), true);
  assert.equal(allowed(`/api/organizations/${ORG_A}/chat_conversations`), false);
  assert.equal(allowed('/api/organizations/../account'), false);
});
