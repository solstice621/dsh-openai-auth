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
  constructor({ source, enabled = true, beforeAuth, childEnvironment, modelSync, quotaStore, createServer = options => new CodexAppServer(options), now = Date.now }) {
    Object.assign(this, { source, enabled, beforeAuth, childEnvironment, modelSync, quotaStore, createServer, now });
  }

  async getState() {
    const enabled = typeof this.enabled === 'function' ? this.enabled() : this.enabled;
    let auth;
    try { auth = await this.source.read(); } catch (error) {
      this.modelSync?.observeAccount(undefined);
      return { enabled, connected: false, account: null, expiresAt: null, error: error.code ?? 'CODEX_AUTH_REQUIRED', attempt: this.safeAttempt(), models: this.modelSync?.state() ?? null };
    }
    if (this.modelSync?.observeAccount(auth.account.id)) this.modelSync.tick(true).catch(() => {});
    // Explicit allowlist: no access/id/refresh token, raw document, or account id.
    return { enabled, connected: auth.expiresAt > this.now(),
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
    await this.beforeAuth();
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

  async quota() {
    const before = await this.source.read();
    const server = await this.server();
    try {
      const account = await server.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') throw new CodexAuthError('请使用 ChatGPT 登录 Codex。', 'CODEX_AUTH_REQUIRED');
      const result = await server.request('account/rateLimits/read');
      const after = await this.source.read();
      if (before.account.id !== after.account.id) throw new CodexAuthError('账号已变化，请重新读取额度。', 'CODEX_ACCOUNT_CHANGED');
      const value = { buckets: normalizeQuota(result, after.account.id), fetchedAt: this.now() };
      // Remember it for the next page load; a failed write never fails the read.
      try { await this.quotaStore?.write({ version: 1, accountKey: accountKey(after.account.id), ...value }); } catch { /* cache only */ }
      return value;
    } finally { server.close(); this.servers.delete(server); }
  }

  /**
   * The last successful read for the currently signed-in account. Reads one
   * small file and never starts the Codex app-server, so the settings page can
   * paint the previous quota immediately and refresh behind it.
   */
  async cachedQuota() {
    if (!this.quotaStore) return null;
    let auth;
    try { auth = await this.source.read(); } catch { return null; }
    const cached = await this.quotaStore.read();
    // Another account's snapshot is not this account's quota.
    if (!cached || cached.accountKey !== accountKey(auth.account.id)) return null;
    return { buckets: cached.buckets, fetchedAt: cached.fetchedAt, cached: true };
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
