#!/usr/bin/env node
'use strict';

const path = require('node:path');
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
  updateApprovalObject,
  autoApproveOneClick,
  updateCheckpointObject,
  transitionRun,
} = require('../lib/orchestration-state.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');
const { normalizeAutomationMode } = require('../lib/orchestration-decisions.js');

let progress;

function usage() {
  console.log(`Usage:
  node scripts/orchestration-state.js init --project-dir <dir> [--project-id <id>]
  node scripts/orchestration-state.js validate --project-dir <dir>
  node scripts/orchestration-state.js status --project-dir <dir>
  node scripts/orchestration-state.js decide --project-dir <dir> --key <decisionKey> --value <jsonOrString> [--source user|deterministic_inference|prior_artifact] [--rationale <text>]
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
      checkpointStatus: {
        discovery: artifacts.checkpoints.discovery.status,
        mapping: artifacts.checkpoints.mapping.status,
        setup: artifacts.checkpoints.setup.status,
        codegen: artifacts.checkpoints.codegen.status,
        execution: artifacts.checkpoints.execution.status,
      },
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
    const decisionValue = parseMaybeJson(args.value);
    if (['automationMode', 'interactionMode', 'runMode'].includes(args.key) &&
        normalizeAutomationMode(decisionValue) === 'one_click' && !args.source) {
      throw new Error('explicit one-click requires --source user');
    }
    updateDecisionObject(artifacts.decisions, args.key, decisionValue, {
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

  if (command === 'approve') {
    if (!args.type || !args.status) {
      throw new Error('approve requires --type and --status');
    }
    updateApprovalObject(artifacts.approvals, args.type, args.status, {
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
    const result = autoApproveOneClick(artifacts, args.type, {
      artifactRefs,
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
