import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { CodexAppServer, readCodexModelWindows } from './app-server.js';
import { CodexAuthError } from './codex-auth.js';
import { normalizeDiscoveredModels, mergeCodexModels, validContextWindow, validModelId } from './model-catalog.js';

const accountKey = id => createHash('sha256').update(id).digest('hex');
const safeCode = error => error instanceof CodexAuthError ? error.code : 'CODEX_MODEL_SYNC_FAILED';
function cacheModels(entries, version) {
  if (!Array.isArray(entries)) throw Error('Invalid cache');
  const models = normalizeDiscoveredModels(entries.map(entry => ({
    model: entry.id, displayName: entry.name, inputModalities: entry.input,
    ...(entry.efforts === null ? {} : { supportedReasoningEfforts: entry.efforts?.map(reasoningEffort => ({ reasoningEffort })) }),
  })));
  if (version === 1) return models;
  const windows = new Map(entries.filter(entry => validContextWindow(entry.contextWindow))
    .map(entry => [entry.id, entry.contextWindow]));
  return models.map(model => windows.has(model.id) ? { ...model, contextWindow: windows.get(model.id) } : model);
}

export function modelCacheFile(codexHome) {
  const homeKey = createHash('sha256').update(codexHome).digest('hex').slice(0, 16);
  return resolve(homedir(), '.dsh', 'cache', 'dsh-openai-auth', homeKey, 'models.json');
}

export function modelCacheStore(path) {
  return {
    async read() {
      try {
        const raw = await readFile(path, 'utf8');
        if (Buffer.byteLength(raw) > 1048576) return null;
        const data = JSON.parse(raw);
        if (![1, 2].includes(data.version) || !/^[a-f0-9]{64}$/.test(data.accountKey) || !Number.isFinite(data.fetchedAt) || data.fetchedAt <= 0) return null;
        const { version, accountKey, fetchedAt } = data;
        const snapshot = { version, accountKey, fetchedAt, models: cacheModels(data.models, version) };
        if (version === 2 && Array.isArray(data.retainedWindows) && data.retainedWindows.length <= 1000) {
          snapshot.retainedWindows = data.retainedWindows.filter(entry =>
            Array.isArray(entry) && entry.length === 2 && validModelId(entry[0]) && validContextWindow(entry[1]));
        }
        return snapshot;
      } catch { return null; }
    },
    async write(value, shouldSave = () => true) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
        if (shouldSave()) await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}

export class ModelSync {
  constructor({ source, baseline, enabled = () => true, beforeAuth = async () => {}, childEnvironment = () => process.env,
    codexCommand = source.codexCommand, intervalMinutes = 360, store = modelCacheStore(modelCacheFile(source.codexHome)),
    createServer = options => new CodexAppServer(options), readModelWindows = readCodexModelWindows, onUpdate = () => {}, now = Date.now,
    schedule = callback => setInterval(callback, 60000), unschedule = clearInterval }) {
    Object.assign(this, { source, baseline, enabled, beforeAuth, childEnvironment, codexCommand, intervalMinutes, store, createServer, readModelWindows, onUpdate, now, schedule, unschedule });
    this.models = baseline;
    this.pendingModels = [];
    this.origin = 'bundled';
    this.discovered = [];
    this.retainedWindows = [];
    this.accountRevision = 0;
    this.abort = new AbortController();
  }

  get refreshDelayMs() {
    const minutes = this.contextReadFailed || this.pendingModels.length ? Math.min(5, this.intervalMinutes) : this.intervalMinutes;
    return minutes * 60000;
  }

  state() {
    return { automatic: true, intervalMinutes: this.intervalMinutes, refreshing: Boolean(this.pending),
      source: this.origin, totalModels: this.models.length, discoveredModels: this.discovered.length,
      availableModels: [...this.models.map(({ id, name }) => ({ id, name })), ...this.pendingModels],
      pendingCount: this.pendingModels.length, contextReadFailed: this.contextReadFailed ?? false,
      lastSyncAt: this.lastSyncAt ?? null, lastAttemptAt: this.lastAttemptAt ?? null,
      nextSyncAt: this.enabled() ? (this.lastAttemptAt ?? this.now()) + this.refreshDelayMs : null,
      error: this.error ?? null, cacheSaved: this.cacheSaved ?? null };
  }

  observeAccount(id) {
    const key = id ? accountKey(id) : undefined;
    if (key === this.key) return false;
    this.key = key; this.accountRevision++; this.lastSyncAt = undefined; this.lastAttemptAt = undefined;
    this.error = undefined; this.contextReadFailed = false; this.cacheSaved = undefined;
    this.retainedWindows = [];
    this.publish([], 'bundled');
    return true;
  }

  publish(entries, origin) {
    if (this.disposed) return;
    this.discovered = entries; this.origin = origin;
    const models = entries.length ? mergeCodexModels(this.baseline, entries) : this.baseline;
    const readyIds = new Set(models.map(model => model.id));
    const pendingModels = entries.filter(entry => !readyIds.has(entry.id))
      .map(({ id, name }) => ({ id, name, limitsPending: true }));
    const modelsChanged = JSON.stringify(models) !== JSON.stringify(this.models);
    const pendingChanged = JSON.stringify(pendingModels) !== JSON.stringify(this.pendingModels);
    if (modelsChanged) this.models = models;
    if (pendingChanged) this.pendingModels = pendingModels;
    if (modelsChanged || pendingChanged) this.onUpdate();
  }

  async start() {
    try {
      const auth = await this.source.read();
      this.observeAccount(auth.account.id);
      const cached = await this.store.read();
      const current = await this.source.read();
      this.observeAccount(current.account.id);
      // Never restore another account's catalog or a future-dated snapshot.
      if (!this.disposed && cached?.accountKey === this.key && cached.fetchedAt <= this.now() + 300000 && cached.fetchedAt > (this.lastSyncAt ?? 0)) {
        this.lastSyncAt = cached.fetchedAt;
        this.retainedWindows = cached.retainedWindows ?? [];
        this.publish(cached.models, 'cache');
      }
    } catch (error) { this.error = safeCode(error); }
    if (this.disposed) return;
    this.timer = this.schedule(() => { this.tick().catch(() => {}); }); this.timer?.unref?.();
    await this.tick(true);
  }

  async tick(force = false) {
    if (this.disposed || !this.enabled()) return this.state();
    try {
      const auth = await this.source.read();
      const changed = this.observeAccount(auth.account.id);
      if (force || changed || this.lastAttemptAt === undefined || this.now() - this.lastAttemptAt >= this.refreshDelayMs) return await this.refresh();
    } catch (error) {
      if (error instanceof CodexAuthError && error.code === 'CODEX_AUTH_REQUIRED') this.observeAccount(undefined);
      this.error = safeCode(error);
    }
    return this.state();
  }

  async refresh() {
    if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
    if (!this.enabled()) throw new CodexAuthError('请先启用 Codex 连接。', 'CODEX_CONNECTION_DISABLED');
    if (!this.pending) {
      this.pending = this.fetchModels();
      this.pending.finally(() => { this.pending = undefined; }).catch(() => {});
    }
    await this.pending;
    return this.state();
  }

  async fetchModels() {
    let server;
    try {
      const before = await this.source.read();
      this.observeAccount(before.account.id);
      const key = this.key, revision = this.accountRevision;
      const isCurrent = () => !this.disposed && this.enabled() && this.accountRevision === revision;
      this.lastAttemptAt = this.now();
      await this.beforeAuth();
      await this.source.accessToken?.(this.abort.signal);
      if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
      const codex = { codexHome: this.source.codexHome, codexCommand: this.codexCommand, env: this.childEnvironment() };
      server = this.createServer({ ...codex, timeoutMs: 30000 });
      this.server = server; await server.initialize();
      const account = await server.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') throw new CodexAuthError('请使用 ChatGPT 登录。', 'CODEX_AUTH_REQUIRED');
      if (account.account.id && account.account.id !== before.account.id) throw new CodexAuthError('账号已变化。', 'CODEX_ACCOUNT_CHANGED');
      let cursor; const rows = [], cursors = new Set();
      for (let page = 0; page < 10; page++) {
        const result = await server.request('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result.data) || rows.length + result.data.length > 1000) throw Error('Invalid catalog');
        rows.push(...result.data);
        if (!result.nextCursor) break;
        if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor) || page === 9) throw Error('Invalid pagination');
        cursor = result.nextCursor; cursors.add(cursor);
      }
      const entries = normalizeDiscoveredModels(rows);
      let contextCatalog;
      if (isCurrent()) {
        try { contextCatalog = await this.readModelWindows({ ...codex, signal: this.abort.signal }); }
        catch { /* Use the last confirmed windows and exact built-in entries. */ }
      }

      const after = await this.source.read();
      if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
      if (!this.enabled()) throw new CodexAuthError('Codex 连接已停用。', 'CODEX_CONNECTION_DISABLED');
      if (after.account.id !== before.account.id || this.accountRevision !== revision) {
        this.observeAccount(after.account.id); throw new CodexAuthError('账号已变化，请重新同步。', 'CODEX_ACCOUNT_CHANGED');
      }

      const previous = new Map(this.retainedWindows);
      for (const { id, contextWindow } of this.discovered) {
        if (validContextWindow(contextWindow)) previous.set(id, contextWindow);
      }
      const enriched = entries.map(entry => {
        const refreshed = contextCatalog?.windows.get(entry.id);
        const cached = previous.get(entry.id);
        previous.delete(entry.id);
        const contextWindow = contextCatalog?.matchesBundle ? cached ?? refreshed : refreshed ?? cached;
        return validContextWindow(contextWindow) ? { ...entry, contextWindow } : entry;
      });
      // Retain known windows when a rollout temporarily removes a model from
      // discovery. These entries do not make the absent model selectable.
      this.retainedWindows = [...previous].slice(-1000);
      this.lastSyncAt = this.now(); this.error = undefined; this.contextReadFailed = !contextCatalog;
      this.publish(enriched, 'codex');
      try {
        await this.store.write({
          version: 2, accountKey: key, fetchedAt: this.lastSyncAt, models: enriched, retainedWindows: this.retainedWindows,
        }, isCurrent);
        if (isCurrent()) this.cacheSaved = true;
      } catch { if (isCurrent()) this.cacheSaved = false; }
    } catch (error) {
      if (error instanceof CodexAuthError && error.code === 'CODEX_AUTH_REQUIRED') this.observeAccount(undefined);
      this.error = safeCode(error);
      throw new CodexAuthError('模型同步失败，保留当前目录。', safeCode(error));
    } finally { server?.close(); if (this.server === server) this.server = undefined; }
  }

  dispose() { this.disposed = true; this.unschedule(this.timer); this.abort.abort(); this.server?.close(); }
}
