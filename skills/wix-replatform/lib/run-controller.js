'use strict';

// The runner deliberately owns only process supervision and presentation. Routing, receipts,
// and migration mutations remain owned by the existing skill artifacts.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadArtifacts, initArtifacts, writeJsonAtomic, updateDecisionObject, transitionRun } = require('./orchestration-state.js');
const { determineNextStep } = require('./orchestration-router.js');
const { validateMigrationCompletion, loadMigrationCompletionInputs } = require('./migration-completion.js');
const { listUserActions, readUserAction } = require('./user-actions.js');
const { applySiteTypePair, resolveSiteTypePair } = require('./destination-choice.js');
const { chooseAdapter, launch, requestCancel } = require('./agent-adapters/index.js');
const { readTaskState, writeTaskState, createTaskState, selectRoute, startRoute, waitForInput, startDirectAgent, finishDirectAgent, recordWorker, finishCurrent, reconcileTaskState } = require('./task-state.js');

const SCHEMA_VERSION = 1;
const RUNNER_DIR = ['state', 'runner'];

const iso = () => new Date().toISOString();
const runId = () => `rpr_${crypto.randomUUID()}`;
const runnerDir = (projectDir) => path.join(projectDir, ...RUNNER_DIR);
const activePath = (projectDir) => path.join(runnerDir(projectDir), 'active.json');
const historyPath = (projectDir, id) => path.join(runnerDir(projectDir), 'runs', `${id}.json`);
const defaultEventsPath = (projectDir) => path.join(runnerDir(projectDir), 'events.ndjson');
const cancelPath = (projectDir) => path.join(runnerDir(projectDir), 'cancel-request.json');

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensureInitialArtifacts(projectDir) {
  const artifacts = await loadArtifacts(projectDir);
  if (artifacts.run) return artifacts;
  return initArtifacts(projectDir);
}

function safeRelative(projectDir, item) {
  const relative = path.relative(projectDir, item);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replaceAll(path.sep, '/') : null;
}

async function appendLine(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function findRun(rootDir, id) {
  if (!/^rpr_[0-9a-f-]+$/.test(id)) return null;
  // Projects normally sit one level beneath the migrations root. A bounded recursive
  // lookup also keeps existing runs observable after a project was nested accidentally.
  const pending = [{ directory: rootDir, depth: 0 }];
  while (pending.length) {
    const { directory, depth } = pending.pop();
    const direct = await readJson(historyPath(directory, id));
    if (direct) return direct;
    if (depth >= 3) continue;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && !['state', 'orchestration', 'completion', 'execution', 'website'].includes(entry.name)) {
        pending.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
      }
    }
  }
  return null;
}

async function readActive(projectDir) { return readJson(activePath(projectDir)); }

async function applyInvocationInputs(projectDir, inputs) {
  const artifacts = await ensureInitialArtifacts(projectDir);
  const decisions = artifacts.decisions;
  const mappings = {
    sourceUrl: inputs.sourceUrl,
    sourceMode: inputs.sourceMode,
    fileInputPaths: inputs.fileInputPaths,
    deliveryMode: inputs.deliveryMode,
    targetSiteStrategy: inputs.destination,
    managementImportMode: inputs.managementImportMode,
    ...(inputs.oneClick ? { automationMode: 'one_click' } : {}),
    ...(inputs.dryRun ? { dryRun: true } : {}),
  };
  let changed = false;
  for (const [key, value] of Object.entries(mappings)) {
    if (value === undefined) continue;
    const existing = decisions[key] && decisions[key].value;
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`CLI input conflicts with existing user decision: ${key}`);
    }
    if (existing === undefined) { updateDecisionObject(decisions, key, value, { source: 'user' }); changed = true; }
  }
  // The site-type pair lands in the same single decisions write. A Harmony
  // flag with no business type records `unknown` (source not_asked) and raises no request.
  if (inputs.siteType !== undefined) {
    const pair = resolveSiteTypePair({
      siteType: inputs.siteType,
      businessType: inputs.siteType === 'harmony' ? (inputs.siteBusinessType || 'unknown') : inputs.siteBusinessType,
      businessTypeSource: inputs.siteType === 'harmony' && !inputs.siteBusinessType ? 'not_asked' : 'user',
    });
    try {
      if (applySiteTypePair(decisions, pair, { rationale: 'replatform CLI --site-type' }).changed) changed = true;
    } catch (error) {
      throw new Error(`CLI input conflicts with existing user decision: targetSiteType (${error.message})`);
    }
  } else if (inputs.siteBusinessType !== undefined) {
    throw new Error('site-business-type is valid only with --site-type harmony');
  }
  if (changed) await writeJsonAtomic(path.join(projectDir, 'orchestration', 'decisions.json'), decisions);
  return artifacts;
}

async function resumeStaleTelemetry(projectDir) {
  try {
    const { resumeIfStale } = require('../resources/rp-telemetry/lib/telemetry-recorder.js');
    return await resumeIfStale(projectDir, { trigger: 'supervisor' });
  } catch (error) {
    return { resumed: false, reason: 'error', trigger: 'supervisor', error: String((error && error.message) || error) };
  }
}

function bootstrap(projectDir) {
  // Only this already-validated absolute path is variable. Intake values stay in artifacts.
  return `Use the installed wix-replatform skill for the migration project at ${projectDir}. Read durable orchestration artifacts and the latest accepted CLI invocation, route, then perform only the selected stage. Do not claim completion from prose. When human input or review is required, create a durable user action and end this turn; never use an interactive question UI or wait for terminal input.`;
}

// A pending action is intentionally included in the normalized stream. A consumer must be
// able to render and answer a checkpoint from JSONL alone, without first reading a project file.
// Keep this to operator-facing fields; do not expose effects or a later answer here.
function userActionSummary(request) {
  return {
    requestId: request.requestId,
    kind: request.kind,
    stage: request.stage,
    title: request.title,
    prompt: request.prompt,
    response: request.response,
    choices: request.choices,
    artifactRefs: request.artifactRefs,
  };
}

function makeResult({ id, projectDir, outcome, adapter = null, route = null, completion = null, nextAction = null, request = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: id,
    project: path.basename(projectDir),
    outcome,
    agent: adapter ? { id: adapter.id, version: adapter.version || null, sessionId: null } : null,
    router: route ? { state: route.nextState, reason: route.reason, nextResource: route.nextResource || null } : null,
    completion: { validated: Boolean(completion && completion.ok), artifact: completion && completion.ok ? 'completion/migration-completion.json' : null },
    artifacts: request ? request.artifactRefs.map((ref) => ref.path) : [],
    ...(request ? {
      requestId: request.requestId,
      kind: request.kind,
      choices: request.choices,
      userAction: userActionSummary(request),
    } : {}),
    nextAction,
  };
}

function exitCode(result) {
  return ({ completed: 0, waiting_for_user: 3, blocked: 4, canceled: 5, interrupted: 5, timed_out: 6 })[result.outcome] ?? 1;
}

class RunController {
  constructor(projectDir, options = {}) {
    this.projectDir = path.resolve(projectDir);
    this.options = { agent: 'auto', maxAgentTurns: 12, maxNoProgressContinuations: 1, gracePeriodMs: 60000, ...options };
    this.id = options.runId || runId();
    this.eventFiles = new Set([options.eventsFile || defaultEventsPath(this.projectDir)]);
    this.vendorEventsPath = options.vendorEvents || null;
    this.lastObservationAt = Date.now();
    this.child = null;
    this.adapter = null;
    this.taskState = null;
    this.closed = false;
  }

  async emit(type, state, message, extra = {}) {
    const event = { schemaVersion: SCHEMA_VERSION, eventId: `evt_${crypto.randomUUID()}`, timestamp: iso(), runId: this.id, type, state, message, ...extra };
    for (const filePath of this.eventFiles) await appendLine(filePath, event);
    this.options.onEvent?.(event);
    return event;
  }

  async writeRecord(patch = {}) {
    // `startedAt` and `telemetryResume` are carried on the controller and included in every
    // write, because the record is rebuilt from scratch each time. `startedAt` in active.json is
    // what an explicit telemetry `start` inside this run reads to join the session this run
    // opened (one supervisor process is one telemetry session).
    const record = { schemaVersion: SCHEMA_VERSION, runId: this.id, projectDir: this.projectDir, pid: process.pid, childPid: this.child?.pid || null, adapter: this.adapter ? { id: this.adapter.id, version: this.adapter.version || null } : null, eventPath: [...this.eventFiles][0], status: 'running', updatedAt: iso(), ...(this.startedAt ? { startedAt: this.startedAt } : {}), ...(this.telemetryResume ? { telemetryResume: this.telemetryResume } : {}), ...patch };
    await fs.mkdir(path.dirname(historyPath(this.projectDir, this.id)), { recursive: true });
    await writeJsonAtomic(historyPath(this.projectDir, this.id), record);
    if (!this.closed) await writeJsonAtomic(activePath(this.projectDir), record);
    return record;
  }

  async updateTasks(change) {
    if (!this.taskState) return null;
    change(this.taskState);
    this.taskState = await writeTaskState(this.projectDir, this.taskState);
    return this.taskState;
  }

  async recordInvocation() {
    const filePath = path.join(this.projectDir, 'orchestration', 'cli-invocations.ndjson');
    const safe = ['agent', 'sourceUrl', 'sourceMode', 'fileInputPaths', 'deliveryMode', 'destination', 'managementImportMode', 'siteType', 'siteBusinessType', 'oneClick', 'dryRun'].reduce((out, key) => {
      if (this.options[key] !== undefined) out[key] = this.options[key]; return out;
    }, {});
    await appendLine(filePath, { schemaVersion: SCHEMA_VERSION, runId: this.id, acceptedAt: iso(), options: safe });
  }

  async cancellationRequested() { return readJson(cancelPath(this.projectDir)); }

  async setOrchestrationCancellation(status) {
    const artifacts = await loadArtifacts(this.projectDir);
    if (!artifacts.run) return;
    const run = transitionRun(artifacts.run, { state: status, activePhase: 'orchestration', status, needsUserInput: false, needsLlm: false });
    await writeJsonAtomic(path.join(this.projectDir, 'orchestration', 'run.json'), run);
  }

  async finish(result) {
    if (this.closed) return result;
    this.closed = true;
    await this.updateTasks((state) => finishCurrent(state, result.outcome === 'waiting_for_user' ? 'waiting_for_input' : result.outcome === 'timed_out' ? 'interrupted' : result.outcome));
    await this.emit('result', result.outcome, 'Run result.', { result });
    await this.writeRecord({ status: result.outcome, result, endedAt: iso() });
    try { await fs.unlink(activePath(this.projectDir)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return result;
  }

  async waitForChild() {
    return new Promise((resolve) => this.child.once('close', (code, signal) => resolve({ code, signal })));
  }

  async run() {
    await fs.mkdir(this.projectDir, { recursive: true });
    const alreadyActive = await readActive(this.projectDir);
    if (alreadyActive && alreadyActive.runId !== this.id && alreadyActive.status === 'running') {
      throw new Error(`project already has an active run: ${alreadyActive.runId}`);
    }
    await applyInvocationInputs(this.projectDir, this.options);
    const existing = await loadArtifacts(this.projectDir);
    if (this.options.resume && ['canceled', 'interrupted', 'cancel_requested'].includes(existing.run?.status)) {
      const resumed = transitionRun(existing.run, { state: 'initialized', activePhase: 'orchestration', status: 'running', needsUserInput: false, needsLlm: false });
      await writeJsonAtomic(path.join(this.projectDir, 'orchestration', 'run.json'), resumed);
      try { await fs.unlink(cancelPath(this.projectDir)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // Once per supervisor process, before the first loop iteration: a supervisor start is a new
    // execution, so an open telemetry journal records a new session (or joins one opened in the
    // last minute). Never from the loop, the router or `status`. Fail-soft and silent: the
    // result lives only in this run's record, never in the event stream or on screen.
    this.startedAt = iso();
    this.telemetryResume = await resumeStaleTelemetry(this.projectDir);
    await this.recordInvocation();
    await this.writeRecord();
    const persistedTaskState = await readTaskState(this.projectDir);
    this.taskState = persistedTaskState?.runId === this.id ? await reconcileTaskState(this.projectDir, persistedTaskState) : createTaskState(this.id);
    await writeTaskState(this.projectDir, this.taskState);
    await this.emit('started', 'running', 'Supervisor started.', { evidence: { kind: 'process', ref: String(process.pid) } });
    const started = Date.now();
    this.startedAtMs = started;
    let turns = 0;
    let sameRoute = 0;
    let priorRoute = null;
    while (turns <= this.options.maxAgentTurns) {
      const cancellation = await this.cancellationRequested();
      if (cancellation) return this.cancel(cancellation);
      if (this.options.wallTimeoutMs && Date.now() - started > this.options.wallTimeoutMs) {
        return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'timed_out', nextAction: 'Resume with replatform resume <project> after investigating the timeout.' }));
      }
      const pending = await listUserActions(this.projectDir, { status: 'pending' });
      if (pending.length) {
        const request = await readUserAction(this.projectDir, pending[0].requestId);
        await this.updateTasks((state) => waitForInput(state, request));
        const route = { nextState: 'awaiting_user_action', reason: 'pending_user_action', nextResource: null };
        await this.emit('user_action_requested', 'waiting_for_user', request.prompt, {
          requestId: request.requestId,
          title: request.title,
          userAction: userActionSummary(request),
          evidence: { kind: 'user_action', ref: `orchestration/user-actions/${request.requestId}.json` },
        });
        await this.emit('waiting_for_user', 'waiting_for_user', 'Waiting for a durable user action answer.', { requestId: request.requestId });
        const response = request.response.mode === 'choice'
          ? `--choice <${request.choices.map((choice) => choice.id).join('|')}>`
          : request.response.mode === 'text' ? '--text "<answer>"' : '--acknowledge';
        return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'waiting_for_user', route, request, nextAction: `replatform answer --project ${this.projectDir} --request-id ${request.requestId} ${response} --continue` }));
      }
      const artifacts = await loadArtifacts(this.projectDir);
      const route = await determineNextStep(this.projectDir, artifacts);
      await this.updateTasks((state) => selectRoute(state, route));
      await this.emit('routed', 'running', route.reason, { evidence: { kind: 'router', ref: route.nextResource || route.reason }, route });
      if (!route.ok) return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'failed', route, nextAction: 'Inspect orchestration artifacts and repair the reported validation error.' }));
      if (route.nextState === 'completed') {
        const completionInputs = await loadMigrationCompletionInputs(this.projectDir);
        const completion = validateMigrationCompletion(completionInputs.completion, completionInputs);
        if (completion.ok) return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'completed', route, completion }));
      }
      if (['blocked', 'canceled', 'interrupted', 'cancel_requested'].includes(route.nextState)) {
        const outcome = route.nextState === 'cancel_requested' ? 'interrupted' : route.nextState;
        return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome, route, nextAction: route.nextState === 'blocked' ? 'Inspect the route reason and satisfy the named prerequisite.' : 'Use replatform resume <project> when ready.' }));
      }
      const routeKey = `${route.nextState}:${route.reason}:${route.nextResource || ''}`;
      sameRoute = routeKey === priorRoute ? sameRoute + 1 : 0;
      priorRoute = routeKey;
      if (sameRoute > this.options.maxNoProgressContinuations) {
        return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'blocked', route, nextAction: 'The selected stage made no durable progress; inspect its artifacts before resuming.' }));
      }
      if (turns >= this.options.maxAgentTurns) return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'timed_out', route, nextAction: 'Maximum agent turns reached; resume after inspecting artifacts.' }));
      if (!this.adapter) {
        this.adapter = chooseAdapter(this.options.agent, { agentPath: this.options.agentPath });
        if (!this.adapter.ok) return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'failed', route, nextAction: 'Run replatform doctor and authenticate an installed supported agent.' }));
      }
      turns += 1;
      let directAgentId = null;
      this.child = launch(this.adapter.id, { cwd: this.projectDir, executablePath: this.options.agentPath, prompt: bootstrap(this.projectDir), onWorker: async (worker) => {
        let accepted = false;
        await this.updateTasks((state) => { const task = state.tasks.find((item) => item.state === 'running'); accepted = Boolean(task) && recordWorker(state, task.taskId, this.adapter.id, worker); });
        if (!accepted) await this.emit('protocol_error', 'running', 'Ignored malformed agent worker report.', { evidence: { kind: 'adapter_protocol', ref: this.adapter.id } });
      }, onEvent: async (event) => {
        this.lastObservationAt = Date.now();
        if (this.vendorEventsPath && event.type === 'vendor_event') await appendLine(this.vendorEventsPath, event.raw);
        await this.emit(event.type === 'vendor_event' ? 'progress' : 'progress', 'running', 'Observed agent output.', { evidence: { kind: event.type, ref: this.adapter.id } });
      } });
      await this.updateTasks((state) => {
        const task = startRoute(state, route);
        directAgentId = startDirectAgent(state, task, this.adapter.id, this.child.pid).agentId;
      });
      await this.writeRecord({ childPid: this.child.pid, childProcessGroup: this.child.pid });
      await this.emit('agent_started', 'running', `Started ${this.adapter.id} agent turn.`, { evidence: { kind: 'process', ref: String(this.child.pid) } });
      const childDone = this.waitForChild();
      const heartbeat = this.options.statusIntervalMs ? setInterval(async () => {
        const elapsed = Date.now() - this.lastObservationAt;
        if (elapsed >= this.options.statusIntervalMs) await this.emit('heartbeat', 'running', 'Agent process is alive; no newer progress was observed.', { lastObservedAt: new Date(this.lastObservationAt).toISOString(), elapsedSinceObservationMs: elapsed, evidence: { kind: 'process', ref: String(this.child?.pid) } });
      }, Math.max(1000, this.options.statusIntervalMs)) : null;
      let finished = null;
      // A second terminal communicates through the durable request file. Polling that
      // file is intentionally mundane: it works for foreground and detached ownership
      // without introducing a daemon socket or an interactive stdin channel.
      while (!finished) {
        finished = await Promise.race([
          childDone,
          new Promise((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (!finished && await this.cancellationRequested()) {
          if (heartbeat) clearInterval(heartbeat);
          return this.cancel(await this.cancellationRequested());
        }
        const wallExpired = this.options.wallTimeoutMs && Date.now() - this.startedAtMs > this.options.wallTimeoutMs;
        const idleExpired = this.options.idleTimeoutMs && Date.now() - this.lastObservationAt > this.options.idleTimeoutMs;
        if (!finished && (wallExpired || idleExpired)) {
          if (heartbeat) clearInterval(heartbeat);
          requestCancel(this.child);
          const stopped = await Promise.race([childDone, new Promise((resolve) => setTimeout(() => resolve(null), this.options.gracePeriodMs))]);
          if (!stopped) {
            try { process.kill(-this.child.pid, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); }
          }
          return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'timed_out', route, nextAction: wallExpired ? 'The configured wall-clock timeout elapsed; inspect diagnostics and resume.' : 'Agent made no observable progress before the idle timeout; inspect diagnostics and resume.' }));
        }
      }
      if (heartbeat) clearInterval(heartbeat);
      this.child = null;
      await this.updateTasks((state) => finishDirectAgent(state, directAgentId, finished.code === 0 ? 'completed' : 'failed'));
      if (finished.code !== 0) return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'failed', route, nextAction: `Agent exited with ${finished.code ?? finished.signal}; inspect vendor diagnostics and resume.` }));
    }
    return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'timed_out' }));
  }

  async cancel(request) {
    await this.setOrchestrationCancellation('cancel_requested');
    await this.emit('cancel_requested', 'cancel_requested', request.reason || 'Cancellation requested.');
    if (!this.child) {
      await this.setOrchestrationCancellation('canceled');
      await this.emit('canceled', 'canceled', 'Cancellation confirmed; no active child remained.');
      return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'canceled', nextAction: 'Use replatform resume <project> when ready.' }));
    }
    requestCancel(this.child);
    const grace = request.gracePeriodMs || this.options.gracePeriodMs;
    const done = await Promise.race([this.waitForChild(), new Promise((resolve) => setTimeout(() => resolve(null), grace))]);
    if (done) {
      await this.setOrchestrationCancellation('canceled');
      await this.emit('canceled', 'canceled', 'Agent exited during cancellation grace period.');
      return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'canceled' }));
    }
    try { process.kill(-this.child.pid, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); }
    await this.setOrchestrationCancellation('interrupted');
    await this.emit('interrupted', 'interrupted', 'Agent required forced termination.');
    return this.finish(makeResult({ id: this.id, projectDir: this.projectDir, outcome: 'interrupted' }));
  }
}

async function requestCancellation(projectDir, { reason = 'canceled by operator', gracePeriodMs = 60000 } = {}) {
  const active = await readActive(projectDir);
  if (!active || active.status !== 'running') throw new Error('no controllable active run exists');
  const request = { schemaVersion: SCHEMA_VERSION, runId: active.runId, requestedAt: iso(), reason, gracePeriodMs };
  await writeJsonAtomic(cancelPath(projectDir), request);
  return { active, request };
}

module.exports = { SCHEMA_VERSION, RunController, runnerDir, activePath, historyPath, defaultEventsPath, readActive, findRun, requestCancellation, applyInvocationInputs, makeResult, exitCode, safeRelative, readJson, userActionSummary };
