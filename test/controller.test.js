import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AuthController, authRpcHandler, normalizeQuota } from '../src/auth-controller.js';
import { CodexAppServer } from '../src/app-server.js';
import { accountKey } from '../src/quota-cache.js';

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

test('model refresh RPC returns safe sync state and observes login identity', async () => {
  let refreshed = 0, observed;
  const controller = create({ modelSync: {
    observeAccount: id => { observed = id; return false; },
    state: () => ({ automatic: true, totalModels: 9, source: 'codex' }),
    refresh: async () => { refreshed++; },
  } });
  const result = await authRpcHandler(controller)('models', {});
  assert.equal(result.ok, true); assert.equal(refreshed, 1); assert.equal(observed, auth.account.id);
  assert.equal(result.value.models.totalModels, 9);
  assert(!JSON.stringify(result).includes(auth.token)); assert(!JSON.stringify(result).includes(auth.account.id));
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

test('a successful quota read is remembered for that account and reused without the app-server', async () => {
  const writes = [];
  const store = { value: null, read: async () => store.value, write: async value => { writes.push(value); store.value = value; } };
  let account = 'private-account-id', opens = 0;
  const controller = create({
    source: { ...source(), read: async () => ({ ...auth, account: { ...auth.account, id: account } }) },
    quotaStore: store, now: () => 5000,
    createServer: () => { opens++; return { initialize: async () => {}, close: () => {}, request: async method => method === 'account/read'
      ? { account: { type: 'chatgpt' } }
      : { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 2000 } } } }; },
  });
  const value = await controller.quota();
  assert.equal(value.buckets[0].primary.usedPercent, 10);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].version, 1);
  assert.equal(writes[0].fetchedAt, 5000);
  assert.equal(writes[0].accountKey, accountKey(auth.account.id));
  assert.ok(!JSON.stringify(writes[0]).includes(auth.account.id));

  const opensAfterQuota = opens;
  const cached = await controller.cachedQuota();
  assert.equal(cached.cached, true);
  assert.equal(cached.fetchedAt, 5000);
  assert.equal(cached.buckets[0].primary.usedPercent, 10);
  assert.equal(opens, opensAfterQuota);

  // Another account's snapshot is not this account's quota.
  account = 'changed-account';
  assert.equal(await controller.cachedQuota(), null);
});

test('the cached quota RPC answers from an empty cache without touching Codex', async () => {
  let opens = 0;
  const controller = create({ quotaStore: { read: async () => null, write: async () => {} }, createServer: () => { opens++; return {}; } });
  const handler = authRpcHandler(controller);
  const empty = await handler('cached', {});
  assert.equal(empty.ok, true);
  assert.equal(empty.value, null);
  assert.equal(opens, 0);
  assert.equal((await handler('cached', { token: 'injected' })).ok, false);
  assert.equal((await handler('nope', {})).ok, false);
});

test('a quota read survives an unwritable cache and a missing cache never breaks the page', async () => {
  const controller = create({
    quotaStore: { read: async () => null, write: async () => { throw Error('disk full'); } },
    createServer: () => ({ initialize: async () => {}, close: () => {}, request: async method => method === 'account/read'
      ? { account: { type: 'chatgpt' } } : { rateLimits: { primary: { usedPercent: 3 } } } }),
  });
  assert.equal((await controller.quota()).buckets[0].primary.usedPercent, 3);
  const bare = create();
  assert.equal(await bare.cachedQuota(), null);
});

test('the settings layout preference is reported without exposing raw configuration', async () => {
  assert.equal((await create().getState()).showModelSync, true);
  assert.equal((await create({ showModelSync: false }).getState()).showModelSync, false);
  const offline = create({ showModelSync: false, source: { ...source(), read: async () => { throw Object.assign(Error('none'), { code: 'CODEX_AUTH_REQUIRED' }); } } });
  assert.equal((await offline.getState()).showModelSync, false);
  assert.equal((await authRpcHandler(create({ showModelSync: false }))('state', {})).value.showModelSync, false);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const quotaServer = (gate, onClose = () => {}) => ({ initialize: async () => {}, close: onClose,
  request: async method => method === 'account/read' ? { account: { type: 'chatgpt', id: auth.account.id } }
    : (await gate.promise, { rateLimits: { primary: { usedPercent: 15 } } }),
});

test('manual and background quota reads share one official server and one cache write', async () => {
  const gate = deferred(); let opens = 0, writes = 0;
  const controller = create({ createServer: () => { opens++; return quotaServer(gate); },
    quotaStore: { write: async () => { writes++; } } });
  const background = controller.quota(), manual = controller.quota();
  assert.equal(background, manual);
  gate.resolve(); const values = await Promise.all([background, manual]);
  assert.equal(opens, 1); assert.equal(writes, 1); assert.equal(values[0].buckets[0].primary.usedPercent, 15);
});

test('disabled or disposed quota operations cannot start a CLI or save late replies', async () => {
  let opens = 0;
  const disabled = create({ enabled: false, createServer: () => { opens++; } });
  await assert.rejects(disabled.quota(), error => error.code === 'CODEX_CONNECTION_DISABLED');
  assert.equal(opens, 0);
  const gate = deferred(), started = deferred(); let writes = 0, closed = 0;
  const controller = create({ createServer: () => { started.resolve(); return quotaServer(gate, () => { closed++; }); },
    quotaStore: { write: async () => { writes++; } } });
  const pending = controller.quota(); await started.promise;
  controller.dispose(); gate.resolve();
  await assert.rejects(pending, error => error.code === 'CODEX_CANCELLED');
  assert.equal(writes, 0); assert.ok(closed > 0);
  await assert.rejects(controller.quota(), error => error.code === 'CODEX_CANCELLED');
});

test('a failed coalesced quota request can retry without destroying the existing snapshot', async () => {
  let requests = 0, writes = 0;
  const controller = create({ createServer: () => ({ initialize: async () => {}, close: () => {},
    request: async method => { if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (++requests === 1) throw Error('unreachable');
      return { rateLimits: { primary: { usedPercent: 5 } } }; } }),
    quotaStore: { write: async () => { writes++; } } });
  await assert.rejects(controller.quota()); assert.equal(writes, 0);
  await controller.quota(); assert.equal(writes, 1); assert.equal(requests, 2);
});

test('the quota interval is display-safe configuration and defaults to five minutes', async () => {
  assert.equal((await create().getState()).quotaRefreshMinutes, 5);
  assert.equal((await create({ quotaRefreshMinutes: 10 }).getState()).quotaRefreshMinutes, 10);
});

test('disposal during proxy preparation cannot start a later Codex child', async () => {
  const gate = deferred(), preparing = deferred(); let opens = 0;
  const controller = create({ beforeAuth: async () => { preparing.resolve(); await gate.promise; },
    createServer: () => { opens++; return quotaServer(gate); } });
  const pending = controller.quota(); await preparing.promise;
  controller.dispose(); gate.resolve();
  await assert.rejects(pending, error => error.code === 'CODEX_CANCELLED'); assert.equal(opens, 0);
});

test('quota display identities match the safe state identity, never the raw account id', async () => {
  let value;
  const gate = deferred(); gate.resolve();
  const controller = create({ createServer: () => quotaServer(gate),
    quotaStore: { write: async entry => { value = entry; }, read: async () => value } });
  const live = await controller.quota(), cached = await controller.cachedQuota();
  assert.equal(live.identity, (await controller.getState()).account.key);
  assert.equal(cached.identity, live.identity);
  assert.equal(value.accountKey.length, 64);
  assert.ok(!JSON.stringify(live).includes(auth.account.id));
});

test('an account switch during a disk-only quota read cannot return the previous snapshot', async () => {
  let reads = 0;
  const controller = create({ source: { ...source(), read: async () => ({ ...auth, account: { ...auth.account, id: ++reads === 1 ? auth.account.id : 'new-account' } }) },
    quotaStore: { read: async () => ({ accountKey: accountKey(auth.account.id), fetchedAt: 1234, buckets: [{ id: 'codex', primary: { usedPercent: 10 } }] }) } });
  assert.equal(await controller.cachedQuota(), null);
});
