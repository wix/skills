'use strict';

// Codegen check: which source entity ref does each generated task handler pass to the shared
// scope guard (assertExecutionScope) before its first write?
//
// A generated record handler that calls the guard with no ref (or a short name instead of the
// scoped ref) fails its whole task at run time with `mapping_field_contract` ("undefined: outside
// resolved execution scope"), and none of its records is attempted. The plan-level
// check passes then, because it asserts each plan ref, not the ref a handler actually sends.
//
// The probe runs in a child process (`node handler-scope-probe.js <projectDir> <json>`): every
// generated `mapping-field-contract.js` the handler loads answers assertExecutionScope by recording
// the ref and throwing, the context is inert (any call on it throws), and the network is closed.
// A handler that reaches the guard is judged on its ref; one that does something else first is
// not judged here (no new stop), and the runtime guard still applies to it.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const PROBE_TIMEOUT_MS = 20000;
const PER_HANDLER_MS = 3000;

// The handler modules to probe: the descriptor's `taskHandlers` map when present, else the
// shared-v1 layout `src/import/handlers/<taskId>.js` for the manifest's import tasks.
function handlerFiles(projectDir, descriptor, manifest) {
  const tasks = (manifest?.tasks || []).filter(task => task && task.kind === 'import');
  const declared = descriptor?.taskHandlers && typeof descriptor.taskHandlers === 'object' ? descriptor.taskHandlers : null;
  return tasks.map(task => ({ taskId: task.id, file: declared ? declared[task.id] : path.join('src/import/handlers', `${task.id}.js`) }))
    .filter(row => typeof row.file === 'string' && fs.existsSync(path.resolve(projectDir, row.file)));
}

function probeHandlerScopes(projectDir, { descriptor = null, manifest, plan } = {}) {
  const allowed = new Set(plan?.executionScope?.selectedEntityRefs || []);
  if (!allowed.size) return { errors: [], probed: [] };
  const files = handlerFiles(projectDir, descriptor, manifest);
  if (!files.length) return { errors: [], probed: [] };
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const child = spawnSync(process.execPath, [__filename, projectDir, JSON.stringify(files)], {
    cwd: projectDir, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS + files.length * PER_HANDLER_MS, env: { ...env, RP_HANDLER_SCOPE_PROBE: '1' },
  });
  const line = String(child.stdout || '').trim().split('\n').filter(Boolean).pop();
  let probed;
  try { probed = JSON.parse(line).probed; } catch { return { errors: [`handler_scope_probe_failed:${String(child.stderr || child.error?.message || `exit ${child.status}`).trim().slice(0, 200)}`], probed: [] }; }
  const errors = probed.filter(row => row.reached && !(typeof row.ref === 'string' && allowed.has(row.ref)))
    .map(row => `handler_scope_ref_invalid:${row.taskId}:${row.file}:${row.ref === undefined ? 'undefined' : JSON.stringify(row.ref)} (pass the task's source entity ref, one of executionScope.selectedEntityRefs)`);
  return { errors, probed };
}

async function childMain(projectDir, files) {
  const Module = require('node:module');
  const SENTINEL = 'HANDLER_SCOPE_PROBE';
  const load = Module._load;
  Module._load = function probeLoad(request, parent, isMain) {
    const exported = load.apply(this, arguments);
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch { return exported; }
    if (path.basename(resolved) !== 'mapping-field-contract.js' || !exported || typeof exported.assertExecutionScope !== 'function') return exported;
    return new Proxy(exported, { get(target, key) {
      if (key !== 'assertExecutionScope') return target[key];
      return (plan, ref) => { throw Object.assign(new Error(SENTINEL), { code: SENTINEL, ref }); };
    } });
  };
  globalThis.fetch = async () => { throw Object.assign(new Error('network closed during the handler scope probe'), { code: 'HANDLER_SCOPE_PROBE_NETWORK' }); };
  const inert = () => {
    const fn = function inertValue() { throw Object.assign(new Error('inert probe context'), { code: 'HANDLER_SCOPE_PROBE_CONTEXT' }); };
    return new Proxy(fn, { get: (target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : inert()), apply: () => fn() });
  };
  const probed = [];
  for (const { taskId, file } of files) {
    const ctx = new Proxy({}, { get: (target, key) => (key === 'taskId' ? taskId : key === 'dryRun' ? true : key === 'then' || typeof key === 'symbol' ? undefined : inert()) });
    let outcome;
    try {
      const handler = require(path.resolve(projectDir, file));
      if (typeof handler?.run !== 'function') { probed.push({ taskId, file, reached: false, code: 'no-run-export' }); continue; }
      await Promise.race([handler.run(ctx), new Promise((resolve, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'HANDLER_SCOPE_PROBE_TIMEOUT' })), PER_HANDLER_MS).unref())]);
      outcome = { reached: false, code: 'returned-without-guard' };
    } catch (error) {
      outcome = error?.code === SENTINEL ? { reached: true, ref: error.ref } : { reached: false, code: error?.code || 'threw-before-guard' };
    }
    probed.push({ taskId, file, ...outcome });
  }
  process.stdout.write(`${JSON.stringify({ probed })}\n`);
  process.exit(0);
}

if (require.main === module) childMain(process.argv[2], JSON.parse(process.argv[3])).catch(error => { process.stderr.write(String(error?.stack || error)); process.exit(1); });

module.exports = { probeHandlerScopes, handlerFiles };
