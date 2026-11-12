'use strict';

// Two calls to the site-import service: a session start before any login, and a link to the
// operator's account after login. Each has a 1 s limit and swallows every failure.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { egressFetch } = require('../../../lib/egress-proxy.js');

const SESSIONS_URL = 'https://www.wixapis.com/ecom/site-import/v1/skill-sessions';
const sessionFile = (telemetryDir) => path.join(telemetryDir, 'skill-session');

async function post(url, body, token, fetchImpl, extraHeaders) {
  try {
    await (fetchImpl || egressFetch)(url, {
      method: 'POST',
      headers: { ...extraHeaders, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1000),
    });
  } catch { /* never changes a run */ }
}

// Where this run lives, so people on their own machine and managed runs (the BIX sandbox) can be told apart
// in the count. A managed environment sets WIX_SKILLS_ORIGIN (the BIX sandbox sets `bix-sandbox`); on a
// person's own machine it is unset and the origin is `local`. It rides in the start request's User-Agent,
// not in the body: the service logs the User-Agent on every request (app_logs.user_agent) and needs no
// change. Only [0-9a-z._-]{1,32} goes out: other characters (spaces, slashes, control characters) become `-`
// and the rest is cut at 32, because a control character in a header makes the request throw and the whole
// start message would be lost; a value with nothing usable left is `invalid`. Counting only, never trust.
function skillOrigin(env = process.env) {
  const value = String(env.WIX_SKILLS_ORIGIN || '').trim().toLowerCase();
  if (!value) return 'local';
  const clean = value.replace(/[^0-9a-z._]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return clean || 'invalid';
}

// The version in the User-Agent and the body is the one the service accepts (^[0-9A-Za-z.+-]{1,32}$), or `unknown`.
const cleanVersion = (v) => (typeof v === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : 'unknown');
const userAgent = (version) => `wix-skills${version ? `/${version}` : ''} (origin=${skillOrigin()})`;

async function startSession(telemetryDir, rawVersion, fetchImpl) {
  const skillsVersion = cleanVersion(rawVersion);
  const skillSessionId = crypto.randomUUID();
  try { fs.writeFileSync(sessionFile(telemetryDir), skillSessionId); } catch { /* the start call does not need the file; only the link does */ }
  await post(SESSIONS_URL, { skillSessionId, skillsVersion }, null, fetchImpl, { 'user-agent': userAgent(skillsVersion) });
}

// Safe to call on every command: it links a session once, the first time a login with a live
// token exists, and costs two small file reads otherwise. An expired token is skipped without
// marking the session, so the next command (after the CLI refreshed it) tries again.
async function linkSession(telemetryDir, fetchImpl) {
  try {
    const skillSessionId = fs.readFileSync(sessionFile(telemetryDir), 'utf8').trim();
    const linked = path.join(telemetryDir, 'skill-session-linked');
    if (!skillSessionId || (fs.existsSync(linked) && fs.readFileSync(linked, 'utf8') === skillSessionId)) return;
    const { accessToken, issuedAt, expiresIn } = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.wix/auth/account.json'), 'utf8'));
    if (!accessToken || issuedAt + expiresIn < Date.now() / 1000) return;
    fs.writeFileSync(linked, skillSessionId);
    await post(`${SESSIONS_URL}/link`, { skillSessionId }, accessToken, fetchImpl, { 'user-agent': userAgent() });
  } catch { /* no session or no login: nothing to link */ }
}

module.exports = { startSession, linkSession };
