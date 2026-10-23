'use strict';

// Per-call time limits: every destination HTTP call is bounded by an explicit
// client-side timeout, and every wait goes through an injectable clock so the bounds can be
// proven with a fake clock instead of real minutes.

class CallTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`request timed out after ${timeoutMs} ms`);
    this.code = 'call_timeout';
    this.timeoutMs = timeoutMs;
  }
}

function realClock() {
  return {
    now: () => Date.now(),
    // A cancelled timer never resolves; nothing waits on it after cancellation.
    timer(ms) {
      let handle = null;
      const promise = new Promise((resolve) => {
        handle = setTimeout(resolve, Math.max(0, ms));
      });
      return { promise, cancel() { clearTimeout(handle); } };
    },
    sleep(ms) { return this.timer(ms).promise; },
  };
}

// One HTTP call: fetch plus body read, aborted at `timeoutMs`. Resolves to
// `{ status, headers, text, json }` (json is null when the body is not JSON) or rejects with
// CallTimeoutError (timeout) / the transport error (network). Never logs headers or bodies.
async function boundedRequest({ fetch, clock }, url, init, timeoutMs) {
  if (!(timeoutMs > 0)) throw new CallTimeoutError(0);
  const controller = new AbortController();
  const timer = clock.timer(timeoutMs);
  let timedOut = false;
  const timeout = timer.promise.then(() => {
    timedOut = true;
    controller.abort();
    throw new CallTimeoutError(timeoutMs);
  });
  const call = (async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return {
      status: response.status,
      retryAfter: response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null,
      text,
      json,
    };
  })();
  try {
    return await Promise.race([call, timeout]);
  } catch (error) {
    if (timedOut) throw new CallTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (!timedOut) timer.cancel();
    call.catch(() => {});
    timeout.catch(() => {});
  }
}

// Retry-After in seconds or an HTTP date; returns milliseconds or null.
function retryAfterMs(value, nowMs) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

module.exports = { CallTimeoutError, boundedRequest, isTransientStatus, realClock, retryAfterMs };
