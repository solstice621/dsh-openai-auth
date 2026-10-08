import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountKey, normalizeCachedBuckets, quotaCacheFile, quotaCacheStore } from '../src/quota-cache.js';

const buckets = () => [{ id: 'codex', name: 'codex', primary: { usedPercent: 12.5, durationMins: 300, resetsAt: 2000000 }, secondary: null }];

test('the account key is a hash and the cache path follows DSH_HOME', () => {
  assert.match(accountKey('account-a'), /^[a-f0-9]{64}$/);
  assert.notEqual(accountKey('account-a'), accountKey('account-b'));
  assert.equal(accountKey(undefined), accountKey(''));
  assert.match(quotaCacheFile('/test/home', { DSH_HOME: '/custom' }), /^\/custom\/cache\/dsh-openai-auth\/[a-f0-9]{16}\/quota\.json$/);
  assert.match(quotaCacheFile('/test/home', {}), /\/\.dsh\/cache\/dsh-openai-auth\/[a-f0-9]{16}\/quota\.json$/);
  assert.notEqual(quotaCacheFile('/test/home', {}), quotaCacheFile('/other/home', {}));
});

test('the store round-trips through disk and clears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-quota-'));
  const store = quotaCacheStore(join(dir, 'quota.json'));
  await store.write({ version: 1, accountKey: accountKey('a'), fetchedAt: 1234, buckets: buckets() });
  const read = await store.read();
  assert.equal(read.version, 1);
  assert.equal(read.fetchedAt, 1234);
  assert.equal(read.buckets[0].primary.usedPercent, 12.5);
  assert.equal(read.buckets[0].primary.resetsAt, 2000000);
  await store.clear();
  assert.equal(await store.read(), null);
});

test('the store refuses documents it cannot trust', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-quota-'));
  const path = join(dir, 'quota.json');
  const store = quotaCacheStore(path);
  for (const bad of [
    { version: 2, accountKey: accountKey('a'), fetchedAt: 1, buckets: buckets() },
    { version: 1, accountKey: 'not-a-hash', fetchedAt: 1, buckets: buckets() },
    { version: 1, accountKey: accountKey('a'), fetchedAt: 0, buckets: buckets() },
    { version: 1, accountKey: accountKey('a'), fetchedAt: 1, buckets: [] },
    { version: 1, accountKey: accountKey('a'), fetchedAt: 1, buckets: [{ id: 'codex' }] },
  ]) {
    await writeFile(path, JSON.stringify(bad));
    assert.equal(await store.read(), null);
  }
  await writeFile(path, '{not json');
  assert.equal(await store.read(), null);
  await writeFile(path, JSON.stringify({ version: 1, accountKey: accountKey('a'), fetchedAt: Number.NaN, buckets: buckets() }));
  assert.equal(await store.read(), null);
});

test('cached buckets are sanitized and unusable windows are dropped', () => {
  const normalized = normalizeCachedBuckets([
    { id: 'codex', name: 'codex', primary: { usedPercent: 130, durationMins: 'nope', resetsAt: 5 }, secondary: { usedPercent: 1 } },
    { id: 'spark', primary: null, secondary: null },
    { id: 'x'.repeat(200), primary: { usedPercent: 2 }, secondary: null },
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].primary.usedPercent, 100);
  assert.equal(normalized[0].primary.durationMins, null);
  assert.equal(normalized[0].secondary.usedPercent, 1);
  assert.equal(normalized[1].id.length, 100);
  assert.throws(() => normalizeCachedBuckets('nope'), /Invalid quota cache/);
  assert.throws(() => normalizeCachedBuckets(new Array(21).fill({ primary: { usedPercent: 1 } })), /Invalid quota cache/);
});
