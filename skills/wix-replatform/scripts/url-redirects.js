#!/usr/bin/env node
'use strict';

// Old-link preservation helpers: plan, apply and verify redirects after the destination
// website exists. Deterministic; prints counts and exceptions only (never response bodies).
// Backend import stays plan-only and never calls apply/verify; the cutover flow decides when
// to run them. None of these modes publishes pages, changes DNS or sends notifications.
//
//   sources --project <dir> --input <file.json>   normalize source redirect maps + coverage
//   import-targets --project <dir>                 plan captured imported destinations
//   report  --project <dir>                       rebuild plan + operator report, no network
//   plan    --project <dir> [--wix-env <file>]    plan; with --wix-env also reads site inventory
//   apply   --project <dir> --wix-env <file> [--exclusive-edit-window-confirmed]
//   verify  --project <dir> --stage preparation --connect-host <host> [--connect-port <n>]
//   verify  --project <dir> --stage verified_public --after-dns-switch
//   retire-import-plan --project <dir> --wix-env <file> --source-key <key>
//     --from <path> --to <path> --evidence <reference>  (local retirement; no remote delete)
//
// Optional: --concurrency <n> --timeout-ms <n> --retries <n>
//
// Credentials (from --wix-env): WIX_SITE_ID plus WIX_API_KEY or WIX_AUTH_TOKEN for reads.
// Writes need Manage SEO Settings and an explicit identity declaration:
// APP: WIX_REDIRECTS_APP_TOKEN, WIX_REDIRECTS_APP_SITE_ID, WIX_REDIRECTS_CREDENTIAL_IDENTITY=APP.
// Wix user: WIX_AUTH_TOKEN, WIX_SITE_ID, WIX_REDIRECTS_CREDENTIAL_IDENTITY=WIX_USER.
// A site-member token is not a Wix user credential; never infer identity from token presence.

const path = require('node:path');
const fs = require('node:fs/promises');
const state = require('../lib/url-preservation-state.js');
const planLib = require('../lib/url-redirect-plan.js');
const verification = require('../lib/url-verification.js');
const reportLib = require('../lib/url-preservation-report.js');
const importedTargets = require('../lib/imported-redirect-targets.js');
const { readEnvFile } = require('../lib/config-env.js');

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const args = { mode, flags: new Set() };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (['--exclusive-edit-window-confirmed', '--after-dns-switch'].includes(token)) args.flags.add(token);
    else if (token.startsWith('--')) args[token.slice(2)] = rest[++i];
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (!['sources', 'import-targets', 'report', 'plan', 'apply', 'verify', 'retire-import-plan'].includes(mode)) throw new Error('unsupported mode');
  if (!args.project) throw new Error('--project <dir> is required');
  args.project = path.resolve(args.project);
  return args;
}

async function loadInputs(projectDir) {
  // Replay all four import-era artifacts (latest row per key), so a recorded redirect
  // requirement or unresolved/manual decision cannot drop out of the plan.
  const ledger = await state.loadUrlLedger(projectDir);
  const importRedirects = await state.loadRedirectsForPlanning(projectDir);
  const importUnresolved = await state.loadUnresolved(projectDir);
  const basePaths = await state.loadBasePaths(projectDir);
  const sources = await state.loadSourceRedirects(projectDir);
  const importedRedirectOutcomes = await importedTargets.currentAuditRows(projectDir);
  return {
    ledgerRows: Object.values(ledger.byKey),
    importRedirects: Object.values(importRedirects.byKey),
    invalidImportRedirects: importRedirects.rejected,
    importUnresolved: Object.values(importUnresolved.byKey),
    basePaths: basePaths.entries,
    sourceRules: sources.latest,
    importedRedirectOutcomes,
    coverage: await state.loadStateJson(projectDir, 'sourceRedirectCoverage'),
    sourceDomains: await state.loadStateJson(projectDir, 'sourceDomains'),
    finalRoutes: await state.loadStateJson(projectDir, 'finalRoutes'),
    launchPlan: await state.loadStateJson(projectDir, 'launchPlan'),
    applyStatus: await state.loadStateJson(projectDir, 'applyStatus'),
  };
}

function siteIdOf(inputs, env) {
  return (inputs.finalRoutes && inputs.finalRoutes.siteId) || (inputs.launchPlan && inputs.launchPlan.siteId) || (env && env.WIX_SITE_ID) || 'unbound-site';
}

function readClientFrom(env) {
  const { createWixClient } = require('../resources/rp-target-wix/lib/wix-writers.js');
  const token = env.WIX_API_KEY || env.WIX_AUTH_TOKEN || env.WIX_REDIRECTS_APP_TOKEN;
  if (!token || !env.WIX_SITE_ID) throw new Error('--wix-env needs WIX_SITE_ID and WIX_API_KEY or WIX_AUTH_TOKEN');
  return createWixClient({ authToken: token, siteId: env.WIX_SITE_ID });
}

function writeCredentialFrom(env) {
  if (env.WIX_REDIRECTS_APP_TOKEN) {
    return { token: env.WIX_REDIRECTS_APP_TOKEN, siteId: env.WIX_REDIRECTS_APP_SITE_ID, identity: env.WIX_REDIRECTS_CREDENTIAL_IDENTITY };
  }
  if (env.WIX_AUTH_TOKEN && env.WIX_REDIRECTS_CREDENTIAL_IDENTITY === 'WIX_USER') {
    return { token: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, identity: 'WIX_USER' };
  }
  return null;
}

async function writeReport(projectDir, plan, inputs) {
  const execution = await state.loadRedirectExecution(projectDir);
  const verified = await state.loadUrlVerification(projectDir);
  const report = reportLib.buildUrlPreservationReport({
    plan,
    executionRows: execution.rows,
    verificationRows: verified.rows,
    launchPlan: inputs.launchPlan,
    applyStatus: inputs.applyStatus && inputs.applyStatus.planDigest === plan.planDigest ? inputs.applyStatus : null,
  });
  const paths = await reportLib.writeUrlPreservationReport(projectDir, report);
  await importedTargets.updateVerificationOutcomes(projectDir, plan, verified.rows);
  return { report, paths, rejectedRows: execution.rejected.length + verified.rejected.length };
}

function summaryOf(report) {
  return {
    status: report.status,
    counts: report.counts,
    obligations: report.obligationCount,
    remoteRules: report.remoteRuleCount,
    coverageComplete: report.coverage.complete,
    operatorActions: report.operatorActions.map((a) => ({ code: a.code, severity: a.severity, affectedCount: a.affectedCount })),
    report: reportLib.REPORT_MD,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args.project;
  if (args.mode === 'retire-import-plan') {
    if (!args['wix-env']) throw new Error('retire-import-plan needs --wix-env for a current destination inventory');
    const env = await readEnvFile(path.resolve(args['wix-env']));
    const seo = require('../resources/rp-target-wix/lib/seo-redirects.js');
    const targetInventory = await seo.listWithBackoff(readClientFrom(env), {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    const retired = await importedTargets.retireImportedPlan({ projectDir,
      sourceStableKey: args['source-key'], sourceRelativeUrl: args.from,
      targetRelativeUrl: args.to, evidence: args.evidence, targetInventory });
    console.log(JSON.stringify(retired));
    return;
  }
  if (args.mode === 'sources') {
    const { extractRedirectSources } = require('../resources/rp-source-wordpress/lib/wp-redirect-sources.js');
    const input = JSON.parse(await fs.readFile(path.resolve(args.input), 'utf8'));
    const result = extractRedirectSources(input);
    const capturedRules = result.rules.slice();
    const existing = await state.loadSourceRedirects(projectDir);
    const complete = result.coverage.providers.length > 0 &&
      result.coverage.providers.every((row) => ['extracted', 'confirmed_empty'].includes(row.status));
    if (complete) {
      const present = new Set(result.rules.map((rule) => rule.ruleKey));
      for (const prior of existing.latest) {
        if (present.has(prior.ruleKey) || prior.disabledReason === 'removed_from_complete_capture') continue;
        result.rules.push({ ...prior, enabled: false, disabledReason: 'removed_from_complete_capture',
          extractedAt: result.coverage.generatedAt });
      }
    }
    let appended = 0;
    for (const rule of result.rules) {
      const prior = existing.byKey[rule.ruleKey];
      const same = prior && JSON.stringify({ ...prior, extractedAt: null }) === JSON.stringify({ ...rule, extractedAt: null });
      if (!same) { await state.appendSourceRedirectRow(projectDir, rule); appended += 1; }
    }
    await state.writeStateJson(projectDir, 'sourceRedirectCoverage', result.coverage);
    const sourceDomains = await state.loadStateJson(projectDir, 'sourceDomains');
    if (sourceDomains) {
      await importedTargets.planImportedRedirectTargets({ projectDir,
        runId: args.run || input.runId || result.coverage.generatedAt,
        captureRevision: result.coverage.generatedAt,
        rules: importedTargets.adaptSourceRedirects(capturedRules, {
          captureRevision: result.coverage.generatedAt, sourceDomains,
        }), fullCapture: complete });
    }
    console.log(JSON.stringify({ rules: capturedRules.length, appended, coverage: result.coverage.providers.map((p) => ({ provider: p.provider, status: p.status, ruleCount: p.ruleCount })) }, null, 2));
    return;
  }

  if (args.mode === 'import-targets') {
    const sourceDomains = await state.loadStateJson(projectDir, 'sourceDomains');
    const coverage = await state.loadStateJson(projectDir, 'sourceRedirectCoverage');
    if (!sourceDomains || !coverage?.generatedAt) throw new Error('import-targets needs declared source domains and captured source redirect coverage');
    const sourceRules = (await state.loadSourceRedirects(projectDir)).latest
      .filter((rule) => rule.disabledReason !== 'removed_from_complete_capture');
    const complete = coverage.providers.length > 0 &&
      coverage.providers.every((row) => ['extracted', 'confirmed_empty'].includes(row.status));
    const report = await importedTargets.planImportedRedirectTargets({ projectDir,
      runId: args.run || coverage.generatedAt, captureRevision: coverage.generatedAt,
      rules: importedTargets.adaptSourceRedirects(sourceRules, {
        captureRevision: coverage.generatedAt, sourceDomains,
      }), fullCapture: complete });
    console.log(JSON.stringify({ captureComplete: report.captureComplete,
      rules: report.rules.length, actionCount: report.operatorActions.length }));
    return;
  }

  const inputs = await loadInputs(projectDir);
  const env = args['wix-env'] ? await readEnvFile(path.resolve(args['wix-env'])) : null;
  const siteId = siteIdOf(inputs, env);
  let inventory = null;
  let inventoryError = null;
  let readClient = null;
  if (env && (args.mode === 'plan' || args.mode === 'apply')) {
    readClient = readClientFrom(env);
    if (env.WIX_SITE_ID !== siteId) throw new Error('WIX_SITE_ID does not match the destination site in final-routes.json/launch-plan.json');
    const seo = require('../resources/rp-target-wix/lib/seo-redirects.js');
    try {
      inventory = await seo.listWithBackoff(readClient, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    } catch (error) {
      if (args.mode !== 'apply') throw error;
      inventoryError = error;
    }
  }
  const plan = planLib.planRedirects({ siteId, ...inputs, targetInventory: inventory });
  if (args.mode !== 'plan' && inventory === null && !inventoryError) {
    const earlier = await state.loadStateJson(projectDir, 'redirectPlan');
    if (earlier?.planDigest === plan.planDigest) {
      const setupByKey = new Map((earlier.obligations || []).filter((ob) => ob.externalSetup)
        .map((ob) => [ob.obligationKey, ob.externalSetup]));
      for (const obligation of plan.obligations) if (obligation.externalTarget) {
        obligation.externalSetup = setupByKey.get(obligation.obligationKey) || null;
      }
    }
  }
  await state.writeStateJson(projectDir, 'redirectPlan', plan);

  if (args.mode === 'apply') {
    if (!env) throw new Error('apply needs --wix-env');
    if (!plan.websiteBuilt) throw new Error('apply needs final-routes.json from the website build');
    const seo = require('../resources/rp-target-wix/lib/seo-redirects.js');
    const credential = writeCredentialFrom(env);
    let writeClient = null;
    if (!seo.credentialProblem(credential, plan.siteId)) {
      const { createWixClient } = require('../resources/rp-target-wix/lib/wix-writers.js');
      writeClient = createWixClient({ authToken: credential.token, siteId: credential.siteId });
    }
    const result = await seo.applyRedirectPlan({
      projectDir,
      plan,
      readClient,
      initialInventory: inventory,
      initialInventoryError: inventoryError,
      writeClient,
      credential,
      launchPlan: inputs.launchPlan,
      exclusiveEditWindowConfirmed: args.flags.has('--exclusive-edit-window-confirmed'),
      runId: args.run || `url-redirects-${Date.now()}`,
    });
    const applyStatus = { schemaVersion: 1, planDigest: plan.planDigest, recordedAt: new Date().toISOString(), summary: result.summary, operatorActions: result.operatorActions };
    await state.writeStateJson(projectDir, 'applyStatus', applyStatus);
    inputs.applyStatus = applyStatus;
    const { report } = await writeReport(projectDir, plan, inputs);
    console.log(JSON.stringify({ apply: result.summary, ...summaryOf(report) }, null, 2));
    return;
  }

  if (args.mode === 'verify') {
    const endpoint = args['connect-host']
      ? { mode: 'connect_override', connectHost: args['connect-host'], connectPort: args['connect-port'] ? Number(args['connect-port']) : undefined }
      : { mode: 'public' };
    const result = await verification.verifyUrls({
      projectDir,
      plan,
      sourceDomains: inputs.sourceDomains,
      stage: args.stage,
      endpoint,
      afterDnsSwitch: args.flags.has('--after-dns-switch'),
      concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
      retryBudget: args.retries ? Number(args.retries) : undefined,
      runId: args.run || `url-verify-${Date.now()}`,
    });
    const { report } = await writeReport(projectDir, plan, inputs);
    console.log(JSON.stringify({ verify: result.summary, exceptionCount: result.exceptionCount, exceptions: result.exceptions, evidence: result.evidence, ...summaryOf(report) }, null, 2));
    return;
  }

  const { report, rejectedRows } = await writeReport(projectDir, plan, inputs);
  console.log(JSON.stringify({ ...summaryOf(report), rejectedStateRows: rejectedRows }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`url-redirects: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadInputs, writeCredentialFrom };
