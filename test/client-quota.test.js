import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

async function mount(rpc) {
  const cells = [], effects = [], queued = [], timers = new Map();
  let cursor = 0, nextTimer = 0, page, factory;
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(value) { const id = cursor++; cells[id] ??= { value }; return [cells[id].value, next => { cells[id].value = typeof next === 'function' ? next(cells[id].value) : next; }]; },
    useRef(value) { const id = cursor++; cells[id] ??= { current: value }; return cells[id]; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(callback, deps) {
      const id = cursor++, previous = effects[id];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        queued.push(() => { previous?.cleanup?.(); effects[id] = { deps, cleanup: callback() }; });
      }
    },
  };
  const window = { __ModuleLoader__: { load(value) { factory = value.factory; } },
    setInterval(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearInterval(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {},
  };
  new Script(await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).runInNewContext({ window });
  factory(() => React).apply({ effect() {}, slots: { inject(_name, setup) { setup(); }, register(_options, component) { page = component; } } });
  const render = () => { cursor = 0; page({ rpc, form: { subscribe() {}, getSnapshot: () => ({ value: { enabled: true } }) } }); for (const effect of queued.splice(0)) effect(); };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); await flush(); render(); await flush();
  return { render, flush, quota: () => cells[1].value, poll: async () => { for (const timer of [...timers.values()]) if (timer.ms === 30000) await timer.callback(); await flush(); },
    dispose: () => { for (const effect of effects) effect?.cleanup?.(); }, timerCount: () => timers.size };
}
const snapshot = (fetchedAt, identity = 'account-a') => ({ identity, fetchedAt, cached: true,
  buckets: [{ id: 'codex', primary: { usedPercent: 10 } }] });

test('the settings page observes newer background snapshots without more quota network calls', async () => {
  let cached = snapshot(100), network = 0;
  const ui = await mount(async method => ({ ok: true, value: method === 'state'
    ? { enabled: true, connected: true, account: { key: 'account-a' }, models: { refreshing: false } }
    : method === 'quota' ? (network++, { ...snapshot(200), cached: false }) : cached }));
  assert.equal(ui.quota().fetchedAt, 200); assert.equal(network, 1);
  cached = snapshot(300); await ui.poll(); assert.equal(ui.quota().fetchedAt, 300); assert.equal(network, 1);
  cached = snapshot(250); await ui.poll(); assert.equal(ui.quota().fetchedAt, 300);
  cached = snapshot(400, 'account-b'); await ui.poll(); assert.equal(ui.quota().fetchedAt, 300);
  ui.dispose(); assert.equal(ui.timerCount(), 0);
});

test('a cache polling error retains the current quota and unmount ignores late replies', async () => {
  let rejectCache = false, pending, resolveCache;
  const ui = await mount(async method => {
    if (method === 'cached' && rejectCache) throw Error('temporary RPC failure');
    return { ok: true, value: method === 'state'
      ? { enabled: true, connected: true, account: { key: 'account-a' }, models: { refreshing: false } }
      : method === 'quota' ? { ...snapshot(200), cached: false }
        : pending ? await pending : snapshot(100) };
  });
  rejectCache = true; await ui.poll(); assert.equal(ui.quota().fetchedAt, 200);
  rejectCache = false; pending = new Promise(resolve => { resolveCache = resolve; });
  const polling = ui.poll(); await ui.flush(); ui.dispose(); resolveCache(snapshot(400)); await polling;
  assert.equal(ui.quota().fetchedAt, 200); assert.equal(ui.timerCount(), 0);
});
