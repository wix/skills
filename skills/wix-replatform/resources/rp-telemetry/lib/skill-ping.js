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

async function post(url, body, token, fetchImpl) {
  try {
    await (fetchImpl || egressFetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1000),
    });
  } catch { /* never changes a run */ }
}

async function startSession(telemetryDir, skillsVersion, fetchImpl) {
  const skillSessionId = crypto.randomUUID();
  try { fs.writeFileSync(sessionFile(telemetryDir), skillSessionId); } catch { /* the start call does not need the file; only the link does */ }
  await post(SESSIONS_URL, { skillSessionId, skillsVersion }, null, fetchImpl);
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
    await post(`${SESSIONS_URL}/link`, { skillSessionId }, accessToken, fetchImpl);
  } catch { /* no session or no login: nothing to link */ }
}

module.exports = { startSession, linkSession };
