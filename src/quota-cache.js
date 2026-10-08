import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const MAX_BUCKETS = 20;

/** Account identity for the cache: a hash, never the account id itself. */
export const accountKey = id => createHash('sha256').update(String(id ?? '')).digest('hex');

function normalizeWindow(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Number.isFinite(value.usedPercent)) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, value.usedPercent)),
    durationMins: Number.isFinite(value.durationMins) ? value.durationMins : null,
    resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null,
  };
}

/** Re-validate what a previous run wrote; a stale or foreign document reads as absent. */
export function normalizeCachedBuckets(value) {
  if (!Array.isArray(value) || value.length > MAX_BUCKETS) throw new Error('Invalid quota cache');
  const buckets = value.map(bucket => ({
    id: typeof bucket?.id === 'string' ? bucket.id.slice(0, 100) : 'codex',
    name: typeof bucket?.name === 'string' ? bucket.name.slice(0, 100) : 'codex',
    primary: normalizeWindow(bucket?.primary),
    secondary: normalizeWindow(bucket?.secondary),
  }));
  return buckets.filter(bucket => bucket.primary || bucket.secondary);
}

export function quotaCacheFile(codexHome, env = process.env) {
  const homeKey = createHash('sha256').update(String(codexHome ?? '')).digest('hex').slice(0, 16);
  // Follow DSH_HOME so a relocated Harness home keeps its own cache.
  return resolve(env.DSH_HOME || resolve(homedir(), '.dsh'), 'cache', 'dsh-openai-auth', homeKey, 'quota.json');
}

/**
 * The last quota a successful read produced, so the settings page can render it
 * immediately instead of waiting for the Codex app-server. It holds rate-limit
 * windows only: no token, no account id, no provider text.
 */
export function quotaCacheStore(path) {
  return {
    async read() {
      try {
        const raw = await readFile(path, 'utf8');
        if (Buffer.byteLength(raw) > 262144) return null;
        const data = JSON.parse(raw);
        if (data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.accountKey) || !Number.isFinite(data.fetchedAt) || data.fetchedAt <= 0) return null;
        const buckets = normalizeCachedBuckets(data.buckets);
        if (!buckets.length) return null;
        return { version: 1, accountKey: data.accountKey, fetchedAt: data.fetchedAt, buckets };
      } catch { return null; }
    },
    async write(value) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
      finally { await rm(temporary, { force: true }); }
    },
    async clear() { await rm(path, { force: true }); },
  };
}
