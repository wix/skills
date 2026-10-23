'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { statEnvKeys, readEnvFile } = require('./config-env.js');
const { SESSION_RECEIPT_FILE } = require('./source-access.js');
const {
  SOURCE_MODE_DECISION_KEYS,
  getDecisionValue,
  invalidSourceModeMessage,
  isKnownSourceMode,
  normalizeSourceMode,
} = require('./orchestration-decisions.js');

const SCHEMA_VERSION = 1;
const execFileAsync = promisify(execFile);

const SOURCE_CONFIG_BY_PLATFORM = {
  wordpress: ['WP_BASE_URL'],
  woocommerce: ['WP_BASE_URL'],
  shopify: ['SHOPIFY_STORE_URL'],
  // CSV is a file-provided flow: source.csv.env holds only optional
  // delimiter/encoding/vendor/rewrite hints, so no key is required. The
  // files_only branch above enforces fileInputPaths instead.
  csv: [],
};

const PRIVATE_SOURCE_CONFIG_BY_PLATFORM = {
  wordpress: ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD'],
  woocommerce: ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD'],
  // The store's *.myshopify.com domain, not a secret. The connection itself is the
  // operator's Shopify CLI session, proven by the session check (probeShopifySession), never by a
  // sourceCredentialRef string. SHOPIFY_STORE_URL stays the public storefront probe's key.
  shopify: ['SHOPIFY_SHOP_DOMAIN'],
};

// wix-wp-plugin-v2's migration key authenticates only the plugin's own /structure and
// /query routes. Track its presence in the preflight receipt, but never let it satisfy a
// private/authenticated WordPress REST requirement: wp/v2 and wc/v3 still need their own
// credential.
const MIGRATION_KEY_CREDENTIAL_BY_PLATFORM = {
  wordpress: 'WMH2_MIGRATION_KEY',
  woocommerce: 'WMH2_MIGRATION_KEY',
};

// Local signals that the user asked for authenticated capture. Only key names are ever
// reported, never values. WP_BASE_URL and WMH2_MIGRATION_KEY are not intent signals.
const AUTH_INTENT_ENV_KEYS = ['WP_USERNAME', 'WP_APPLICATION_PASSWORD'];

// `acquisitionMode` is not a decision key the product records, but earlier runs invented
// it from prose. A stray value naming authentication is still read as intent.
const STRAY_ACQUISITION_MODE_KEY = 'acquisitionMode';
const AUTH_INTENT_ACQUISITION_VALUES = ['authenticated', 'private', 'private_data'];

function rawDecisionValue(decisions, key) {
  const entry = decisions && decisions[key];
  return entry && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : null;
}

// Returns the key names of every local authenticated-intent signal found.
async function findAuthIntentSignals(projectDir, decisions, sourcePlatform, credentialRef) {
  const signals = [];
  if (sourcePlatform) {
    const sourceEnv = await statEnvKeys(configFileForPlatform(projectDir, sourcePlatform), AUTH_INTENT_ENV_KEYS);
    for (const key of AUTH_INTENT_ENV_KEYS) {
      if (sourceEnv.keys[key] === 'present') signals.push(key);
    }
  }
  if (credentialRef) signals.push('sourceCredentialRef');
  // A Shopify session receipt means a private connection was checked for this project.
  if (fs.existsSync(path.join(projectDir, SESSION_RECEIPT_FILE))) signals.push(SESSION_RECEIPT_FILE);
  // A second sourceMode spelling that names private mode conflicts with the resolved one.
  for (const key of SOURCE_MODE_DECISION_KEYS) {
    if (normalizeSourceMode(rawDecisionValue(decisions, key)) === 'private_data') signals.push(key);
  }
  const acquisitionMode = rawDecisionValue(decisions, STRAY_ACQUISITION_MODE_KEY);
  if (typeof acquisitionMode === 'string' && AUTH_INTENT_ACQUISITION_VALUES.includes(acquisitionMode.trim().toLowerCase())) {
    signals.push(STRAY_ACQUISITION_MODE_KEY);
  }
  return signals;
}

function makeCheck(id, label, status, message, details = {}) {
  return { id, label, status, message, ...details };
}

// Reports whether this project is recording telemetry. It only ever reports: the check never
// starts a journal on the run's behalf, because a check that quietly created one would report a
// healthy run it had just manufactured, and could attach a fresh journal to a project that
// already owns a finished one. Starting a journal stays in the run's own opening step.
//
// The reading comes from the recorder's own `status()` rather than a second presence test here,
// so "active" cannot drift from what the recorder means by it when the journal format moves.
function telemetryJournalCheck(projectDir) {
  const check = (journal, message, details = {}) =>
    // Always `info`: see the roll-up below. This line informs, it never gates.
    makeCheck('telemetry_journal', 'Telemetry recording', 'info', message, { journal, ...details });

  let result;
  try {
    // Required lazily, inside the guard, on purpose. A top-level require would make the whole
    // preflight module fail to load in any bundle shipped without rp-telemetry; lazily, that
    // case degrades to `unreadable` like any other unreadable record.
    //
    // `status()` is synchronous and reads the whole journal. At preflight time — once per
    // project, before discovery — the journal is empty or near-empty, so this is a trivial read.
    // It stops being trivial if this check is ever moved into the router, which runs on every
    // invocation. Do not move it there without re-deciding that.
    const { status } = require('../resources/rp-telemetry/lib/telemetry-recorder.js');
    result = status(projectDir);
  } catch (error) {
    // Preflight gates source configuration and destination credentials. It must not acquire a
    // new way to die on a project whose telemetry file is a truncated line of garbage.
    return check('unreadable', error && error.message ? error.message : String(error));
  }

  // `finalized_attempts` is present only when there is no journal file at all; the recorder
  // returns the replayed run state otherwise.
  if (Object.prototype.hasOwnProperty.call(result, 'finalized_attempts')) {
    return result.finalized_attempts > 0
      ? check('finalized_only', 'previous attempts were finalized; nothing is recording the current one')
      : check('absent', 'no telemetry journal for this project — this run is recording nothing');
  }
  if (!result.active) {
    return check('finalized_only', 'journal present but finalized; nothing is recording the current one');
  }
  if (!result.run_id) {
    // A journal file that replays to no run start — truncated, empty or garbage. `status()` does
    // not throw on one; it reports an open run with no identity. Calling that "recording" would
    // be a green line over a run that is recording nothing, which is the exact shape of thing
    // this check exists to stop, so it is reported as a record we could not read.
    return check('unreadable', 'telemetry journal is present but unreadable — no run start could be replayed from it');
  }
  return check('active', `recording (run ${result.run_id}, attempt ${result.attempt})`, {
    runId: result.run_id,
    attempt: result.attempt,
  });
}

const TELEMETRY_RECORDER = '../resources/rp-telemetry/lib/telemetry-recorder.js';

// Preflight decision → recorder dimension. Only decisions preflight already holds; everything
// else (operator identity, skills version/commit) the recorder resolves itself, and later
// dimensions arrive through the agent's own `dims` calls.
const TELEMETRY_DIMS_BY_DECISION = {
  sourcePlatform: 'source_platform',
  deliveryMode: 'delivery_mode',
  targetSiteStrategy: 'destination_strategy',
};

function telemetryDimsFromDecisions(decisions = {}) {
  const dims = {};
  for (const [decisionKey, dimKey] of Object.entries(TELEMETRY_DIMS_BY_DECISION)) {
    const value = getDecisionValue(decisions, decisionKey);
    if (value !== undefined && value !== null && value !== '') dims[dimKey] = value;
  }
  return dims;
}

// Keep each dimension the recorder's own validator accepts; drop, never fail on, the rest.
function acceptedTelemetryDims(recorder, dims = {}) {
  const accepted = {};
  for (const [key, value] of Object.entries(dims || {})) {
    try {
      Object.assign(accepted, recorder.validateDims({ [key]: value }));
    } catch {
      // A value the recorder rejects is dropped so the start itself still happens.
    }
  }
  return accepted;
}

// A filename-safe ISO-8601 instant (`:` is not a legal filename character on every OS).
function setAsideStamp(now) {
  const date = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
  return date.toISOString().replace(/:/g, '-');
}

// Moves `source` to `target` without ever replacing an existing `target`. A check-then-rename
// is racy (POSIX rename silently replaces a destination created in between), so the target is
// created by a hard link, which fails atomically with EEXIST when the name is taken. The source
// is removed only after the link exists and still names the same file, so every failure leaves
// both files as they were. Returns null on success, or the Error to report.
function moveAsideExclusive(source, target, targetName) {
  try {
    fs.linkSync(source, target);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return new Error(`cannot set the unreadable telemetry journal aside: ${targetName} already exists`);
    }
    return new Error(`cannot set the unreadable telemetry journal aside: ${error && error.message ? error.message : String(error)}`);
  }
  const a = fs.statSync(source, { throwIfNoEntry: false });
  const b = fs.statSync(target);
  if (!a || a.ino !== b.ino || a.dev !== b.dev) {
    return Object.assign(new Error('telemetry journal changed while it was being set aside; both files were kept'), { linked: true });
  }
  fs.unlinkSync(source);
  return null;
}

// The recovery step that runs right after the read-only `telemetry_journal` check.
//
// The check (above) only looks, so the report shows what was found rather than a healthy run
// this step just made. This step then starts recording when the reading says nothing is. It is
// called by the preflight script, never from inside `runPreflight`, which stays read-only.
//
// It never throws and never gates: every error becomes `recovery: 'failed'`, and the caller
// leaves the preflight verdict and exit code untouched. A failure is team-only evidence: the returned details and one progress line are the whole escalation.
async function recoverTelemetryJournal(projectDir, check, dims = {}, { now } = {}) {
  const failed = (error) => ({
    recovery: 'failed',
    recoveryError: error && error.message ? error.message : String(error),
  });
  try {
    const reading = check && check.journal;
    if (reading === 'active') return { recovery: 'not_needed' };

    // Act only on a fresh reading that still matches the check, so a start made between the
    // check and here (the agent's own) is not doubled into an extra session.
    const fresh = telemetryJournalCheck(projectDir);
    if (fresh.journal === 'active') return { recovery: 'not_needed' };
    if (fresh.journal !== reading) {
      return failed(new Error(`telemetry reading changed between check (${reading}) and recovery (${fresh.journal}); recovery did not act`));
    }

    // Required lazily, inside the guard, as the check does: a bundle without rp-telemetry
    // degrades to `failed` rather than failing preflight.
    const recorder = require(TELEMETRY_RECORDER);
    const startDims = acceptedTelemetryDims(recorder, dims);
    let setAsideFile = null;

    if (reading === 'unreadable') {
      // Recoverable only when the file is there and replays to no run start. Any other cause
      // (an unreadable directory, a read error) needs a human.
      const journalFile = recorder.journalPath(projectDir);
      const journal = recorder.readJournal(projectDir);
      if (!journal) return failed(new Error(fresh.message || 'telemetry journal could not be read'));
      if (recorder.replay(journal.records).runStart) {
        return failed(new Error(fresh.message || 'telemetry journal could not be read'));
      }
      // Moved aside byte-for-byte, next to the journal and outside `telemetry/runs/` so
      // attempt numbering is unaffected. Never deleted, truncated, rewritten or overwritten.
      setAsideFile = `events.unreadable-${setAsideStamp(now)}.jsonl`;
      const target = path.join(path.dirname(journalFile), setAsideFile);
      const moved = moveAsideExclusive(journalFile, target, setAsideFile);
      if (moved) return moved.linked ? { ...failed(moved), setAsideFile } : failed(moved);
    } else if (reading !== 'absent' && reading !== 'finalized_only') {
      return failed(new Error(`unknown telemetry reading: ${reading}`));
    }

    let started;
    try {
      started = await recorder.start(projectDir, startDims, now === undefined ? {} : { now });
    } catch (error) {
      return setAsideFile ? { ...failed(error), setAsideFile } : failed(error);
    }
    return {
      recovery: setAsideFile ? 'set_aside_and_started' : 'started',
      recoveredRunId: started.run_id,
      recoveredAttempt: started.attempt,
      ...(setAsideFile ? { setAsideFile } : {}),
    };
  } catch (error) {
    return failed(error);
  }
}

async function defaultProbeWixCli({ execFile = execFileAsync } = {}) {
  try {
    const { stdout } = await execFile('npx', ['@wix/cli@latest', 'whoami'], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const output = String(stdout || '').trim();
    if (!output) {
      return { available: true, authState: 'unknown', reason: 'wix whoami returned empty output' };
    }
    return {
      available: true,
      authState: 'authenticated',
      // `whoami` is the authority for the displayed identity; it is not necessarily an email.
      identity: output,
      email: output,
    };
  } catch (error) {
    return {
      available: false,
      authState: 'unknown',
      reason: error && error.message ? error.message : String(error),
    };
  }
}

// Runs the Shopify session check without installing anything and without asking
// the first-connection question; the result is the receipt, or the reason there is none.
async function defaultProbeShopifySession({ projectDir, shopDomain }) {
  try {
    // Lazily: the core preflight must load in a bundle without the Shopify adapter.
    const { runSessionCheck } = require('../resources/rp-source-shopify/lib/shopify-session.js');
    const { receipt } = await runSessionCheck({ projectDir, store: shopDomain, install: false, askFirstConnection: false });
    return { receipt };
  } catch (error) {
    return {
      receipt: null,
      code: error && error.code ? error.code : null,
      reason: error && error.message ? error.message : String(error),
      ...(error && error.details && Array.isArray(error.details.missingScopes) ? { missingScopes: error.details.missingScopes } : {}),
    };
  }
}

async function shopifySessionCheck(projectDir, probeShopifySession) {
  let shopDomain = null;
  try {
    const values = await readEnvFile(configFileForPlatform(projectDir, 'shopify'));
    shopDomain = String(values.SHOPIFY_SHOP_DOMAIN || '').trim().toLowerCase() || null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const label = 'Shopify CLI session';
  if (!shopDomain) return makeCheck('source_credentials', label, 'blocked', 'SHOPIFY_SHOP_DOMAIN is missing from source.shopify.env; the session check needs the store domain');
  const result = (await probeShopifySession({ projectDir, shopDomain })) || {};
  const receipt = result.receipt || null;
  if (!receipt) {
    const missing = Array.isArray(result.missingScopes) && result.missingScopes.length ? ` (missing scopes: ${result.missingScopes.join(', ')})` : '';
    return makeCheck('source_credentials', label, 'blocked', `no passing Shopify session check${missing}: ${result.reason || 'no session receipt'}. Run rp-source-shopify scripts/shopify-session-check.js.`, { missingScopes: result.missingScopes || [] });
  }
  const missingScopes = Array.isArray(receipt.missingScopes) ? receipt.missingScopes : ['(unknown)'];
  if (missingScopes.length) {
    return makeCheck('source_credentials', label, 'blocked', `the Shopify session is missing scopes: ${missingScopes.join(', ')}. Run rp-source-shopify scripts/shopify-session-check.js --connect.`, { missingScopes });
  }
  if (receipt.shopDomain !== shopDomain) {
    return makeCheck('source_credentials', label, 'blocked', `the Shopify session is for ${receipt.shopDomain || 'an unrecorded store'}, not SHOPIFY_SHOP_DOMAIN=${shopDomain}`, { shopDomain: receipt.shopDomain || null });
  }
  return makeCheck('source_credentials', label, 'pass', `Shopify CLI session checked for ${shopDomain}`, { shopDomain, cliVersion: receipt.cliVersion || null, apiVersion: receipt.apiVersion || null });
}

function configFileForPlatform(projectDir, platform) {
  return path.join(projectDir, 'config', `source.${platform}.env`);
}

async function runPreflight(projectDir, artifacts, options = {}) {
  const probeWixCli = options.probeWixCli || defaultProbeWixCli;
  const probeShopifySession = options.probeShopifySession || defaultProbeShopifySession;
  const progress = options.progress || null;
  const checks = [];
  const decisions = artifacts.decisions || {};
  const sourceMode = getDecisionValue(decisions, 'sourceMode');
  const sourcePlatform = getDecisionValue(decisions, 'sourcePlatform');
  const deliveryMode = getDecisionValue(decisions, 'deliveryMode');
  const targetSiteStrategy = getDecisionValue(decisions, 'targetSiteStrategy');
  const fileInputPaths = getDecisionValue(decisions, 'fileInputPaths');
  const credentialRef = getDecisionValue(decisions, 'sourceCredentialRef');

  checks.push(
    !sourceMode
      ? makeCheck('source_mode', 'Source acquisition mode', 'blocked', 'sourceMode decision is missing')
      : isKnownSourceMode(sourceMode)
        ? makeCheck('source_mode', 'Source acquisition mode', 'pass', `sourceMode=${sourceMode}`)
        : makeCheck('source_mode', 'Source acquisition mode', 'blocked', invalidSourceModeMessage(sourceMode)),
  );
  progress?.progress('Checked source acquisition mode', { phase: 'preflight', step: 'source-mode' });

  if ((sourceMode === 'private_data' || sourceMode === 'authenticated_api') && !(sourcePlatform in PRIVATE_SOURCE_CONFIG_BY_PLATFORM)) {
    checks.push(
      credentialRef
        ? makeCheck('source_credentials', 'Source credential reference', 'pass', 'credential reference present')
        : makeCheck('source_credentials', 'Source credential reference', 'blocked', 'private/authenticated mode requires sourceCredentialRef'),
    );
    progress?.progress('Checked source credential reference', { phase: 'preflight', step: 'source-credentials' });
  }

  // Shopify private data: a sourceCredentialRef never satisfies this; only a passing session check
  // for the configured store does.
  if ((sourceMode === 'private_data' || sourceMode === 'authenticated_api') && sourcePlatform === 'shopify') {
    checks.push(await shopifySessionCheck(projectDir, probeShopifySession));
    progress?.progress('Checked Shopify CLI session', { phase: 'preflight', step: 'source-credentials' });
  }

  if (sourceMode === 'files_only' || getDecisionValue(decisions, 'includeAdditionalFiles') === true) {
    const files = Array.isArray(fileInputPaths) ? fileInputPaths : [];
    checks.push(
      files.length > 0
        ? makeCheck('file_inputs', 'Input files', 'pass', `${files.length} file input path(s) recorded`)
        : makeCheck('file_inputs', 'Input files', 'blocked', 'file-based flow requires fileInputPaths'),
    );
    progress?.progress('Checked file inputs', { phase: 'preflight', step: 'file-inputs' });
  }

  checks.push(
    deliveryMode
      ? makeCheck('delivery_mode', 'Delivery mode', 'pass', `deliveryMode=${deliveryMode}`)
      : makeCheck('delivery_mode', 'Delivery mode', 'blocked', 'deliveryMode decision is missing'),
  );
  checks.push(
    targetSiteStrategy
      ? makeCheck('target_site_strategy', 'Target site strategy', 'pass', `targetSiteStrategy=${targetSiteStrategy}`)
      : makeCheck('target_site_strategy', 'Target site strategy', 'blocked', 'targetSiteStrategy decision is missing'),
  );
  progress?.progress('Checked delivery and target site decisions', { phase: 'preflight', step: 'target-decisions' });

  const wixEnv = await statEnvKeys(path.join(projectDir, 'config', 'wix.env'), ['WIX_SITE_STRATEGY', 'WIX_SITE_ID', 'WIX_AUTH_TOKEN']);
  checks.push(makeCheck('wix_env', 'Wix config file', wixEnv.exists ? 'pass' : 'blocked', wixEnv.exists ? 'wix.env exists' : 'wix.env is missing', { keyStatus: wixEnv.keys }));
  progress?.progress('Checked Wix config file', { phase: 'preflight', step: 'wix-env' });

  if (targetSiteStrategy === 'existing_site') {
    const siteIdStatus = wixEnv.keys.WIX_SITE_ID;
    checks.push(
      siteIdStatus === 'present'
        ? makeCheck('wix_site_id', 'Existing site id', 'pass', 'WIX_SITE_ID present')
        : makeCheck('wix_site_id', 'Existing site id', 'blocked', `WIX_SITE_ID is ${siteIdStatus}`),
    );
    progress?.progress('Checked existing Wix site id', { phase: 'preflight', step: 'wix-site-id' });
  }

  if (sourcePlatform) {
    const isPrivateMode = sourceMode === 'private_data' || sourceMode === 'authenticated_api';
    const migrationKeyField = isPrivateMode ? MIGRATION_KEY_CREDENTIAL_BY_PLATFORM[sourcePlatform] : null;
    const requiredSourceKeys =
      isPrivateMode
        ? (PRIVATE_SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || [])
        : (SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || []);
    const keysToCheck = migrationKeyField ? [...requiredSourceKeys, migrationKeyField] : requiredSourceKeys;
    if (keysToCheck.length > 0) {
      const sourceEnv = await statEnvKeys(configFileForPlatform(projectDir, sourcePlatform), keysToCheck);
      // The migration key is useful for bridge reads, but it does not authenticate wp/v2 or
      // wc/v3. A private/authenticated source mode therefore still requires the Application
      // Password pair; otherwise preflight would advance a knowingly incomplete capture.
      const nonCredentialKeys = migrationKeyField
        ? requiredSourceKeys.filter((key) => key !== 'WP_USERNAME' && key !== 'WP_APPLICATION_PASSWORD')
        : requiredSourceKeys;
      const nonCredentialGood = nonCredentialKeys.every((key) => sourceEnv.keys[key] === 'present');
      const applicationPasswordGood = !migrationKeyField
        || (sourceEnv.keys.WP_USERNAME === 'present' && sourceEnv.keys.WP_APPLICATION_PASSWORD === 'present');
      const migrationKeyGood = migrationKeyField && sourceEnv.keys[migrationKeyField] === 'present';
      const allGood = nonCredentialGood && applicationPasswordGood;
      // Report bridge-key availability separately from the credential that satisfies the
      // selected source scope. The router consumes `status`, so explanatory prose must never
      // be the only thing distinguishing complete from incomplete readiness.
      const credentialMode = !migrationKeyField
        ? null
        : sourceEnv.keys.WP_USERNAME === 'present' && sourceEnv.keys.WP_APPLICATION_PASSWORD === 'present'
          ? 'application-password'
          : 'none';
      checks.push(
        makeCheck(
          'source_env',
          'Source config file',
          allGood ? 'pass' : 'blocked',
          sourceEnv.exists ? `checked source.${sourcePlatform}.env` : `source.${sourcePlatform}.env is missing`,
          credentialMode
            ? { keyStatus: sourceEnv.keys, credentialMode, bridgeMigrationKeyAvailable: Boolean(migrationKeyGood) }
            : { keyStatus: sourceEnv.keys },
        ),
      );
      progress?.progress(`Checked source ${sourcePlatform} config file`, { phase: 'preflight', step: 'source-env', entity: sourcePlatform });
    }
  }

  // Fail closed when the run is configured public but local signals say the user asked
  // for authenticated capture: a public capture would silently drop private data.
  if (sourceMode === 'public_content') {
    const signals = await findAuthIntentSignals(projectDir, decisions, sourcePlatform, credentialRef);
    if (signals.length > 0) {
      checks.push(
        makeCheck(
          'source_auth_intent',
          'Authenticated capture intent',
          'blocked',
          `you asked for authenticated capture but are configured public (sourceMode=public_content); found ${signals.join(', ')}. Record sourceMode=private_data, or remove these signals to confirm public-only capture.`,
          { signals },
        ),
      );
    }
    progress?.progress('Checked authenticated capture intent', { phase: 'preflight', step: 'source-auth-intent' });
  }

  progress?.progress('Wix CLI probe started', { phase: 'preflight', step: 'wix-cli' });
  const wixCli = progress
    ? await progress.withHeartbeat({ phase: 'preflight', step: 'wix-cli', message: 'Still probing Wix CLI' }, probeWixCli)
    : await probeWixCli();
  checks.push(
    wixCli.available
      ? makeCheck('wix_cli_available', 'Wix CLI availability', 'pass', 'Wix CLI probe succeeded', { cli: wixCli })
      : makeCheck('wix_cli_available', 'Wix CLI availability', 'blocked', wixCli.reason || 'Wix CLI probe failed', { cli: wixCli }),
  );
  checks.push(
    wixCli.authState === 'authenticated'
      ? makeCheck('wix_cli_auth', 'Wix CLI auth state', 'pass', 'Wix CLI is authenticated', { cli: wixCli })
      : makeCheck('wix_cli_auth', 'Wix CLI auth state', 'blocked', wixCli.reason || 'Wix CLI auth could not be confirmed', { cli: wixCli }),
  );
  progress?.progress('Checked Wix CLI availability and auth', { phase: 'preflight', step: 'wix-cli' });

  // Last on purpose: it reads as a note, not a prerequisite.
  checks.push(telemetryJournalCheck(projectDir));
  progress?.progress('Checked telemetry recording', { phase: 'preflight', step: 'telemetry-journal' });

  const blocked = checks.filter((check) => check.status === 'blocked');
  const failed = checks.filter((check) => check.status === 'failed');
  // `info` is non-gating BY DESIGN and must stay out of both branches below. A local run, a
  // rehearsal or a one-off repair may legitimately proceed with no telemetry journal; what they
  // may not do is proceed without anyone knowing. Folding `info` into `blocked` would turn every
  // such run into a halt. If you are here to "fix" a status the roll-up ignores: it is ignored
  // deliberately, and the readiness tests asserting `status === 'pass'` are the standing proof.
  const status = failed.length > 0 ? 'failed' : blocked.length > 0 ? 'blocked' : 'pass';

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    updatedAt: new Date().toISOString(),
    checks,
  };
}

module.exports = {
  SCHEMA_VERSION,
  defaultProbeWixCli,
  defaultProbeShopifySession,
  runPreflight,
  recoverTelemetryJournal,
  telemetryDimsFromDecisions,
};
