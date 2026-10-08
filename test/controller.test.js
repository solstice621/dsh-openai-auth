import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AuthController, authRpcHandler, normalizeQuota } from '../src/auth-controller.js';
import { CodexAppServer } from '../src/app-server.js';

const auth = { token: 'private-access-token', expiresAt: 2000000000000, account: { id: 'private-account-id', email: 'test@example.com', plan: 'pro' } };
const source = () => ({ codexHome: '/test/home', codexCommand: '/test/codex', read: async () => auth, refresh: async () => {} });
const create = options => new AuthController({ source: source(), beforeAuth: async () => {}, childEnvironment: () => ({}), ...options });

test('live connection preference changes state without changing the Codex login', async () => {
  let enabled = true;
  const controller = create({ enabled: () => enabled });
  assert.equal((await controller.getState()).enabled, true);
  enabled = false;
  const disabled = await controller.getState();
  assert.equal(disabled.enabled, false); assert.equal(disabled.connected, true);
});

test('UI state and RPC errors never expose credentials or raw exceptions', async () => {
  const controller = create();
  const state = await controller.getState();
  assert.equal(state.account.email, 'test@example.com');
  assert.equal(state.account.plan, 'pro');
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes(auth.token)); assert.ok(!serialized.includes(auth.account.id));
  assert.equal((await authRpcHandler(controller)('state', { token: 'injected' })).ok, false);
  assert.equal((await authRpcHandler(controller)('constructor', {})).ok, false);
  controller.source.refresh = async () => { throw Error('private-refresh-token'); };
  const error = await authRpcHandler(controller)('refresh', {});
  assert.equal(error.ok, false); assert.ok(!JSON.stringify(error).includes('private-refresh-token'));
});

test('quota prefers multiple buckets, clamps percentages, preserves unknown windows, rejects account mismatch', () => {
  const result = normalizeQuota({ accountId: auth.account.id, rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 2000000 }, secondary: null },
    spark: { primary: { usedPercent: 120 } },
  } }, auth.account.id);
  assert.equal(result[0].primary.usedPercent, 20);
  assert.equal(result[0].secondary, null); assert.equal(result[1].primary.usedPercent, 100);
  assert.equal(result[1].primary.resetsAt, null);
  assert.throws(() => normalizeQuota({ accountId: 'other' }, auth.account.id), /账号已变化/);
});

test('quota closes official server and refuses stale account data after an external switch', async () => {
  let reads = 0, closed = false;
  const controller = create({ source: { ...source(), read: async () => ++reads === 1 ? auth : { ...auth, account: { ...auth.account, id: 'changed' } } },
    createServer: () => ({ initialize: async () => {}, request: async method => method === 'account/read' ? { account: { type: 'chatgpt' } } : { rateLimits: {} }, close: () => { closed = true; } }),
  });
  await assert.rejects(controller.quota(), /账号已变化/); assert.equal(closed, true);
});

test('official login completion and cancellation are tracked without global logout or credential writes', async () => {
  let notification, closed = 0, refreshes = 0;
  const methods = [];
  const controller = create({ source: { ...source(), refresh: async () => { refreshes++; } }, createServer: options => {
    notification = options.onNotification;
    return { initialize: async () => {}, request: async method => {
      methods.push(method);
      return { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=one-time' };
    }, close: () => { closed++; } };
  } });
  assert.equal((await controller.startLogin()).attempt.phase, 'waiting-browser');
  notification('account/login/completed', { loginId: 'other-login', success: true });
  assert.equal((await controller.getState()).attempt.phase, 'waiting-browser');
  notification('account/login/completed', { loginId: 'login-1', success: true });
  assert.equal((await controller.getState()).attempt.phase, 'succeeded');
  assert.equal(closed, 1);
  await controller.startLogin(); await controller.cancelLogin();
  assert.equal((await controller.getState()).attempt.phase, 'cancelled');
  assert.deepEqual(methods, ['account/login/start', 'account/login/start', 'account/login/cancel']);
  assert.equal(refreshes, 0);
});

test('untrusted login URL is rejected and official child is stopped', async () => {
  let closed = false;
  const controller = create({ createServer: () => ({ initialize: async () => {}, request: async () => ({ type: 'chatgpt', loginId: 'id', authUrl: 'https://attacker.example/login' }), close: () => { closed = true; } }) });
  await assert.rejects(controller.startLogin(), /登录地址/); assert.equal(closed, true);
});

test('app-server correlates concurrent calls, uses file storage, sanitizes errors, and cleans up pending calls', async () => {
  let spawned;
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  child.stdin.on('data', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.method === 'initialized') return;
    queueMicrotask(() => child.stdout.write(JSON.stringify(message.method === 'bad' ? { id: message.id, error: { message: 'secret' } } : { id: message.id, result: { method: message.method } }) + '\n'));
  });
  const server = new CodexAppServer({ codexHome: '/test/home', codexCommand: '/test/codex', spawnProcess: (...args) => { spawned = args; return child; } });
  await server.initialize();
  assert.deepEqual(await Promise.all([server.request('one'), server.request('two')]), [{ method: 'one' }, { method: 'two' }]);
  await assert.rejects(server.request('bad'), error => !error.message.includes('secret'));
  assert.equal(spawned[2].shell, false); assert.equal(spawned[2].env.CODEX_HOME, '/test/home');
  assert.ok(spawned[1].includes('cli_auth_credentials_store="file"'));
  server.close(); await assert.rejects(server.request('one'), /已关闭/);
});
