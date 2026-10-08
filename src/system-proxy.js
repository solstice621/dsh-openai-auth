import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexAuthError } from './codex-auth.js';

const execute = promisify(execFile);

export function parseSystemProxy(text) {
  const field = name => text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.*?)\\s*$`, 'm'))?.[1];
  const proxy = scheme => {
    if (field(`${scheme}Enable`) !== '1') return undefined;
    const host = field(`${scheme}Proxy`), port = Number(field(`${scheme}Port`));
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CodexAuthError('The active macOS HTTP proxy is invalid. Check system proxy settings.', 'SYSTEM_PROXY_INVALID');
    }
    const url = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`);
    return url.href.replace(/\/$/, '');
  };
  const http = proxy('HTTP'), https = proxy('HTTPS');
  if (!http && !https && (field('ProxyAutoConfigEnable') === '1' || field('SOCKSEnable') === '1')) {
    throw new CodexAuthError('This Codex plugin needs a static HTTP/HTTPS system proxy. PAC/SOCKS-only settings are not supported by the Harness transport.', 'SYSTEM_PROXY_UNSUPPORTED');
  }
  const exceptions = text.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]+)\}/)?.[1] ?? '';
  const bypass = [...exceptions.matchAll(/^\s*\d+\s*:\s*(.*?)\s*$/gm)].map(match => match[1]);
  return {
    ...(http ? { HTTP_PROXY: http } : {}),
    ...(https ? { HTTPS_PROXY: https } : {}),
    NO_PROXY: [...new Set(['localhost', '127.0.0.1', '::1', ...bypass])].join(','),
  };
}

export async function readSystemProxy() {
  try {
    const { stdout } = await execute('/usr/sbin/scutil', ['--proxy'], { timeout: 5000, maxBuffer: 65536 });
    return parseSystemProxy(stdout);
  } catch (error) {
    if (error instanceof CodexAuthError) throw error;
    throw new CodexAuthError('Cannot read the macOS system proxy. Restart Harness or disable useSystemProxy to use an explicitly configured Harness proxy.', 'SYSTEM_PROXY_UNAVAILABLE');
  }
}

// The official transport owns the process-wide dispatcher and its restoration.
// Do not rewire it during an in-flight request: changes require a Host restart.
export class SystemProxyBridge {
  constructor({ enabled, hostProxied, install, read = readSystemProxy, report = () => {} }) {
    this.enabled = enabled && !hostProxied;
    this.install = install;
    this.read = read;
    this.report = report;
  }

  async start() {
    if (!this.enabled) return;
    this.environment = await this.read();
    this.snapshot = JSON.stringify(this.environment);
    if (this.environment.HTTP_PROXY || this.environment.HTTPS_PROXY) {
      this.release = await this.install({ get: name => this.environment[name] ? { value: this.environment[name] } : undefined }, this.report);
    }
  }

  async ensure() {
    if (!this.enabled) return;
    if (this.changed || JSON.stringify(await this.read()) !== this.snapshot) {
      this.changed = true;
      await this.dispose();
      throw new CodexAuthError('The macOS system proxy changed. Restart DeepSeek Harness so Codex requests use the current proxy. No request was sent.', 'SYSTEM_PROXY_CHANGED');
    }
  }

  async dispose() {
    const release = this.release;
    this.release = undefined;
    await release?.();
  }
}
