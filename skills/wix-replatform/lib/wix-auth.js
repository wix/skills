'use strict';

// The CLI site token (`npx --no-install wix token --site`, written by scripts/mint-token.sh) is
// short-lived, and `wix token` may hand back a cached token with only part of its life left. A
// token source renews it from the token's own `exp` and on a refusal, for the SAME site only.
// When renewal cannot help, the run is INTERRUPTED (`wix_auth_expired`): never a record outcome.
// The token value is never printed, logged or put in an error.

const crypto = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { readEnvFile } = require('./config-env.js');

const WIX_AUTH_EXPIRED = 'wix_auth_expired';
const WIX_AUTH_EXIT_CODE = 75;
// Site tokens live for about four hours. Renew with roughly thirty minutes left, or once the
// token has been held for about three and a half hours, so a long batch does not start with a
// credential that is likely to expire before its records finish.
const RENEW_WITHIN_MS = 30 * 60 * 1000;
const MAX_TOKEN_AGE_MS = 3.5 * 60 * 60 * 1000;
const RENEWAL_WINDOW_MS = 30 * 60 * 1000;
const MAX_RENEWALS_PER_WINDOW = 5;
const MINT_TIMEOUT_MS = 120 * 1000;

const REASONS = Object.freeze({
  mint_failed: 'scripts/mint-token.sh did not produce a token',
  token_missing: 'config/wix.env has no WIX_AUTH_TOKEN',
  config_unreadable: 'config/wix.env could not be read',
  site_mismatch: 'config/wix.env names a different site than this run',
  still_rejected: 'Wix refused the request again after the token was renewed',
  renewal_limit: 'the token was renewed too often in a short time',
});
const AUTH_EXPIRED_REASON = 'auth_expired';

const OPERATOR_ACTION = 'run `npx --no-install wix whoami` (log in if asked), then `bash scripts/mint-token.sh` in the migration project, answer the wix_auth_expired action, and resume the import; do not re-run from scratch';

class WixAuthInterruption extends Error {
  constructor(reason, { httpStatus } = {}) {
    super(`${WIX_AUTH_EXPIRED}: ${REASONS[reason] || reason}. Requires Import Operator: ${OPERATOR_ACTION}.`);
    this.name = 'WixAuthInterruption';
    this.code = WIX_AUTH_EXPIRED;
    this.interruption = true;
    this.reason = reason;
    // A refused or never-sent request was not applied, but outcome code must not read this as a
    // target decision about the record: it carries no `status`, so no 4xx branch can claim it.
    this.outcomeKnown = false;
    this.requestApplied = false;
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus;
  }
}

// A SIGTERM/SIGINT stop: the run is recording what it knows, so no new request is sent and no
// record outcome is invented for one that was refused here. Same latch, same handling.
const IMPORT_STOPPING = 'import_stopping';
class ImportStopRequested extends Error {
  constructor(signal) {
    super(`${IMPORT_STOPPING}: the import received ${signal} and is recording what it knows; no new request is sent.`);
    this.name = 'ImportStopRequested';
    this.code = IMPORT_STOPPING;
    this.interruption = true;
    this.signal = signal;
    this.outcomeKnown = false;
    this.requestApplied = false;
  }
}

function isRunInterruption(error) {
  return Boolean(error && error.interruption === true && (error.code === WIX_AUTH_EXPIRED || error.code === IMPORT_STOPPING));
}

// One latch per project in this process: once renewal fails, every client and the attempt
// journal refuse to go on until the Import Operator renews the token and the run resumes.
const latched = new Map();
function interruptionFor(projectDir) {
  return projectDir ? latched.get(path.resolve(projectDir)) || null : null;
}
// Latches a stop: every token-source client then refuses locally, and the journal refuses a new
// `started` row. An earlier wix_auth_expired latch is kept (it is the stop's real cause).
function latchStop(projectDir, signal) {
  const root = path.resolve(projectDir);
  if (!latched.has(root)) latched.set(root, new ImportStopRequested(signal));
  return latched.get(root);
}
// Only for a resume in the same process after the Import Operator renewed the token.
function clearInterruption(projectDir) {
  latched.delete(path.resolve(projectDir));
}

function bareToken(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '');
}

function isApiKey(token) {
  return /^IST\./.test(bareToken(token));
}

// `OauthNG.JWS.<header>.<payload>.<signature>`: the payload's `exp` (seconds) is the only claim
// read. Any segment that decodes to a JSON object with a numeric `exp` counts; anything else is
// "unknown", which leaves only the on-refusal renewal.
function tokenExpiresAt(token) {
  for (const segment of bareToken(token).split('.')) {
    if (segment.length < 8) continue;
    try {
      const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (claims && typeof claims === 'object' && Number.isFinite(claims.exp)) return claims.exp * 1000;
    } catch {
      // not a JSON segment
    }
  }
  return null;
}

function tokenIssuedAt(token) {
  for (const segment of bareToken(token).split('.')) {
    if (segment.length < 8) continue;
    try {
      const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (claims && typeof claims === 'object' && Number.isFinite(claims.iat)) return claims.iat * 1000;
    } catch {
      // not a JSON segment
    }
  }
  return null;
}

function isAuthExpired(error) {
  return Boolean(error && (error.authExpired === true || error.reason === AUTH_EXPIRED_REASON || error.code === AUTH_EXPIRED_REASON));
}

function authExpiredError({ httpStatus = 401 } = {}) {
  const error = new Error(`${AUTH_EXPIRED_REASON}: the Wix site token was refused after one refresh; retry this record after the token is renewed`);
  error.name = 'WixAuthExpiredError';
  error.code = AUTH_EXPIRED_REASON;
  error.reason = AUTH_EXPIRED_REASON;
  error.authExpired = true;
  error.outcomeKnown = true;
  error.requestApplied = false;
  if (Number.isInteger(httpStatus)) error.status = httpStatus;
  return error;
}

function runMintScript(projectDir) {
  return new Promise((resolve, reject) => {
    // stdout and stderr are discarded: the script writes the token to config/wix.env only.
    execFile('bash', [path.join(projectDir, 'scripts', 'mint-token.sh')], { cwd: projectDir, timeout: MINT_TIMEOUT_MS }, (error) => {
      if (error) reject(Object.assign(new Error('mint-token.sh failed'), { exitCode: error.code }));
      else resolve();
    });
  });
}

// `mint(projectDir)` and `now()` are injectable for tests; the default runs the project's own
// scripts/mint-token.sh, which mints for config/wix.env's WIX_SITE_ID.
function createWixTokenSource({ projectDir, siteId, mint = runMintScript, now = Date.now, renewWithinMs = RENEW_WITHIN_MS, maxTokenAgeMs = renewWithinMs === RENEW_WITHIN_MS ? MAX_TOKEN_AGE_MS : Infinity } = {}) {
  if (!projectDir || !siteId) throw new Error('createWixTokenSource: projectDir and siteId are required');
  const root = path.resolve(projectDir);
  const envPath = path.join(root, 'config', 'wix.env');
  let token = null;
  let expiresAt = null;
  let issuedAt = null;
  let inFlight = null;
  // `wix token` may hand back the same cached token. Once a renewal returned a token that is
  // still inside the renewal window, that token is used until it is refused, not renewed again
  // on every request.
  let keptAfterRenewal = null;
  const renewals = [];

  function fail(reason, extra) {
    const error = Object.assign(new WixAuthInterruption(reason, extra), { siteId });
    if (!latched.has(root)) latched.set(root, error);
    return latched.get(root);
  }

  async function readSiteEnv() {
    let env;
    try {
      env = await readEnvFile(envPath);
    } catch {
      throw fail('config_unreadable');
    }
    if (String(env.WIX_SITE_ID || '').trim() !== siteId) throw fail('site_mismatch');
    return env;
  }

  async function load() {
    const value = bareToken((await readSiteEnv()).WIX_AUTH_TOKEN);
    if (!value) throw fail('token_missing');
    token = value;
    expiresAt = isApiKey(value) ? null : tokenExpiresAt(value);
    issuedAt = isApiKey(value) ? null : tokenIssuedAt(value);
    return token;
  }

  async function renew() {
    const interrupted = latched.get(root);
    if (interrupted) throw interrupted;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const at = now();
      while (renewals.length && at - renewals[0] > RENEWAL_WINDOW_MS) renewals.shift();
      if (renewals.length >= MAX_RENEWALS_PER_WINDOW) throw fail('renewal_limit');
      renewals.push(at);
      // mint-token.sh mints for the site in config/wix.env: check it is this run's site first.
      await readSiteEnv();
      try {
        await mint(root);
      } catch {
        throw fail('mint_failed');
      }
      const renewed = await load();
      // The mint script may return the CLI's cached token. It is still the result of this
      // bounded refresh attempt, so do not invoke the mint again on every following request;
      // the request-refusal path will make one later retry if the CLI cache was stale.
      keptAfterRenewal = renewed;
      return renewed;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  const source = {
    siteId,
    projectDir: root,
    get interruption() { return latched.get(root) || null; },
    expiresAt: () => expiresAt,
    // The token to send now, renewed first when it has under `renewWithinMs` left.
    async current() {
      const interrupted = latched.get(root);
      if (interrupted) throw interrupted;
      if (inFlight) return inFlight;
      if (token === null) await load();
      const age = issuedAt === null ? null : now() - issuedAt;
      const shouldRenew = (expiresAt !== null && expiresAt - now() < renewWithinMs)
        || (age !== null && age >= maxTokenAgeMs);
      if (shouldRenew && token !== keptAfterRenewal) return renew();
      return token;
    },
    // True when `sent` is no longer the token in use: another request already renewed it, so a
    // refusal of `sent` needs only a resend.
    replaced(sent) {
      return token !== null && sent !== token;
    },
    // A refusal of the token that was SENT is expiry when that token can renew: 401 always; 403
    // only once that token's own `exp` has passed, because a 403 is otherwise a permission answer
    // that a new token would not change.
    isExpiryRefusal(status, sent = token) {
      if (!sent || isApiKey(sent)) return false;
      if (status === 401) return true;
      const sentExpiresAt = tokenExpiresAt(sent);
      return status === 403 && sentExpiresAt !== null && sentExpiresAt <= now();
    },
    renew,
    fail,
  };
  return Object.freeze(source);
}

// The resumable stop. One pending manual_action per site; a still-pending one is reused.
const AUTH_EXPIRED_NS = 'wix-auth-expired';
function sequencedRequestId(key, n) {
  const hex = crypto.createHash('sha256').update(`${AUTH_EXPIRED_NS}\0${key}\0${n}`).digest('hex');
  return `uar_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function recordWixAuthExpired(projectDir, { siteId, reason } = {}) {
  if (!siteId) throw new Error('recordWixAuthExpired: siteId is required');
  const { createUserAction, readUserAction } = require('./user-actions.js');
  let n = 1;
  let latest = null;
  for (;; n += 1) {
    let action = null;
    try {
      action = await readUserAction(projectDir, sequencedRequestId(siteId, n));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!action) break;
    latest = action;
  }
  if (latest && latest.status === 'pending') return latest;
  return createUserAction(projectDir, {
    requestId: sequencedRequestId(siteId, n),
    kind: 'manual_action',
    stage: 'execution',
    title: 'Renew the Wix site token and resume the import',
    prompt: `Requires Import Operator. The import stopped with ${WIX_AUTH_EXPIRED}${reason && REASONS[reason] ? ` (${REASONS[reason]})` : ''}. No record was marked failed. In the original migration environment, ${OPERATOR_ACTION}.`,
    response: { mode: 'none' },
    choices: [],
    subject: { type: WIX_AUTH_EXPIRED, siteId },
  });
}

// The exit code for a script's top-level catch: an interruption records its resumable action
// and exits WIX_AUTH_EXIT_CODE; anything else exits 1 as before.
async function stopExitCode(error, projectDir) {
  if (!isRunInterruption(error) || error.code !== WIX_AUTH_EXPIRED || !projectDir || !error.siteId) return 1;
  try {
    await recordWixAuthExpired(projectDir, { siteId: error.siteId, reason: error.reason });
  } catch (recordError) {
    process.stderr.write(`could not record the ${WIX_AUTH_EXPIRED} action: ${recordError.message}\n`);
  }
  return WIX_AUTH_EXIT_CODE;
}

module.exports = {
  WIX_AUTH_EXPIRED,
  WIX_AUTH_EXIT_CODE,
  WixAuthInterruption,
  IMPORT_STOPPING,
  ImportStopRequested,
  latchStop,
  isRunInterruption,
  interruptionFor,
  clearInterruption,
  tokenExpiresAt,
  tokenIssuedAt,
  AUTH_EXPIRED_REASON,
  isAuthExpired,
  authExpiredError,
  createWixTokenSource,
  recordWixAuthExpired,
  stopExitCode,
};
