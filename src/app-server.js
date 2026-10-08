import { spawn } from 'node:child_process';
import { CodexAuthError } from './codex-auth.js';

// Official account and model RPC only. Raw provider output never reaches the UI.
export class CodexAppServer {
  constructor({ codexHome, codexCommand, env = process.env, spawnProcess = spawn, timeoutMs = 45000, onNotification = () => {} }) {
    this.pending = new Map();
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.onNotification = onNotification;
    try {
      this.child = spawnProcess(codexCommand, ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', 'cli_auth_credentials_store="file"'], {
        env: { ...env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
      });
    } catch {
      throw new CodexAuthError('无法启动 Codex，请检查插件中的 Codex 路径。', 'CODEX_CLI_UNAVAILABLE');
    }
    this.child.on('error', () => this.fail('CODEX_CLI_UNAVAILABLE'));
    this.child.on('exit', () => this.fail('CODEX_SERVER_EXITED'));
    this.child.stdin.on('error', () => this.fail('CODEX_SERVER_EXITED'));
    this.child.stderr.on('data', () => {});
    let buffer = '';
    this.child.stdout.on('data', data => {
      if (this.closed) return;
      buffer += data.toString('utf8');
      if (Buffer.byteLength(buffer) > 1024 * 1024) { this.fail('CODEX_PROTOCOL_ERROR'); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0 && !this.closed) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(new CodexAuthError('Codex 操作失败，请检查网络或重新登录。', 'CODEX_RPC_FAILED'));
          else pending.resolve(message.result);
        } else if (typeof message.method === 'string') {
          try { this.onNotification(message.method, message.params); } catch { /* owner isolates notices */ }
        }
      }
    });
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'dsh_openai_auth', title: 'Harness OpenAI Auth', version: '0.3.0' } });
    this.send({ method: 'initialized' });
    return this;
  }

  send(message) {
    if (this.closed) throw new CodexAuthError('Codex 连接已关闭，请重试。', 'CODEX_SERVER_EXITED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(new CodexAuthError('Codex 连接已关闭，请重试。', 'CODEX_SERVER_EXITED'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAuthError('Codex 操作超时，请检查当前网络和代理。', 'CODEX_RPC_TIMEOUT'));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch { this.fail('CODEX_SERVER_EXITED'); }
    });
  }

  fail(code) {
    this.close(new CodexAuthError('Codex 连接中断，请检查可执行文件和网络后重试。', code));
    this.onNotification('dsh/serverClosed', { code });
  }

  close(error = new CodexAuthError('Codex 操作已取消。', 'CODEX_CANCELLED')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child.stdin.end(); this.child.kill();
  }
}
