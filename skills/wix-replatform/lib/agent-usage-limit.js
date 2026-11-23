'use strict';

// Detects that an agent turn stopped on a usage, token or rate limit, and when the
// limit resets. The run controller uses this to wait and resume by itself instead of
// ending the run for a human to restart (history class H39: 3-42 h idle per stop).
//
// Signals (from real vendor streams):
// - claude stream-json `result` with is_error and api_error_status 429 or
//   api_error "usage_limit_reached"; text "You've hit your 5-hour limit · resets 5:10pm (UTC)".
// - claude `rate_limit_event` with rate_limit_info.status "rejected" and resetsAt (epoch s).
//   Supplies the reset time only; a rejected event alone does not end a turn.
// - codex `error` / `turn.failed` events or stderr text such as
//   "You've hit your usage limit ... try again at 3:42 PM" or "try again in 2 hours".

// Only the vendors' own limit signals count. Text such as a bare "429" or "rate limit" is not
// enough: an agent turn that fails while describing a Wix 429 is not a vendor usage limit.
// Claude: structured api_error / api_error_status on the result. Codex: its usage-limit error
// (code `usage_limit_reached` / `usage_limit_exceeded`, or its fixed "hit your usage limit" text).
const CODEX_LIMIT_CODES = new Set(['usage_limit_reached', 'usage_limit_exceeded', 'UsageLimitExceeded', 'UsageLimitReached']);
const VENDOR_LIMIT_TEXT = /you'?ve hit your usage limit|usage_limit_(reached|exceeded)/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function tzOffsetMs(timeZone, date) {
  if (!timeZone || /^(utc|gmt|z)$/i.test(timeZone)) return 0;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  } catch {
    return null;
  }
}

// Wall-clock time in a zone → epoch ms. Two passes settle a DST edge.
function zonedToEpoch({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = tzOffsetMs(timeZone, new Date(guess));
  if (first === null) return null;
  const second = tzOffsetMs(timeZone, new Date(guess - first));
  return guess - (second === null ? first : second);
}

function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

// "resets 5:10pm (UTC)", "resets Nov 18, 5pm (Asia/Jerusalem)", "try again at 3:42 PM",
// "try again in 2 days 3 hours 5 minutes". Returns epoch ms or null.
function parseResetTime(text, now = Date.now()) {
  if (typeof text !== 'string' || !text) return null;
  const relative = text.match(/(?:try again|resets?|retry)\s+in\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+)/i);
  if (relative) {
    let ms = 0;
    for (const [, amount, unit] of relative[1].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const u = unit.toLowerCase();
      const factor = u.startsWith('d') ? 86400000 : u.startsWith('h') ? 3600000 : u.startsWith('m') ? 60000 : 1000;
      ms += Number(amount) * factor;
    }
    return ms > 0 ? now + ms : null;
  }
  const absolute = text.match(/(?:resets?|try again at|available again at|retry at)\s+(?:on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?:\s*\(([^)]+)\))?/i);
  if (!absolute) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = absolute;
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (meridiem) {
    const pm = /^p/i.test(meridiem);
    if (hour === 12) hour = pm ? 12 : 0; else if (pm) hour += 12;
  } else if (!minuteText) {
    return null; // a bare number is not a time
  }
  if (hour > 23 || minute > 59) return null;
  const timeZone = zone ? zone.trim() : localTimeZone();
  if (tzOffsetMs(timeZone, new Date(now)) === null) return null;
  const offset = tzOffsetMs(timeZone, new Date(now));
  const local = new Date(now + offset);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  let day = local.getUTCDate();
  const monthIndex = monthName ? MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) : -1;
  if (monthName && monthIndex < 0) return null;
  if (monthIndex >= 0) { month = monthIndex; day = Number(dayText); }
  let at = zonedToEpoch({ year, month, day, hour, minute }, timeZone);
  if (at === null) return null;
  if (at <= now) {
    if (monthIndex >= 0) at = zonedToEpoch({ year: year + 1, month, day, hour, minute }, timeZone);
    else at = zonedToEpoch({ year, month, day: day + 1, hour, minute }, timeZone);
  }
  return at;
}

function messageOf(raw) {
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.result === 'string') return raw.result;
  if (typeof raw.message === 'string') return raw.message;
  if (raw.error && typeof raw.error === 'object' && typeof raw.error.message === 'string') return raw.error.message;
  if (typeof raw.error === 'string') return raw.error;
  if (raw.item && typeof raw.item.message === 'string') return raw.item.message;
  if (typeof raw.text === 'string') return raw.text;
  return '';
}

// One vendor event → { terminal, resetsAt, message, source } or null.
// `terminal` means the turn stopped because of the limit; a non-terminal hit only
// carries the reset time for a later terminal hit.
function detectUsageLimitEvent(event, now = Date.now()) {
  if (!event) return null;
  if (event.type === 'vendor_stderr') {
    const message = String(event.message || '');
    if (!VENDOR_LIMIT_TEXT.test(message)) return null;
    return { terminal: true, resetsAt: parseResetTime(message, now), message: message.slice(0, 300), source: 'stderr' };
  }
  const raw = event.type === 'vendor_event' ? event.raw : event;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'rate_limit_event') {
    const info = raw.rate_limit_info || {};
    if (info.status !== 'rejected') return null;
    const resetsAt = Number.isFinite(Number(info.resetsAt)) && Number(info.resetsAt) > 0 ? Number(info.resetsAt) * 1000 : null;
    return { terminal: false, resetsAt, message: `rate limit rejected (${info.rateLimitType || 'unknown window'})`, source: 'rate_limit_event' };
  }
  if (raw.type === 'result') {
    const message = messageOf(raw);
    const limited = raw.is_error === true && (raw.api_error === 'usage_limit_reached' || raw.api_error === 'rate_limit' || (raw.api_error_status === 429 && raw.terminal_reason === 'api_error'));
    return limited ? { terminal: true, resetsAt: parseResetTime(message, now), message: message.slice(0, 300), source: 'result' } : null;
  }
  if (raw.type === 'error' || raw.type === 'turn.failed') {
    const message = messageOf(raw);
    const codes = [raw.code, raw.error?.code, raw.error?.type, raw.codex_error_info, raw.error?.codex_error_info].filter((value) => typeof value === 'string');
    if (!codes.some((code) => CODEX_LIMIT_CODES.has(code)) && !VENDOR_LIMIT_TEXT.test(message)) return null;
    return { terminal: true, resetsAt: parseResetTime(message, now), message: message.slice(0, 300), source: raw.type };
  }
  return null;
}

// Folds one detection into the turn's running state.
function mergeUsageLimit(current, hit) {
  if (!hit) return current;
  const next = current ? { ...current } : { terminal: false, resetsAt: null, message: null, source: null };
  if (hit.terminal) { next.terminal = true; next.message = hit.message; next.source = hit.source; }
  if (Number.isFinite(hit.resetsAt) && (!Number.isFinite(next.resetsAt) || hit.resetsAt > next.resetsAt)) next.resetsAt = hit.resetsAt;
  if (!next.message) next.message = hit.message;
  return next;
}

const DEFAULT_POLICY = Object.freeze({
  maxWaits: 3, // waits per supervisor run; then a clear blocker
  marginMs: 2 * 60000, // start a little after the stated reset
  backoffMs: 15 * 60000, // no reset time given: 15 m, 30 m, 60 m ...
  maxBackoffMs: 2 * 3600000,
  maxWaitMs: 6 * 3600000, // a longer reset (for example a weekly limit) is a blocker, not a silent day-long wait
});

// attempt is 0-based: how many waits already happened in this run.
function planUsageLimitWait(limit, { attempt = 0, now = Date.now(), policy = {} } = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  if (attempt >= p.maxWaits) return { wait: false, reason: 'retries_exhausted', attempt, maxWaits: p.maxWaits };
  if (Number.isFinite(limit?.resetsAt) && limit.resetsAt > now) {
    const waitMs = limit.resetsAt - now + p.marginMs;
    if (waitMs > p.maxWaitMs) return { wait: false, reason: 'reset_too_far', resetsAt: new Date(limit.resetsAt).toISOString(), waitMs, attempt, maxWaits: p.maxWaits };
    return { wait: true, waitMs, basis: 'reset_time', resetsAt: new Date(limit.resetsAt).toISOString(), attempt: attempt + 1, maxWaits: p.maxWaits };
  }
  const waitMs = Math.min(p.backoffMs * 2 ** attempt, p.maxBackoffMs);
  if (waitMs > p.maxWaitMs) return { wait: false, reason: 'reset_too_far', resetsAt: new Date(now + waitMs).toISOString(), waitMs, attempt, maxWaits: p.maxWaits };
  return { wait: true, waitMs, basis: 'backoff', resetsAt: null, attempt: attempt + 1, maxWaits: p.maxWaits };
}

module.exports = { DEFAULT_POLICY, parseResetTime, detectUsageLimitEvent, mergeUsageLimit, planUsageLimitWait };
