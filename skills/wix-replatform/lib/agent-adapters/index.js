'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Resolve this from the adapter module, never from the caller's cwd or a user-level
// skill installation. The runner and the toolkit it launches must be the same copy.
const TOOLKIT_ROOT = path.resolve(__dirname, '../..');

function pinnedPrompt(prompt, { projectRoot = null } = {}) {
  const scope = projectRoot ? ` Treat ${projectRoot} as the only writable migration project root; keep the toolkit read-only.` : '';
  return `${prompt}\n\nUse only the wix-replatform toolkit at ${TOOLKIT_ROOT}. Do not discover, load, or follow any other copy of this toolkit from the project, home directory, global installation, or another path on disk.${scope}`;
}

const CODEX_NON_INTERACTIVE_FLAGS = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--skip-git-repo-check',
];

function workerLabel(item, workerId) {
  const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return (firstLine || `Codex worker ${workerId}`).slice(0, 200);
}

function codexWorkerReports(raw) {
  const item = raw?.item;
  if (!item || item.type !== 'collab_tool_call') return [];
  if (!['spawn_agent', 'wait', 'close_agent'].includes(item.tool)) return [];
  const states = item.agents_states;
  if (!states || typeof states !== 'object' || Array.isArray(states)) return [];
  const stateMap = {
    pending_init: 'starting',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    canceled: 'canceled',
    cancelled: 'canceled',
    interrupted: 'interrupted',
  };
  return Object.entries(states).flatMap(([workerId, value]) => {
    const state = stateMap[value?.status];
    return state ? [{
      workerId,
      label: workerLabel(item, workerId),
      state,
      ...(item.parent_worker_id ? { parentWorkerId: item.parent_worker_id } : {}),
    }] : [];
  });
}

const codexSessionCache = new Map();
const CODEX_SESSION_SCAN_INTERVAL_MS = 1000;
const CODEX_SESSION_TAIL_BYTES = 256 * 1024;

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

async function walkFiles(directory, depth, predicate, files = []) {
  if (depth < 0) return files;
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && predicate(entry.name)) files.push(entryPath);
    else if (entry.isDirectory()) await walkFiles(entryPath, depth - 1, predicate, files);
  }
  return files;
}

async function findCodexSessionFile(workerId, { home = codexHome(), now = Date.now() } = {}) {
  const sessionsRoot = path.join(home, 'sessions');
  const cacheKey = `${sessionsRoot}\0${workerId}`;
  const cached = codexSessionCache.get(cacheKey);
  if (cached && (cached.path || now - cached.scannedAt < CODEX_SESSION_SCAN_INTERVAL_MS)) return cached.path;
  const files = await walkFiles(sessionsRoot, 3, (name) => name.endsWith('.jsonl') && name.includes(`-${workerId}.`));
  const file = files.sort().at(-1) || null;
  codexSessionCache.set(cacheKey, { path: file, scannedAt: now });
  return file;
}

async function readTail(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, CODEX_SESSION_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    const offset = Math.max(0, stat.size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    if (offset > 0) lines.shift();
    return { stat, lines: lines.flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    }) };
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function codexEventType(record) {
  if (record?.type === 'response_item') return 'response_item';
  return record?.payload?.type || record?.type || null;
}

const CODEX_ACTIVITY_ITEM_TYPES = new Set([
  'message',
  'reasoning',
  'custom_tool_call',
  'custom_tool_call_output',
  'function_call',
  'function_call_output',
  'web_search_call',
  'web_search_call_output',
  'computer_call',
  'computer_call_output',
  'local_shell_call',
  'local_shell_call_output',
]);

function isCodexOutput(record) {
  const type = codexEventType(record);
  if (type === 'response_item') {
    return CODEX_ACTIVITY_ITEM_TYPES.has(record.payload?.payload?.type)
      || CODEX_ACTIVITY_ITEM_TYPES.has(record.payload?.type);
  }
  return ['item_completed', 'turn_aborted'].includes(type);
}

function codexTerminalState(records) {
  for (const record of records) {
    const type = codexEventType(record);
    if (type === 'task_complete') return 'completed';
    if (type === 'turn_aborted') return 'interrupted';
  }
  return null;
}

function handoffWorkerId(handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return null;
  const value = handoff.workerId ?? handoff.worker_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function findCodexHandoff(projectRoot, worker, since) {
  const root = path.join(projectRoot, 'state', 'handoffs');
  const files = await walkFiles(root, 2, (name) => name.endsWith('.json'));
  const candidates = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs < since) continue;
      // Handoffs are project-level files. An unscoped handoff cannot prove which
      // simultaneously pending child produced it, so it must never complete a worker.
      const handoff = JSON.parse(await fs.readFile(file, 'utf8'));
      if (handoffWorkerId(handoff) !== worker.workerId) continue;
      candidates.push({ file, mtimeMs: stat.mtimeMs });
    } catch { /* the child may still be atomically replacing the handoff */ }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

async function reconcileCodexWorkers(workers, { cwd, env = process.env, codexHome: home = codexHome(env), now = Date.now() } = {}) {
  if (!cwd || !Array.isArray(workers)) return [];
  return Promise.all(workers.map(async (worker) => {
    const handoff = await findCodexHandoff(cwd, worker, worker.firstSeenAt || now);
    if (handoff) {
      return { ...worker, state: 'completed', activity: 'handoff', handoffPath: path.relative(cwd, handoff.file).replaceAll(path.sep, '/'), lastActivityAt: handoff.mtimeMs };
    }
    const sessionFile = await findCodexSessionFile(worker.workerId, { home, now });
    if (!sessionFile) return { ...worker, state: 'starting', activity: 'none' };
    const tail = await readTail(sessionFile);
    if (!tail) return { ...worker, state: 'starting', activity: 'none' };
    const terminalState = codexTerminalState(tail.lines);
    if (terminalState) return { ...worker, state: terminalState, activity: 'terminal', sessionFile, lastActivityAt: tail.stat.mtimeMs };
    const output = tail.lines.filter(isCodexOutput);
    if (output.length > 0) return { ...worker, state: 'running', activity: 'session_output', sessionFile, lastActivityAt: tail.stat.mtimeMs };
    return { ...worker, state: 'starting', activity: 'none', sessionFile };
  }));
}

const ADAPTERS = {
  codex: {
    executable: 'codex',
    args(prompt, { cwd } = {}) {
      if (!cwd) return ['exec', '--json', ...CODEX_NON_INTERACTIVE_FLAGS, prompt];
      return ['exec', ...CODEX_NON_INTERACTIVE_FLAGS, '--cd', cwd, '--json', pinnedPrompt(prompt, { projectRoot: cwd })];
    },
    workerReports: codexWorkerReports,
    reconcileWorkers: reconcileCodexWorkers,
  },
  claude: {
    executable: 'claude',
    args(prompt, { cwd } = {}) {
      return ['--dangerously-skip-permissions', '-p', '--output-format', 'stream-json', '--verbose', pinnedPrompt(prompt, { projectRoot: cwd })];
    },
  },
};

function probe(id, { executablePath, env = process.env } = {}) {
  const adapter = ADAPTERS[id];
  if (!adapter) return { ok: false, id, reason: 'unknown_adapter' };
  const executable = executablePath || adapter.executable;
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, env });
  if (result.error) return { ok: false, id, executable, reason: result.error.code === 'ENOENT' ? 'not_installed' : 'probe_failed' };
  if (result.status !== 0) return { ok: false, id, executable, reason: 'version_failed' };
  return { ok: true, id, executable, version: `${result.stdout || result.stderr}`.trim(), capabilities: ['headless', 'events', 'session', 'cwd', 'cancel'] };
}

const INVOCATION_MARKERS = {
  codex: [
    ['CODEX_THREAD_ID', (value) => Boolean(String(value || '').trim())],
    ['CODEX_CI', (value) => String(value || '').trim() === '1'],
  ],
  claude: [
    ['CLAUDE_CODE_SESSION_ID', (value) => Boolean(String(value || '').trim())],
    ['CLAUDECODE', (value) => Boolean(String(value || '').trim())],
    ['CLAUDE_CODE_ENTRYPOINT', (value) => Boolean(String(value || '').trim())],
  ],
};

function detectInvokingAgent(env = process.env) {
  const matches = Object.entries(INVOCATION_MARKERS).flatMap(([id, markers]) => markers
    .filter(([name, matchesMarker]) => matchesMarker(env[name]))
    .map(([name]) => ({ id, name })));
  const ids = [...new Set(matches.map((match) => match.id))];
  if (ids.length === 1) {
    return {
      id: ids[0],
      mode: 'invocation',
      reason: `invoking ${ids[0]} environment detected (${matches.filter((match) => match.id === ids[0]).map((match) => match.name).join(', ')})`,
      markers: matches.filter((match) => match.id === ids[0]).map((match) => match.name),
    };
  }
  if (ids.length > 1) {
    return {
      id: null,
      mode: 'availability',
      reason: `conflicting invoking-agent markers (${matches.map((match) => `${match.id}:${match.name}`).join(', ')})`,
      markers: matches.map((match) => `${match.id}:${match.name}`),
    };
  }
  return { id: null, mode: 'availability', reason: 'no invoking-agent environment marker detected', markers: [] };
}

function authProbe(id, executable, env) {
  const args = id === 'codex' ? ['login', 'status'] : ['auth', 'status'];
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 5000, env });
  if (result.error) return { ok: false, reason: result.error.code === 'ENOENT' ? 'not_installed' : 'auth_probe_failed' };
  if (result.status !== 0) return { ok: false, reason: 'not_authenticated' };
  if (id === 'claude') {
    try {
      const parsed = JSON.parse(`${result.stdout || result.stderr}`);
      if (parsed.loggedIn !== true) return { ok: false, reason: 'not_authenticated' };
    } catch {
      return { ok: false, reason: 'auth_probe_failed' };
    }
  }
  return { ok: true };
}

function probeWithAuth(id, options = {}) {
  const result = probe(id, { ...options, executablePath: options.executablePath || options.agentPath });
  if (!result.ok || !options.checkAuth) return result;
  const auth = authProbe(id, result.executable, options.env || process.env);
  return auth.ok ? { ...result, authenticated: true } : { ...result, ok: false, reason: auth.reason, authenticated: false };
}

function chooseAdapter(id = 'auto', options = {}) {
  if (id !== 'auto') {
    const selected = probeWithAuth(id, { ...options, checkAuth: options.checkAuth === true });
    return selected.ok
      ? { ...selected, selection: { mode: 'explicit', requested: id, reason: `explicit --agent ${id}` }, probes: [selected] }
      : { ...selected, reason: selected.reason || 'agent_unavailable', selection: { mode: 'explicit', requested: id, reason: `explicit --agent ${id}` }, probes: [selected] };
  }

  const invocation = detectInvokingAgent(options.env || process.env);
  const ids = invocation.id ? [invocation.id] : ['codex', 'claude'];
  const probes = ids.map((candidate) => probeWithAuth(candidate, { ...options, checkAuth: true }));
  const selected = probes.find((result) => result.ok);
  const selection = invocation.id
    ? { ...invocation, requested: 'auto' }
    : {
      mode: 'availability',
      requested: 'auto',
      reason: `${invocation.reason}; selected ${selected ? selected.id : 'none'} from installed and authenticated adapters${selected && probes.filter((probe) => probe.ok).length > 1 ? ' (codex tie-break order)' : ''}`,
      markers: invocation.markers,
    };
  return selected
    ? { ...selected, probes, selection }
    : { ok: false, reason: invocation.id ? 'invoking_agent_unavailable' : 'no_compatible_agent', probes, selection };
}

function launch(id, { cwd, prompt, executablePath, onEvent, onWorker }) {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`unknown adapter: ${id}`);
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('agent cwd must be an absolute project root');
  const projectRoot = path.resolve(cwd);
  const child = spawn(executablePath || adapter.executable, adapter.args(prompt, { cwd: projectRoot }), {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line.trim()) continue;
      let raw;
      try { raw = JSON.parse(line); } catch { raw = { text: line }; }
      onEvent?.({ type: 'vendor_event', raw });
      // Worker reporting is an explicit adapter capability. Do not infer workers from a
      // vendor event unless the adapter supplies a parser for its own schema.
      if (typeof adapter.workerReports === 'function') {
        const workers = adapter.workerReports(raw);
        for (const worker of workers || []) onWorker?.(worker);
      }
    }
  });
  child.stderr.on('data', (chunk) => onEvent?.({ type: 'vendor_stderr', message: String(chunk).trim() }));
  return child;
}

function requestCancel(child) {
  if (!child || child.exitCode !== null) return false;
  if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
  else child.kill('SIGTERM');
  return true;
}

async function reconcileWorkers(id, workers, options = {}) {
  const reconcile = ADAPTERS[id]?.reconcileWorkers;
  return typeof reconcile === 'function' ? reconcile(workers, options) : [];
}

module.exports = {
  ADAPTERS,
  TOOLKIT_ROOT,
  pinnedPrompt,
  CODEX_NON_INTERACTIVE_FLAGS,
  codexWorkerReports,
  reconcileCodexWorkers,
  probe,
  chooseAdapter,
  detectInvokingAgent,
  launch,
  reconcileWorkers,
  requestCancel,
};
