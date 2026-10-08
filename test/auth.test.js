import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseCodexAuth, readCodexAuth, CodexTokenSource, refreshWithCodex } from '../src/codex-auth.js';

function fixture(exp = 2000000000, account = 'test-account') {
  const payload = Buffer.from(JSON.stringify({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url');
  return { auth_mode: 'chatgpt', tokens: { access_token: `header.${payload}.signature`, account_id: account, refresh_token: 'never-copy-me' } };
}

test('accepts subscription auth, rejects API keys and account mismatches without leaking secrets', () => {
  assert.equal(parseCodexAuth(fixture()).expiresAt, 2000000000000);
  assert.throws(() => parseCodexAuth({ auth_mode: 'apikey', OPENAI_API_KEY: 'private-key' }), /signed in with ChatGPT/);
  const wrong = fixture(); wrong.tokens.account_id = 'other-account';
  assert.throws(() => parseCodexAuth(wrong), /does not match/);
  assert.throws(() => parseCodexAuth({ tokens: { access_token: 'private-secret' } }), error => !error.message.includes('private-secret'));
  assert.throws(() => parseCodexAuth(fixture('2000000000')), /expiry/);
});

test('reads auth cache without changing or copying it; corrupt cache errors are redacted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-auth-test-'));
  try {
    const original = JSON.stringify(fixture());
    await writeFile(join(root, 'auth.json'), original);
    assert.equal((await readCodexAuth(root)).token, fixture().tokens.access_token);
    assert.equal(await readFile(join(root, 'auth.json'), 'utf8'), original);
    await writeFile(join(root, 'auth.json'), '{private-secret');
    await assert.rejects(readCodexAuth(root), error => !error.message.includes('private-secret'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reloads external login changes on every request', async () => {
  let token = 'first';
  const source = new CodexTokenSource({ read: async () => ({ token, expiresAt: 1000000 }), now: () => 0, refresh: () => { throw Error('should not refresh'); } });
  assert.equal(await source.accessToken(), 'first');
  token = 'second';
  assert.equal(await source.accessToken(), 'second');
});

test('concurrent expired reads across instances share one official renewal', async () => {
  let renewed = false, refreshes = 0;
  const options = { codexHome: '/fake/concurrency', now: () => 1000,
    read: async () => ({ token: renewed ? 'new' : 'old', expiresAt: renewed ? 1000000 : 0 }),
    refresh: async () => { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); renewed = true; },
  };
  const a = new CodexTokenSource(options), b = new CodexTokenSource(options);
  assert.deepEqual(await Promise.all([a.accessToken(), b.accessToken(), a.accessToken()]), ['new', 'new', 'new']);
  assert.equal(refreshes, 1);
});

test('cancelled waiter stops promptly without killing another waiter renewal', async () => {
  let renewed = false, release;
  const source = new CodexTokenSource({ codexHome: '/fake/cancel', now: () => 1000,
    read: async () => ({ token: 'fresh', expiresAt: renewed ? 1000000 : 0 }),
    refresh: async () => { await new Promise(resolve => { release = resolve; }); renewed = true; },
  });
  const controller = new AbortController();
  const cancelled = source.accessToken(controller.signal);
  const survivor = source.accessToken();
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('user-cancelled'));
  await assert.rejects(cancelled, /user-cancelled/);
  release();
  assert.equal(await survivor, 'fresh');
});

test('failed renewal can retry and never returns expired credentials', async () => {
  let attempts = 0;
  const source = new CodexTokenSource({ codexHome: '/fake/retry', now: () => 1000,
    read: async () => ({ token: 'expired', expiresAt: 0 }),
    refresh: async () => { attempts++; if (attempts === 1) throw Error('failed'); },
  });
  await assert.rejects(source.accessToken(), /failed/);
  await assert.rejects(source.accessToken(), /still expired/);
  assert.equal(attempts, 2);
});

function fakeChild(respond) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  child.stdin.on('data', bytes => {
    for (const line of bytes.toString().trim().split('\n')) respond(JSON.parse(line), child);
  });
  return child;
}

test('app-server initializes before forced refresh, uses explicit CODEX_HOME and no shell', async () => {
  const methods = [];
  let captured;
  const child = fakeChild((message, process) => {
    methods.push(message.method);
    queueMicrotask(() => {
      if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      if (message.method === 'account/read') {
        assert.equal(message.params.refreshToken, true);
        process.stdout.write(JSON.stringify({ id: 2, result: { account: { type: 'chatgpt' } } }) + '\n');
      }
    });
  });
  await refreshWithCodex({ codexHome: '/fake/rpc', codexCommand: '/official/codex', env: { HTTPS_PROXY: 'http://proxy:8080' }, spawnProcess: (...args) => { captured = args; return child; } });
  assert.deepEqual(methods, ['initialize', 'initialized', 'account/read']);
  assert.equal(captured[2].env.CODEX_HOME, '/fake/rpc');
  assert.equal(captured[2].env.HTTPS_PROXY, 'http://proxy:8080');
  assert.equal(captured[2].shell, false);
  assert.equal(child.killed, true);
});

test('app-server errors and timeouts are sanitized and close the process', async () => {
  const child = fakeChild((message, process) => queueMicrotask(() => process.stdout.write(JSON.stringify({ id: message.id, error: { message: 'private-token' } }) + '\n')));
  await assert.rejects(refreshWithCodex({ codexHome: '/fake', codexCommand: 'codex', spawnProcess: () => child }), error => !error.message.includes('private-token'));
  const hanging = fakeChild(() => {});
  await assert.rejects(refreshWithCodex({ codexHome: '/fake', codexCommand: 'codex', timeoutMs: 15, spawnProcess: () => hanging }), /timed out/);
  assert.equal(hanging.killed, true);
});
