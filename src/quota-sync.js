/** Quota polling owned by the backend, not by the settings page. */
export class QuotaSync {
  constructor({ enabled = () => true, readIdentity, readCached, refresh, intervalMinutes = 5,
    now = Date.now, schedule = callback => setInterval(callback, 60000), unschedule = clearInterval }) {
    Object.assign(this, { enabled, readIdentity, readCached, refresh, intervalMinutes, now, schedule, unschedule });
  }

  start() {
    if (this.disposed || this.started) return Promise.resolve();
    this.started = true;
    this.timer = this.schedule(() => { this.tick().catch(() => {}); });
    this.timer?.unref?.();
    return this.tick();
  }

  tick() {
    if (this.disposed || !this.enabled()) return Promise.resolve();
    if (!this.pending) {
      this.pending = this.poll();
      this.pending.finally(() => { this.pending = undefined; }).catch(() => {});
    }
    return this.pending;
  }

  async poll() {
    let identity;
    try { identity = await this.readIdentity(); }
    catch { return; } // No login: do not start a CLI or request the quota endpoint.
    if (this.disposed || !this.enabled()) return;
    if (identity !== this.identity) {
      this.identity = identity;
      this.lastAttemptAt = undefined;
    }
    let cached;
    try { cached = await this.readCached(); } catch { /* an unreadable cache is optional */ }
    if (this.disposed || !this.enabled()) return;
    const now = this.now(), interval = this.intervalMinutes * 60000;
    // A successful manual refresh or a recent snapshot from the previous run
    // also satisfies the polling interval. Never trust a future timestamp.
    if (Number.isFinite(cached?.fetchedAt) && cached.fetchedAt <= now && now - cached.fetchedAt < interval) return;
    if (this.lastAttemptAt !== undefined && now >= this.lastAttemptAt && now - this.lastAttemptAt < interval) return;
    this.lastAttemptAt = now;
    try { await this.refresh(); } catch { /* retain the last successful snapshot; retry next interval */ }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.started) this.unschedule(this.timer);
  }
}
