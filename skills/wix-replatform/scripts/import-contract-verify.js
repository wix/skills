#!/usr/bin/env node
'use strict';

// Layer 2 — the committed pre-write gate.
//
// Layer 1 is the generated entrypoint checking itself: `run-import.js` calls
// `assertGeneratedImporterContract` as the first statement of `main()`, so an operator cannot
// skip it. This is the outside check, run before the first write, that catches the importer
// which never emitted that call at all — such an importer also cannot answer `--describe`.
//
// Neither layer replaces the other. Layer 1 covers the run an operator starts directly; layer 2
// is what makes the boundary testable, because a test can spawn a real script the same way the
// suite already spawns execution-state-prepare.js.
//
// The probe writes only an isolated temporary review store and touches no target.

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const review = require('../lib/migration-review.js');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyPluginHandoff } = require('../lib/generated-plugin-handoff.js');
const { parseSelectionArgs } = require('../resources/rp-source-wordpress/lib/plugin-entity-read-plan.js');
const { assertGeneratedImporterContract } = require('../lib/import-recovery.js');
const { dependencyModeErrors } = require('../lib/dependency-readiness.js');
const { missingWriterErrors, rawRequestTargets } = require('../lib/target-import-support.js');
const { mappingScopes } = require('../lib/migration-review-mapping.js');
const { files } = require('../lib/import-readiness-contract.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

const DEFAULT_ENTRYPOINTS = ['src/import/run-import.js'];
const DESCRIBE_TIMEOUT_MS = 30000;

let progress;

function usage() {
  console.error(`Usage:
  node skills/wix-replatform/scripts/import-contract-verify.js <projectDir> [--entrypoint <path>]

First checks generated code and the execution manifest for values a toolkit function refuses
at runtime (verificationKind and the other CONTRACT_ENUMS). Then spawns each
generated import entrypoint with --describe, validates the descriptor, refuses
generated sources that bypass shared DRY_RUN or held-scope registration, then runs its isolated
--migration-review-probe to exercise capture/publication, selected+held scope registration and
an injected failing write's recovery capture.
Exits non-zero naming missing modes, paths or review hooks. Writes temporary probe state only, touches no target.

--entrypoint may be repeated; paths are resolved against <projectDir>. When omitted, the
conventional entrypoint ${DEFAULT_ENTRYPOINTS.join(', ')} is used.
`);
}

function parseArgs(argv) {
  const args = { entrypoints: [], selection: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args.selection = parseSelectionArgs(argv.slice(i + 1));
      break;
    } else if (token === '--extract-entrypoint') {
      args.extractEntrypoint = argv[++i];
    } else if (token === '--entrypoint') {
      args.entrypoints.push(argv[i + 1]);
      i += 1;
    } else if (!args.projectDir) {
      args.projectDir = token;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

// The entrypoint prints ONE JSON object. Generated importers habitually log a banner line
// first, so take the last balanced top-level object rather than demanding a pristine stdout —
// but never guess: unparsable stdout is a gate failure, not a pass.
function parseDescriptor(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw new Error('printed nothing on --describe (an entrypoint that ignores --describe fails the gate)');
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`printed no JSON object on --describe: ${trimmed.slice(0, 200)}`);
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (error) {
    throw new Error(`printed unparsable JSON on --describe: ${error.message}`);
  }
}

// Blank JS comments so a comment naming DRY_RUN is not a bypass. Strings, templates and regex
// literals are kept (only skipped over), so a '//' inside one never hides the code after it.
function stripComments(text) {
  let out = '', i = 0, prev = '';
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; } continue; }
    if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2), stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\n]/g, ' '); i = stop; continue; }
    const regex = c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev));
    if (c === '"' || c === "'" || c === '`' || regex) {
      let j = i + 1, cls = false;
      while (j < text.length && (text[j] !== c || cls) && !(c !== '`' && text[j] === '\n')) {
        if (text[j] === '\\') j += 1; else if (regex && text[j] === '[') cls = true; else if (regex && text[j] === ']') cls = false;
        j += 1;
      }
      out += text.slice(i, j + 1); i = j + 1; prev = c; continue;
    }
    out += c; if (!/\s/.test(c)) prev = c; i += 1;
  }
  return out;
}
// Source shapes that bypass shared runtime decisions. These are refusals, never proofs of compliance:
// a bounded text backstop over comment-stripped source. Broader (AST/flow) analysis is deferred.
const RUNTIME_BYPASSES = [
  [/process\.env(?:\.DRY_RUN\b|\[\s*['"`]DRY_RUN)|\bDRY_RUN\b[^}]*\}\s*=\s*process\.env/, 'dry_run_config_bypass'],
  [/mappingScopes\([^)]*resolvedEntityRefs/, 'held_scope_registration_omitted'],
  // Unmarked requests the import client refuses; a native entity with no writer uses guarded raw requests.
  // Only calls through a module object or a destructured import: the vendored toolkit's own
  // definitions and name lists are not uses.
  [/\.\s*(?:sendDirectRest|buildDirectRestRequest)\s*\(|\{[^}]*\b(?:sendDirectRest|buildDirectRestRequest)\b[^}]*\}\s*=\s*require/, 'direct_rest_write_refused'],
];
// A retired builder hold code (target knowledge `retiredHoldCodes`) as a string literal in generated
// code: the builder still holds records a shipped route now writes. Refused at codegen, with the
// file, so codegen QA fixes the builder before the read-back inventory refuses it.
function retiredHoldUses(text) {
  const codes = Object.keys(require('../resources/rp-target-wix/lib/domain-knowledge.js').retiredHoldCodes());
  return codes.filter(code => new RegExp(`(['"\`])${code}\\1`).test(text));
}
function verifyRuntimeUse(projectDir) {
  const errors = [];
  for (const file of files(path.join(projectDir, 'src'))) {
    const text = stripComments(fsSync.readFileSync(file, 'utf8'));
    for (const [pattern, code] of RUNTIME_BYPASSES) if (pattern.test(text)) errors.push(`${code}:${path.relative(projectDir, file)}`);
    for (const code of retiredHoldUses(text)) errors.push(`retired_hold_code:${code}:${path.relative(projectDir, file)}`);
  }
  return errors;
}
// Values a toolkit function refuses at runtime, checked in the generated code at
// codegen. Each entry asks the runtime function itself (one source of truth, no copied list), so
// this refuses only what the import would crash on later -- it moves that crash earlier, with the
// file and line. Add an entry when a toolkit function throws on a value generated code passes.
const { verificationKind } = require('../lib/entity-verification.js');
const CONTRACT_ENUMS = [
  { key: 'verificationKind', owner: 'lib/entity-verification.js verificationKind()', refusal: (value) => { try { verificationKind({ verificationKind: value }); return null; } catch (error) { return error.message; } } },
];
function verifyStaticContract(projectDir) {
  const errors = [];
  let manifest = null;
  try { manifest = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')); } catch { /* the entrypoint check reports a missing manifest */ }
  for (const task of manifest?.tasks || []) for (const { key, owner, refusal } of CONTRACT_ENUMS) {
    const refused = task[key] !== undefined && refusal(task[key]);
    if (refused) errors.push(`contract_enum_invalid:execution/execution-manifest.json task ${task.id} ${key} ${JSON.stringify(task[key])} (${owner}: ${refused})`);
  }
  for (const file of [...files(path.join(projectDir, 'src')), ...files(path.join(projectDir, 'scripts'))]) {
    const lines = stripComments(fsSync.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const { key, owner, refusal } of CONTRACT_ENUMS) for (const match of line.matchAll(new RegExp(`\\b${key}['"]?\\s*:\\s*(['"\`])([^'"\`]*)\\1`, 'g'))) {
        const refused = refusal(match[2]);
        if (refused) errors.push(`contract_enum_invalid:${path.relative(projectDir, file)}:${index + 1} ${key} ${JSON.stringify(match[2])} (${owner}: ${refused})`);
      }
    });
  }
  return errors;
}
// A gated entity (entity decision with a readBackContract) whose generated code does
// not call the toolkit's runGatedEntity. A warning shown with the plan, never a refusal: a
// hand-wired ReadBackGate that works is not blocked. Names the decision file and, when the code
// wires the gate by hand, the first file and line that constructs it.
function verifyGateWiring(projectDir) {
  const { DOMAINS, decisionFileName } = require('../lib/read-back-contract.js');
  let plan = null;
  try { plan = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch { /* generated-contract checks report missing plans */ }
  const gated = Object.keys(DOMAINS).filter((entity) => {
    try {
      const file = decisionFileName(projectDir, entity);
      return Boolean(JSON.parse(fsSync.readFileSync(path.join(projectDir, `mapping/entity-decisions/${file}`), 'utf8')).readBackContract);
    } catch { return false; }
  });
  if (!gated.length) return [];
  const sources = [...files(path.join(projectDir, 'src')), ...files(path.join(projectDir, 'scripts'))]
    // The vendored gate module defines both names; it is not a use.
    .filter((file) => path.basename(file) !== 'read-back-gate.js')
    .map((file) => ({ file: path.relative(projectDir, file), lines: stripComments(fsSync.readFileSync(file, 'utf8')).split('\n') }));
  const at = (pattern) => { for (const { file, lines } of sources) { const index = lines.findIndex((line) => pattern.test(line)); if (index >= 0) return `${file}:${index + 1}`; } return null; };
  const toolkit = at(/\brunGatedEntity\s*\(/), handWired = at(/\bnew\s+(?:[\w$.]+\.)?ReadBackGate\s*\(/);
  if (toolkit) return [];
  return gated.map((entity) => ({
    code: 'read_back_gate_not_toolkit_owned',
    entity,
    decision: `mapping/entity-decisions/${decisionFileName(projectDir, entity)}`,
    location: handWired,
    message: handWired
      ? `${entity}: the read-back gate is wired by hand (${handWired}); call runGatedEntity from lib/read-back-gate.js instead.`
      : `${entity}: no generated code runs the read-back gate; call runGatedEntity from lib/read-back-gate.js, or completion reports gate-not-run.`,
  }));
}
function expectedMappingScopes(plan) {
  return plan?.fieldContractVersion === 1 && plan.executionScope?.selectedEntityRefs?.length ? mappingScopes(plan) : [];
}

async function verifyReviewProbe(absolute, relativePath, descriptor, mappingPlan) {
  if (descriptor?.migrationReview?.probeFlag !== '--migration-review-probe') {
    return { entrypoint: relativePath, ok: false, error: 'migration review probe flag is missing from the descriptor' };
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-review-probe-'));
  const nonce = crypto.randomUUID();
  try {
    const probeEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    const probed = spawnSync(process.execPath, [absolute, '--migration-review-probe', '--project', scratch], {
      cwd: scratch, encoding: 'utf8', timeout: DESCRIBE_TIMEOUT_MS,
      env: { ...probeEnv, MIGRATION_REVIEW_PROBE_PROJECT: scratch, MIGRATION_REVIEW_PROBE_NONCE: nonce, MIGRATION_REVIEW_LIB: path.resolve(__dirname, '../lib/migration-review.js') },
    });
    if (probed.error || probed.status !== 0) throw new Error((probed.stderr || probed.stdout || probed.error?.message || `exit ${probed.status}`).trim().slice(0, 400));
    const response = parseDescriptor(probed.stdout);
    const report = await review.readReport(scratch);
    const proof = await review.readExecutionEvidence(scratch, response.executionId);
    if (proof.execution.executionKind !== 'probe') throw new Error('isolated execution must identify itself as a probe');
    if (report.migrationId !== `probe_${nonce}` || report.destination.siteId !== 'probe-site' || report.source.identity !== `probe_${nonce}` || report.coverage.status !== 'complete' || !report.evidenceRevision) throw new Error('isolated publication is missing or incomplete');
    if (!report.results.some((row) => row.probeNonce === nonce)) throw new Error('publication did not preserve probe evidence');
    for (const category of review.EVIDENCE_CATEGORIES) {
      if (!proof.captures.some((row) => row.category === category && row.evidence.probeNonce === nonce)) throw new Error(`no committed capture for ${category}`);
    }
    const held = expectedMappingScopes(mappingPlan).filter((scope) => !proof.execution.assessedScope.includes(scope));
    if (held.length) throw new Error(`registration omits selected/held mapping scopes: ${held.join(', ')}`);
    if (!proof.captures.some((row) => row.category === 'execution_recovery' && row.phase === 'recovery' && row.evidence.kind === 'write-failure' && row.evidence.probeNonce === nonce && row.evidence.outcomes?.[0]?.reasonCode === review.PROBE_WRITE_FAILURE)) throw new Error('injected failing write committed no execution_recovery capture through createWriteRecovery');
    const state = JSON.parse(await fs.readFile(path.join(review.reviewRoot(scratch), 'state.json'), 'utf8'));
    const committed = Object.values(state.committedRequests);
    if (!committed.some((row) => row.operation === 'publish-evidence') || committed.filter((row) => row.operation === 'capture-evidence').length < review.EVIDENCE_CATEGORIES.length) throw new Error('capture/publication receipts are not committed');
    return null;
  } catch (error) {
    return { entrypoint: relativePath, ok: false, error: `migration review probe failed: ${error.message}` };
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

async function verifyEntrypoint(projectDir, relativePath) {
  const absolute = path.resolve(projectDir, relativePath);
  if (!fsSync.existsSync(absolute)) {
    return { entrypoint: relativePath, ok: false, error: 'entrypoint not found' };
  }
  const described = spawnSync(process.execPath, [absolute, '--describe'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: DESCRIBE_TIMEOUT_MS,
  });
  if (described.error) {
    return { entrypoint: relativePath, ok: false, error: `could not run --describe: ${described.error.message}` };
  }
  if (described.status !== 0) {
    const detail = (described.stderr || described.stdout || '').trim().slice(0, 400);
    return { entrypoint: relativePath, ok: false, error: `--describe exited ${described.status}: ${detail}` };
  }
  let descriptor, mappingPlanForProbe;
  try {
    descriptor = parseDescriptor(described.stdout);
  } catch (error) {
    return { entrypoint: relativePath, ok: false, error: error.message };
  }
  try {
    const planFile=path.join(projectDir,'mapping/mapping-plan.json');
    const mappingPlan=fsSync.existsSync(planFile)?JSON.parse(fsSync.readFileSync(planFile,'utf8')):null;
    assertGeneratedImporterContract(descriptor,{mappingPlan,projectDir});
    const readiness = require('../lib/import-readiness-contract').verifyReadinessContract(projectDir, descriptor);
    // A stale generated manifest cannot pass by matching its own stale descriptor.
    const manifest = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'));
    const modes = [...dependencyModeErrors(projectDir, manifest), ...missingWriterErrors(manifest)];
    const bypasses = verifyRuntimeUse(projectDir);
    if (!readiness.ok || modes.length || bypasses.length) throw new Error([...readiness.errors, ...modes, ...bypasses].join(';'));
    mappingPlanForProbe = mappingPlan;
  } catch (error) {
    return { entrypoint: relativePath, ok: false, error: error.message };
  }
  const probeFailure = await verifyReviewProbe(absolute, relativePath, descriptor, mappingPlanForProbe);
  if (probeFailure) return probeFailure;
  return { entrypoint: relativePath, ok: true, error: null };
}

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/import-contract-verify.js',
    ...parsed.progress,
  });
  progress.start('Import contract verification started', { phase: 'execution', step: 'verify-import-contract' });

  const args = parseArgs(parsed.args);
  if (!args.projectDir) {
    usage();
    progress.error('Missing project directory', { phase: 'execution', step: 'verify-import-contract' });
    process.exit(1);
  }

  const projectDir = path.resolve(args.projectDir);
  const entrypoints = args.entrypoints.length ? args.entrypoints : DEFAULT_ENTRYPOINTS;
  // Inspect canonical inventory and exact generated bytes BEFORE executing --describe.
  const plugin = verifyPluginHandoff(projectDir, args.selection);
  if (plugin.applicable && entrypoints.some((entrypoint) => entrypoint !== 'src/import/run-import.js')) throw new Error('unsupported generated plugin importer entrypoint');
  if (plugin.applicable && args.extractEntrypoint && args.extractEntrypoint !== 'src/extract/run-extract.js') throw new Error('unsupported generated plugin extractor entrypoint');
  const results = [];
  // Static first: no entrypoint runs while the generated code passes values the toolkit refuses.
  const staticErrors = verifyStaticContract(projectDir);
  if (staticErrors.length) results.push({ entrypoint: '(static contract)', ok: false, error: staticErrors.join(';') });
  else for (const entrypoint of entrypoints) results.push(await verifyEntrypoint(projectDir, entrypoint));
  const failures = results.filter((result) => !result.ok);

  // Entities written by guarded raw requests, for the plan shown before consent.
  let rawRequests = [];
  try { rawRequests = rawRequestTargets(JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'))); } catch { /* the entrypoint check reports a missing manifest */ }
  // Expected CMS items against the site's quota, for the same plan. Shown, never a gate.
  let cmsItemQuota = null;
  try { cmsItemQuota = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/cms-item-quota-plan.json'), 'utf8')); } catch { /* no custom-collection rows planned, or not read yet */ }
  // Read-back gate wiring, for the same plan. Shown, never a gate.
  const warnings = verifyGateWiring(projectDir);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    projectDir,
    entrypoints: results,
    rawRequestTargets: rawRequests,
    cmsItemQuota,
    warnings,
  }, null, 2));

  if (failures.length) {
    for (const failure of failures) {
      console.error(`${failure.entrypoint}: ${failure.error}`);
    }
    console.error('Import aborted: the generated importer does not satisfy the entry contract. Route back to codegen — there is no degraded mode and no skip flag.');
    progress.error('Import contract verification failed', {
      phase: 'execution',
      step: 'verify-import-contract',
      artifact: projectDir,
      count: failures.length,
      unit: 'entrypoints',
    });
    process.exit(1);
  }

  progress.complete('Import contract verification passed', {
    phase: 'execution',
    step: 'verify-import-contract',
    artifact: projectDir,
    count: results.length,
    unit: 'entrypoints',
  });
  process.exit(0);
}

if (require.main === module) main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Import contract verification failed', {
      phase: 'execution',
      step: 'verify-import-contract',
    });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
// The source refusals, for the cross-gate test.
module.exports = { RUNTIME_BYPASSES, CONTRACT_ENUMS, verifyStaticContract, verifyGateWiring, verifyRuntimeUse };
