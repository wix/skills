#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readEnvFile, upsertEnvFile, statEnvKeys } = require('../lib/config-env.js');

function usage() {
  return [
    'Usage:',
    '  node scripts/wix-headless-scaffold.js --business-name <name> [--folder-name frontend] [--site-template commerce] [--project-dir <dir>]',
    '',
    'Runs the Wix headless scaffold non-interactively through npm create.',
    'Idempotent: safe to re-invoke against the same project (spec 0085) — adopts an',
    'existing destination receipt instead of re-scaffolding, and never spawns a second',
    'site when config/wix.env or frontend/wix.config.json already name one.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    folderName: 'frontend',
    siteTemplate: 'blank',
    projectDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--business-name':
        args.businessName = argv[i + 1];
        i += 1;
        break;
      case '--folder-name':
        args.folderName = argv[i + 1];
        i += 1;
        break;
      case '--site-template':
        args.siteTemplate = argv[i + 1];
        i += 1;
        break;
      case '--project-dir':
        args.projectDir = argv[i + 1];
        i += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

async function readWixConfig(frontendDir) {
  try {
    const raw = await fs.readFile(path.join(frontendDir, 'wix.config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.siteId === 'string' && parsed.siteId.trim() !== '') {
      return parsed;
    }
    return null;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return null;
    }
    throw error;
  }
}

async function readWixEnvValues(wixEnvPath) {
  try {
    return await readEnvFile(wixEnvPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function isNonEmptyDir(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function defaultSpawnScaffold(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', [
      '--yes',
      'create',
      '@wix/new@latest',
      '--',
      'headless',
      '--business-name',
      args.businessName,
      '--folder-name',
      args.folderName,
      '--site-template',
      args.siteTemplate,
      '--skip-install',
    ], {
      cwd: path.resolve(args.projectDir),
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code: signal ? 1 : (code == null ? 1 : code) });
    });
  });
}

// Removes WIX_SCAFFOLD_STATUS entirely (not just blanking its value, which config-env.js's
// upsertEnvFile cannot do and which would itself read back as a present-but-unrecognized
// value) — used only when a spawn-launch failure proves nothing could have been created,
// so the next invocation sees a genuinely untouched config/wix.env, not a lingering marker.
async function clearWixScaffoldStatus(wixEnvPath) {
  let raw;
  try {
    raw = await fs.readFile(wixEnvPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const hadTrailingNewline = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  if (hadTrailingNewline && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return true;
    }
    const idx = line.indexOf('=');
    return idx === -1 || line.slice(0, idx).trim() !== 'WIX_SCAFFOLD_STATUS';
  });
  const out = kept.join('\n');
  await fs.writeFile(wixEnvPath, out === '' ? '' : `${out}\n`, 'utf8');
}

// Persists WIX_SITE_ID from a confirmed receipt, re-checking for a conflict immediately
// before the write (config/wix.env can change between the top-of-invocation read and now).
// Uses statEnvKeys' placeholder-aware classification for the conflict check — PR #184
// review correction: comparing the raw value directly treated a template placeholder
// (e.g. WIX_SITE_ID=REPLACE_WITH_REAL_VALUE) as a real, conflicting destination, which
// made this throw instead of persisting on the very first scaffold of a freshly
// templated project, silently discarding the receipt this function exists to confirm.
async function persistSiteId(wixEnvPath, siteId, scaffoldStatus) {
  const currentStatus = (await statEnvKeys(wixEnvPath, ['WIX_SITE_ID'])).keys.WIX_SITE_ID;
  if (currentStatus === 'present') {
    const current = await readWixEnvValues(wixEnvPath);
    if (current.WIX_SITE_ID !== siteId) {
      throw new Error(
        `config/wix.env's WIX_SITE_ID (${current.WIX_SITE_ID}) no longer matches the scaffold's own wix.config.json (${siteId}); refusing to overwrite a different destination.`,
      );
    }
  }
  await upsertEnvFile(wixEnvPath, { WIX_SITE_ID: siteId, WIX_SCAFFOLD_STATUS: scaffoldStatus });
}

// spec 0085: safe to call more than once against the same project directory, including
// after its own prior partial failure. Every branch below either confirms a destination
// receipt before returning success, or fails closed without touching config/wix.env.
async function ensureDestinationReceipt(args, { spawnScaffold = defaultSpawnScaffold } = {}) {
  const projectDir = path.resolve(args.projectDir);
  const frontendDir = path.join(projectDir, args.folderName);
  const wixEnvPath = path.join(projectDir, 'config', 'wix.env');

  const siteIdStatus = (await statEnvKeys(wixEnvPath, ['WIX_SITE_ID'])).keys.WIX_SITE_ID;
  const envValues = await readWixEnvValues(wixEnvPath);
  const wixConfig = await readWixConfig(frontendDir);

  if (siteIdStatus === 'present') {
    // Case 1: config/wix.env already names a destination — checked first, independent of
    // wix.config.json, so an env-only receipt (adopted/existing destination, or a lost
    // frontend folder) can never fall through to spawning a second site.
    if (wixConfig && wixConfig.siteId !== envValues.WIX_SITE_ID) {
      // 1b — conflicting.
      throw new Error(
        `config/wix.env already has WIX_SITE_ID=${envValues.WIX_SITE_ID}, but ${frontendDir}/wix.config.json names a different siteId=${wixConfig.siteId}. Refusing to create or adopt a second destination — resolve the conflict manually.`,
      );
    }
    // 1a — consistent (wix.config.json is absent, has no siteId, or matches).
    const status = envValues.WIX_SCAFFOLD_STATUS;
    if (status === undefined || status === 'complete') {
      return { siteId: envValues.WIX_SITE_ID };
    }
    if (status === 'incomplete') {
      throw new Error(
        `Destination ${envValues.WIX_SITE_ID} already exists, but a prior scaffold attempt did not complete (WIX_SCAFFOLD_STATUS=incomplete). Refusing to spawn again — that would risk a duplicate site. Resolve manually before retrying.`,
      );
    }
    throw new Error(
      `config/wix.env has an unrecognized WIX_SCAFFOLD_STATUS value (${JSON.stringify(status)}); expected "complete", "incomplete", or the key to be absent. Refusing to proceed.`,
    );
  }

  // Case 2: no confirmed real WIX_SITE_ID (missing, blank, or a placeholder — all treated
  // alike here, matching case 1's classification). PR #184 review correction: this branch
  // must also inspect WIX_SCAFFOLD_STATUS, not just wix.config.json's existence — a bare
  // "wix.config.json exists" check cannot tell a genuinely legacy/host-adopted receipt
  // apart from one left behind by a scaffold attempt this script itself started but never
  // finished recording (the wrapper crashed, or was killed, after the CLI created the site
  // but before persistSiteId ran). Silently adopting the latter as "complete" is the same
  // laundering bug as case 1 exists to prevent, just reached from the opposite direction.
  const status = envValues.WIX_SCAFFOLD_STATUS;
  if (status === 'in_progress') {
    if (wixConfig) {
      // A prior invocation marked in_progress before spawning (see 2c below) and never
      // got to record a final outcome. The CLI may well have finished — never infer
      // "complete" from an orphaned receipt like this. Persist it as incomplete (the same
      // durable, fail-closed record a known non-zero exit produces) so the *next*
      // invocation adopts and blocks via case 1's existing, tested handling instead of
      // this ambiguity recurring indefinitely.
      await persistSiteId(wixEnvPath, wixConfig.siteId, 'incomplete');
      throw new Error(
        `A prior scaffold attempt was interrupted before it could record its outcome (WIX_SCAFFOLD_STATUS=in_progress), but a destination was found (WIX_SITE_ID=${wixConfig.siteId}). Persisted as incomplete — resolve manually before retrying.`,
      );
    }
    // PR #184 review correction (round 6): no local receipt either does NOT mean nothing
    // was created remotely — a crash could have happened after a remote site was created
    // but before wix.config.json was written locally (or even before the frontend folder
    // existed at all), which isNonEmptyDir below cannot detect. Fail closed
    // unconditionally rather than falling through to 2b/2c; the one case that clears this
    // marker for a safe automatic retry is a genuine spawn-launch failure (see 2c) — that
    // is handled before this marker is ever left behind, not by re-reading it here.
    throw new Error(
      'A prior scaffold attempt was interrupted before it could record any outcome (WIX_SCAFFOLD_STATUS=in_progress) and no local destination receipt (wix.config.json) exists either. This cannot be safely distinguished from a remote site having been created before a local receipt was written. Refusing to retry automatically — confirm whether a destination already exists, then either record its WIX_SITE_ID manually or clear WIX_SCAFFOLD_STATUS from config/wix.env if nothing was actually created.',
    );
  }
  if (status !== undefined) {
    // WIX_SCAFFOLD_STATUS is set to something else (a known-ambiguous marker from this
    // script, or corrupted state) while no real WIX_SITE_ID exists. Fail closed rather
    // than silently proceeding as though nothing were recorded.
    throw new Error(
      `config/wix.env has WIX_SCAFFOLD_STATUS=${JSON.stringify(status)} but no valid WIX_SITE_ID; this cannot be automatically resolved. Refusing to proceed automatically — resolve manually.`,
    );
  }

  if (wixConfig) {
    // 2a — adopt a receipt with no status marker at all: a genuinely legacy/host-adopted
    // destination, or one scaffolded before this script wrote WIX_SCAFFOLD_STATUS.
    await upsertEnvFile(wixEnvPath, { WIX_SITE_ID: wixConfig.siteId, WIX_SCAFFOLD_STATUS: 'complete' });
    return { siteId: wixConfig.siteId };
  }

  if (await isNonEmptyDir(frontendDir)) {
    // 2b — genuinely ambiguous state this script cannot resolve on its own.
    throw new Error(
      `${frontendDir} already exists and is not empty, but no valid wix.config.json was found there and config/wix.env has no WIX_SITE_ID. Refusing to scaffold into this folder automatically — resolve manually before retrying.`,
    );
  }

  // 2c — nothing exists yet; mark in_progress before spawning so a crash between now and
  // persisting a final outcome always leaves a distinguishable trace instead of silently
  // looking like "nothing was ever attempted."
  await upsertEnvFile(wixEnvPath, { WIX_SCAFFOLD_STATUS: 'in_progress' });
  let code;
  try {
    ({ code } = await spawnScaffold(args));
  } catch (spawnError) {
    // A rejection alone isn't proof nothing was created — spawnScaffold could fail for
    // reasons other than a launch failure after the child already did real work. Check for
    // a receipt regardless of why this rejected: if one exists, leave the in_progress
    // marker in place so the next invocation's self-heal branch above handles it (never
    // clear a marker out from under a receipt that might exist). Only when there is
    // genuinely no receipt is it safe to clear — for the real spawnScaffold, which only
    // rejects via child_process's 'error' event (emitted specifically when the OS-level
    // process itself could never be launched, before any exit code exists), that absence
    // is deterministic: nothing could have been created remotely.
    const orphanedConfig = await readWixConfig(frontendDir);
    if (!orphanedConfig) {
      await clearWixScaffoldStatus(wixEnvPath);
    }
    throw spawnError;
  }
  const postConfig = await readWixConfig(frontendDir);
  if (postConfig) {
    // Persisted even on a non-zero exit: site creation and later template/release work are
    // separate phases of the CLI's run, so discarding the id here is exactly how a retry
    // would spawn a second site.
    await persistSiteId(wixEnvPath, postConfig.siteId, code === 0 ? 'complete' : 'incomplete');
    if (code === 0) {
      return { siteId: postConfig.siteId };
    }
    throw new Error(
      `Scaffold process exited with code ${code}, but a destination was created (WIX_SITE_ID=${postConfig.siteId}); persisted as incomplete. Do not retry automatically — resolve the underlying failure first.`,
    );
  }
  // The child process definitely ran to completion (it returned an exit code), but no
  // valid local receipt was found. This must NOT be left as a retryable in_progress
  // marker: a remote site could still have been created before a local write failed.
  // Convert it to a durable, always-blocked marker instead.
  await upsertEnvFile(wixEnvPath, { WIX_SCAFFOLD_STATUS: 'ambiguous' });
  if (code === 0) {
    throw new Error('Scaffold process exited 0, but no wix.config.json with a siteId was found afterward — cannot confirm whether a destination was created. Marked ambiguous; resolve manually before retrying.');
  }
  throw new Error(`Scaffold process exited with code ${code} and no destination receipt was found — cannot confirm whether a destination was created. Marked ambiguous; resolve manually before retrying.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.businessName) {
    console.error(usage());
    process.exit(1);
    return;
  }
  const result = await ensureDestinationReceipt(args);
  console.log(JSON.stringify({ ok: true, siteId: result.siteId }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { ensureDestinationReceipt, parseArgs, usage };
