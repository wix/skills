'use strict';

class ReadBackBudgetError extends Error {
  constructor(reason = 'read-budget-exhausted') {
    super(reason);
    this.code = reason;
  }
}
class ReadBackReads {
  constructor(client, {
    now = () => performance.now(),
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    budgetMs = 600000,
    settlementMs = 60000,
    pacingMs = 200
  } = {}) {
    Object.assign(this, {
      client,
      now,
      sleep,
      budgetMs,
      settlementMs,
      pacingMs
    });
    this.stats = {
      attempts: 0,
      timeouts: 0,
      readMs: 0,
      pacingMs: 0,
      retryMs: 0,
      settlementMs: 0
    };
    this.nextAt = 0;
    this.queue = Promise.resolve();
    this.wix = {
      send: request => this.send(request)
    };
  }
  remaining() {
    return Math.max(0, this.budgetMs - ['readMs', 'pacingMs', 'retryMs', 'settlementMs'].reduce((n, k) => n + this.stats[k], 0));
  }
  async timed(kind, fn) {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.stats[kind] += Math.max(0, this.now() - start);
    }
  }
  async wait(ms, kind) {
    if (ms > this.remaining()) throw new ReadBackBudgetError();
    await this.timed(kind, () => this.sleep(ms));
    if (this.remaining() <= 0) throw new ReadBackBudgetError();
  }
  async settle() {
    if (this.settlementMs - this.stats.settlementMs < 60000) throw new ReadBackBudgetError('media-settlement-exhausted');
    await this.wait(60000, 'settlementMs');
  }
  send(request) {
    const task = this.queue.then(() => this.attempt(request));
    this.queue = task.catch(() => {});
    return task;
  }
  async attempt(request) {
    for (let i = 0; i < 4; i++) {
      if (this.remaining() <= 0) throw new ReadBackBudgetError();
      const delay = Math.max(0, this.nextAt - this.now());
      if (delay) await this.wait(delay, 'pacingMs');
      this.stats.attempts++;
      try {
        const result = await this.timed('readMs', () => this.client.send(require('../resources/rp-target-wix/lib/wix-writers').buildBoundedReadRequest(request, Math.min(10000, this.remaining()))));
        this.nextAt = this.now() + this.pacingMs;
        return result;
      } catch (e) {
        this.nextAt = this.now() + this.pacingMs;
        if (e.readTimedOut) this.stats.timeouts++;
        if (e.status === 401 || e.status === 403) {
          e.code = e.status === 401 ? 'auth-failed' : 'permission-denied';
          throw e;
        }
        const retry = e.readTimedOut || !e.status || [429, 500, 502, 503, 504].includes(e.status) || e.status >= 200 && e.status < 300 && e.outcomeKnown === false || e.status === 404 && e.outcomeKnown === true;
        if (!retry || i === 3) {
          e.code ||= retry ? 'read-unavailable' : 'read-rejected';
          throw e;
        }
        await this.wait(e.status === 429 && e.retryAfterMs != null ? e.retryAfterMs : 1000 * 2 ** i, 'retryMs');
      }
    }
  }
}
module.exports = {
  ReadBackReads,
  ReadBackBudgetError
};
