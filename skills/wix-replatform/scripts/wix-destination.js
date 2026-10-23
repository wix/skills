#!/usr/bin/env node
'use strict';

// Deterministic destination coordinator CLI. rp-destination runs this instead of
// composing creation requests itself. It prints a JSON outcome (never credentials) and exits
// 0 when the destination is ready, 3 when a durable user action is waiting, 4 when blocked.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const { ensureDestination } = require('../lib/destination.js');
const { realClock } = require('../lib/destination-http.js');
const { buildWixDashboardUrl } = require('../lib/wix-dashboard-url.js');

const execFileAsync = promisify(execFile);
const CLI = ['@wix/cli@latest'];

function usage() {
  return [
    'Usage:',
    '  node scripts/wix-destination.js ensure --project-dir <dir>',
    '',
    'Resolves the one destination for a new-site migration: asks for the site type when it is',
    'missing, delegates Headless to wix-headless-scaffold.js, creates a Studio/Harmony site',
    'through the API, verifies its editor and that it is unpublished, and records',
    'orchestration/destination.json. Never publishes, unpublishes or deletes a site, and never',
    'repeats a create whose outcome is unknown.',
  ].join('\n');
}

// Credentials come from the operator's existing Wix CLI login. Values stay in memory only.
async function cliToken(args) {
  const { stdout } = await execFileAsync('npx', [...CLI, 'token', ...args], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const token = String(stdout || '').trim().split(/\r?\n/).pop();
  return token || null;
}

function defaultCredentials() {
  return {
    async identity() {
      try {
        const { stdout } = await execFileAsync('npx', [...CLI, 'whoami'], { timeout: 30_000, maxBuffer: 1024 * 1024 });
        const identity = String(stdout || '').trim();
        return { authenticated: Boolean(identity), identity: identity || null };
      } catch {
        return { authenticated: false, identity: null };
      }
    },
    // The login's user id, which the creation response's metaSite.ownerId must match. `wix
    // whoami` prints only an email, so it is read from the CLI's own login record (the same
    // source rp-telemetry uses); a missing or unreadable record fails before any create.
    async userId() {
      try {
        const raw = await fs.readFile(path.join(os.homedir(), '.wix', 'auth', 'account.json'), 'utf8');
        const value = JSON.parse(raw)?.userInfo?.userId;
        return typeof value === 'string' && value ? value : null;
      } catch {
        return null;
      }
    },
    accountToken: () => cliToken([]),
    siteToken: (metaSiteId) => cliToken(['--site', metaSiteId]),
  };
}

function defaultHeadless({ projectDir, businessName }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'wix-headless-scaffold.js'), '--business-name', businessName, '--project-dir', projectDir], {
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); process.stderr.write(chunk); });
    child.on('close', (code) => resolve({ ok: code === 0, message: code === 0 ? null : stderr.trim().split(/\r?\n/).pop() }));
  });
}

function defaultDeps() {
  return {
    fetch: globalThis.fetch,
    clock: realClock(),
    credentials: defaultCredentials(),
    headless: defaultHeadless,
    randomUUID: () => crypto.randomUUID(),
  };
}

function exitCodeFor(outcome) {
  if (['verified', 'created', 'existing_destination', 'not_new_site'].includes(outcome)) return 0;
  if (['awaiting_site_type', 'awaiting_editor_website_decision', 'awaiting_account_confirmation', 'awaiting_recovery', 'failed_before_create', 'ambiguous'].includes(outcome)) return 3;
  if (outcome === 'blocked' || outcome === 'locked') return 4;
  return 1;
}

// The printed summary omits nothing an operator needs and contains no credential.
function summarize(result) {
  const receipt = result.receipt || null;
  return {
    outcome: result.outcome,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.errors ? { errors: result.errors } : {}),
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(receipt ? {
      status: receipt.status,
      siteType: receipt.requestedSiteType,
      creationMethod: receipt.creationMethod,
      metaSiteId: receipt.metaSiteId,
      observedEditorType: receipt.observedEditorType,
      editorUrl: receipt.editorUrl,
      publication: receipt.publication ? receipt.publication.state : null,
      error: receipt.error,
      recoveryRequestId: receipt.recovery ? receipt.recovery.requestId : null,
      dashboardUrl: receipt.metaSiteId ? buildWixDashboardUrl(receipt.metaSiteId) : null,
    } : {}),
  };
}

async function main(argv = process.argv.slice(2), deps = defaultDeps()) {
  const command = argv[0];
  if (!command || command === '--help' || command === 'help') {
    console.log(usage());
    return command ? 0 : 1;
  }
  const index = argv.indexOf('--project-dir');
  if (command !== 'ensure' || index === -1 || !argv[index + 1]) {
    console.error(usage());
    return 1;
  }
  const result = await ensureDestination(path.resolve(argv[index + 1]), deps);
  process.stdout.write(`${JSON.stringify(summarize(result), null, 2)}\n`);
  return exitCodeFor(result.outcome);
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { defaultDeps, exitCodeFor, main, summarize };
