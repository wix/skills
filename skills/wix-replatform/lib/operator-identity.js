'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  execFileSync
} = require('node:child_process');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveOperatorIdentity({
  accountFile = path.join(os.homedir(), '.wix/auth/account.json'),
  readFile = fs.readFileSync
} = {}) {
  try {
    const id = JSON.parse(readFile(accountFile, 'utf8'))?.userInfo?.userId;
    return typeof id === 'string' && GUID.test(id) ? id : null;
  } catch {
    return null;
  }
}
function requireOperatorIdentity({
  whoami = () => execFileSync('wix', ['whoami'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore']
  }),
  now = () => new Date().toISOString(),
  ...options
} = {}) {
  const userId = resolveOperatorIdentity(options);
  let displayName;
  try {
    displayName = whoami()?.trim();
  } catch {/* fail closed below */}
  if (!userId || !displayName) throw new Error('Authenticated Wix user GUID and non-empty wix whoami identity required for approval');
  return {
    userId,
    displayName,
    source: 'wix-cli-session',
    observedAt: now()
  };
}
module.exports = {
  GUID,
  resolveOperatorIdentity,
  requireOperatorIdentity
};
