import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSync, modelCacheStore } from '../src/model-sync.js';
import { normalizeDiscoveredModels, mergeCodexModels } from '../src/model-catalog.js';
import { readCodexModelWindows } from '../src/app-server.js';

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
    readModelWindows: async options => {
      state.catalogOptions = options;
      if (state.contextFailure) throw Error('private-token and provider diagnostic');
      const windows = state.windows ?? new Map(state.pages.flatMap(page => page.data.map(model => [model.model, 320000])));
      return { windows, matchesBundle: state.matchesBundle ?? false };
    },
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
  const result = mergeCodexModels([native], [{ ...entries[0], contextWindow: 320000 }]);
  assert.equal(result[0].api, native.api); assert.equal(result[0].contextWindow, 320000);
  assert.equal(result[0].maxTokens, 4096); assert.equal(result[0].compat, undefined);
  assert.equal(result[0].thinkingLevelMap.off, null); assert.equal(result[0].thinkingLevelMap.low, null);
  assert.equal(result[0].thinkingLevelMap.max, 'max'); assert.equal(result[1], native);
  const known = mergeCodexModels([native], normalizeDiscoveredModels([row(native.id)]))[0];
  assert.equal(known.contextWindow, native.contextWindow); assert.deepEqual(known.compat, native.compat);
});

test('reads context windows from the same official CLI, with bundled fallback detection', async () => {
  const options = {
    codexHome: '/test/home', codexCommand: '/test/codex', signal: new AbortController().signal,
    env: { HTTPS_PROXY: 'http://proxy.test:1234' },
  };
  const raw = { models: [
    { slug: native.id, context_window: 272000, max_context_window: 872000 },
    { slug: 'gpt-6.3-sol', context_window: 320000, max_context_window: 872000, raw: 'not retained' },
    { slug: 'gpt-6.3-astra', max_context_window: 872000 },
    { slug: 'bad-id', context_window: '500000' },
  ] };
  const bundled = { models: [raw.models[0]] };
  const calls = [];
  const run = async (command, args, child) => {
    calls.push(args);
    assert.equal(command, options.codexCommand);
    assert.equal(child.env.CODEX_HOME, options.codexHome);
    assert.equal(child.env.HTTPS_PROXY, options.env.HTTPS_PROXY);
    assert.equal(child.signal, options.signal);
    assert.equal(child.timeout, 15000);
    assert.deepEqual(args.slice(0, 6), ['debug', 'models', '-c', 'model_provider="openai"', '-c', 'cli_auth_credentials_store="file"']);
    return { stdout: JSON.stringify(args.includes('--bundled') ? bundled : raw) };
  };
  const result = await readCodexModelWindows({ ...options, run });
  assert.deepEqual(result, { windows: new Map([[native.id, 272000], ['gpt-6.3-sol', 320000]]), matchesBundle: false });
  assert.equal(calls.length, 2);
  raw.models = bundled.models;
  assert.equal((await readCodexModelWindows({ ...options, run })).matchesBundle, true);
});

test('new IDs get exact synced windows or stay pending until the catalog supplies them', async () => {
  const { sync, state } = fixture();
  state.pages = [{ data: [row('gpt-6.3-sol'), row('gpt-6.3-astra')], nextCursor: null }];
  state.windows = new Map([['gpt-6.3-sol', 320000]]);
  await sync.start();
  assert.equal(sync.models.find(model => model.id === 'gpt-6.3-sol').contextWindow, 320000);
  assert(!sync.models.some(model => model.id === 'gpt-6.3-astra'));
  assert.deepEqual(sync.pendingModels, [{ id: 'gpt-6.3-astra', name: 'Future Sol', limitsPending: true }]);
  assert.equal(sync.state().pendingCount, 1);
  assert.equal(sync.state().nextSyncAt, state.time + 5 * 60000);
  const attempts = state.opens;
  state.windows.set('gpt-6.3-astra', 240000);
  state.time += 4 * 60000;
  await sync.tick();
  assert.equal(state.opens, attempts);
  state.time += 60000;
  await sync.tick();
  assert.equal(state.opens, attempts + 1);
  assert.equal(sync.models.find(model => model.id === 'gpt-6.3-astra').contextWindow, 240000);
  assert.equal(sync.state().pendingCount, 0);
  assert.equal(sync.state().nextSyncAt, state.time + 360 * 60000);
  sync.dispose();
});

test('a context refresh failure preserves last good windows and advertises new unresolved IDs as pending', async () => {
  const { sync, state } = fixture();
  state.pages = [{ data: [row(native.id), row('gpt-6.3-sol')], nextCursor: null }];
  state.windows = new Map([[native.id, 300000], ['gpt-6.3-sol', 320000]]);
  await sync.refresh();
  state.pages[0].data.push(row('gpt-6.3-astra'));
  state.contextFailure = true;
  await sync.refresh();
  assert.equal(sync.state().contextReadFailed, true);
  assert.equal(sync.state().error, null);
  assert(!JSON.stringify(sync.state()).includes('private-token'));
  assert.equal(sync.models.find(model => model.id === native.id).contextWindow, 300000);
  assert.equal(sync.models.find(model => model.id === 'gpt-6.3-sol').contextWindow, 320000);
  assert.equal(sync.state().availableModels.find(model => model.id === 'gpt-6.3-astra').limitsPending, true);
  assert.equal(state.writes.at(-1).models.find(model => model.id === 'gpt-6.3-sol').contextWindow, 320000);
  assert(!('contextWindow' in state.writes.at(-1).models.find(model => model.id === 'gpt-6.3-astra')));
  state.contextFailure = false;
  state.matchesBundle = true;
  state.windows = new Map([[native.id, 272000]]);
  await sync.refresh();
  assert.equal(sync.models.find(model => model.id === native.id).contextWindow, 300000);
  state.matchesBundle = false;
  state.windows.set(native.id, 280000);
  await sync.refresh();
  assert.equal(sync.models.find(model => model.id === native.id).contextWindow, 280000);
  sync.dispose();
});

test('retains a previously synced window for an ID rediscovered after restart', async () => {
  const temporaryId = 'gpt-6.3-sol';
  const { sync, state } = fixture();
  state.pages = [{ data: [row(native.id), row(temporaryId)], nextCursor: null }];
  await sync.refresh();
  state.pages[0].data.pop();
  await sync.refresh();
  assert(!sync.models.some(model => model.id === temporaryId));
  const snapshot = state.writes.at(-1);
  assert.deepEqual(snapshot.retainedWindows, [[temporaryId, 320000]]);
  sync.dispose();

  const restarted = fixture();
  restarted.state.cache = snapshot;
  restarted.state.pages = [{ data: [row(temporaryId)], nextCursor: null }];
  restarted.state.contextFailure = true;
  await restarted.sync.start();
  assert.equal(restarted.sync.models.find(model => model.id === temporaryId).contextWindow, 320000);
  assert.equal(restarted.sync.state().pendingCount, 0);
  restarted.sync.dispose();
});

test('starts automatically, follows pagination, persists safe metadata, and respects the interval', async () => {
  const { sync, state } = fixture();
  state.pages = [{ data: [row('new-1')], nextCursor: 'page-2' }, { data: [row('new-2')], nextCursor: null }];
  await sync.start();
  assert.equal(sync.models.length, 3); assert.equal(sync.state().source, 'codex');
  assert.deepEqual(sync.state().availableModels, sync.models.map(({ id, name }) => ({ id, name })));
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
  state.cache = { version: 2, accountKey: key(state.account), fetchedAt: state.time - 1,
    models: normalizeDiscoveredModels([row('cached-model')]).map(model => ({ ...model, contextWindow: 360000 })) };
  state.fail = true; await sync.start(); assert.equal(sync.state().error, 'CODEX_MODEL_SYNC_FAILED');
  assert.equal(sync.state().source, 'cache'); assert.equal(sync.models[0].id, 'cached-model');
  assert.equal(sync.models[0].contextWindow, 360000); sync.dispose();
});

test('never restores another account and synchronizes account switches without waiting for the interval', async () => {
  const { sync, state } = fixture();
  state.cache = { accountKey: key('other-account'), fetchedAt: state.time - 1, models: normalizeDiscoveredModels([row('wrong-account-model')]) };
  await sync.start(); assert(!sync.models.some(model => model.id === 'wrong-account-model'));
  state.account = 'account-b'; state.pages = [{ data: [row('account-b-model'), row()], nextCursor: null }];
  state.windows = new Map([['account-b-model', 380000]]);
  await sync.tick(); assert.equal(state.opens, 2);
  assert(sync.models.some(model => model.id === 'account-b-model'));
  assert(!sync.models.some(model => model.id === 'gpt-future-sol'));
  assert.equal(sync.state().availableModels.find(model => model.id === 'gpt-future-sol').limitsPending, true);
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
  assert.equal(state.catalogOptions, undefined);
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
    const enriched = { ...value, version: 2, models: value.models.map(model => ({ ...model, contextWindow: 320000 })),
      retainedWindows: [['older-model', 100000]] };
    await store.write(enriched); assert.deepEqual(await store.read(), enriched);
    await store.write(value, () => false); assert.deepEqual(await store.read(), enriched);
    await store.write({ ...enriched, models: enriched.models.map(model => ({ ...model, contextWindow: -1 })) });
    assert.deepEqual(await store.read(), { ...value, version: 2, retainedWindows: enriched.retainedWindows });
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert(!JSON.parse(await readFile(path, 'utf8')).token);
    await writeFile(path, '{broken'); assert.equal(await store.read(), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
