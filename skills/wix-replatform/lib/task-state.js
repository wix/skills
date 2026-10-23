'use strict';

// Durable, deliberately small operator-facing work state. It is not a transcript and it
// never derives tasks from vendor output. The supervisor is the only normal writer.
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJsonAtomic } = require('./orchestration-state.js');

const SCHEMA_VERSION = 1;
const taskStatePath = (projectDir) => path.join(projectDir, 'state', 'runner', 'task-state.json');
const now = () => new Date().toISOString();
const terminal = new Set(['completed', 'blocked', 'failed', 'canceled', 'interrupted']);
const taskStates = new Set(['planned', 'running', 'waiting_for_input', ...terminal]);
const agentStates = new Set(['running', ...terminal]);

async function readTaskState(projectDir) {
  try {
    const value = JSON.parse(await fs.readFile(taskStatePath(projectDir), 'utf8'));
    if (value?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.tasks) || !Array.isArray(value.agents)) return null;
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeTaskState(projectDir, state) {
  const next = { ...state, schemaVersion: SCHEMA_VERSION, updatedAt: now() };
  await fs.mkdir(path.dirname(taskStatePath(projectDir)), { recursive: true });
  await writeJsonAtomic(taskStatePath(projectDir), next);
  return next;
}

function createTaskState(runId) { return { schemaVersion: SCHEMA_VERSION, runId, updatedAt: now(), tasks: [], agents: [] }; }
function routeTitle(route) { return route.nextResource ? `Run ${route.nextResource}` : `Resolve ${String(route.nextState || 'migration').replaceAll('_', ' ')}`; }
function routeValue(route) { return { state: route.nextState || 'unknown', reason: route.reason || 'unknown', resource: route.nextResource || null }; }
function currentTask(state) { return state.tasks.find((task) => ['running', 'waiting_for_input', 'planned'].includes(task.state)) || null; }

function finishTask(state, task, outcome, endedAt = now()) {
  if (!task || !taskStates.has(outcome) || terminal.has(task.state)) return;
  task.state = outcome; task.endedAt = endedAt;
  for (const agent of state.agents.filter((item) => item.taskId === task.taskId && item.state === 'running')) {
    agent.state = outcome === 'completed' ? 'completed' : outcome;
    agent.endedAt = endedAt;
  }
}

function selectRoute(state, route) {
  const value = routeValue(route); const active = currentTask(state);
  if (active && active.kind === 'route' && active.route.state === value.state && active.route.reason === value.reason && active.route.resource === value.resource) return active;
  if (active) finishTask(state, active, 'completed');
  const task = { taskId: `route:${state.tasks.filter((item) => item.kind === 'route').length + 1}`, parentTaskId: null, title: routeTitle(route), kind: 'route', state: 'planned', route: value, createdAt: now(), startedAt: null, endedAt: null };
  state.tasks.push(task); return task;
}

function startRoute(state, route) {
  const task = selectRoute(state, route);
  task.state = 'running'; task.startedAt ||= now();
  return task;
}

function waitForInput(state, request) {
  let task = currentTask(state);
  if (!task) {
    task = { taskId: `route:${state.tasks.filter((item) => item.kind === 'route').length + 1}`, parentTaskId: null, title: request?.title || 'Await user action', kind: 'route', state: 'waiting_for_input', route: { state: 'awaiting_user_action', reason: 'pending_user_action', resource: null }, createdAt: now(), startedAt: null, endedAt: null };
    state.tasks.push(task);
  }
  task.state = 'waiting_for_input';
  return task;
}

function startDirectAgent(state, task, adapter, pid) {
  const agentId = `agent:${adapter}:${pid || adapter}`;
  let agent = state.agents.find((item) => item.agentId === agentId);
  if (!agent) {
    agent = { agentId, taskId: task.taskId, parentAgentId: null, adapter, label: `${adapter} agent`, state: 'running', pid: Number.isInteger(pid) ? pid : null, startedAt: now(), endedAt: null };
    state.agents.push(agent);
  } else { agent.state = 'running'; agent.endedAt = null; }
  return agent;
}

function finishDirectAgent(state, agentId, outcome) {
  const agent = state.agents.find((item) => item.agentId === agentId);
  if (agent && agent.state === 'running') { agent.state = outcome; agent.endedAt = now(); }
}

function recordWorker(state, taskId, adapter, report) {
  if (!report || typeof report !== 'object' || !/^[A-Za-z0-9._:-]{1,160}$/.test(report.workerId || '') || !agentStates.has(report.state) || typeof report.label !== 'string' || !report.label.trim()) return false;
  const parentAgentId = report.parentWorkerId ? `agent:${adapter}:worker:${report.parentWorkerId}` : null;
  if (parentAgentId && !state.agents.some((item) => item.agentId === parentAgentId)) return false;
  const agentId = `agent:${adapter}:worker:${report.workerId}`;
  let agent = state.agents.find((item) => item.agentId === agentId);
  if (!agent) { agent = { agentId, taskId, parentAgentId, adapter, label: report.label.trim(), state: report.state, pid: null, startedAt: report.startedAt || now(), endedAt: terminal.has(report.state) ? (report.endedAt || now()) : null }; state.agents.push(agent); }
  else { agent.label = report.label.trim(); agent.state = report.state; agent.endedAt = terminal.has(report.state) ? (report.endedAt || now()) : null; }
  return true;
}

function finishCurrent(state, outcome) { finishTask(state, currentTask(state), outcome); }

async function reconcileTaskState(projectDir, state) {
  let changed = false;
  for (const agent of state.agents.filter((item) => item.state === 'running' && Number.isInteger(item.pid))) {
    try { process.kill(agent.pid, 0); } catch { agent.state = 'interrupted'; agent.endedAt = now(); changed = true; }
  }
  const activeTask = currentTask(state);
  if (activeTask && state.agents.some((item) => item.taskId === activeTask.taskId && item.state === 'interrupted')) { activeTask.state = 'interrupted'; activeTask.endedAt = now(); changed = true; }
  return changed ? writeTaskState(projectDir, state) : state;
}

module.exports = { SCHEMA_VERSION, taskStatePath, readTaskState, writeTaskState, createTaskState, selectRoute, startRoute, waitForInput, startDirectAgent, finishDirectAgent, recordWorker, finishCurrent, reconcileTaskState };
