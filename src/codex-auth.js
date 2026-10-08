import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export class CodexAuthError extends Error {
  constructor(message, code = 'CODEX_AUTH_REQUIRED') {
    super(message);
    this.name = 'CodexAuthError';
    this.code = code;
  }
}

// Decode only for expiry/account checks. OpenAI validates the actual signature.
export function parseCodexAuth(document) {
  if (document?.auth_mode !== undefined && document.auth_mode !== 'chatgpt') {
    throw new CodexAuthError('Codex must be signed in with ChatGPT. Run codex login; an API key does not use your Codex subscription.');
  }
  const token = document?.tokens?.access_token;
  let claims;
  try {
    if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new CodexAuthError('The Codex login cache has no valid ChatGPT access token. Run codex login.');
  }
  const account = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  if (!Number.isFinite(claims.exp) || claims.exp <= 0 || typeof account !== 'string' || !account) {
    throw new CodexAuthError('The Codex login cache is missing subscription account or expiry information. Run codex login.');
  }
  if (document.tokens.account_id && document.tokens.account_id !== account) {
    throw new CodexAuthError('The account in the Codex login cache does not match its access token. Run codex login.');
  }
  const profile = claims['https://api.openai.com/profile'];
  const metadata = claims['https://api.openai.com/auth'];
  return { token, expiresAt: claims.exp * 1000, account: {
    id: account,
    email: typeof profile?.email === 'string' ? profile.email.slice(0, 254) : null,
    plan: typeof metadata.chatgpt_plan_type === 'string' ? metadata.chatgpt_plan_type.slice(0, 80) : null,
  } };
}

export async function readCodexAuth(codexHome) {
  let raw;
  try {
    raw = await readFile(resolve(codexHome, 'auth.json'), 'utf8');
  } catch {
    throw new CodexAuthError('Cannot read Codex auth.json. This plugin requires file-based ChatGPT login storage; run codex -c cli_auth_credentials_store=\"file\" login.');
  }
  let document;
  try { document = JSON.parse(raw); } catch {
    throw new CodexAuthError('Codex auth.json is not valid JSON. Run codex login.');
  }
  return parseCodexAuth(document);
}

// Refresh through the official app-server. Never rotate/write refresh tokens here.
export function refreshWithCodex({ codexHome, codexCommand, env = process.env, timeoutMs = 45000, spawnProcess = spawn }) {
  return new Promise((resolvePromise, reject) => {
    let child;
    let settled = false;
    let buffer = '';
    let outputBytes = 0;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.stdin?.end();
      child?.kill();
      error ? reject(error) : resolvePromise();
    };
    const timer = setTimeout(() => finish(new CodexAuthError('Codex token refresh timed out. Check the active proxy/VPN and codex login.', 'CODEX_REFRESH_TIMEOUT')), timeoutMs);
    try {
      child = spawnProcess(codexCommand, ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"'], {
        env: { ...env, CODEX_HOME: codexHome },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch {
      finish(new CodexAuthError('Cannot start the Codex CLI. Set codexCommand to the installed executable path.', 'CODEX_CLI_UNAVAILABLE'));
      return;
    }
    const send = (message) => {
      if (!settled && !child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n');
    };
    child.on('error', () => finish(new CodexAuthError('Cannot start the Codex CLI. Set codexCommand to its absolute path.', 'CODEX_CLI_UNAVAILABLE')));
    child.stdin.on('error', () => finish(new CodexAuthError('The Codex CLI closed its authentication connection.', 'CODEX_REFRESH_FAILED')));
    child.on('exit', () => finish(new CodexAuthError('Codex exited before refreshing the login. Run codex login.', 'CODEX_REFRESH_FAILED')));
    // Consume diagnostics without ever forwarding potentially sensitive provider text.
    child.stderr.on('data', () => {});
    child.stdout.on('data', (data) => {
      if (settled) return;
      outputBytes += data.length;
      if (outputBytes > 1024 * 1024) {
        finish(new CodexAuthError('Codex returned too much authentication output.', 'CODEX_REFRESH_FAILED'));
        return;
      }
      buffer += data.toString('utf8');
      let end;
      while (!settled && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 1 && message.id !== 2) continue;
        if (message.error) {
          finish(new CodexAuthError('Codex could not renew its ChatGPT login. Check the proxy, then run codex login.', 'CODEX_REFRESH_FAILED'));
        } else if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/read', params: { refreshToken: true } });
        } else if (message.result?.account?.type === 'chatgpt') {
          finish();
        } else {
          finish(new CodexAuthError('The Codex CLI is not signed in with ChatGPT. Run codex login.'));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dsh_openai_auth', title: 'DeepSeek Harness OpenAI Auth', version: '0.3.0' } } });
  });
}

const renewals = new Map();

function cancellable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise((resolvePromise, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export class CodexTokenSource {
  constructor(options = {}) {
    this.codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? resolve(homedir(), '.codex'));
    this.codexCommand = options.codexCommand ?? 'codex';
    this.skewMs = (options.refreshSkewSeconds ?? 300) * 1000;
    this.read = options.read ?? (() => readCodexAuth(this.codexHome));
    this.refresh = options.refresh ?? (() => refreshWithCodex({ codexHome: this.codexHome, codexCommand: this.codexCommand, env: typeof options.childEnvironment === 'function' ? options.childEnvironment() : options.childEnvironment ?? process.env }));
    this.now = options.now ?? Date.now;
  }

  async accessToken(signal) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    const current = await this.read();
    if (current.expiresAt > this.now() + this.skewMs) return current.token;
    let pending = renewals.get(this.codexHome);
    if (!pending) {
      pending = (async () => {
        // Recheck after another client might have renewed its cache.
        const latest = await this.read();
        if (latest.expiresAt <= this.now() + this.skewMs) await this.refresh();
        const fresh = await this.read();
        if (fresh.expiresAt <= this.now()) throw new CodexAuthError('Codex renewed its login but the cached token is still expired. Run codex login.', 'CODEX_REFRESH_FAILED');
        return fresh.token;
      })();
      renewals.set(this.codexHome, pending);
      pending.finally(() => { if (renewals.get(this.codexHome) === pending) renewals.delete(this.codexHome); }).catch(() => {});
    }
    return cancellable(pending, signal);
  }
}
