import { CodexAppServer } from './app-server.js';
import { CodexAuthError } from './codex-auth.js';
import { accountKey } from './quota-cache.js';
import { createHash } from 'node:crypto';

export function normalizeQuota(result, expectedAccountId) {
  if (result.accountId && result.accountId !== expectedAccountId) {
    throw new CodexAuthError('账号已变化，请重新读取额度。', 'CODEX_ACCOUNT_CHANGED');
  }
  const window = value => value && Number.isFinite(value.usedPercent) ? {
    usedPercent: Math.min(100, Math.max(0, value.usedPercent)),
    durationMins: Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null,
    resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt * 1000 : null,
  } : null;
  const buckets = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : [['codex', result.rateLimits]];
  return buckets.filter(([, value]) => value && typeof value === 'object').map(([id, value]) => ({
    id: id.slice(0, 100), name: typeof value.limitName === 'string' ? value.limitName.slice(0, 100) : id.slice(0, 100),
    primary: window(value.primary), secondary: window(value.secondary),
  }));
}

export class AuthController {
  constructor({ source, enabled = true, beforeAuth, childEnvironment, modelSync, quotaStore, quotaRefreshMinutes = 5, showModelSync = true, createServer = options => new CodexAppServer(options), now = Date.now }) {
    Object.assign(this, { source, enabled, beforeAuth, childEnvironment, modelSync, quotaStore, quotaRefreshMinutes, showModelSync, createServer, now });
    this.quotaAbort = new AbortController();
  }

  async getState() {
    const enabled = typeof this.enabled === 'function' ? this.enabled() : this.enabled;
    // A layout preference, reported so the page never has to read the raw config.
    const showModelSync = this.showModelSync !== false;
    let auth;
    try { auth = await this.source.read(); } catch (error) {
      this.modelSync?.observeAccount(undefined);
      return { enabled, showModelSync, quotaRefreshMinutes: this.quotaRefreshMinutes, connected: false, account: null, expiresAt: null, error: error.code ?? 'CODEX_AUTH_REQUIRED', attempt: this.safeAttempt(), models: this.modelSync?.state() ?? null };
    }
    if (this.modelSync?.observeAccount(auth.account.id)) this.modelSync.tick(true).catch(() => {});
    // Explicit allowlist: no access/id/refresh token, raw document, or account id.
    return { enabled, showModelSync, quotaRefreshMinutes: this.quotaRefreshMinutes, connected: auth.expiresAt > this.now(),
      account: { key: createHash('sha256').update(auth.account?.id ?? '').digest('hex').slice(0, 16), email: auth.account?.email ?? null, plan: auth.account?.plan ?? null },
      expiresAt: auth.expiresAt, error: auth.expiresAt <= this.now() ? 'CODEX_TOKEN_EXPIRED' : null,
      attempt: this.safeAttempt(), models: this.modelSync?.state() ?? null };
  }

  async refreshModels() {
    if (!this.modelSync) throw new CodexAuthError('模型同步不可用。', 'CODEX_MODEL_SYNC_FAILED');
    await this.modelSync.refresh();
    return this.getState();
  }

  safeAttempt() {
    if (!this.attempt) return null;
    const { phase, authUrl, expiresAt, error } = this.attempt;
    return { phase, authUrl: authUrl ?? null, expiresAt: expiresAt ?? null, error: error ?? null };
  }

  async server(onNotification) {
    if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
    await this.beforeAuth();
    if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
    const server = this.createServer({ codexHome: this.source.codexHome, codexCommand: this.source.codexCommand, env: this.childEnvironment(), onNotification });
    this.servers ??= new Set(); this.servers.add(server);
    try {
      await server.initialize();
      if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
      return server;
    } catch (error) { server.close(); this.servers.delete(server); throw error; }
  }

  async refresh() {
    await this.beforeAuth();
    if (!this.refreshing) {
      this.refreshing = this.source.refresh();
      this.refreshing.finally(() => { this.refreshing = undefined; }).catch(() => {});
    }
    await this.refreshing;
    return this.getState();
  }

  assertQuotaActive() {
    if (this.disposed) throw new CodexAuthError('插件已停用。', 'CODEX_CANCELLED');
    if ((typeof this.enabled === 'function' ? this.enabled() : this.enabled) === false) {
      throw new CodexAuthError('请先启用 Codex 连接。', 'CODEX_CONNECTION_DISABLED');
    }
  }

  quota() {
    try { this.assertQuotaActive(); } catch (error) { return Promise.reject(error); }
    // Opening the page and a background tick share the same official RPC.
    if (!this.quotaPending) {
      this.quotaPending = this.readQuota();
      this.quotaPending.finally(() => { this.quotaPending = undefined; }).catch(() => {});
    }
    return this.quotaPending;
  }

  async readQuota() {
    const before = await this.source.read();
    this.assertQuotaActive();
    const server = await this.server();
    try {
      this.assertQuotaActive();
      const account = await server.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') throw new CodexAuthError('请使用 ChatGPT 登录 Codex。', 'CODEX_AUTH_REQUIRED');
      if (account.account.id && account.account.id !== before.account.id) throw new CodexAuthError('账号已变化，请重新读取额度。', 'CODEX_ACCOUNT_CHANGED');
      const result = await server.request('account/rateLimits/read');
      const after = await this.source.read();
      this.assertQuotaActive();
      if (before.account.id !== after.account.id) throw new CodexAuthError('账号已变化，请重新读取额度。', 'CODEX_ACCOUNT_CHANGED');
      const value = { buckets: normalizeQuota(result, after.account.id), fetchedAt: this.now() };
      // Commit only while this controller and account are still current.
      // A failed cache write never fails an otherwise successful quota read.
      try {
        await this.quotaStore?.write({ version: 1, accountKey: accountKey(after.account.id), ...value }, async () => {
          try {
            this.assertQuotaActive();
            const current = await this.source.read();
            this.assertQuotaActive();
            return current.account.id === after.account.id;
          } catch { return false; }
        }, this.quotaAbort.signal);
      } catch { /* cache only */ }
      const current = await this.source.read();
      this.assertQuotaActive();
      if (current.account.id !== after.account.id) throw new CodexAuthError('账号已变化，请重新读取额度。', 'CODEX_ACCOUNT_CHANGED');
      return { ...value, identity: accountKey(after.account.id).slice(0, 16) };
    } finally { server.close(); this.servers.delete(server); }
  }

  /**
   * The last successful read for the currently signed-in account. Reads one
   * small file and never starts the Codex app-server, so the settings page can
   * paint the previous quota immediately and refresh behind it.
   */
  async cachedQuota() {
    if (this.disposed || !this.quotaStore) return null;
    try {
      const auth = await this.source.read();
      const cached = await this.quotaStore.read();
      const current = await this.source.read();
      // Another account's snapshot is not this account's quota, including an
      // account switch that happens while the disk read is in progress.
      const identity = accountKey(current.account.id);
      if (this.disposed || !cached || accountKey(auth.account.id) !== identity || cached.accountKey !== identity) return null;
      return { buckets: cached.buckets, fetchedAt: cached.fetchedAt, cached: true, identity: identity.slice(0, 16) };
    } catch { return null; }
  }

  async startLogin() {
    if (this.loginStarting) return this.loginStarting;
    if (this.attempt?.phase === 'waiting-browser') return this.getState();
    this.loginStarting = this.beginLogin();
    try { return await this.loginStarting; } finally { this.loginStarting = undefined; }
  }

  async beginLogin() {
    this.attempt = { phase: 'starting' };
    try {
      this.loginServer = await this.server((method, params) => {
        if (method === 'account/login/completed' && (!params?.loginId || params.loginId === this.attempt?.id)) {
          this.attempt = { phase: params?.success ? 'succeeded' : 'failed', error: params?.success ? null : 'CODEX_LOGIN_FAILED' };
          clearTimeout(this.loginTimer);
          this.loginServer?.close(); this.loginServer = undefined;
          for (const server of this.servers ?? []) if (server.closed) this.servers.delete(server);
        } else if (method === 'dsh/serverClosed' && ['starting', 'waiting-browser'].includes(this.attempt?.phase)) {
          this.attempt = { phase: 'failed', error: params.code };
          clearTimeout(this.loginTimer);
        }
      });
      const result = await this.loginServer.request('account/login/start', { type: 'chatgpt' });
      const url = new URL(result.authUrl);
      if (result.type !== 'chatgpt' || typeof result.loginId !== 'string' || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) {
        throw new CodexAuthError('Codex 返回了无法识别的登录地址。', 'CODEX_LOGIN_FAILED');
      }
      if (this.attempt.phase === 'starting') {
        this.attempt = { phase: 'waiting-browser', id: result.loginId, authUrl: url.href, expiresAt: this.now() + 600000 };
        this.loginTimer = setTimeout(() => { this.cancelLogin('expired').catch(() => {}); }, 600000);
        this.loginTimer.unref?.();
      }
      return this.getState();
    } catch (error) {
      this.loginServer?.close(); this.loginServer = undefined;
      this.attempt = { phase: 'failed', error: error.code ?? 'CODEX_LOGIN_FAILED' };
      throw error;
    }
  }

  async cancelLogin(phase = 'cancelled') {
    clearTimeout(this.loginTimer);
    const server = this.loginServer, id = this.attempt?.id;
    // Set terminal state before closing; process-exit notices cannot overwrite it.
    this.attempt = { phase };
    try { if (server && id) await server.request('account/login/cancel', { loginId: id }); }
    finally { server?.close(); this.loginServer = undefined; }
    return this.getState();
  }

  dispose() {
    this.disposed = true;
    this.quotaAbort.abort();
    clearTimeout(this.loginTimer);
    this.attempt = { phase: 'cancelled' };
    for (const server of this.servers ?? []) server.close();
    this.servers?.clear();
  }
}

export function authRpcHandler(controller) {
  const methods = new Map([['state', () => controller.getState()], ['refresh', () => controller.refresh()], ['quota', () => controller.quota()], ['cached', () => controller.cachedQuota()], ['login', () => controller.startLogin()], ['cancel', () => controller.cancelLogin()], ['models', () => controller.refreshModels()]]);
  return async (endpoint, payload) => {
    if (!methods.has(endpoint) || payload === null || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
      return { ok: false, error: { code: 'CODEX_BAD_REQUEST', message: '无法识别的授权操作。', details: {} } };
    }
    try { return { ok: true, value: await methods.get(endpoint)() }; }
    catch (error) { return { ok: false, error: { code: error instanceof CodexAuthError ? error.code : 'CODEX_OPERATION_FAILED', message: 'Codex 操作未完成，请检查网络或重新登录。', details: {} } }; }
  };
}
