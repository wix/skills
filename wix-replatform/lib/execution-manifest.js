'use strict';

const SCHEMA_VERSION = 1;

const TASK_KIND = new Set(['setup', 'extract', 'import']);
const TASK_STATUS = new Set(['pending', 'running', 'completed', 'blocked', 'failed', 'skipped']);
const CROSSWALK_AUTHORITY = new Set(['local']);
const CMS_MIRROR_MODE = new Set(['none', 'download', 'upload', 'download-and-upload']);
const URL_PRESERVATION_PATHS = [
  'basePathsPath',
  'ledgerPath',
  'redirectsPath',
  'unresolvedPath',
];

function createManifest({ projectId, planVersion, tasks = [], generatedArtifacts = [], llmHandoff = null, timestamp = new Date().toISOString() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    planVersion,
    generatedAt: timestamp,
    generatedArtifacts,
    tasks,
    llmHandoff,
  };
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest must be an object');
    return { ok: false, errors };
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!manifest.projectId || typeof manifest.projectId !== 'string') {
    errors.push('projectId must be a non-empty string');
  }
  if (!manifest.planVersion || typeof manifest.planVersion !== 'string') {
    errors.push('planVersion must be a non-empty string');
  }
  if (!Array.isArray(manifest.generatedArtifacts)) {
    errors.push('generatedArtifacts must be an array');
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    errors.push('tasks must be a non-empty array');
  } else {
    const ids = new Set();
    for (const task of manifest.tasks) {
      if (!task || typeof task !== 'object') {
        errors.push('task must be an object');
        continue;
      }
      if (!task.id || typeof task.id !== 'string') {
        errors.push('task.id must be a non-empty string');
      } else if (ids.has(task.id)) {
        errors.push(`duplicate task id: ${task.id}`);
      } else {
        ids.add(task.id);
      }
      if (!TASK_KIND.has(task.kind)) {
        errors.push(`task.kind invalid for ${task.id || '<unknown>'}`);
      }
      if (task.status && !TASK_STATUS.has(task.status)) {
        errors.push(`task.status invalid for ${task.id || '<unknown>'}`);
      }
      if (!Array.isArray(task.dependsOn)) {
        errors.push(`task.dependsOn must be an array for ${task.id || '<unknown>'}`);
      }
      if (!Array.isArray(task.artifactRefs)) {
        errors.push(`task.artifactRefs must be an array for ${task.id || '<unknown>'}`);
      }
      validateUrlPreservation(task, errors);
      if (task.kind === 'import') {
        validateImportTaskState(task, errors);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateUrlPreservation(task, errors) {
  if (task.urlPreservation === undefined) {
    return;
  }
  const label = task.id || '<unknown>';
  if (task.kind !== 'import') {
    errors.push(`task.urlPreservation is only allowed for import tasks in ${label}`);
  }
  const policy = task.urlPreservation;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    errors.push(`task.urlPreservation must be an object for ${label}`);
    return;
  }
  if (policy.enabled !== undefined && typeof policy.enabled !== 'boolean') {
    errors.push(`task.urlPreservation.enabled must be a boolean for ${label}`);
  }
  if (policy.applyRedirects === true) {
    errors.push(`task.urlPreservation.applyRedirects must be false until website-builder redirect application is supported for ${label}`);
  }
  if (policy.applyRedirects !== undefined && typeof policy.applyRedirects !== 'boolean') {
    errors.push(`task.urlPreservation.applyRedirects must be a boolean for ${label}`);
  }
  if (policy.enabled === true) {
    for (const field of URL_PRESERVATION_PATHS) {
      if (!policy[field] || typeof policy[field] !== 'string') {
        errors.push(`task.urlPreservation.${field} required when enabled for ${label}`);
      }
    }
    if (policy.applyRedirects !== false) {
      errors.push(`task.urlPreservation.applyRedirects must be false when enabled for ${label}`);
    }
  }
}

function hasServerAssignedNativeTargetIds(task) {
  return task.targetIdAssignment === 'server' ||
    task.targetIdAssignment === 'server-assigned' ||
    task.nativeTargetIds === 'server-assigned' ||
    task.targetIdsServerAssigned === true;
}

function validateCmsMirror(task, state, errors) {
  if (!state.cmsMirror || typeof state.cmsMirror !== 'object') {
    return;
  }
  const mode = state.cmsMirror.mode;
  if (!CMS_MIRROR_MODE.has(mode)) {
    errors.push(`task.state.cmsMirror.mode invalid for ${task.id || '<unknown>'}`);
    return;
  }
  if (mode !== 'none') {
    if (!state.cmsMirror.collectionId || typeof state.cmsMirror.collectionId !== 'string') {
      errors.push(`task.state.cmsMirror.collectionId required when CMS mirror is enabled for ${task.id || '<unknown>'}`);
    }
    if (!state.cmsMirror.setupRequirementId || typeof state.cmsMirror.setupRequirementId !== 'string') {
      errors.push(`task.state.cmsMirror.setupRequirementId required when CMS mirror is enabled for ${task.id || '<unknown>'}`);
    }
  }
}

function validateImportTaskState(task, errors) {
  const state = task.state;
  if (!state || typeof state !== 'object') {
    if (hasServerAssignedNativeTargetIds(task)) {
      errors.push(`task.state required for server-assigned native target IDs in ${task.id || '<unknown>'}`);
    }
    return;
  }
  if (state.crosswalkAuthority === 'cms') {
    errors.push(`task.state.crosswalkAuthority must not be cms for ${task.id || '<unknown>'}`);
  }
  if (state.crosswalkAuthority !== undefined && !CROSSWALK_AUTHORITY.has(state.crosswalkAuthority)) {
    errors.push(`task.state.crosswalkAuthority invalid for ${task.id || '<unknown>'}`);
  }
  if (hasServerAssignedNativeTargetIds(task) && (!state.crosswalkPath || typeof state.crosswalkPath !== 'string')) {
    errors.push(`task.state.crosswalkPath required for server-assigned native target IDs in ${task.id || '<unknown>'}`);
  }
  if (state.attemptJournalPath !== undefined && typeof state.attemptJournalPath !== 'string') {
    errors.push(`task.state.attemptJournalPath must be a string for ${task.id || '<unknown>'}`);
  }
  validateCmsMirror(task, state, errors);
}

function nextPendingTask(manifest, completedIds = new Set()) {
  const done = completedIds instanceof Set ? completedIds : new Set(completedIds || []);
  for (const task of manifest.tasks || []) {
    if (task.status === 'completed' || done.has(task.id)) {
      continue;
    }
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    if (deps.every((dep) => done.has(dep))) {
      return task;
    }
  }
  return null;
}

module.exports = {
  SCHEMA_VERSION,
  createManifest,
  validateManifest,
  nextPendingTask,
};
