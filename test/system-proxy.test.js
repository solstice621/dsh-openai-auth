import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSystemProxy, SystemProxyBridge } from '../src/system-proxy.js';

const settings = `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : proxy.example.internal
  HTTPPort : 8080
  HTTPSEnable : 1
  HTTPSProxy : proxy.example.internal
  HTTPSPort : 8080
  ExceptionsList : <array> {
    0 : localhost
    1 : *.example.internal
  }
}`;

test('reads active HTTP proxies and system exceptions; disabled proxies stay absent', () => {
  const env = parseSystemProxy(settings);
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example.internal:8080');
  assert(env.NO_PROXY.includes('*.example.internal'));
  assert.equal(parseSystemProxy(settings.replace('HTTPEnable : 1', 'HTTPEnable : 0').replace('HTTPSEnable : 1', 'HTTPSEnable : 0')).HTTPS_PROXY, undefined);
  assert.throws(() => parseSystemProxy('SOCKSEnable : 1'), /PAC\/SOCKS/);
  assert.throws(() => parseSystemProxy(settings.replace('HTTPSPort : 8080', 'HTTPSPort : 0')), /invalid/);
});

test('uses the official dispatcher, restores it on proxy changes, and blocks that request', async () => {
  let current = parseSystemProxy(settings), installed = 0, restored = 0;
  const bridge = new SystemProxyBridge({ enabled: true, hostProxied: false,
    read: async () => current,
    install: async env => { installed++; assert.equal(env.get('HTTPS_PROXY').value, current.HTTPS_PROXY); return async () => { restored++; }; },
  });
  await bridge.start(); await bridge.ensure();
  assert.equal(installed, 1);
  current = { NO_PROXY: 'localhost' };
  await assert.rejects(bridge.ensure(), /No request was sent/);
  assert.equal(restored, 1);
  await assert.rejects(bridge.ensure(), /Restart/);
  current = parseSystemProxy(settings);
  await assert.rejects(bridge.ensure(), /Restart/);
  await bridge.dispose();
  assert.equal(restored, 1);
});

test('preserves explicit Harness proxy configuration and never reads system settings in that case', async () => {
  const bridge = new SystemProxyBridge({ enabled: true, hostProxied: true,
    read: () => { throw Error('must not read'); }, install: () => { throw Error('must not override'); },
  });
  await bridge.start(); await bridge.ensure(); await bridge.dispose();
});
