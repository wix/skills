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

// This is deliberately a small flow check rather than a JavaScript parser. The generated
// entrypoint has a narrow contract: the value returned by attachAttemptReasons must be the value
// supplied as createCompletionReport's entityCompleteness. Looking only for helper names and
// their order lets a discarded return value silently remove journal-backed reasons from the
// durable report.
function callsInSource(source, name) {
  const calls = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (let match; (match = pattern.exec(source));) {
    const open = source.indexOf('(', match.index);
    let depth = 1, quote = null, escaped = false;
    let end = open + 1;
    for (; end < source.length && depth; end += 1) {
      const character = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
    }
    if (depth) break;
    calls.push({ start: match.index, end, args: source.slice(open + 1, end - 1) });
  }
  return calls;
}

function assignmentBefore(source, position) {
  const prefix = source.slice(0, position);
  const match = prefix.match(/(?:^|[;{}])\s*(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/);
  return match?.[1] || null;
}

function objectPropertyValue(objectSource, property) {
  const match = new RegExp(`\\b${property}\\s*:`).exec(objectSource);
  if (!match) return null;
  const start = match.index + match[0].length;
  let parens = 0, brackets = 0, braces = 0, quote = null, escaped = false;
  for (let index = start; index < objectSource.length; index += 1) {
    const character = objectSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '(') parens += 1;
    else if (character === ')') parens -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets -= 1;
    else if (character === '{') braces += 1;
    else if (character === '}') {
      if (!parens && !brackets && !braces) return objectSource.slice(start, index).trim();
      braces -= 1;
    } else if (character === ',' && !parens && !brackets && !braces) {
      return objectSource.slice(start, index).trim();
    }
  }
  return objectSource.slice(start).trim();
}

function completionDataflowErrors(source, relativeEntrypoint) {
  const attachCalls = callsInSource(source, 'attachAttemptReasons');
  const reports = callsInSource(source, 'createCompletionReport');
  const errors = [];
  for (const report of reports) {
    const value = objectPropertyValue(report.args, 'entityCompleteness');
    if (!value) {
      errors.push(`task_orchestration_completion_entity_rows_not_supplied:${relativeEntrypoint}`);
      continue;
    }
    const identifier = value.match(/^(?:await\s+)?([A-Za-z_$][\w$]*)$/)?.[1];
    const directAttach = /^await\s+attachAttemptReasons\s*\(/.test(value) || /^attachAttemptReasons\s*\(/.test(value);
    const joinedVariables = new Set(attachCalls
      .filter(call => call.end <= report.start)
      .map(call => assignmentBefore(source, call.start))
      .filter(Boolean));
    if (!directAttach && (!identifier || !joinedVariables.has(identifier))) {
      errors.push(`task_orchestration_completion_journal_join_result_not_used:${relativeEntrypoint}`);
    }
  }
  return errors;
}

function verifyStaticContract(projectDir, { pluginHandoff = null } = {}) {
  const errors = [];
  let manifest = null;
  try { manifest = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')); } catch { /* the entrypoint check reports a missing manifest */ }
  if (pluginHandoff === null) {
    try { pluginHandoff = verifyPluginHandoff(projectDir); } catch { /* the main gate reports malformed plugin wiring separately */ }
  }
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
  // Task-level stop/continue policy is deterministic runtime behavior, not an LLM choice. Once a
  // generated project has an execution manifest and an import entrypoint, require the shared
  // scheduler so a hand-written `for (...) { ... if (failed) break; }` cannot pass codegen QA.
  const importEntrypoint = path.join(projectDir, 'src/import/run-import.js');
  // The WordPress structure-bridge importer is a deliberately closed generated entrypoint.
  // Its exact bytes are checked by generated-plugin-handoff before this layer runs; its runtime
  // runs dispatch through runImportTasks itself (plugin-entity-read-plan.js, covered by
  // tests/orchestration/plugin-dispatch-isolation-test.js) and leaves completion to the plugin
  // adapter. Requiring the generic
  // shared-v1 helper names in that wrapper would make the two independent contracts mutually
  // exclusive. Keep the generic check for every other generated importer.
  const canonicalPluginEntrypoint = pluginHandoff?.applicable === true;
  if (!canonicalPluginEntrypoint && manifest?.taskOrchestration === 'shared-v1'
    && (manifest?.tasks || []).some(task => task?.kind === 'import') && fsSync.existsSync(importEntrypoint)) {
    const source = stripComments(fsSync.readFileSync(importEntrypoint, 'utf8'));
    if (!/\brunImportTasks\s*\(/.test(source)) errors.push(`task_orchestration_shared_helper_missing:${path.relative(projectDir, importEntrypoint)}`);
    const relativeEntrypoint = path.relative(projectDir, importEntrypoint);
    const completionCalls = [
      ['task_orchestration_completion_rows_missing', /\bbuildImportCompletenessRows\s*\(/],
      ['task_orchestration_completion_reasons_missing', /\battachAttemptReasons\s*\(/],
      ['task_orchestration_completion_report_missing', /\bcreateCompletionReport\s*\(/],
    ].map(([code, pattern]) => ({ code, position: source.search(pattern) }));
    for (const { code, position } of completionCalls) {
      if (position < 0) errors.push(`${code}:${relativeEntrypoint}`);
    }
    const reasons = completionCalls.find(({ code }) => code === 'task_orchestration_completion_reasons_missing');
    const report = completionCalls.find(({ code }) => code === 'task_orchestration_completion_report_missing');
    if (reasons.position >= 0 && report.position >= 0 && reasons.position > report.position) {
      errors.push(`task_orchestration_completion_journal_join_after_report:${relativeEntrypoint}`);
    }
    if (reasons.position >= 0 && report.position >= 0) errors.push(...completionDataflowErrors(source, relativeEntrypoint));
  }
  return errors;
}
// Design v2 A5: an entity whose writes the import loop owns as a composite (lib/import-task-runner.js
// COMPOSITES: products, contacts, orders, and any added later) always runs through runRecordTask.
// Generated code that calls that entity's composite or principal writer itself is the old
// hand-wired path. It is a codegen finding (A3's codegenFindings), never a refusal of the whole
// import: codegen gets one fix attempt, and a finding still there when the import runs holds only
// the tasks that write that entity (dependency-readiness evaluateTask blocks them, with a cutover
// item). Vendored toolkit copies are skipped (isToolkitCopy), and scripts/, which holds the
// offline codegen-examples harness (no Wix write).
const COMPOSITE_CALLS = {
  'stores/product': ['importProducts', 'bulkCreateStoresProductsWithInventory', 'createStoresProduct'],
  'crm/contact': ['importContacts', 'bulkUpsertContacts'],
  'ecom/order': ['importOrderHistory', 'importOrder'],
  'stores/coupon': ['ensureCoupon', 'createCoupon', 'bulkCreateCoupons'],
  'blog/post': ['runBlogBuildStage', 'runBlogBuild', 'createDraftPost', 'publishDraftPost'],
  'stores/review': ['createStoresReviews', 'moderateStoresReviews', 'moderateStoresReview'],
  'stores/back-in-stock-request': ['createBackInStockRequest'],
};
function verifyCompositeEntities(projectDir, manifest) {
  const { COMPOSITES } = require('../lib/import-task-runner.js');
  const tasks = (manifest?.tasks || []).filter(task => task?.kind === 'import');
  const refs = new Set(tasks.flatMap(task => task.entityRefs || []).filter(ref => COMPOSITES[ref]));
  if (!refs.size) return [];
  const findings = [];
  for (const file of files(path.join(projectDir, 'src'))) {
    const relative = path.relative(projectDir, file);
    if (isToolkitCopy(file)) continue;
    stripComments(fsSync.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      for (const ref of refs) for (const name of COMPOSITE_CALLS[ref] || []) {
        if (!new RegExp(`(?<![\\w$])${name}\\s*\\(`).test(line) || new RegExp(`function\\s+${name}\\b`).test(line)) continue;
        const taskIds = tasks.filter(task => (task.entityRefs || []).includes(ref)).map(task => task.id).sort();
        findings.push({ code: 'composite_entity_hand_wired', file: relative, line: index + 1, call: name, ref, taskIds,
          message: `${relative}:${index + 1}: calls ${name} for ${ref} itself; the import loop owns this entity. Run task ${taskIds.join(', ')} through runRecordTask and supply build only.` });
      }
    });
  }
  return findings;
}
// A gated entity (entity decision with a readBackContract) whose generated code does
// not call the toolkit's runGatedEntity. A warning shown with the plan, never a refusal: a
// hand-wired ReadBackGate that works is not blocked. Names the decision file and, when the code
// wires the gate by hand, the first file and line that constructs it.
function verifyGateWiring(projectDir) {
  const { DOMAINS, decisionFileName } = require('../lib/read-back-contract.js');
  let plan = null;
  try { plan = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch { /* generated-contract checks report missing plans */ }
  // One read-back unit per plan row that writes a gated entity (several rows may write contacts).
  const units = plan?.fieldContractVersion === 1
    ? Object.keys(DOMAINS).flatMap((entity) => require('../lib/mapping-field-contract.js').readBackKeys(plan, entity))
    : Object.keys(DOMAINS);
  const gated = units.filter((entity) => {
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
  // The fixed loop (runRecordTask, the scaffold's handlers) runs the gate itself.
  const toolkit = at(/\brunGatedEntity\s*\(/) || at(/\brunRecordTask\s*\(/), handWired = at(/\bnew\s+(?:[\w$.]+\.)?ReadBackGate\s*\(/);
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
// Generated task code supplies build(record, lookups) and send; the
// toolkit owns lookups, gates, the journal, the read-back gate and retries. Findings name the
// generated file and line that does the toolkit's job itself, for codegen to fix before import.
// Shown with the plan, never a refusal: entities still on the old hand-wired path report here until
// they move. A text backstop over comment-stripped source, like RUNTIME_BYPASSES.
const BOUNDARY_CALLS = [
  [/\b(gateBatch|evaluateTask)\s*\(/, 'codegen_gate_called_directly', 'the shared runner (runRecordTask) evaluates and gates each batch'],
  [/\b(appendAttempt)\s*\(/, 'codegen_journal_written_directly', 'the shared runner writes every journal row'],
  [/\b(runGatedEntity)\s*\(/, 'codegen_read_back_gate_called_directly', 'the shared runner runs the read-back gate'],
];
// Starting the run and binding each task belong to the import entrypoint layer (src/import/*.js);
// task code (handlers, task modules) receives its taskBinding.
const ENTRY_ONLY_CALLS = /\b(startImportRun|bindTask)\s*\(/;
// A counted loop over attempts/retries: the runner and the writers own retries without duplicates.
const RETRY_LOOPS = [
  /\bfor\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*[\w$.]+\s*;\s*\1\s*<=?\s*([\w$.]+)/,
  /\bwhile\s*\([^)]*\b(?:attempts?|retr(?:y|ies)|tries)\w*\s*(?:<=?|>=?|--|\+\+)/i,
  /\bwhile\s*\([^)]*(?:<=?|>=?)\s*[\w$.]*(?:attempts?|retr(?:y|ies)|tries)\w*/i,
];
const RETRY_NAME = /attempt|retr(?:y|ies)|tries/i;
let toolkitBasenames = null;
function isToolkitCopy(file) {
  if (!toolkitBasenames) {
    const root = path.resolve(__dirname, '..');
    toolkitBasenames = new Map();
    for (const toolkitFile of ['lib', 'resources', 'scripts'].flatMap(dir => files(path.join(root, dir)))) {
      const name = path.basename(toolkitFile);
      if (!toolkitBasenames.has(name)) toolkitBasenames.set(name, []);
      toolkitBasenames.get(name).push(toolkitFile);
    }
  }
  // A vendored toolkit module: named like a toolkit file AND either byte-identical to one, or
  // placed where vendoring puts copies (flat in src/lib, mirrored under src/resources or
  // src/import/vendor). A generated file that only shares a common name (src/import/index.js) is
  // generated code and is checked (review #719).
  const copies = toolkitBasenames.get(path.basename(file));
  if (!copies) return false;
  const parts = path.resolve(file).split(path.sep), src = parts.lastIndexOf('src');
  const under = src >= 0 ? parts.slice(src + 1, -1) : [];
  if ((under.length === 1 && under[0] === 'lib') || under[0] === 'resources' || (under[0] === 'import' && under[1] === 'vendor') || under[0] === 'toolkit') return true;
  const bytes = fsSync.readFileSync(file);
  return copies.some(copy => { try { return fsSync.readFileSync(copy).equals(bytes); } catch { return false; } });
}
function relativeRequires(text, file) {
  const out = [];
  for (const match of text.matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
    const base = path.resolve(path.dirname(file), match[2]);
    const found = ['', '.js', '.cjs', '.mjs', '/index.js'].map(ext => base + ext).find(candidate => fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile());
    if (found) out.push(found);
  }
  return out;
}
// A catch that only logs or drops the error: the record's failure never reaches the fixed loop
// (journal -> completion report -> cutover task). Errors in generated build/send must propagate.
// A catch that does anything else (a fallback value, a rethrow, a returned result) is not flagged.
const LOG_ONLY = /^(?:(?:console|logger|log|progress)\s*\.\s*\w+\s*\([^;]*\)\s*;?\s*)*$/;
function swallowedCatches(text) {
  const out = [];
  const lineAt = index => text.slice(0, index).split('\n').length;
  for (const match of text.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    let depth = 1, end = match.index + match[0].length;
    for (; end < text.length && depth; end += 1) { if (text[end] === '{') depth += 1; else if (text[end] === '}') depth -= 1; }
    const body = text.slice(match.index + match[0].length, end - 1).trim();
    if (LOG_ONLY.test(body)) out.push(lineAt(match.index));
  }
  // Promise form: .catch(() => {}), .catch(() => null|undefined), .catch(e => console.warn(e))
  for (const match of text.matchAll(/\.catch\s*\(\s*(?:async\s*)?(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*(?:\{\s*(?:(?:console|logger|log|progress)\s*\.\s*\w+\s*\([^;{}]*\)\s*;?\s*)?\}|null|undefined|(?:console|logger|log|progress)\s*\.\s*\w+\s*\([^)]*\))\s*\)/g)) out.push(lineAt(match.index));
  return out;
}
function verifyCodegenBoundary(projectDir) {
  let manifest = null;
  try { manifest = JSON.parse(fsSync.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')); } catch { /* the entrypoint check reports a missing manifest */ }
  const generated = new Map([...files(path.join(projectDir, 'src')), ...files(path.join(projectDir, 'scripts'))]
    .filter(file => !isToolkitCopy(file))
    .map(file => [file, stripComments(fsSync.readFileSync(file, 'utf8'))]));
  // Which import tasks reach each generated file: the task's handler (src/import/handlers/<taskId>.js)
  // and the generated modules it requires. Used to read the task's own dependency edge modes.
  const owners = new Map();
  const importTasks = (manifest?.tasks || []).filter(task => task?.kind === 'import');
  for (const task of importTasks) {
    const stack = [path.join(projectDir, 'src/import/handlers', `${task.id}.js`)], seen = new Set();
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file) || !generated.has(file)) continue;
      seen.add(file);
      if (!owners.has(file)) owners.set(file, new Set());
      owners.get(file).add(task);
      stack.push(...relativeRequires(generated.get(file), file));
    }
  }
  const entryLayer = path.join(projectDir, 'src/import');
  const findings = [];
  for (const [file, text] of generated) {
    const relative = path.relative(projectDir, file);
    for (const line of swallowedCatches(text)) findings.push({ code: 'codegen_error_swallowed', file: relative, line, call: 'catch', message: `${relative}:${line}: catches an error and only logs or drops it; let errors from build/send reach the shared runner, which journals them into the completion report and a cutover task.` });
    const atEntryLayer = path.dirname(file) === entryLayer;
    text.split('\n').forEach((line, index) => {
      const location = `${relative}:${index + 1}`;
      const add = (code, call, message) => findings.push({ code, file: relative, line: index + 1, call, message: `${location}: ${message}` });
      for (const [pattern, code, owner] of BOUNDARY_CALLS) {
        const match = line.match(pattern);
        if (match) add(code, match[1], `calls ${match[1]} itself; ${owner}. Supply only build(record, lookups) and send to runRecordTask.`);
      }
      const entry = !atEntryLayer && line.match(ENTRY_ONLY_CALLS);
      if (entry) add('codegen_run_bound_in_task_code', entry[1], `calls ${entry[1]} in task code; the import entrypoint starts the run and binds each task, and task code receives its taskBinding.`);
      for (const pattern of RETRY_LOOPS) {
        const match = line.match(pattern);
        if (match && (pattern !== RETRY_LOOPS[0] || RETRY_NAME.test(match[1]) || RETRY_NAME.test(match[2]))) {
          add('codegen_retry_loop', 'retry-loop', 'writes its own retry loop; the shared runner and writers retry without duplicates.');
          break;
        }
      }
      // A per-record lookup for a reference the task waits on as a whole (a task-complete edge):
      // the gate refuses it (REFERENCE_UNDECLARED) and every record of the task is blocked (11-15).
      for (const match of line.matchAll(/\bresolveReference\s*\(\s*(['"`])([\w-]+\/[\w-]+)\1/g)) {
        for (const task of owners.get(file) || []) {
          const edge = (task.dependencyEdges || []).find(row => row.ref === match[2]);
          if (edge?.mode === 'task-complete') add('codegen_resolver_mode_mismatch', 'resolveReference', `task ${task.id} looks up ${match[2]} per record, but its manifest edge is task-complete; lookups belong to the runner, which uses the edge's mode.`);
        }
      }
    });
  }
  findings.push(...verifyCompositeEntities(projectDir, manifest));
  return findings;
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
    // Each generated task handler must pass its own source entity ref to the scope guard.
    const scopes = mappingPlan?.fieldContractVersion === 1 ? require('../lib/handler-scope-probe').probeHandlerScopes(projectDir, { descriptor, manifest, plan: mappingPlan }).errors : [];
    if (!readiness.ok || modes.length || bypasses.length || scopes.length) throw new Error([...readiness.errors, ...modes, ...bypasses, ...scopes].join(';'));
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
  const staticErrors = verifyStaticContract(projectDir, { pluginHandoff: plugin });
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
  // Generated code doing the toolkit's job (gates, journal, read-back gate, retries, lookup mode).
  // Returned to codegen to fix before import; never a refusal here.
  const codegenFindings = verifyCodegenBoundary(projectDir);
  // The toolkit-written import scaffold (codegen-scaffold.js): a change outside the hook bodies is a
  // finding once (one fix attempt); still there on the next check, the toolkit restores it.
  codegenFindings.push(...require('../lib/codegen-scaffold.js').verifyScaffold(projectDir));
  // Durable evidence for the completion report's operator action (rewritten every run, so a fix
  // clears it). It reads only generated code, so a dry run records it too.
  fsSync.mkdirSync(path.join(projectDir, 'execution'), { recursive: true });
  fsSync.writeFileSync(path.join(projectDir, 'execution/codegen-findings.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), findings: codegenFindings }, null, 2)}\n`);
  if (codegenFindings.length) console.error(`${codegenFindings.length} codegen finding(s): generated code does work the toolkit owns; route back to codegen (see codegenFindings).`);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    projectDir,
    entrypoints: results,
    rawRequestTargets: rawRequests,
    cmsItemQuota,
    warnings,
    codegenFindings,
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
module.exports = { RUNTIME_BYPASSES, CONTRACT_ENUMS, COMPOSITE_CALLS, verifyStaticContract, verifyGateWiring, verifyRuntimeUse, verifyCodegenBoundary, verifyCompositeEntities };
