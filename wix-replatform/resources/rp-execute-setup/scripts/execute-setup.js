#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const REAL_WRITERS = require('../../rp-target-wix/lib/wix-writers.js');
const { hashArtifact } = require('../../../lib/artifact-freshness.js');
const { validatePlanShape, validateSetupVerification } = require('../../../lib/setup-verification.js');

// NOTE: 'wix-stores' intentionally still maps to 1380b703-... (Wix eCommerce, not Wix
// Stores) here — a separate, independently-tracked defect, not part of this change. See
// wix-writers.js's WIX_STORES_APP_ID (215238eb-...) for the correct id.
const APPS = { 'wix-stores': '1380b703-ce81-ff05-f115-39571d94dfcd', 'wix-blog': '14bcded7-0066-7c35-14d7-466cb3f09103' };

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readJsonIfExists(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readEnv(dir) {
  const raw = await fs.readFile(path.join(dir, 'config', 'wix.env'), 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
}

async function fallbackAuthor(dir, wix, writers) {
  const id = path.basename(dir);
  const email = `replatform-${id}@example.com`;
  const listed = await writers.listMembers(wix, { limit: 100 });
  let member = (listed.members || []).find((item) => String(item.loginEmail || '').toLowerCase() === email);
  if (!member) member = await writers.createMember(wix, { email, name: 'Imported content', slug: `imported-content-${id}` });
  if (!member?.id) throw new Error('fallback Blog author was not created');
  const file = path.join(dir, 'config', 'wix.env');
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    `${raw.replace(/\n?WIX_BLOG_FALLBACK_MEMBER_ID=.*(?:\n|$)/g, '\n').replace(/\s*$/, '\n')}WIX_BLOG_FALLBACK_MEMBER_ID=${member.id}\n`,
  );
}

// Runs one setup-plan step. Throws (with `blockerCode`/`recommendedAction` attached where
// the failure is a recognized, expected condition rather than a genuinely unexpected one)
// on anything short of full success — the caller records the failure and stops the run
// rather than letting a step's exception propagate past a recorded outcome.
async function runStep(step, { dir, env, wix, writers }) {
  if (step.id === 'mute-site-notifications') {
    const state = await writers.muteSiteNotifications(wix, { reason: `RePlatform migration — ${path.basename(dir)}` });
    if (!state?.muted) throw new Error('notification mute verification failed');
    return;
  }
  if (APPS[step.id]) {
    await writers.installWixApp(wix, { appDefId: APPS[step.id], siteId: env.WIX_SITE_ID });
    return;
  }
  if (step.id === 'stores-catalog-v3') {
    const result = await writers.sendDirectRest(wix, { method: 'GET', path: '/stores/v3/provision/version' });
    if (result.catalogVersion !== 'V3_CATALOG') {
      throw Object.assign(new Error(`Catalog V3 required (got ${result.catalogVersion || 'unknown'})`), {
        blockerCode: 'CATALOG_V1',
        recommendedAction: 'Use a destination site provisioned with Catalog V3, or omit Stores from this migration.',
      });
    }
    return;
  }
  if (step.id === 'blog-fallback-author') {
    await fallbackAuthor(dir, wix, writers);
    return;
  }
  throw Object.assign(new Error(`No executor implements setup step "${step.id}"`), {
    blockerCode: 'NO_EXECUTOR_FOR_REQUIREMENT',
    recommendedAction: 'Add an executor for this step id in execute-setup.js, or remove it from the setup plan.',
  });
}

async function writeBlockers(setupDir, generatedAt, blockers) {
  await fs.writeFile(
    path.join(setupDir, 'setup-blockers.json'),
    `${JSON.stringify({ schemaVersion: 1, generatedAt, blockers }, null, 2)}\n`,
  );
}

// Writes the final file via a temp-then-rename so a crash mid-write can never leave a
// corrupt or partial receipt where a trusted one is expected — the rename is atomic on the
// same filesystem/directory.
async function publishAtomically(filePath, contents) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, filePath);
}

// Core logic, independent of the CLI entry point below so tests can inject a fake
// `writers` module instead of making real Wix API calls. Performs every file write itself
// (the receipt, the blockers file) and returns a summary rather than throwing on a
// recognized blocker — `main()` decides how to surface that to the process exit code.
async function executeSetup({ dir, dryRun = false, writers = REAL_WRITERS }) {
  const env = await readEnv(dir);
  if (!env.WIX_SITE_ID || !env.WIX_AUTH_TOKEN) throw new Error('WIX_SITE_ID and WIX_AUTH_TOKEN are required');

  const setupDir = path.join(dir, 'setup');
  const verificationPath = path.join(setupDir, 'setup-verification.json');
  const plan = await readJsonIfExists(path.join(setupDir, 'setup-plan.json'));
  const generatedAt = new Date().toISOString();

  if (!dryRun) {
    // Invalidate any prior receipt the instant a new live attempt begins — before we even
    // know whether this attempt will succeed. A crash partway through this run (or a
    // failure to reach the blocker-write below) must never leave an earlier, possibly
    // no-longer-true success receipt sitting there looking trusted.
    await fs.rm(verificationPath, { force: true });
  }

  const planShape = validatePlanShape(plan);
  if (!planShape.ok) {
    const blocker = {
      code: 'INVALID_SETUP_PLAN',
      severity: 'blocker',
      requirementId: null,
      description: `setup-plan.json is invalid: ${planShape.reasons.join(', ')}`,
      whyBlocked: planShape.reasons.join(', '),
      recommendedAction: 'Regenerate setup/setup-plan.json with a valid schemaVersion, a steps array, and unique, non-empty step ids.',
    };
    if (dryRun) throw new Error(blocker.description);
    await writeBlockers(setupDir, generatedAt, [blocker]);
    return { ok: false, dryRun: false, requirements: [], blocker };
  }

  const planDigest = hashArtifact(dir, path.join('setup', 'setup-plan.json'));
  const wix = writers.createWixClient({ dryRun, authToken: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, projectDir: dir });

  const requirements = [];
  let blocker = null;

  for (const step of plan.steps) {
    if (dryRun) {
      requirements.push({ id: step.id, status: 'planned_dry_run' });
      continue;
    }
    try {
      await runStep(step, { dir, env, wix, writers });
      requirements.push({ id: step.id, status: 'passed' });
    } catch (error) {
      requirements.push({ id: step.id, status: 'blocked', detail: error.message });
      blocker = {
        code: error.blockerCode || 'UNEXPECTED_SETUP_ERROR',
        severity: 'blocker',
        requirementId: step.id,
        description: error.message,
        whyBlocked: error.message,
        recommendedAction: error.recommendedAction || 'Investigate the underlying error and re-run setup once resolved.',
      };
      break; // Stop at the first failure — later steps were never attempted, not skipped.
    }
  }

  if (dryRun) {
    await fs.writeFile(
      path.join(setupDir, 'setup-dry-run.json'),
      `${JSON.stringify({ schemaVersion: 1, generatedAt, dryRun: true, requirements }, null, 2)}\n`,
    );
    return { ok: true, dryRun: true, requirements, blocker: null };
  }

  if (blocker) {
    // The old receipt (if any) was already removed above, before this attempt began.
    await writeBlockers(setupDir, generatedAt, [blocker]);
    return { ok: false, dryRun: false, requirements, blocker };
  }

  // Full success: every planned requirement passed. Self-check the candidate against the
  // exact same validator the router uses before publishing it — there must be exactly one
  // definition of "valid", shared, never re-implemented separately here.
  const candidate = { schemaVersion: 1, generatedAt, dryRun: false, planDigest, requirements };
  const selfCheck = validateSetupVerification({ verification: candidate, plan, planDigest });
  if (!selfCheck.ok) {
    const internalBlocker = {
      code: 'INTERNAL_VALIDATION_FAILURE',
      severity: 'blocker',
      requirementId: null,
      description: `execute-setup.js produced a receipt that failed its own validator: ${selfCheck.reasons.join(', ')}`,
      whyBlocked: selfCheck.reasons.join(', '),
      recommendedAction: 'This indicates a bug in execute-setup.js itself — investigate rather than retrying.',
    };
    await writeBlockers(setupDir, generatedAt, [internalBlocker]);
    return { ok: false, dryRun: false, requirements, blocker: internalBlocker };
  }

  await writeBlockers(setupDir, generatedAt, []);
  await publishAtomically(verificationPath, `${JSON.stringify(candidate, null, 2)}\n`);
  return { ok: true, dryRun: false, requirements, blocker: null };
}

async function main() {
  const dir = process.argv[2] && path.resolve(process.argv[2]);
  if (!dir) throw new Error('Usage: execute-setup.js <projectDir> [--dry-run]');
  const dryRun = process.argv.includes('--dry-run');
  const result = await executeSetup({ dir, dryRun });
  if (result.blocker) throw new Error(result.blocker.description);
  console.log(JSON.stringify({ ok: true, dryRun }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { executeSetup, runStep };
