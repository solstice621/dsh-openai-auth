import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotaSync } from '../src/quota-sync.js';

function harness(options = {}) {
  let now = 1000000, enabled = true, identity = 'account-a', cached = null, requests = 0, callback, cleared = 0, identities = 0;
  const timer = { unref() {} };
  const loop = new QuotaSync({
    enabled: () => enabled, readIdentity: async () => { identities++; return identity; },
    readCached: async () => cached,
    refresh: async () => { requests++; cached = { fetchedAt: now }; },
    now: () => now, schedule: value => { callback = value; return timer; },
    unschedule: value => { assert.equal(value, timer); cleared++; }, ...options,
  });
  return { loop, advance: ms => { now += ms; }, enable: value => { enabled = value; },
    account: value => { identity = value; cached = null; }, cache: value => { cached = value; },
    get requests() { return requests; }, get now() { return now; }, get cleared() { return cleared; },
    get identities() { return identities; }, get callback() { return callback; } };
}

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('quota starts in the backend without a settings page and follows the five-minute interval', async () => {
  const h = harness();
  await h.loop.start(); assert.equal(h.requests, 1);
  await h.loop.start(); assert.equal(h.requests, 1);
  h.advance(60000); await h.loop.tick(); assert.equal(h.requests, 1);
  h.advance(240000); await h.loop.tick(); assert.equal(h.requests, 2);
  h.loop.dispose(); assert.equal(h.cleared, 1);
  h.advance(300000); await h.callback(); await h.loop.tick(); assert.equal(h.requests, 2);
});

test('a fresh persisted snapshot skips startup and a manual refresh postpones polling', async () => {
  const h = harness(); h.cache({ fetchedAt: h.now - 120000 });
  await h.loop.start(); assert.equal(h.requests, 0);
  h.advance(120000); h.cache({ fetchedAt: h.now });
  h.advance(240000); await h.loop.tick(); assert.equal(h.requests, 0);
  h.advance(60000); await h.loop.tick(); assert.equal(h.requests, 1);
  h.loop.dispose();
});

test('disabled connections neither read credentials nor poll; enabling resumes next tick', async () => {
  const h = harness(); h.enable(false);
  await h.loop.start(); assert.equal(h.requests, 0); assert.equal(h.identities, 0);
  h.enable(true); await h.loop.tick(); assert.equal(h.requests, 1);
  h.enable(false); h.advance(300000); await h.loop.tick(); assert.equal(h.requests, 1);
  h.loop.dispose();
});

test('concurrent timer ticks share a request rather than creating overlapping work', async () => {
  const gate = deferred(); let requests = 0;
  const h = harness({ refresh: async () => { requests++; await gate.promise; } });
  const first = h.loop.start();
  const second = h.loop.tick();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests, 1);
  gate.resolve(); await Promise.all([first, second]); h.loop.dispose();
});

test('a failed refresh preserves the previous snapshot and retries at the next interval', async () => {
  let requests = 0;
  const h = harness({ refresh: async () => { requests++; throw Error('redacted failure'); } });
  const snapshot = { fetchedAt: h.now - 300000 }; h.cache(snapshot);
  await h.loop.start(); assert.equal(requests, 1);
  h.advance(60000); await h.loop.tick(); assert.equal(requests, 1);
  h.advance(240000); await h.loop.tick(); assert.equal(requests, 2);
  h.loop.dispose();
});

test('an account change bypasses the previous account refresh cooldown', async () => {
  const h = harness(); await h.loop.start(); assert.equal(h.requests, 1);
  h.account('account-b'); h.advance(60000); await h.loop.tick(); assert.equal(h.requests, 2);
  h.loop.dispose();
});

test('a missing login does not start a quota request, and a future cache cannot suppress refresh', async () => {
  const h = harness({ readIdentity: async () => { throw Error('no login'); } });
  await h.loop.start(); assert.equal(h.requests, 0); h.loop.dispose();
  const next = harness(); next.cache({ fetchedAt: next.now + 99999999 });
  await next.loop.start(); assert.equal(next.requests, 1); next.loop.dispose();
});

test('disposal while reading the cache prevents a later network request', async () => {
  const gate = deferred();
  const h = harness({ readCached: () => gate.promise });
  const running = h.loop.start(); await Promise.resolve();
  h.loop.dispose(); gate.resolve(null); await running;
  assert.equal(h.requests, 0);
});
