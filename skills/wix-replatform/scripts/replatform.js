#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Command, Option } = require('commander');
const {
  RunController, readActive, findRun, requestCancellation, defaultEventsPath, readJson, exitCode,
} = require('../lib/run-controller.js');
const { loadArtifacts } = require('../lib/orchestration-state.js');
const { determineNextStep } = require('../lib/orchestration-router.js');
const { listUserActions, readUserAction, answerUserAction } = require('../lib/user-actions.js');
const { writeJsonAtomic } = require('../lib/orchestration-state.js');
const { chooseAdapter } = require('../lib/agent-adapters/index.js');
const { defaultProbeWixCli } = require('../lib/orchestration-preflight.js');
const { readTaskState } = require('../lib/task-state.js');
const { applyUserActionEffect } = require('../lib/user-action-effects.js');

const VERSION = '0.1.0';

function duration(value, { allowOff = false, min = 0, max = Infinity } = {}) {
  if (allowOff && (value === undefined || value === 'off')) return null;
  if (!/^\d+(ms|s|m|h|d)$/.test(String(value))) throw new Error(`invalid duration: ${value}`);
  const [, amount, unit] = String(value).match(/^(\d+)(ms|s|m|h|d)$/);
  const multiplier = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  const result = Number(amount) * multiplier;
  if (result < min || result > max) throw new Error(`duration out of allowed range: ${value}`);
  return result;
}

function positive(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function output(value, format = 'text', text = null) {
  if (format === 'json') process.stdout.write(`${JSON.stringify(value)}\n`);
  else if (format === 'jsonl') process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${text || JSON.stringify(value, null, 2)}\n`);
}

function rootDir() { return path.resolve(process.env.REPLATFORM_MIGRATIONS_DIR || path.join(process.cwd(), 'migrations')); }
async function resolveProject(value) {
  if (!value) throw new Error('project is required (or set --project)');
  if (/^rpr_[0-9a-f-]+$/.test(value)) {
    const record = await findRun(rootDir(), value);
    if (!record) throw new Error(`run ID not found: ${value}`);
    return { projectDir: record.projectDir, runId: value };
  }
  const candidate = path.resolve(value);
  // A value with path syntax is a path even before `run` creates its project directory.
  // Only a bare name is resolved beneath the configured migrations root.
  if (path.isAbsolute(value) || value.includes(path.sep) || value.startsWith('.')) return { projectDir: candidate, runId: null };
  if (fssync.existsSync(candidate)) return { projectDir: candidate, runId: null };
  return { projectDir: path.join(rootDir(), value), runId: null };
}
function projectArg(args, index = 1) { return args.project || args._[index]; }

function runtimeOptions(args) {
  const format = args.format === 'event-stream' ? 'jsonl' : (args.format || 'jsonl');
  if (!['text', 'json', 'jsonl'].includes(format)) throw new Error('format must be text, json, jsonl, or event-stream');
  const statusIntervalMs = args.statusInterval === 'off' || (args.detach && args.statusInterval === undefined)
    ? null : duration(args.statusInterval || '60s', { min: 10000, max: 300000 });
  if (!['auto', 'codex', 'claude'].includes(args.agent || 'auto')) throw new Error('agent must be auto, codex, or claude');
  if (args.sourceUrl !== undefined) {
    let source;
    try { source = new URL(args.sourceUrl); } catch { throw new Error('source-url must be an https URL'); }
    if (source.protocol !== 'https:' || source.username || source.password) throw new Error('source-url must be a credential-free https URL');
  }
  if (args.sourceMode !== undefined && !['public_content', 'authenticated_api', 'private_data', 'files_only'].includes(args.sourceMode)) throw new Error('invalid source-mode');
  if (args.deliveryMode !== undefined && !['management', 'website', 'management_and_website'].includes(args.deliveryMode)) throw new Error('invalid delivery-mode');
  if (args.managementImportMode !== undefined && !['standard', 'quick'].includes(args.managementImportMode)) throw new Error('invalid management-import-mode');
  if (args.destination !== undefined && !(args.destination === 'new' || /^existing:[A-Za-z0-9_-]+$/.test(args.destination))) throw new Error('destination must be new or existing:<site-id>');
  // An explicit new-site type, and Harmony's optional business type.
  if (args.siteType !== undefined && !['headless', 'studio', 'harmony'].includes(args.siteType)) throw new Error('site-type must be headless, studio, or harmony');
  if (args.siteBusinessType !== undefined && !['store', 'bookings', 'other'].includes(args.siteBusinessType)) throw new Error('site-business-type must be store, bookings, or other');
  if (args.siteBusinessType !== undefined && args.siteType !== 'harmony') throw new Error('site-business-type is valid only with --site-type harmony');
  if (args.siteType !== undefined && args.destination !== undefined && args.destination !== 'new') throw new Error('site-type applies only to --destination new');
  return {
    agent: args.agent || 'auto', agentPath: args.agentPath, sourceUrl: args.sourceUrl, sourceMode: args.sourceMode,
    deliveryMode: args.deliveryMode, destination: args.destination, managementImportMode: args.managementImportMode,
    siteType: args.siteType, siteBusinessType: args.siteBusinessType,
    fileInputPaths: args.file?.length ? args.file.map((filePath) => path.resolve(filePath)) : undefined,
    oneClick: args.oneClick, dryRun: args.dryRun, eventsFile: args.eventsFile ? path.resolve(args.eventsFile) : null, vendorEvents: args.vendorEvents ? path.resolve(args.vendorEvents) : null,
    statusIntervalMs, wallTimeoutMs: duration(args.wallTimeout || 'off', { allowOff: true, min: 60000, max: 7 * 86400000 }),
    idleTimeoutMs: duration(args.idleTimeout || '15m', { min: 60000, max: 2 * 3600000 }),
    maxAgentTurns: positive(args.maxAgentTurns, 'max-agent-turns', 12),
    maxNoProgressContinuations: positive(args.maxNoProgressContinuations, 'max-no-progress-continuations', 1),
    format,
  };
}

function applyApproval(projectDir, request, answer) {
  return applyUserActionEffect(projectDir, request, answer);
}

async function runCommand(args, { resume = false, internalRunId = null } = {}) {
  const target = await resolveProject(projectArg(args));
  const options = runtimeOptions(args);
  if (resume && [args.sourceUrl, args.sourceMode, args.file, args.deliveryMode, args.destination, args.managementImportMode, args.siteType, args.siteBusinessType, args.oneClick].some((value) => value !== undefined)) throw new Error('resume does not accept intake mutation options');
  const controller = new RunController(target.projectDir, { ...options, resume, runId: internalRunId || undefined, onEvent: (event) => {
    if (options.format === 'jsonl') process.stdout.write(`${JSON.stringify(event)}\n`);
  } });
  if (args.detach && !internalRunId) {
    // The child receives a serialized, already parsed invocation; no shell or prompt is built.
    const encoded = Buffer.from(JSON.stringify({ project: target.projectDir, options: { ...options, resume, runId: controller.id } })).toString('base64url');
    const child = spawn(process.execPath, [__filename, '__supervise', encoded], { detached: true, stdio: 'ignore' });
    child.unref();
    const result = { schemaVersion: 1, runId: controller.id, project: path.basename(target.projectDir), outcome: 'running', nextAction: `replatform status ${controller.id}` };
    // Allocate a lookup record before returning; the supervisor will replace it immediately.
    await fs.mkdir(path.join(target.projectDir, 'state', 'runner', 'runs'), { recursive: true });
    await writeJsonAtomic(path.join(target.projectDir, 'state', 'runner', 'runs', `${controller.id}.json`), { schemaVersion: 1, runId: controller.id, projectDir: target.projectDir, pid: child.pid, status: 'starting', updatedAt: new Date().toISOString() });
    output(result, options.format, `Started detached run ${controller.id}.\nStatus: replatform status ${controller.id}`);
    return 0;
  }
  const result = await controller.run();
  if (options.format === 'json') output(result, 'json');
  else if (options.format === 'text') output(result, 'text', `${result.outcome}: ${result.router?.reason || 'run finished'}${result.requestId ? `\nRequest: ${result.requestId}\nAnswer: ${result.nextAction}` : ''}`);
  return exitCode(result);
}

async function statusCommand(args) {
  const target = await resolveProject(projectArg(args));
  const active = await readActive(target.projectDir);
  const artifacts = await loadArtifacts(target.projectDir);
  const router = artifacts.run ? await determineNextStep(target.projectDir, artifacts) : null;
  const historyDir = path.join(target.projectDir, 'state', 'runner', 'runs');
  let latestRun = target.runId ? await findRun(rootDir(), target.runId) : null;
  if (!latestRun) {
    try {
      const records = await Promise.all((await fs.readdir(historyDir)).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(historyDir, name))));
      latestRun = records.filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const eventPath = active?.eventPath || latestRun?.eventPath || defaultEventsPath(target.projectDir);
  let lastEvent = null;
  try { const lines = (await fs.readFile(eventPath, 'utf8')).trim().split('\n').filter(Boolean); if (lines.length) lastEvent = JSON.parse(lines.at(-1)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = { schemaVersion: 1, project: path.basename(target.projectDir), activeRun: active ? { runId: active.runId, pid: active.pid, childPid: active.childPid, status: active.status } : null, orchestration: artifacts.run ? { status: artifacts.run.status, state: artifacts.run.currentState } : null, router, eventStream: { path: eventPath, lastEventId: lastEvent?.eventId || null, lastEventAt: lastEvent?.timestamp || null }, latestResult: latestRun?.result || null };
  output(result, args.format || 'text', active ? `Run ${active.runId}: ${active.status}` : `No active run. ${router?.reason || 'No orchestration state.'}`);
  return 0;
}

async function tailCommand(args) {
  const target = await resolveProject(projectArg(args));
  const active = await readActive(target.projectDir);
  const eventFile = active?.eventPath || defaultEventsPath(target.projectDir);
  const since = args.since;
  let passedCursor = !since || !/^evt_[0-9a-f-]+$/.test(since);
  const shouldPrint = (item) => {
    if (!since) return true;
    if (/^evt_[0-9a-f-]+$/.test(since)) {
      if (!passedCursor && item.eventId === since) { passedCursor = true; return false; }
      return passedCursor;
    }
    return Date.parse(item.timestamp) >= Date.now() - duration(since, { min: 0, max: 365 * 86400000 });
  };
  const print = async () => {
    let text; try { text = await fs.readFile(eventFile, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const lines = text.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const item = JSON.parse(line); if (!shouldPrint(item)) continue;
      if ((args.format || 'jsonl') === 'text') process.stdout.write(`${item.timestamp} ${item.type}: ${item.message}\n`);
      else process.stdout.write(`${line}\n`);
    }
    return lines.length;
  };
  let known = await print();
  if (!args.follow) return 0;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    let text = ''; try { text = await fs.readFile(eventFile, 'utf8'); } catch { continue; }
    const lines = text.trim().split('\n').filter(Boolean);
    for (const line of lines.slice(known)) {
      const item = JSON.parse(line); if (shouldPrint(item)) process.stdout.write(`${line}\n`);
    }
    known = lines.length;
    const current = await readActive(target.projectDir); if (!current) break;
  }
  return 0;
}

function allowedArtifact(requests, target) {
  const normalized = target.replaceAll('\\', '/');
  if (normalized.includes('..') || normalized.startsWith('/') || /^(config|state|source|raw)(\/|$)/.test(normalized)) return false;
  return normalized.includes('/review/') || requests.some((request) => request.artifactRefs.some((ref) => ref.path === normalized));
}
async function showCommand(args) {
  const target = await resolveProject(projectArg(args));
  const id = args._[2]; if (!id) throw new Error('show requires request-id-or-artifact');
  if (/^uar_[0-9a-f-]+$/.test(id)) { const request = await readUserAction(target.projectDir, id); output(request, args.format || 'text'); return 0; }
  const requests = await listUserActions(target.projectDir, {});
  if (!allowedArtifact(requests.map((row) => ({ ...row, artifactRefs: [] })), id)) {
    // Index rows intentionally omit refs; read each action before authorizing an artifact.
    const full = []; for (const row of requests) full.push(await readUserAction(target.projectDir, row.requestId));
    if (!allowedArtifact(full, id)) throw new Error('artifact is not user-reviewable');
  }
  const fullPath = path.resolve(target.projectDir, id);
  const root = `${path.resolve(target.projectDir)}${path.sep}`;
  if (!fullPath.startsWith(root)) throw new Error('artifact escapes project');
  const content = await fs.readFile(fullPath);
  const max = positive(args.maxBytes, 'max-bytes', 1048576);
  const cursor = args.cursor === undefined ? 0 : Number(args.cursor);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > content.length) throw new Error('cursor must be a valid byte offset');
  const emitted = content.subarray(cursor, cursor + max); const truncated = cursor + emitted.length < content.length;
  const fullRequests = []; for (const row of requests) fullRequests.push(await readUserAction(target.projectDir, row.requestId));
  const mediaType = fullRequests.flatMap((request) => request.artifactRefs).find((ref) => ref.path === id.replaceAll('\\', '/'))?.mediaType || 'text/plain';
  const result = { schemaVersion: 1, path: id.replaceAll('\\', '/'), mediaType, totalBytes: content.length, cursor, emittedBytes: emitted.length, truncated, nextCursor: truncated ? cursor + emitted.length : null, content: emitted.toString('utf8') };
  output(result, args.format || 'text', `${result.content}${truncated ? `\nTRUNCATED: showed ${emitted.length}B of ${content.length}B; rerun with --max-bytes ${content.length} or larger.` : ''}`);
  return 0;
}

async function requestsCommand(args) {
  const target = await resolveProject(projectArg(args));
  const rows = await listUserActions(target.projectDir, { status: args.status || 'pending' });
  const actions = await Promise.all(rows.map((row) => readUserAction(target.projectDir, row.requestId)));
  const text = actions.map((action) => {
    const answer = action.response.mode === 'choice'
      ? `--choice <${action.choices.map((choice) => choice.id).join('|')}>`
      : action.response.mode === 'text' ? '--text "<answer>"' : '--acknowledge';
    const choices = action.response.mode === 'choice'
      ? `\n  Choices: ${action.choices.map((choice) => `${choice.id} (${choice.label})`).join(', ')}` : '';
    const next = action.response.mode === 'none'
      ? `After completing it: replatform answer --project ${target.projectDir} --request-id ${action.requestId} --acknowledge --continue`
      : `Answer: replatform answer --project ${target.projectDir} --request-id ${action.requestId} ${answer}`;
    const prompt = action.response.mode === 'none' ? `\n  Required action: ${action.prompt}` : '';
    return `${action.requestId}: ${action.title} (${action.status})\n  Response: ${action.response.mode}${choices}${prompt}\n  Show: replatform show --project ${target.projectDir} ${action.requestId}\n  Next: ${next}`;
  }).join('\n\n') || 'No matching user actions.';
  output(actions, args.format || 'text', text);
  return 0;
}

async function tasksCommand(args) {
  const target = await resolveProject(projectArg(args));
  const state = await readTaskState(target.projectDir);
  const active = await readActive(target.projectDir);
  const result = state || { schemaVersion: 1, runId: active?.runId || target.runId || null, updatedAt: null, tasks: [], agents: [] };
  output(result, args.format || 'text', result.tasks.length
    ? result.tasks.map((task) => `${task.state}: ${task.title}`).join('\n')
    : 'No durable work state has been recorded for this run.');
  return 0;
}

async function answerCommand(args) {
  const target = await resolveProject(projectArg(args)); const requestId = args._[2];
  if (!requestId) throw new Error('answer requires request id');
  const variants = [args.choice !== undefined, args.text !== undefined, args.textFile !== undefined, args.acknowledge === true].filter(Boolean).length;
  if (variants !== 1) throw new Error('answer requires exactly one of --choice, --text, --text-file, --acknowledge');
  if (args.note !== undefined && args.choice === undefined && !args.acknowledge) throw new Error('note is supported only with a choice or acknowledgement');
  const answer = args.acknowledge ? { acknowledged: true, ...(args.note !== undefined ? { note: args.note } : {}) } : args.choice !== undefined ? { choice: args.choice, ...(args.note !== undefined ? { note: args.note } : {}) } : { text: args.textFile ? await fs.readFile(path.resolve(args.textFile), 'utf8') : args.text };
  const result = await answerUserAction(target.projectDir, requestId, answer, { applyEffect: (request, normalized) => applyApproval(target.projectDir, request, normalized) });
  if (!args.continue) { output(result, args.format || 'text', `Answered ${requestId}. Resume: replatform resume ${target.projectDir}`); return 0; }
  args._ = ['run', target.projectDir]; args.project = target.projectDir; return runCommand(args, { resume: true });
}

async function doctorCommand(args) {
  const value = projectArg(args); const target = value ? await resolveProject(value) : null;
  const ids = args.agent && args.agent !== 'auto' ? [args.agent] : ['codex', 'claude'];
  const adapters = ids.map((id) => chooseAdapter(id, { agentPath: args.agentPath }));
  const active = target ? await readActive(target.projectDir) : null;
  const result = { schemaVersion: 1, node: process.version, project: target?.projectDir || null, writable: target ? await fs.access(target.projectDir, fssync.constants.W_OK).then(() => true).catch(() => false) : null, adapters, activeRun: active };
  output(result, args.format || 'text', adapters.map((a) => `${a.id || args.agent}: ${a.ok ? 'available' : a.reason}`).join('\n'));
  return adapters.some((item) => item.ok) ? 0 : 2;
}

async function projectsCommand(args) {
  const root = rootDir();
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') { output({ schemaVersion: 1, projects: [] }, args.format || 'text', 'No migration projects.'); return 0; }
    throw error;
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const projectDir = path.join(root, entry.name); const artifacts = await loadArtifacts(projectDir);
    if (!artifacts.run && !fssync.existsSync(path.join(projectDir, 'state', 'runner'))) continue;
    const active = await readActive(projectDir);
    const router = artifacts.run ? await determineNextStep(projectDir, artifacts) : null;
    projects.push({ project: entry.name, activeRun: active ? { runId: active.runId, status: active.status } : null, orchestration: artifacts.run ? { status: artifacts.run.status, state: artifacts.run.currentState } : null, router: router ? { state: router.nextState, reason: router.reason } : null });
  }
  projects.sort((a, b) => a.project.localeCompare(b.project));
  output({ schemaVersion: 1, projects }, args.format || 'text', projects.map((item) => item.project).join('\n') || 'No migration projects.');
  return 0;
}

async function accountCommand(args) {
  const wixCli = await defaultProbeWixCli();
  const result = {
    schemaVersion: 1,
    available: wixCli.available,
    authState: wixCli.authState,
    ...(wixCli.identity || wixCli.email ? { identity: wixCli.identity || wixCli.email } : {}),
    ...(wixCli.reason ? { reason: wixCli.reason } : {}),
  };
  const confirmed = result.authState === 'authenticated' && Boolean(result.identity);
  output(result, args.format || 'text', confirmed
    ? `Authenticated Wix CLI identity: ${result.identity}`
    : `Wix CLI identity could not be confirmed: ${result.reason || 'unknown'}`);
  return confirmed ? 0 : 2;
}

function commandArgs(command, positional, options) {
  return { ...options, _: [command, ...(positional === undefined ? [] : [positional])] };
}

function addRuntimeOptions(command, { intake = false } = {}) {
  command
    .addHelpText('after', '\nThis command is non-interactive: it never prompts, opens a pager/editor/browser/login, or waits for stdin.\n')
    .addOption(new Option('--agent <id>', 'auto selects a compatible adapter (Codex first); codex and claude require that exact adapter.').choices(['auto', 'codex', 'claude']).default('auto'))
    .option('--agent-path <path>', 'adapter executable override (testing/development)')
    .addOption(new Option('--format <format>', 'jsonl streams lifecycle events (default); json emits one final result; text is human-readable; event-stream aliases jsonl.').choices(['text', 'json', 'jsonl', 'event-stream']).default('jsonl'))
    .option('--status-interval <duration>', 'liveness heartbeat interval: 60s foreground by default, off detached; use off to disable')
    .option('--events-file <path>', 'write normalized JSONL events to this file')
    .option('--vendor-events <path>', 'write raw vendor events to this diagnostic file')
    .option('--wall-timeout <duration>', 'whole-run deadline; use off to disable')
    .option('--idle-timeout <duration>', 'maximum time without observed progress')
    .option('--max-agent-turns <count>', 'maximum agent turns in this supervisor run')
    .option('--max-no-progress-continuations <count>', 'maximum same-route retries')
    .option('--detach', 'start the supervisor in the background')
    .option('--no-resume-agent-session', 'do not reuse an adapter session when supported');
  if (intake) {
    command
      .option('--source-url <https-url>', 'source URL; credentials are rejected')
      .addOption(new Option('--source-mode <mode>', 'public_content reads public pages; authenticated_api uses normal source API access; private_data needs protected credentials; files_only imports supplied files.').choices(['public_content', 'authenticated_api', 'private_data', 'files_only']))
      .option('--file <path>', 'input file for files_only mode; repeat for each source file', (value, previous) => [...(previous || []), value])
      .addOption(new Option('--delivery-mode <mode>', 'management migrates backend data; website migrates the frontend only; management_and_website performs both.').choices(['management', 'website', 'management_and_website']))
      .option('--destination <strategy>', 'new creates a site; existing:<site-id> adopts the named existing site')
      .addOption(new Option('--site-type <type>', 'type of a new destination site: headless (website in code), studio or harmony (website designed in a Wix editor). Required before a new site is created; never defaulted.').choices(['headless', 'studio', 'harmony']))
      .addOption(new Option('--site-business-type <type>', 'with --site-type harmony only: store, bookings or other records the business context for the run. It does not change how the site is created: Harmony always starts from the blank template.').choices(['store', 'bookings', 'other']))
      .addOption(new Option('--management-import-mode <mode>', 'standard uses the full discovery/mapping flow; quick uses a public adapter and bounded plan.').choices(['standard', 'quick']))
      .option('--one-click', 'record an explicit user one-click decision')
      .option('--dry-run', 'request the existing dry-run execution path');
  }
  return command;
}

async function cancelCommand(args) {
  const target = await resolveProject(projectArg(args));
  const gracePeriodMs = duration(args.gracePeriod || '60s', { min: 5000, max: 600000 });
  const result = await requestCancellation(target.projectDir, { reason: args.reason || 'canceled by operator', gracePeriodMs });
  if (args.wait !== false) {
    const deadline = Date.now() + gracePeriodMs + 5000;
    while (Date.now() < deadline && await readActive(target.projectDir)) await new Promise((resolve) => setTimeout(resolve, 250));
    const record = await readJson(path.join(target.projectDir, 'state', 'runner', 'runs', `${result.active.runId}.json`));
    if (record?.result) { output(record.result, args.format || 'text', `${record.result.outcome}: cancellation finished.`); return exitCode(record.result); }
  }
  output(result, args.format || 'text', `Cancellation requested for ${result.active.runId}.`);
  return 0;
}

function setExit(handler) {
  return async (...values) => { process.exitCode = await handler(...values); };
}

function createProgram() {
  const program = new Command();
  program
    .name('replatform')
    .description('Non-interactive supervisor for artifact-first RePlatform migrations.')
    .version(VERSION, '--version', 'print the CLI version')
    .showHelpAfterError('(all commands are non-interactive; they never prompt, open a pager, or wait for stdin)')
    .addHelpText('after', '\nPurpose: the CLI supervises an agent using wix-replatform; it does not replace the skill or migration receipts.\nFull guide: CLI.md alongside this installed wix-replatform bundle.\nExit codes: 0 completed, 1 failed, 2 invalid input, 3 waiting for user, 4 blocked, 5 canceled/interrupted, 6 timeout.\n');

  addRuntimeOptions(program.command('run [project]').description('Start a non-interactive foreground supervised migration run.').option('--project <path>', 'project directory'), { intake: true })
    .action(setExit((project, options) => runCommand(commandArgs('run', project, options))));
  addRuntimeOptions(program.command('resume [project]').description('Resume an unfinalized migration project non-interactively.').option('--project <path>', 'project directory'), { intake: false })
    .action(setExit((project, options) => runCommand(commandArgs('resume', project, options), { resume: true })));
  program.command('status [project-or-run-id]').description('Read durable orchestration and runner state.').option('--project <path>', 'project directory').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((project, options) => statusCommand(commandArgs('status', project, options))));
  program.command('tail [project-or-run-id]').description('Render normalized runner events without a pager.').option('--project <path>', 'project directory').option('--follow', 'wait for events until the run terminates').option('--since <event-id-or-duration>', 'exclusive event cursor or inclusive duration window').addOption(new Option('--format <format>', 'stdout format').choices(['jsonl', 'text']).default('jsonl'))
    .action(setExit((project, options) => tailCommand(commandArgs('tail', project, options))));
  program.command('cancel <project-or-run-id>').description('Request supervised cancellation of a live run.').option('--project <path>', 'project directory').option('--grace-period <duration>', 'grace period before forced termination', '60s').option('--no-wait', 'return after durable acknowledgement').option('--reason <text>', 'operator-visible reason', 'canceled by operator').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((project, options) => cancelCommand(commandArgs('cancel', project, options))));
  program.command('doctor [project-or-run-id]').description('Check local agent and project-run capability without exposing credentials.').option('--project <path>', 'project directory').addOption(new Option('--agent <id>', 'agent adapter').choices(['auto', 'codex', 'claude']).default('auto')).option('--agent-path <path>', 'adapter executable override').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((project, options) => doctorCommand(commandArgs('doctor', project, options))));
  program.command('requests [project-or-run-id]').description('List durable human actions.').option('--project <path>', 'project directory').addOption(new Option('--status <status>', 'request status').choices(['pending', 'answered', 'canceled']).default('pending')).option('--since <duration>', 'only actions since this duration').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((project, options) => requestsCommand(commandArgs('requests', project, options))));
  program.command('tasks [project-or-run-id]').description('Read persisted operator-facing work state.').option('--project <path>', 'project directory').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((project, options) => tasksCommand(commandArgs('tasks', project, options))));
  program.command('show [project-or-run-id] [request-id-or-artifact]').description('Print a durable action or authorized review artifact. With --project, supply the item positionally.').option('--project <path>', 'project directory').option('--max-bytes <count>', 'maximum emitted bytes', '1048576').option('--cursor <byte-offset>', 'artifact byte offset', '0').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((first, second, options) => {
      const item = second || (options.project ? first : null);
      const project = options.project || (second ? first : null);
      if (!item) throw new Error('show requires request-id-or-artifact');
      return showCommand({ ...options, project, _: ['show', project, item] });
    }));
  addRuntimeOptions(program.command('answer [project-or-run-id] [request-id]').description('Record one immutable human response. With --project, supply the request ID positionally or through --request-id.').option('--project <path>', 'project directory').option('--request-id <id>', 'durable user-action request ID').option('--choice <choice-id>', 'declared choice ID').option('--note <text>', 'optional reviewer or acknowledgement note').option('--text <text>', 'free-text answer').option('--text-file <path>', 'UTF-8 answer file').option('--acknowledge', 'state that a required manual action was completed; the resumed stage must verify it').option('--continue', 'start a foreground resume after recording the answer'), { intake: false })
    .action(setExit((first, second, options) => {
      const requestId = options.requestId || second || (options.project ? first : null);
      const project = options.project || (second ? first : null);
      if (!requestId) throw new Error('answer requires request-id (positional or --request-id)');
      return answerCommand({ ...options, project, _: ['answer', project, requestId] });
    }));
  program.command('projects').description('List migration projects beneath the configured migrations root.').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((options) => projectsCommand(options)));
  program.command('account').description('Report the identity currently authenticated in the local Wix CLI.').addOption(new Option('--format <format>', 'stdout format').choices(['text', 'json']).default('text'))
    .action(setExit((options) => accountCommand(options)));
  program.command('completion <shell>').description('Print static completion for bash, zsh, or fish.')
    .action((shell) => {
      if (!['bash', 'zsh', 'fish'].includes(shell)) throw new Error('completion requires bash, zsh, or fish');
      const commands = 'run resume status tail cancel doctor requests tasks show answer projects account help completion';
      if (shell === 'bash') process.stdout.write(`_replatform() { COMPREPLY=( $(compgen -W '${commands}' -- "${'${COMP_WORDS[1]}'}") ); }\ncomplete -F _replatform replatform\n`);
      if (shell === 'zsh') process.stdout.write(`#compdef replatform\n_arguments '1:command:(${commands})' '*::arg:->args'\n`);
      if (shell === 'fish') process.stdout.write(`${commands.split(' ').map((item) => `complete -c replatform -f -a ${item}`).join('\n')}\n`);
    });
  program.command('__supervise <payload>', { hidden: true }).action(setExit(async (payload) => {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const controller = new RunController(data.project, { ...data.options, onEvent: () => {} });
    return exitCode(await controller.run());
  }));
  return program;
}

async function main(argv = process.argv.slice(2)) {
  const program = createProgram();
  // Commander remains the single formatter. JSON wraps its generated help for callers
  // that need discovery without parsing terminal columns.
  if (argv[0] === 'help' && argv.includes('--format')) {
    const format = argv[argv.indexOf('--format') + 1];
    if (!['text', 'json'].includes(format)) throw new Error('help format must be text or json');
    const requested = argv.slice(1).find((item) => !item.startsWith('-'));
    const target = requested ? program.commands.find((command) => command.name() === requested) : program;
    if (requested && !target) throw new Error(`unknown command: ${requested}`);
    const helpText = target.helpInformation();
    output({ schemaVersion: 1, command: requested || null, help: helpText }, format, helpText);
    return 0;
  }
  await program.parseAsync(['node', 'replatform', ...argv]);
  return process.exitCode || 0;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
module.exports = { main, createProgram, duration, runtimeOptions, resolveProject, allowedArtifact, accountCommand, tasksCommand };
