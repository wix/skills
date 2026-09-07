'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateManifest } = require('./execution-manifest.js');
const {
  attemptJournalPath,
  crosswalkPath,
  dryRunCrosswalkPath,
  loadCrosswalk,
  rebuildCrosswalkIndexes,
  seedCrosswalkFromCmsMirror,
  wixRequestCapturesPath,
} = require('./local-state.js');
const { initUrlPreservationState } = require('./url-preservation-state.js');

function importTasks(manifest) {
  return (manifest.tasks || [])
    .filter((task) => task && task.kind === 'import')
    .sort((a, b) => Number(hasDownloadMirror(b)) - Number(hasDownloadMirror(a)));
}

function hasDownloadMirror(task) {
  const mirror = task.state && task.state.cmsMirror;
  if (!mirror || mirror.mode === 'none') {
    return false;
  }
  return mirror.mode === 'download' || mirror.mode === 'download-and-upload' || mirror.downloadBeforeRun === true;
}

function hasLocalCrosswalk(task) {
  return Boolean(task.state && task.state.crosswalkPath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureEmptyNdjson(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (!(await pathExists(filePath))) {
    await fs.writeFile(filePath, '', 'utf8');
    return true;
  }
  return false;
}

async function readMirrorRowsFromMap(task, rowsByTaskId) {
  if (!rowsByTaskId || !Object.prototype.hasOwnProperty.call(rowsByTaskId, task.id)) {
    return undefined;
  }
  return rowsByTaskId[task.id];
}

async function prepareExecutionState(projectDir, manifest, options = {}) {
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    return {
      ok: false,
      status: 'blocked',
      errors: validation.errors,
      actions: [],
    };
  }

  const actions = [];
  const errors = [];
  const mirrorRowsByTaskId = options.cmsMirrorRowsByTaskId || {};
  const dryRun = options.dryRun === true;

  if (dryRun) {
    const requestCapturesCreated = await ensureEmptyNdjson(wixRequestCapturesPath(projectDir));
    actions.push({
      action: requestCapturesCreated ? 'initialized_wix_request_captures' : 'kept_wix_request_captures',
      path: 'state/attempts/wix-request-captures.ndjson',
    });
    const dryRunCrosswalkCreated = await ensureEmptyNdjson(dryRunCrosswalkPath(projectDir));
    actions.push({
      action: dryRunCrosswalkCreated ? 'initialized_dry_run_crosswalk' : 'kept_dry_run_crosswalk',
      path: 'state/crosswalk/dry-run-crosswalk.ndjson',
    });
  }

  for (const task of importTasks(manifest)) {
    if (task.urlPreservation && task.urlPreservation.enabled === true) {
      const urlActions = await initUrlPreservationState(projectDir);
      for (const action of urlActions) {
        actions.push({
          taskId: task.id,
          ...action,
        });
      }
    }

    if (!hasLocalCrosswalk(task)) {
      continue;
    }

    const localPath = crosswalkPath(projectDir);
    const localExists = await pathExists(localPath);

    if (localExists) {
      await loadCrosswalk(projectDir);
      await rebuildCrosswalkIndexes(projectDir);
      actions.push({
        taskId: task.id,
        action: 'rebuilt_crosswalk_indexes',
        path: task.state.crosswalkPath,
      });
    } else if (hasDownloadMirror(task)) {
      let rows = await readMirrorRowsFromMap(task, mirrorRowsByTaskId);
      if (rows === undefined && typeof options.downloadCmsMirrorRows === 'function') {
        rows = await options.downloadCmsMirrorRows(task);
      }
      if (rows === undefined) {
        errors.push(`CMS mirror download configured for ${task.id}, but no CMS mirror rows provider was supplied`);
        continue;
      }
      const seeded = await seedCrosswalkFromCmsMirror(projectDir, rows);
      actions.push({
        taskId: task.id,
        action: seeded.seeded ? 'seeded_crosswalk_from_cms_mirror' : 'skipped_cms_seed',
        ...seeded,
      });
    } else {
      await ensureEmptyNdjson(localPath);
      await rebuildCrosswalkIndexes(projectDir);
      actions.push({
        taskId: task.id,
        action: 'initialized_empty_crosswalk',
        path: task.state.crosswalkPath,
      });
    }

    if (task.state.attemptJournalPath) {
      const created = await ensureEmptyNdjson(attemptJournalPath(projectDir));
      actions.push({
        taskId: task.id,
        action: created ? 'initialized_attempt_journal' : 'kept_attempt_journal',
        path: task.state.attemptJournalPath,
      });
    }

  }

  if (errors.length) {
    return {
      ok: false,
      status: 'blocked',
      errors,
      actions,
    };
  }

  return {
    ok: true,
    status: 'ready',
    errors: [],
    actions,
  };
}

module.exports = {
  prepareExecutionState,
};
