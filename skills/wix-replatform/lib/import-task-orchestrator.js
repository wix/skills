'use strict';

const { isRunInterruption } = require('./wix-auth.js');

// Deterministic task scheduling for generated importers. The dependency gate decides whether
// individual records can be written; this module only decides which task handlers are invoked.
// In particular, a failed producer must not terminate the process or prune its independent
// siblings. Dependants are still invoked so gateBatch can defer only records that name a parent
// that cannot land.

function importTasks(value) {
  const tasks = Array.isArray(value) ? value : value && Array.isArray(value.tasks) ? value.tasks : [];
  return tasks.filter(task => task && task.kind === 'import');
}

function taskId(task, index) {
  if (!task || typeof task.id !== 'string' || !task.id) throw new Error(`import task ${index} has no id`);
  return task.id;
}

function dependencyContractError(task, dependencies) {
  const hasDependencyContract = Object.hasOwn(task, 'dependencyRefs') || Object.hasOwn(task, 'dependencyEdges');
  if (!hasDependencyContract) return null;
  if (!Array.isArray(task.dependencyRefs) || !Array.isArray(task.dependencyEdges)) {
    return `import task ${task.id} has an incomplete dependency contract`;
  }
  const edgeTasks = task.dependencyEdges
    .filter(edge => edge?.producer?.kind === 'import-task')
    .map(edge => edge.producer.taskId)
    .sort();
  const expected = [...dependencies].sort();
  if (edgeTasks.length !== expected.length || edgeTasks.some((id, index) => id !== expected[index])) {
    return `import task ${task.id} dependencyEdges do not match dependsOn`;
  }
  return null;
}

function planImportTaskWaves(value) {
  const tasks = importTasks(value);
  const byId = new Map();
  tasks.forEach((task, index) => {
    const id = taskId(task, index);
    if (byId.has(id)) throw new Error(`duplicate import task id: ${id}`);
    byId.set(id, task);
  });

  const order = new Map(tasks.map((task, index) => [task.id, index]));
  const dependencies = new Map();
  for (const task of tasks) {
    const deps = Array.isArray(task.dependsOn) ? [...new Set(task.dependsOn)] : [];
    for (const dependency of deps) {
      if (!byId.has(dependency)) throw new Error(`import task ${task.id} depends on missing task ${dependency}`);
      if (dependency === task.id) throw new Error(`import task ${task.id} depends on itself`);
    }
    const contractError = dependencyContractError(task, deps);
    if (contractError) throw new Error(contractError);
    dependencies.set(task.id, new Set(deps));
  }

  const remaining = new Set(tasks.map(task => task.id));
  const waves = [];
  while (remaining.size) {
    const wave = tasks.filter(task => remaining.has(task.id)
      && [...dependencies.get(task.id)].every(dependency => !remaining.has(dependency)));
    if (!wave.length) {
      const cycle = [...remaining].sort((left, right) => order.get(left) - order.get(right));
      throw new Error(`import task dependency cycle: ${cycle.join(', ')}`);
    }
    waves.push(wave);
    for (const task of wave) remaining.delete(task.id);
  }
  return waves;
}

function emptyCounts() {
  return { attempted: 0, imported: 0, alreadyPresent: 0, deferred: 0, failed: 0, unresolved: 0 };
}

function defaultTaskFailure(task, error) {
  return {
    taskId: task.id,
    sourceEntity: task.sourceBindings?.[0]?.sourceEntity || null,
    status: 'failed',
    counts: emptyCounts(),
    taskError: {
      code: error?.code ? String(error.code) : null,
      message: error?.message ? String(error.message) : String(error),
    },
  };
}

/**
 * Invoke every import task in stable topological order.
 *
 * `runTask` remains the only generated hook. It is called for dependent tasks even when a
 * producer failed; the task's shared readiness gate is responsible for per-record deferrals.
 * A thrown ordinary task error is converted to a failed task result and does not suppress later
 * waves. Callers may persist a richer result with `onTaskError`. Interruptions are rethrown.
 */
async function runImportTasks({
  tasks,
  runTask,
  stopRequested = () => false,
  isInterruption = isRunInterruption,
  onTaskError,
} = {}) {
  if (typeof runTask !== 'function') throw new Error('runImportTasks requires runTask');
  const waves = planImportTaskWaves(tasks);
  const results = [];
  let stopped = false;

  outer: for (const wave of waves) {
    for (const task of wave) {
      if (stopRequested()) { stopped = true; break outer; }
      try {
        const result = await runTask(task, { dependencyResults: results.slice() });
        results.push({ ...(result || {}), taskId: result?.taskId || task.id });
      } catch (error) {
        if (isInterruption(error)) throw error;
        const result = onTaskError ? await onTaskError(error, task) : defaultTaskFailure(task, error);
        results.push({ ...(result || defaultTaskFailure(task, error)), taskId: result?.taskId || task.id });
      }
    }
  }

  return { results, waves, stopped };
}

module.exports = { importTasks, planImportTaskWaves, runImportTasks };
