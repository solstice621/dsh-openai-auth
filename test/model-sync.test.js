import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSync, modelCacheStore } from '../src/model-sync.js';
import { normalizeDiscoveredModels, mergeCodexModels } from '../src/model-catalog.js';

const native = { id: 'gpt-6-sol', name: 'GPT-6 Sol', api: 'openai-codex-responses', provider: 'codex-subscription',
  baseUrl: 'https://chatgpt.com/backend-api', input: ['text', 'image'], contextWindow: 272000, maxTokens: 128000,
  cost: { input: 2 }, compat: { supportsAdditionalTools: true }, reasoning: true, thinkingLevelMap: { low: 'low' } };
const row = (id = 'gpt-future-sol') => ({ model: id, displayName: 'Future Sol', inputModalities: ['text'],
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'max' }, { reasoningEffort: 'ultra' }] });
const key = id => createHash('sha256').update(id).digest('hex');
function fixture(options = {}) {
  const state = { account: 'account-a', time: 1000000, opens: 0, closes: 0, writes: [], requests: [], updates: 0, pages: [{ data: [row()], nextCursor: null }] };
  const sync = new ModelSync({
    source: { codexHome: '/test/home', codexCommand: '/test/codex', read: async () => ({ token: 'private-token', account: { id: state.account } }) },
    baseline: [structuredClone(native)], now: () => state.time,
    store: { read: async () => state.cache ?? null, write: async value => { state.writes.push(value); } },
    schedule: callback => { state.scheduled = callback; return 123; }, unschedule: () => { state.unscheduled = true; },
    onUpdate: () => { state.updates++; },
    createServer: () => {
      state.opens++; let page = 0;
      return { initialize: async () => {}, request: async (method, params) => {
        state.requests.push({ method, params });
        if (method === 'account/read') return { account: { type: 'chatgpt', id: state.account } };
        if (state.fail) throw Error('private-token and provider diagnostic');
        if (state.delay) await state.delay;
        return state.pages[page++];
      }, close: () => { state.closes++; } };
    }, ...options,
  });
  return { sync, state };
}

test('sanitizes discovery, deduplicates, and limits new models to supported modalities and efforts', () => {
  const entries = normalizeDiscoveredModels([row(), row(), { ...row('hidden'), hidden: true },
    { ...row('audio-only'), inputModalities: ['audio'] }, { ...row('bad/url') }]);
  assert.deepEqual(entries, [{ id: 'gpt-future-sol', name: 'Future Sol', input: ['text'], efforts: ['medium', 'max'] }]);
  const result = mergeCodexModels([native], entries);
  assert.equal(result[0].api, native.api); assert.equal(result[0].contextWindow, 16384);
  assert.equal(result[0].maxTokens, 4096); assert.equal(result[0].compat, undefined);
  assert.equal(result[0].thinkingLevelMap.off, null); assert.equal(result[0].thinkingLevelMap.low, null);
  assert.equal(result[0].thinkingLevelMap.max, 'max'); assert.equal(result[1], native);
  const known = mergeCodexModels([native], normalizeDiscoveredModels([row(native.id)]))[0];
  assert.equal(known.contextWindow, native.contextWindow); assert.deepEqual(known.compat, native.compat);
});

test('starts automatically, follows pagination, persists safe metadata, and respects the interval', async () => {
  const { sync, state } = fixture();
  state.pages = [{ data: [row('new-1')], nextCursor: 'page-2' }, { data: [row('new-2')], nextCursor: null }];
  await sync.start();
  assert.equal(sync.models.length, 3); assert.equal(sync.state().source, 'codex');
  assert.equal(state.requests[2].params.cursor, 'page-2'); assert.equal(state.opens, state.closes);
  assert(!JSON.stringify(state.writes).includes('private-token')); assert(!JSON.stringify(sync.state()).includes('account-a'));
  await sync.tick(); assert.equal(state.opens, 1);
  state.time += 360 * 60000; await sync.tick(); assert.equal(state.opens, 2);
  sync.dispose(); assert(state.unscheduled);
});

test('concurrent manual refreshes share a request and failed refresh keeps the successful catalog', async () => {
  const { sync, state } = fixture();
  let release; state.delay = new Promise(resolve => { release = resolve; });
  const one = sync.refresh(), two = sync.refresh(); release(); await Promise.all([one, two]);
  assert.equal(state.opens, 1); const previous = sync.models; state.fail = true;
  await assert.rejects(sync.refresh(), error => error.code === 'CODEX_MODEL_SYNC_FAILED' && !error.message.includes('private-token'));
  assert.equal(sync.models, previous); assert.equal(state.writes.length, 1); assert.equal(state.opens, state.closes);
  sync.dispose();
});

test('restores an account-matched cache when startup discovery fails', async () => {
  const { sync, state } = fixture();
  state.cache = { accountKey: key(state.account), fetchedAt: state.time - 1, models: normalizeDiscoveredModels([row('cached-model')]) };
  state.fail = true; await sync.start(); assert.equal(sync.state().error, 'CODEX_MODEL_SYNC_FAILED');
  assert.equal(sync.state().source, 'cache'); assert.equal(sync.models[0].id, 'cached-model'); sync.dispose();
});

test('never restores another account and synchronizes account switches without waiting for the interval', async () => {
  const { sync, state } = fixture();
  state.cache = { accountKey: key('other-account'), fetchedAt: state.time - 1, models: normalizeDiscoveredModels([row('wrong-account-model')]) };
  await sync.start(); assert(!sync.models.some(model => model.id === 'wrong-account-model'));
  state.account = 'account-b'; state.pages = [{ data: [row('account-b-model')], nextCursor: null }];
  await sync.tick(); assert.equal(state.opens, 2);
  assert(sync.models.some(model => model.id === 'account-b-model')); assert(!sync.models.some(model => model.id === 'gpt-future-sol'));
  sync.dispose();
});

test('rejects an in-flight account change without publishing or saving the wrong catalog', async () => {
  const { sync, state } = fixture(); let release;
  state.delay = new Promise(resolve => { release = resolve; });
  const pending = sync.refresh();
  while (!state.requests.some(request => request.method === 'model/list')) await new Promise(resolve => setImmediate(resolve));
  state.account = 'account-b'; release();
  await assert.rejects(pending, error => error.code === 'CODEX_ACCOUNT_CHANGED');
  assert.deepEqual(sync.models, [native]); assert.equal(state.writes.length, 0); assert.equal(state.opens, state.closes); sync.dispose();
});

test('disabling pauses requests and disposal prevents late publication', async () => {
  const paused = fixture({ enabled: () => false });
  await paused.sync.start(); assert.equal(paused.state.opens, 0);
  await assert.rejects(paused.sync.refresh(), error => error.code === 'CODEX_CONNECTION_DISABLED'); paused.sync.dispose();
  const { sync, state } = fixture(); let release; state.delay = new Promise(resolve => { release = resolve; });
  const pending = sync.refresh();
  while (!state.requests.some(request => request.method === 'model/list')) await new Promise(resolve => setImmediate(resolve));
  sync.dispose(); release(); await assert.rejects(pending, error => error.code === 'CODEX_CANCELLED');
  assert.equal(state.writes.length, 0); assert.deepEqual(sync.models, [native]);
});

test('invalid or looping discovery never erases the current catalog', async () => {
  const { sync, state } = fixture(); await sync.refresh(); const previous = sync.models;
  state.pages = [{ data: [], nextCursor: null }]; await assert.rejects(sync.refresh()); assert.equal(sync.models, previous);
  state.pages = [{ data: [row()], nextCursor: 'same' }, { data: [row()], nextCursor: 'same' }];
  await assert.rejects(sync.refresh()); assert.equal(sync.models, previous); sync.dispose();
});

test('disk cache is atomic, private, validated, and contains only model metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-model-cache-')); const path = join(directory, 'models.json');
  try {
    const store = modelCacheStore(path); assert.equal(await store.read(), null);
    const value = { version: 1, accountKey: key('test'), fetchedAt: 100, models: normalizeDiscoveredModels([row()]) };
    await store.write(value); assert.deepEqual(await store.read(), value);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert(!JSON.parse(await readFile(path, 'utf8')).token);
    await writeFile(path, '{broken'); assert.equal(await store.read(), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
