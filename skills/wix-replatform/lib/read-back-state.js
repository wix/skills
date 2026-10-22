'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const local = require('./local-state');
const FILE = 'execution/read-back-gate.json';
async function readJson(projectDir, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir, name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback);
    throw e;
  }
}
async function atomic(projectDir, name, value) {
  const file = path.join(projectDir, name),
    temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), {
    recursive: true
  });
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, {
      force: true
    });
  }
}
// Use the project's existing lock. Contending local writers retry instead of losing updates.
const localQueues = new Map();
function locked(projectDir, fn) {
  const key = path.resolve(projectDir),
    previous = localQueues.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => acquire(projectDir, fn));
  localQueues.set(key, task);
  return task.finally(() => {
    if (localQueues.get(key) === task) localQueues.delete(key);
  });
}
async function acquire(projectDir, fn) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await local.withStateLock(projectDir, fn);
    } catch (e) {
      if (!/state lock already held/.test(e.message) || Date.now() >= deadline) throw e;
      await new Promise(r => setTimeout(r, crypto.randomInt(10, 40)));
    }
  }
}
async function load(projectDir) {
  let state;
  try {
    state = await readJson(projectDir, FILE);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('gate history unreadable', {
      cause: e
    });
    const store = require('./write-verification-state');
    let hasHistory = false;
    const snapshot = await readJson(projectDir, 'state/write-verification.json', null);
    if (snapshot) {
      const recovered = await store.load(projectDir, snapshot.siteId);
      hasHistory = Object.values(recovered.rows).some(r => r.kind === 'read-back-gate');
    } else {
      // An un-compacted journal also proves a gate existed.
      let files = [];
      try {
        files = await fs.readdir(path.join(projectDir, 'state/write-verification-journal'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const delta = await readJson(projectDir, `state/write-verification-journal/${file}`);
        if (Object.values(delta.rows || {}).some(r => r.kind === 'read-back-gate')) hasHistory = true;
      }
    }
    if (hasHistory) throw new Error('gate history unreadable');
    state = {
      schemaVersion: 1,
      observedLosses: [],
      runs: {}
    };
  }
  if (state.schemaVersion !== 1 || !Array.isArray(state.observedLosses) || !state.runs || Array.isArray(state.runs)) throw new Error('gate history unreadable');
  return state;
}
async function update(projectDir, mutate) {
  return locked(projectDir, async () => {
    const state = await load(projectDir);
    const result = await mutate(state);
    await atomic(projectDir, FILE, state);
    return result;
  });
}
module.exports = {
  FILE,
  readJson,
  atomic,
  locked,
  load,
  update
};
