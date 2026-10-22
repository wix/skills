'use strict';

const { spawn, spawnSync } = require('node:child_process');

const ADAPTERS = {
  codex: {
    executable: 'codex',
    args(prompt) { return ['exec', '--json', prompt]; },
  },
  claude: {
    executable: 'claude',
    args(prompt) { return ['-p', '--output-format', 'stream-json', '--verbose', prompt]; },
  },
};

function probe(id, { executablePath } = {}) {
  const adapter = ADAPTERS[id];
  if (!adapter) return { ok: false, id, reason: 'unknown_adapter' };
  const executable = executablePath || adapter.executable;
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (result.error) return { ok: false, id, executable, reason: result.error.code === 'ENOENT' ? 'not_installed' : 'probe_failed' };
  if (result.status !== 0) return { ok: false, id, executable, reason: 'version_failed' };
  return { ok: true, id, executable, version: `${result.stdout || result.stderr}`.trim(), capabilities: ['headless', 'events', 'session', 'cwd', 'cancel'] };
}

function chooseAdapter(id = 'auto', options = {}) {
  const ids = id === 'auto' ? ['codex', 'claude'] : [id];
  const probes = ids.map((candidate) => probe(candidate, { executablePath: options.agentPath }));
  const selected = probes.find((result) => result.ok);
  return selected ? { ...selected, probes } : { ok: false, reason: id === 'auto' ? 'no_compatible_agent' : 'agent_unavailable', probes };
}

function launch(id, { cwd, prompt, executablePath, onEvent, onWorker }) {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`unknown adapter: ${id}`);
  const child = spawn(executablePath || adapter.executable, adapter.args(prompt), {
    cwd,
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
      // vendor event unless a future adapter supplies this parser and its own schema.
      if (typeof adapter.workerReport === 'function') {
        const worker = adapter.workerReport(raw);
        if (worker) onWorker?.(worker);
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

module.exports = { ADAPTERS, probe, chooseAdapter, launch, requestCancel };
