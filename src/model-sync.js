import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { CodexAppServer } from './app-server.js';
import { CodexAuthError } from './codex-auth.js';
import { normalizeDiscoveredModels, mergeCodexModels } from './model-catalog.js';

const accountKey = id => createHash('sha256').update(id).digest('hex');
const safeCode = error => error instanceof CodexAuthError ? error.code : 'CODEX_MODEL_SYNC_FAILED';
function cacheModels(entries) {
  if (!Array.isArray(entries)) throw Error('Invalid cache');
  return normalizeDiscoveredModels(entries.map(entry => ({
    model: entry.id, displayName: entry.name, inputModalities: entry.input,
    ...(entry.efforts === null ? {} : { supportedReasoningEfforts: entry.efforts?.map(reasoningEffort => ({ reasoningEffort })) }),
  })));
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
        if (data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.accountKey) || !Number.isFinite(data.fetchedAt) || data.fetchedAt <= 0) return null;
        return { version: 1, accountKey: data.accountKey, fetchedAt: data.fetchedAt, models: cacheModels(data.models) };
      } catch { return null; }
    },
    async write(value) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
      finally { await rm(temporary, { force: true }); }
    },
  };
}

export class ModelSync {
  constructor({ source, baseline, enabled = () => true, beforeAuth = async () => {}, childEnvironment = () => process.env,
    codexCommand = source.codexCommand, intervalMinutes = 360, store = modelCacheStore(modelCacheFile(source.codexHome)),
    createServer = options => new CodexAppServer(options), onUpdate = () => {}, now = Date.now,
    schedule = callback => setInterval(callback, 60000), unschedule = clearInterval }) {
    Object.assign(this, { source, baseline, enabled, beforeAuth, childEnvironment, codexCommand, intervalMinutes, store, createServer, onUpdate, now, schedule, unschedule });
    this.models = baseline; this.origin = 'bundled'; this.discovered = []; this.abort = new AbortController();
  }

  state() {
    return { automatic: true, intervalMinutes: this.intervalMinutes, refreshing: Boolean(this.pending),
      source: this.origin, totalModels: this.models.length, discoveredModels: this.discovered.length,
      lastSyncAt: this.lastSyncAt ?? null, lastAttemptAt: this.lastAttemptAt ?? null,
      nextSyncAt: this.enabled() ? (this.lastAttemptAt ?? this.now()) + this.intervalMinutes * 60000 : null,
      error: this.error ?? null, cacheSaved: this.cacheSaved ?? null };
  }

  observeAccount(id) {
    const key = id ? accountKey(id) : undefined;
    if (key === this.key) return false;
    this.key = key; this.discovered = []; this.lastSyncAt = undefined; this.lastAttemptAt = undefined;
    this.error = undefined; this.cacheSaved = undefined; this.publish([], 'bundled');
    return true;
  }

  publish(entries, origin) {
    if (this.disposed) return;
    this.discovered = entries; this.origin = origin;
    const models = entries.length ? mergeCodexModels(this.baseline, entries) : this.baseline;
    if (JSON.stringify(models) === JSON.stringify(this.models)) return;
    this.models = models; this.onUpdate();
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
        this.lastSyncAt = cached.fetchedAt; this.publish(cached.models, 'cache');
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
      if (force || changed || this.lastAttemptAt === undefined || this.now() - this.lastAttemptAt >= this.intervalMinutes * 60000) return await this.refresh();
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
      this.observeAccount(before.account.id); const key = this.key;
      this.lastAttemptAt = this.now();
      await this.beforeAuth();
      await this.source.accessToken?.(this.abort.signal);
      if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
      server = this.createServer({ codexHome: this.source.codexHome, codexCommand: this.codexCommand, env: this.childEnvironment(), timeoutMs: 30000 });
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
      const after = await this.source.read();
      if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
      if (after.account.id !== before.account.id || this.key !== key) {
        this.observeAccount(after.account.id); throw new CodexAuthError('账号已变化，请重新同步。', 'CODEX_ACCOUNT_CHANGED');
      }
      this.lastSyncAt = this.now(); this.error = undefined;
      this.publish(entries, 'codex');
      try { await this.store.write({ version: 1, accountKey: key, fetchedAt: this.lastSyncAt, models: entries }); this.cacheSaved = true; }
      catch { this.cacheSaved = false; }
    } catch (error) {
      if (error instanceof CodexAuthError && error.code === 'CODEX_AUTH_REQUIRED') this.observeAccount(undefined);
      this.error = safeCode(error);
      throw new CodexAuthError('模型同步失败，保留当前目录。', safeCode(error));
    } finally { server?.close(); if (this.server === server) this.server = undefined; }
  }

  dispose() { this.disposed = true; this.unschedule(this.timer); this.abort.abort(); this.server?.close(); }
}
