#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { approvalArtifactRefs } = require('../lib/user-actions.js');
const {
  nowIso,
  randomId,
  orchestrationDir,
  loadArtifacts,
  initArtifacts,
  validateArtifacts,
  writeJsonAtomic,
  appendEvent,
  updateDecisionObject,
  assertGenericDecisionKey,
  recordPluginCmsFallbackDecision,
  updateApprovalObject,
  autoApproveOneClick,
  updateCheckpointObject,
  transitionRun,
} = require('../lib/orchestration-state.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');
const {
  SOURCE_MODE_DECISION_KEYS,
  invalidSourceModeMessage,
  isKnownSourceMode,
  normalizeAutomationMode,
} = require('../lib/orchestration-decisions.js');
const { applySiteTypePair, resolveSiteTypePair } = require('../lib/destination-choice.js');

let progress;

function usage() {
  console.log(`Usage:
  node scripts/orchestration-state.js init --project-dir <dir> [--project-id <id>]
  node scripts/orchestration-state.js validate --project-dir <dir>
  node scripts/orchestration-state.js status --project-dir <dir>
  node scripts/orchestration-state.js decide --project-dir <dir> --key <decisionKey> --value <jsonOrString> [--source user|deterministic_inference|prior_artifact] [--rationale <text>]
      (targetSiteType: --value headless|studio|harmony [--business-type store|bookings|other|unknown] [--business-type-source user|context|not_asked] [--evidence-ref <ref>])
  node scripts/orchestration-state.js decide-cms-fallback --project-dir <dir> --capability <id> --value approved|declined --approved-by <text> [--rationale <text>] [--coverage <plugin-coverage.json>] [--plugins-root <dir>]
  node scripts/orchestration-state.js approve --project-dir <dir> --type mapping|execution --status pending|approved|rejected|provisional [--notes <text>] [--decided-by user|system|agent]
  node scripts/orchestration-state.js auto-approve --project-dir <dir> --type mapping|execution [--notes <text>] [--artifact-refs <jsonArray>]
  node scripts/orchestration-state.js checkpoint --project-dir <dir> --phase discovery|mapping|setup|codegen|execution --patch <json>
  node scripts/orchestration-state.js transition --project-dir <dir> --state <state> --phase <activePhase> [--status <runStatus>] [--needs-user-input true|false] [--needs-llm true|false] [--resume-from <jsonReasonRef>]
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

// Missing checkpoints.json or a missing phase entry renders as null; the validation
// error list printed alongside it names the problem.
function checkpointStatusSummary(checkpoints) {
  const summary = {};
  for (const phase of ['discovery', 'mapping', 'setup', 'codegen', 'execution']) {
    const item = checkpoints && typeof checkpoints === 'object' ? checkpoints[phase] : null;
    summary[phase] = item && typeof item === 'object' ? item.status : null;
  }
  return summary;
}

function parseMaybeJson(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBoolean(value, fallback) {
  if (value == null) {
    return fallback;
  }
  return String(value) === 'true';
}

async function saveArtifacts(projectDir, artifacts) {
  const dir = orchestrationDir(projectDir);
  await writeJsonAtomic(path.join(dir, 'run.json'), artifacts.run);
  await writeJsonAtomic(path.join(dir, 'checkpoints.json'), artifacts.checkpoints);
  await writeJsonAtomic(path.join(dir, 'decisions.json'), artifacts.decisions);
  await writeJsonAtomic(path.join(dir, 'approvals.json'), artifacts.approvals);
  if (artifacts.preflight) {
    await writeJsonAtomic(path.join(dir, 'preflight.json'), artifacts.preflight);
  }
}

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/orchestration-state.js',
    ...parsed.progress,
  });
  progress.start('Orchestration state command started', { phase: 'orchestration' });

  const args = parseArgs(parsed.args);
  const command = args._[0];
  if (!command || command === 'help') {
    usage();
    if (command) {
      progress.complete('Orchestration state help shown', { phase: 'orchestration', step: 'help' });
    } else {
      progress.error('Missing orchestration state command', { phase: 'orchestration' });
    }
    process.exit(command ? 0 : 1);
  }

  if (!args.projectDir) {
    throw new Error('--project-dir is required');
  }
  const projectDir = path.resolve(args.projectDir);

  if (command === 'init') {
    const artifacts = await initArtifacts(projectDir, { projectId: args.projectId || path.basename(projectDir) });
    console.log(JSON.stringify({ ok: true, projectDir, state: artifacts.run.currentState }, null, 2));
    progress.complete('Orchestration artifacts initialized', { phase: 'orchestration', step: 'init', artifact: projectDir });
    return;
  }

  const artifacts = await loadArtifacts(projectDir);
  if (!artifacts.run) {
    throw new Error(`orchestration artifacts not initialized under ${projectDir}`);
  }

  if (command === 'validate') {
    const result = validateArtifacts(artifacts);
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      progress.complete('Orchestration artifacts validated', { phase: 'orchestration', step: 'validate', artifact: projectDir });
    } else {
      progress.error('Orchestration artifact validation failed', { phase: 'orchestration', step: 'validate', artifact: projectDir, count: result.errors.length, unit: 'errors' });
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === 'status') {
    const result = validateArtifacts(artifacts);
    console.log(JSON.stringify({
      ok: result.ok,
      currentState: artifacts.run.currentState,
      activePhase: artifacts.run.activePhase,
      runStatus: artifacts.run.status,
      approvals: artifacts.approvals,
      checkpointStatus: checkpointStatusSummary(artifacts.checkpoints),
      errors: result.errors,
    }, null, 2));
    if (result.ok) {
      progress.complete('Orchestration status read', { phase: 'orchestration', step: 'status', artifact: projectDir });
    } else {
      progress.error('Orchestration status is invalid', { phase: 'orchestration', step: 'status', artifact: projectDir, count: result.errors.length, unit: 'errors' });
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === 'decide') {
    if (!args.key || args.value == null) {
      throw new Error('decide requires --key and --value');
    }
    assertGenericDecisionKey(args.key);
    const decisionValue = parseMaybeJson(args.value);
    if (['automationMode', 'interactionMode', 'runMode'].includes(args.key) &&
        normalizeAutomationMode(decisionValue) === 'one_click' && !args.source) {
      throw new Error('explicit one-click requires --source user');
    }
    // Reject an unknown source mode before anything is saved or logged, so it can never
    // reach the router or preflight and silently downgrade to public capture.
    if (SOURCE_MODE_DECISION_KEYS.includes(args.key) && !isKnownSourceMode(decisionValue)) {
      throw new Error(invalidSourceModeMessage(decisionValue));
    }
    // The site type and Harmony business type are one pair in one write.
    if (args.key === 'targetSiteBusinessType') {
      throw new Error('record targetSiteBusinessType with --key targetSiteType --value harmony --business-type <store|bookings|other|unknown>');
    }
    if (args.key === 'targetSiteType') {
      const pair = resolveSiteTypePair({
        siteType: decisionValue,
        businessType: args.businessType,
        businessTypeSource: args.businessTypeSource || (decisionValue === 'harmony' && args.businessType === undefined ? 'user' : undefined),
        evidenceRef: args.evidenceRef || null,
      });
      applySiteTypePair(artifacts.decisions, pair, { rationale: args.rationale || null, timestamp: nowIso() });
    } else updateDecisionObject(artifacts.decisions, args.key, decisionValue, {
      source: args.source || 'user',
      rationale: args.rationale || null,
      timestamp: nowIso(),
    });
    await saveArtifacts(projectDir, artifacts);
    await appendEvent(projectDir, {
      id: randomId('evt'),
      timestamp: nowIso(),
      phase: artifacts.run.activePhase,
      state: artifacts.run.currentState,
      type: 'decision.recorded',
      payload: { key: args.key },
    });
    console.log(JSON.stringify({ ok: true, decision: args.key }, null, 2));
    progress.complete('Orchestration decision recorded', { phase: 'orchestration', step: 'decide', entity: args.key, artifact: projectDir });
    return;
  }

  if (command === 'decide-cms-fallback' || command === 'decideCmsFallback') {
    const coveragePath = args.coverage
      ? path.resolve(args.coverage)
      : [path.join(projectDir, 'discovery', 'plugin-coverage.json'), path.join(projectDir, 'data', 'wp-discovery', 'plugin-coverage.json')]
        .find((candidate) => fs.existsSync(candidate));
    if (!coveragePath || !fs.existsSync(coveragePath)) {
      throw new Error('decide-cms-fallback needs plugin-coverage.json (discovery/ or data/wp-discovery/, or --coverage)');
    }
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const coverageRow = (coverage.capabilities || []).find((row) => row.capability === args.capability && row.recognized);
    const { key, event } = recordPluginCmsFallbackDecision(artifacts, {
      capability: args.capability,
      value: args.value,
      approvedBy: args.approvedBy,
      coverageRow,
      pluginsRoot: args.pluginsRoot ? path.resolve(args.pluginsRoot) : undefined,
      rationale: args.rationale || null,
      timestamp: nowIso(),
    });
    await saveArtifacts(projectDir, artifacts);
    await appendEvent(projectDir, event);
    console.log(JSON.stringify({ ok: true, decision: key, value: args.value, mappingApproval: artifacts.approvals.mapping.status }, null, 2));
    progress.complete('CMS-fallback decision recorded', { phase: 'orchestration', step: 'decide-cms-fallback', entity: key, artifact: projectDir });
    return;
  }

  if (command === 'approve') {
    if (!args.type || !args.status) {
      throw new Error('approve requires --type and --status');
    }
    updateApprovalObject(artifacts.approvals, args.type, args.status, {
      artifactRefs: await approvalArtifactRefs(projectDir, { approvalType: args.type, status: args.status, decidedBy: args.decidedBy || 'user' }),
      notes: args.notes || null,
      decidedBy: args.decidedBy || 'user',
      timestamp: nowIso(),
    });
    await saveArtifacts(projectDir, artifacts);
    await appendEvent(projectDir, {
      id: randomId('evt'),
      timestamp: nowIso(),
      phase: artifacts.run.activePhase,
      state: artifacts.run.currentState,
      type: 'approval.updated',
      payload: { approvalType: args.type, status: args.status },
    });
    console.log(JSON.stringify({ ok: true, approvalType: args.type, status: args.status }, null, 2));
    progress.complete('Orchestration approval updated', { phase: 'orchestration', step: 'approve', entity: args.type, artifact: projectDir });
    return;
  }

  if (command === 'auto-approve' || command === 'autoApprove') {
    if (!args.type) {
      throw new Error('auto-approve requires --type');
    }
    const artifactRefs = args.artifactRefs == null ? [] : parseMaybeJson(args.artifactRefs);
    if (!Array.isArray(artifactRefs)) {
      throw new Error('--artifact-refs must be a JSON array when provided');
    }
    // Preserve the existing no-op/refusal behavior before performing any disk binding.
    const probe = autoApproveOneClick(JSON.parse(JSON.stringify(artifacts)), args.type, { artifactRefs });
    if (!probe.ok) throw new Error(`auto-approve failed: ${probe.reason}`);
    const boundRefs = probe.changed ? await approvalArtifactRefs(projectDir, { approvalType: args.type, status: 'approved', decidedBy: 'agent', artifactRefs }) : artifactRefs;
    const result = autoApproveOneClick(artifacts, args.type, {
      artifactRefs: boundRefs,
      notes: args.notes || null,
      timestamp: nowIso(),
    });
    if (!result.ok) {
      throw new Error(`auto-approve failed: ${result.reason}`);
    }
    await saveArtifacts(projectDir, artifacts);
    await appendEvent(projectDir, {
      id: randomId('evt'),
      timestamp: nowIso(),
      phase: artifacts.run.activePhase,
      state: artifacts.run.currentState,
      type: 'approval.auto_approved',
      payload: { approvalType: args.type },
    });
    console.log(JSON.stringify({ ok: true, approvalType: args.type, changed: result.changed }, null, 2));
    progress.complete('Orchestration approval auto-approved', { phase: 'orchestration', step: 'auto-approve', entity: args.type, artifact: projectDir });
    return;
  }

  if (command === 'checkpoint') {
    if (!args.phase || !args.patch) {
      throw new Error('checkpoint requires --phase and --patch');
    }
    updateCheckpointObject(artifacts.checkpoints, args.phase, parseMaybeJson(args.patch), nowIso());
    await saveArtifacts(projectDir, artifacts);
    // Advancing a phase is a fact about how far the run got, so it belongs in the run's own
    // journal exactly as `transition`, `decide`, `approve` and `auto-approve` put theirs there.
    // Without this line, phase progress was remembered only in checkpoints.json, and a reader
    // replaying the journal saw a run that never left its opening state.
    //
    // The payload is read back off the *persisted* checkpoint, never off `--patch`: a patch that
    // sets only `lastCompletedStep` must still report the status the checkpoint actually holds,
    // and reporting the argument would emit `undefined` for a field the run still carries.
    const checkpoint = artifacts.checkpoints[args.phase];
    const payload = {
      phase: args.phase,
      status: checkpoint.status ?? null,
      // A fresh checkpoint has no completed step. Emit the null rather than dropping the key:
      // an absent key and a null step are different facts to a reader replaying the journal.
      lastCompletedStep: checkpoint.lastCompletedStep ?? null,
    };
    if (args.phase === 'execution') {
      // Execution is the only checkpoint carrying these two, and the only one where a single
      // status cannot distinguish "setup done, import not" from "neither started".
      payload.setupStatus = checkpoint.setupStatus ?? null;
      payload.importStatus = checkpoint.importStatus ?? null;
    }
    // After saveArtifacts, matching the four sibling commands. A crash in between leaves a
    // checkpoint with no event; that failure mode is theirs already and is not narrowed here.
    await appendEvent(projectDir, {
      id: randomId('evt'),
      timestamp: nowIso(),
      phase: artifacts.run.activePhase,
      state: artifacts.run.currentState,
      type: 'checkpoint.updated',
      payload,
    });
    console.log(JSON.stringify({ ok: true, phase: args.phase }, null, 2));
    progress.complete('Orchestration checkpoint updated', { phase: 'orchestration', step: 'checkpoint', entity: args.phase, artifact: projectDir });
    return;
  }

  if (command === 'transition') {
    if (!args.state || !args.phase) {
      throw new Error('transition requires --state and --phase');
    }
    artifacts.run = transitionRun(artifacts.run, {
      state: args.state,
      activePhase: args.phase,
      status: args.status || artifacts.run.status,
      needsUserInput: parseBoolean(args.needsUserInput, artifacts.run.needsUserInput),
      needsLlm: parseBoolean(args.needsLlm, artifacts.run.needsLlm),
      resumeFrom: args.resumeFrom ? parseMaybeJson(args.resumeFrom) : artifacts.run.resumeFrom,
      timestamp: nowIso(),
    });
    await saveArtifacts(projectDir, artifacts);
    await appendEvent(projectDir, {
      id: randomId('evt'),
      timestamp: nowIso(),
      phase: artifacts.run.activePhase,
      state: artifacts.run.currentState,
      type: 'state.transitioned',
      payload: { activePhase: artifacts.run.activePhase, runStatus: artifacts.run.status },
    });
    console.log(JSON.stringify({ ok: true, state: artifacts.run.currentState, phase: artifacts.run.activePhase }, null, 2));
    progress.complete('Orchestration state transitioned', { phase: 'orchestration', step: 'transition', entity: args.state, artifact: projectDir });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Orchestration state command failed', { phase: 'orchestration' });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
