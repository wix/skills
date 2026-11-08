'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { readEnvFile } = require('./config-env.js');
const { getDecisionValue } = require('./orchestration-decisions.js');
const { isRunInterruption } = require('./wix-auth.js');
const path = require('node:path');

const CONTRACT_VERSION = 'migration-review/1';
const GROUPS = ['Data', 'Manual', 'Plugins'];
const STORE_DIR = 'migration-review';
const EVIDENCE_CATEGORIES = ['source_scope', 'mapping_fidelity', 'execution_recovery', 'setup_plugin', 'explanations_checks'];

class MigrationReviewError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationReviewError';
    this.code = code;
    this.details = details;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function reviewRoot(projectDir) {
  return path.join(path.resolve(projectDir), STORE_DIR);
}

function assertToken(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new MigrationReviewError('invalid_request', `${name} must be a stable non-empty token`);
  }
  return value;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MigrationReviewError('invalid_request', `${name} must be an object`);
  }
  return value;
}

function assertVersion(request) {
  if (request.contractVersion !== CONTRACT_VERSION) {
    throw new MigrationReviewError('unsupported_contract', `contractVersion must be ${CONTRACT_VERSION}`);
  }
}

function safeName(value) {
  return digest(value).slice(0, 32);
}

async function assertSafePath(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const boundary = parts.lastIndexOf(STORE_DIR);
  if (boundary < 0) return;
  for (let index = boundary; index < parts.length; index += 1) {
    const current = parts.slice(0, index + 1).join(path.sep) || path.sep;
    const stat = await fs.lstat(current).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat && stat.isSymbolicLink()) throw new MigrationReviewError('unsupported_store_path', 'review storage must not contain symbolic links');
  }
}

function bindingKeys(value) {
  return { migrationId: value.migrationId, sourceIdentity: value.source.identity, destinationSiteId: value.destination.siteId };
}

async function projectBinding(projectDir) {
  const run = await fs.readFile(path.join(projectDir, 'orchestration', 'run.json'), 'utf8').then(JSON.parse).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const decisions = await fs.readFile(path.join(projectDir, 'orchestration', 'decisions.json'), 'utf8').then(JSON.parse).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const env = await readEnvFile(path.join(projectDir, 'config', 'wix.env')).catch((error) => error.code === 'ENOENT' ? {} : Promise.reject(error));
  const sourceUrl = decisions && getDecisionValue(decisions, 'sourceUrl');
  if (!run || !sourceUrl || !env.WIX_SITE_ID || env.WIX_SITE_ID === 'REPLACE_WITH_REAL_VALUE') return null;
  // Project identity persists across runner invocations; a runner's runId does not.
  return { contractVersion: CONTRACT_VERSION, migrationId: `migration_${digest({ projectId: run.projectId, sourceUrl, siteId: env.WIX_SITE_ID }).slice(0, 24)}`, source: { identity: `source_${digest({ projectId: run.projectId, sourceUrl }).slice(0, 24)}` }, destination: { siteId: env.WIX_SITE_ID } };
}

function validateBinding(request, identity) {
  if (request.migrationId !== identity.migrationId) throw new MigrationReviewError('binding_mismatch', 'request belongs to a different migration');
  if (request.destination && request.destination.siteId !== identity.destination.siteId) throw new MigrationReviewError('binding_mismatch', 'request belongs to a different destination');
}

async function readJson(filePath, { optional = false } = {}) {
  await assertSafePath(filePath);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (optional && error && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new MigrationReviewError('corrupt_store', `invalid JSON at ${filePath}`);
    throw error;
  }
}

async function syncDir(dirPath) {
  try {
    const handle = await fs.open(dirPath, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw new MigrationReviewError('unsupported_filesystem', 'review storage requires local atomic rename and directory fsync support');
    throw error;
  }
}

async function ensureDurableDir(dirPath) {
  const firstCreated = await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  if (!firstCreated) return;
  let current = dirPath;
  for (;;) {
    await syncDir(current);
    if (current === path.dirname(firstCreated)) break;
    current = path.dirname(current);
  }
}

async function writeAtomic(filePath, value) {
  await assertSafePath(filePath);
  const dir = path.dirname(filePath);
  await ensureDurableDir(dir);
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${canonical(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
  await syncDir(dir);
}

async function writeImmutable(filePath, value) {
  await assertSafePath(filePath);
  const bytes = `${canonical(value)}\n`;
  await ensureDurableDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    // Publish only complete bytes. A killed writer cannot leave a truncated immutable object.
    await fs.link(temporary, filePath);
    await syncDir(path.dirname(filePath));
    return { created: true };
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const current = await fs.readFile(filePath, 'utf8');
    if (current !== bytes) throw new MigrationReviewError('immutable_collision', `immutable object differs at ${filePath}`);
    return { created: false };
  } finally { await fs.unlink(temporary); }
}

function emptyState(identity) {
  return {
    contractVersion: CONTRACT_VERSION,
    migrationId: identity.migrationId,
    destination: clone(identity.destination),
    stateVersion: 0,
    currentRevisionId: null,
    actionIds: [],
    committedRequests: {},
    scopeFrontier: {},
    executions: {},
    captures: {},
    generation: 0,
    latestHandoffId: null,
    updatedAt: identity.createdAt,
  };
}

async function ensureIdentity(projectDir, request, clock = () => new Date(), hooks = {}) {
  assertVersion(request);
  const inferred = await projectBinding(projectDir);
  const binding = {
    contractVersion: CONTRACT_VERSION,
    migrationId: request.migrationId || inferred && inferred.migrationId,
    source: clone(request.source || inferred && inferred.source),
    destination: clone(request.destination || inferred && inferred.destination),
  };
  assertToken(binding.migrationId, 'migrationId');
  assertToken(assertObject(binding.source, 'source').identity, 'source.identity');
  assertToken(assertObject(binding.destination, 'destination').siteId, 'destination.siteId');
  if (inferred && canonical(bindingKeys(binding)) !== canonical(bindingKeys(inferred))) throw new MigrationReviewError('binding_mismatch', 'review binding differs from the accepted project identity');
  const root = reviewRoot(projectDir);
  await assertSafePath(root);
  await ensureDurableDir(root);
  const lock = await acquireLock(root, { operation: 'initialize', acquiredAt: clock().toISOString() });
  try {
    const filePath = path.join(root, 'identity.json');
    const existing = await readJson(filePath, { optional: true });
    if (existing && canonical(bindingKeys(existing)) !== canonical(bindingKeys(binding))) throw new MigrationReviewError('binding_mismatch', 'review source/destination identity differs from this project');
    const identity = existing || { ...binding, createdAt: clock().toISOString() };
    await writeImmutable(filePath, identity);
    if (hooks.afterIdentity) await hooks.afterIdentity(clone(identity));
    const statePath = path.join(root, 'state.json');
    if (!await readJson(statePath, { optional: true })) {
      for (const folder of ['receipts', 'revisions', 'actions', 'executions', 'evidence']) {
        const rows = await fs.readdir(path.join(root, folder)).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
        if (rows.length) throw new MigrationReviewError('missing_commit_descriptor', 'existing review artifacts need recovery; initialization cannot reset their history');
      }
      await writeAtomic(statePath, emptyState(identity));
    }
    return identity;
  } finally { await releaseLock(lock); }
}

async function loadIdentityAndState(projectDir) {
  const root = reviewRoot(projectDir);
  await assertSafePath(root);
  const identity = await readJson(path.join(root, 'identity.json'));
  const state = await readJson(path.join(root, 'state.json'));
  if (identity.contractVersion !== CONTRACT_VERSION || state.contractVersion !== CONTRACT_VERSION) {
    throw new MigrationReviewError('unsupported_contract', 'migration review store has an unsupported contract version');
  }
  if (identity.migrationId !== state.migrationId || canonical(identity.destination) !== canonical(state.destination)) {
    throw new MigrationReviewError('corrupt_store', 'identity and committed state binding disagree');
  }
  const inferred = await projectBinding(projectDir);
  if (inferred && canonical(bindingKeys(identity)) !== canonical(bindingKeys(inferred))) throw new MigrationReviewError('binding_mismatch', 'project identity changed after review initialization');
  return { root, identity, state };
}

async function lockOwner(lockPath) {
  const stat = await fs.lstat(lockPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) return null;
  return readJson(stat.isDirectory() ? path.join(lockPath, 'owner.json') : lockPath, { optional: true });
}

async function acquireLock(root, owner) {
  const lockPath = path.join(root, '.lock');
  const record = { token: owner.token || crypto.randomUUID(), operation: owner.operation, pid: process.pid, host: os.hostname(), acquiredAt: owner.acquiredAt };
  // Link fully synced bytes exclusively; no ownerless claim is exposed between mkdir/write.
  const ownerPath = path.join(root, 'lock-owners', `${safeName(record.token)}.json`);
  await writeImmutable(ownerPath, record);
  try { await fs.link(ownerPath, lockPath); } catch (error) {
    if (error.code === 'EEXIST') throw new MigrationReviewError('lock_held', 'review mutation is owned by another process', { owner: await lockOwner(lockPath) });
    if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw new MigrationReviewError('unsupported_filesystem', 'review storage requires local exclusive hard-link claims');
    throw error;
  }
  await syncDir(root);
  return { lockPath, record };
}

async function releaseLock(lock) {
  const current = await lockOwner(lock.lockPath);
  if (!current || current.token !== lock.record.token) return;
  await fs.unlink(lock.lockPath);
  await syncDir(path.dirname(lock.lockPath));
}

function ownerIsLive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.host !== os.hostname()) return null;
  try { process.kill(owner.pid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : null; }
}

async function acquireRecoveryClaim(root, originalToken) {
  const dir = path.join(root, 'recovery-claims');
  const token = crypto.randomUUID(), claimPath = path.join(dir, `${safeName(token)}.json`);
  const claim = { token, pid: process.pid, host: os.hostname(), originalToken, choosing: true, number: 0 };
  await writeImmutable(claimPath, claim);
  try {
    const readClaims = async () => {
      const rows = [];
      for (const name of await fs.readdir(dir)) {
        if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
        const row = await readJson(path.join(dir, name), { optional: true });
        if (row) rows.push(row);
      }
      return rows;
    };
    // Publish a choosing marker before taking a ticket. Later entrants take a higher
    // ticket; simultaneous choosers arbitrate by token. Dead process records are inert.
    claim.number = Math.max(0, ...(await readClaims()).map((row) => row.number || 0)) + 1;
    claim.choosing = false;
    await writeAtomic(claimPath, claim);
    for (const other of await readClaims()) {
      if (other.token === token || ownerIsLive(other) === false) continue;
      if (ownerIsLive(other) !== true || other.choosing || other.number < claim.number || (other.number === claim.number && other.token < token)) {
        throw new MigrationReviewError('lock_recovery_conflict', 'another live or unknown process owns recovery; retry after it finishes', { recoveryOwner: other });
      }
    }
    return claimPath;
  } catch (error) { await fs.unlink(claimPath); await syncDir(dir); throw error; }
}

async function recoverLock(projectDir, request, options = {}) {
  assertVersion(request);
  const root = reviewRoot(projectDir);
  await assertSafePath(root);
  const identity = await readJson(path.join(root, 'identity.json'), { optional: true });
  let state = await readJson(path.join(root, 'state.json'), { optional: true });
  if (identity) validateBinding(request, identity);
  else assertToken(request.migrationId, 'migrationId');
  const lockPath = path.join(root, '.lock');
  const owner = await lockOwner(lockPath);
  const originalRecord = !owner && request.ownerToken ? await readJson(path.join(root, 'lock-owners', `${safeName(request.ownerToken)}.json`), { optional: true }) : null;
  const recoveryOwner = owner || (originalRecord && request.originalOwner && canonical(originalRecord) === canonical(request.originalOwner) ? originalRecord : null);
  if (!recoveryOwner || request.ownerToken !== recoveryOwner.token || ownerIsLive(recoveryOwner) !== false || request.expectedStateVersion !== (state ? state.stateVersion : 0)) throw new MigrationReviewError('lock_recovery_refused', 'recovery requires an unchanged descriptor and the original dead local owner', { owner, stateVersion: state && state.stateVersion });
  if (!state && recoveryOwner.operation !== 'initialize') throw new MigrationReviewError('missing_commit_descriptor', 'committed descriptor must be recovered before mutation lock recovery');
  if (!state) for (const folder of ['receipts', 'revisions', 'actions', 'executions', 'evidence']) {
    const files = await fs.readdir(path.join(root, folder)).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
    if (files.length) throw new MigrationReviewError('missing_commit_descriptor', 'existing artifacts cannot be reset during initialization recovery');
  }
  // Keep the original claim in place until repair ends. Arbitration has no ownerless
  // window or singleton recovery lock that another interruption could strand.
  const recoveryPath = await acquireRecoveryClaim(root, recoveryOwner.token);
  try {
    if (options.hooks && options.hooks.afterRecoveryClaim) await options.hooks.afterRecoveryClaim();
    if (canonical(await lockOwner(lockPath)) !== canonical(owner)) throw new MigrationReviewError('lock_recovery_conflict', 'lock owner changed during recovery');
    const latestState = await readJson(path.join(root, 'state.json'), { optional: true });
    if (canonical(latestState) !== canonical(state)) throw new MigrationReviewError('lock_recovery_conflict', 'descriptor changed during recovery');
    if (!state && identity) { state = emptyState(identity); await writeAtomic(path.join(root, 'state.json'), state); }
    await fs.rm(lockPath, { recursive: true });
    await syncDir(root);
    return { contractVersion: CONTRACT_VERSION, recovered: true, owner, stateVersion: state ? state.stateVersion : 0 };
  } finally { await fs.unlink(recoveryPath); await syncDir(path.dirname(recoveryPath)); }
}

function requestDigest(operation, request) {
  const normalized = clone(request);
  delete normalized.expectedStateVersion;
  return digest({ operation, request: normalized });
}

async function replayIfCommitted(root, state, requestId, requestHash) {
  const entry = state.committedRequests[requestId];
  if (!entry) return null;
  if (entry.requestHash !== requestHash) throw new MigrationReviewError('request_collision', `requestId ${requestId} was already committed with different content`);
  const receipt = await readJson(path.join(root, 'receipts', `${safeName(requestId)}.json`));
  if (receipt.requestId !== requestId || receipt.requestHash !== requestHash || receipt.committedStateVersion !== entry.stateVersion) throw new MigrationReviewError('corrupt_store', 'receipt differs from its committed request');
  return { ...receipt, replayed: true };
}

async function commitMutation(projectDir, operation, request, build, options = {}) {
  assertVersion(request);
  const requestId = assertToken(request.requestId, 'requestId');
  const requestHash = requestDigest(operation, request);
  const initial = await loadIdentityAndState(projectDir);
  validateBinding(request, initial.identity);
  const replay = await replayIfCommitted(initial.root, initial.state, requestId, requestHash);
  if (replay) return replay;
  if (request.expectedStateVersion !== initial.state.stateVersion) {
    throw new MigrationReviewError('state_conflict', `expected state version ${request.expectedStateVersion}, current is ${initial.state.stateVersion}`, { stateVersion: initial.state.stateVersion });
  }
  const prepared = await build(initial);
  if (options.hooks && options.hooks.afterStage) await options.hooks.afterStage(clone(prepared));
  const now = (options.clock || (() => new Date()))().toISOString();
  const lock = await acquireLock(initial.root, { token: options.lockToken, operation, acquiredAt: now });
  try {
    const current = await loadIdentityAndState(projectDir);
    const committedReplay = await replayIfCommitted(current.root, current.state, requestId, requestHash);
    if (committedReplay) return committedReplay;
    if (current.state.stateVersion !== request.expectedStateVersion) {
      throw new MigrationReviewError('state_conflict', 'committed state changed while the mutation was staged', { stateVersion: current.state.stateVersion });
    }
    const nextVersion = current.state.stateVersion + 1;
    const receiptPath = path.join(current.root, 'receipts', `${safeName(requestId)}.json`);
    const stagedReceipt = await readJson(receiptPath, { optional: true });
    if (stagedReceipt && stagedReceipt.requestHash !== requestHash) {
      throw new MigrationReviewError('request_collision', `requestId ${requestId} has a staged receipt with different content`);
    }
    const intentPath = path.join(current.root, 'intents', `${safeName(requestId)}.json`);
    const priorIntent = await readJson(intentPath, { optional: true });
    if (priorIntent && priorIntent.requestHash !== requestHash) throw new MigrationReviewError('request_collision', 'staged request identity was reused with different content');
    if (priorIntent && priorIntent.expectedStateVersion !== current.state.stateVersion) throw new MigrationReviewError('state_conflict', 'staged request must be reconciled against changed committed state');
    const intent = priorIntent || { requestId, requestHash, expectedStateVersion: current.state.stateVersion, committedAt: stagedReceipt ? stagedReceipt.committedAt : now };
    await writeImmutable(intentPath, intent);
    if (options.hooks && options.hooks.afterIntent) await options.hooks.afterIntent(clone(intent));
    const effectiveNow = intent.committedAt;
    const applied = await prepared.apply({ ...current, now: effectiveNow, nextVersion });
    if (options.hooks && options.hooks.afterApply) await options.hooks.afterApply(clone(applied.result));
    const receipt = stagedReceipt || {
      contractVersion: CONTRACT_VERSION,
      operation,
      requestId,
      requestHash,
      migrationId: current.identity.migrationId,
      destination: clone(current.identity.destination),
      committedStateVersion: nextVersion,
      evidenceRevision: applied.state.currentRevisionId,
      committedAt: effectiveNow,
      result: clone(applied.result),
    };
    if (stagedReceipt && canonical(stagedReceipt.result) !== canonical(applied.result)) {
      throw new MigrationReviewError('staged_receipt_conflict', `staged receipt ${requestId} no longer matches the recomputed mutation`);
    }
    await writeImmutable(receiptPath, receipt);
    if (options.hooks && options.hooks.afterReceipt) await options.hooks.afterReceipt(clone(receipt));
    const nextState = {
      ...applied.state,
      stateVersion: nextVersion,
      updatedAt: effectiveNow,
      committedRequests: {
        ...applied.state.committedRequests,
        [requestId]: { operation, requestHash, stateVersion: nextVersion },
      },
    };
    await writeAtomic(path.join(current.root, 'state.json'), nextState);
    if (options.hooks && options.hooks.afterCommit) await options.hooks.afterCommit(clone(receipt));
    return { ...receipt, replayed: false };
  } finally {
    await releaseLock(lock);
  }
}

async function initialize(projectDir, request, options = {}) {
  const identity = await ensureIdentity(projectDir, request, options.clock, options.hooks);
  const { state } = await loadIdentityAndState(projectDir);
  return { contractVersion: CONTRACT_VERSION, identity, state };
}

async function registerExecution(projectDir, request, options = {}) {
  assertToken(request.executionId, 'executionId');
  if (request.executionKind !== undefined && !['import', 'probe'].includes(request.executionKind)) throw new MigrationReviewError('invalid_request', 'executionKind must be import or probe');
  if (!Array.isArray(request.assessedScope) || request.assessedScope.length === 0 || !request.assessedScope.every((scope) => typeof scope === 'string' && scope.length)) throw new MigrationReviewError('invalid_request', 'assessedScope must name record or capability scopes');
  return commitMutation(projectDir, 'register-execution', request, async ({ root, state }) => {
    const existing = state.executions && state.executions[request.executionId];
    const facts = { contractVersion: CONTRACT_VERSION, executionId: request.executionId, assessedScope: [...new Set(request.assessedScope)].sort(), artifactRefs: clone(request.artifactRefs || []), sourceSnapshot: clone(request.sourceSnapshot || null) };
    if (request.producerId !== undefined) facts.producerId = assertToken(request.producerId, 'producerId');
    if (request.executionKind !== undefined) facts.executionKind = request.executionKind;
    if (existing) {
      const stored = await loadExecution(root, state, request.executionId);
      const comparable = { ...stored }; delete comparable.generation; delete comparable.registeredAt;
      if (canonical(comparable) !== canonical(facts)) throw new MigrationReviewError('execution_collision', 'an execution identity cannot be rebound on resume');
      return { apply: async ({ state: current }) => ({ state: current, result: stored }) };
    }
    const execution = { ...facts, generation: (state.generation || 0) + 1 };
    return { apply: async ({ root: lockedRoot, state: current, now }) => {
      const stored = { ...execution, registeredAt: now };
      const objectHash = digest(stored);
      await writeImmutable(path.join(lockedRoot, 'executions', `${objectHash}.json`), stored);
      return { state: { ...current, generation: execution.generation, executions: { ...(current.executions || {}), [request.executionId]: { generation: execution.generation, objectHash } } }, result: stored };
    } };
  }, options);
}

async function loadExecution(root, state, executionId) {
  if (!state.executions || !state.executions[executionId]) throw new MigrationReviewError('unknown_execution', 'execution registration is not committed');
  const execution = await readJson(path.join(root, 'executions', `${state.executions[executionId].objectHash}.json`));
  if (digest(execution) !== state.executions[executionId].objectHash) throw new MigrationReviewError('corrupt_store', 'execution bytes differ from committed hash');
  if (execution.executionId !== executionId || state.executions[executionId].generation !== execution.generation) throw new MigrationReviewError('corrupt_store', 'committed execution identity differs');
  return execution;
}

async function captureEvidence(projectDir, request, options = {}) {
  assertToken(request.executionId, 'executionId'); assertToken(request.captureId, 'captureId');
  if (!EVIDENCE_CATEGORIES.includes(request.category)) throw new MigrationReviewError('invalid_request', 'unknown evidence category');
  assertObject(request.evidence, 'evidence');
  if (!Object.keys(request.evidence).length) throw new MigrationReviewError('invalid_request', 'capture evidence must contain observed facts or explicit unknown areas');
  if (request.category === 'source_scope' && request.evidence.acceptedScopes !== undefined && (!Array.isArray(request.evidence.acceptedScopes) || !request.evidence.acceptedScopes.every((scope) => typeof scope === 'string' && scope.length))) throw new MigrationReviewError('invalid_request', 'acceptedScopes must name accepted capability scopes, not record IDs');
  if (request.category === 'source_scope') for (const scope of request.evidence.acceptedScopes || []) assertToken(scope, 'acceptedScopes entry');
  return commitMutation(projectDir, 'capture-evidence', request, async ({ root, state }) => {
    const execution = await loadExecution(root, state, request.executionId);
    const scope = request.scope || execution.assessedScope;
    if (!Array.isArray(scope) || !scope.length || scope.some((key) => !execution.assessedScope.includes(key))) throw new MigrationReviewError('scope_violation', 'capture scope is outside its committed execution');
    const evidenceHash = digest(request.evidence);
    const capture = { contractVersion: CONTRACT_VERSION, captureId: request.captureId, executionId: execution.executionId, generation: execution.generation, category: request.category, scope: [...new Set(scope)].sort(), phase: request.phase || 'import', sequence: Number.isInteger(request.sequence) ? request.sequence : 0, observedAt: request.observedAt || null, objectHash: evidenceHash };
    if (state.captures && state.captures[request.captureId]) {
      const [stored] = await validateCaptures(root, state, execution, [request.captureId]);
      const comparable = { ...stored }; delete comparable.capturedAt; delete comparable.evidence;
      if (canonical(comparable) !== canonical(capture)) throw new MigrationReviewError('capture_collision', 'a committed capture identity cannot be rebound');
      return { apply: async ({ state: current }) => ({ state: current, result: capture }) };
    }
    return { apply: async ({ root: lockedRoot, state: current, now }) => {
      await writeImmutable(path.join(lockedRoot, 'evidence', 'objects', evidenceHash), request.evidence);
      const stored = { ...capture, capturedAt: now }, captureHash = digest(stored);
      await writeImmutable(path.join(lockedRoot, 'evidence', 'captures', `${captureHash}.json`), stored);
      return { state: { ...current, captures: { ...(current.captures || {}), [request.captureId]: { executionId: execution.executionId, category: capture.category, objectHash: evidenceHash, captureHash } } }, result: capture };
    } };
  }, options);
}

// One queue per importer process. Only producer-owned captures refresh their version;
// operator actions and publication retain the strict compare-and-swap interface.
function createEvidenceCaptureQueue(projectDir, options = {}) {
  const lockWaitMs = options.lockWaitMs === undefined ? 2000 : options.lockWaitMs;
  if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 5000) throw new MigrationReviewError('invalid_request', 'capture lockWaitMs must be between 0 and 5000');
  let pending = Promise.resolve();
  return function enqueue(request) {
    const input = clone(request);
    pending = pending.then(async () => {
      const deadline = performance.now() + lockWaitMs;
      for (;;) {
        const { root, state } = await loadIdentityAndState(projectDir);
        try {
          return await captureEvidence(projectDir, { ...input, expectedStateVersion: state.stateVersion }, options);
        } catch (error) {
          // These conflicts occur before a durable intent. Interrupted/staged intents
          // have no stateVersion detail and must take the explicit recovery path.
          if (error.code !== 'lock_held' && !(error.code === 'state_conflict' && Number.isSafeInteger(error.details?.stateVersion))) throw error;
          do {
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw error;
            await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
            // Poll without staging or creating a fresh owner record while held.
          } while (await lockOwner(path.join(root, '.lock')));
        }
      }
    });
    // A failed capture poisons this queue, preventing later batches from proceeding.
    return pending;
  };
}

// Every generated target write goes through this wrapper on the importer's one capture queue.
// A throw, or an outcome the caller names unknown, commits execution_recovery evidence before
// the error returns, so the next write cannot start ahead of it. A capture failure stops writes.
const PROBE_WRITE_FAILURE = 'probe_injected_write_failure';
function createWriteRecovery({ captureQueue, migrationId, executionId, scope, probeNonce = null }) {
  if (typeof captureQueue !== 'function' || !Array.isArray(scope) || !scope.length) throw new MigrationReviewError('invalid_request', 'write recovery needs the importer capture queue and registered scope');
  assertToken(migrationId, 'migrationId'); assertToken(executionId, 'executionId');
  async function capture(meta, outcome) {
    const evidence = { kind: 'write-failure', outcomes: [{ record: meta.sourceStableKey, attemptId: meta.attemptId || null, operation: meta.operation || null, ...outcome }], recovery: 'read-back-before-retry', ...(probeNonce ? { probeNonce } : {}) };
    const id = `write-recovery:${digest({ executionId, scope, evidence })}`;
    return captureQueue({ contractVersion: CONTRACT_VERSION, migrationId, executionId, requestId: id, captureId: id, category: 'execution_recovery', scope, phase: 'recovery', evidence });
  }
  async function write(meta, run, { unknownOutcome = () => null } = {}) {
    assertToken(meta && meta.sourceStableKey, 'sourceStableKey');
    // One identity per call: separate failures of one record never share a capture id.
    meta = { ...meta, attemptId: meta.attemptId || crypto.randomUUID() };
    let result;
    try { result = await run(); } catch (error) {
      // Only a readable 4xx rejection (not 408) is known failed; a 5xx, timeout or transport
      // error may have written. Message text stays out.
      const e = error || {};
      const interrupted = isRunInterruption(e);
      const rejected = !interrupted && e.outcomeKnown === true && Number.isInteger(e.status) && e.status >= 400 && e.status < 500 && e.status !== 408;
      const code = typeof e.code === 'string' && e.code ? e.code : ['AbortError', 'TimeoutError'].includes(e.name) ? e.name : null;
      const httpStatus = Number.isInteger(e.status) ? e.status : Number.isInteger(e.httpStatus) ? e.httpStatus : null;
      await capture(meta, { status: rejected ? 'failed' : 'uncertain', reasonCode: String(e.applicationErrorCode || code || (httpStatus ? `http_${httpStatus}` : 'unknown_error')), ...(httpStatus !== null ? { httpStatus } : {}) })
        .catch((captureError) => { throw Object.assign(captureError, { writeError: error }); });
      throw error;
    }
    const reason = unknownOutcome(result);
    if (reason) await capture(meta, { status: 'uncertain', reasonCode: String(reason) });
    return result;
  }
  async function probeFailure() {
    if (!probeNonce) throw new MigrationReviewError('invalid_request', 'an injected write failure belongs only to the isolated probe');
    await write({ sourceStableKey: 'probe-record', attemptId: 'probe-attempt', operation: 'probe' }, async () => { throw Object.assign(new Error('Injected probe write failure'), { code: PROBE_WRITE_FAILURE }); })
      .catch((error) => { if (error.code !== PROBE_WRITE_FAILURE) throw error; });
  }
  return { write, probeFailure };
}

function materialFingerprint(task) {
  return digest({
    affected: [...(task.affected || [])].sort(),
    // An ID preview is not a population count. Keep legacy fingerprints stable
    // when a producer has not supplied this additive measurement.
    ...(Object.prototype.hasOwnProperty.call(task, 'affectedCount') ? { affectedCount: task.affectedCount } : {}),
    intendedBehavior: task.intendedBehavior || null,
    action: task.action || null,
    requirement: task.requirement || (task.required === true ? 'required' : task.required === false ? 'optional' : null),
    scopeKey: task.scopeKey,
    consequence: task.consequence || null,
    verificationPolicy: task.verificationPolicy || 'manual',
    prerequisites: [...(task.prerequisites || [])].sort(),
    unknownAreas: [...(task.unknownAreas || [])].sort(),
  });
}

function normalizeFinding(item, producerId, kind) {
  assertObject(item, kind);
  const keyName = kind === 'task' ? 'findingKey' : 'resultKey';
  const key = assertToken(item[keyName], `${kind}.${keyName}`);
  const scopeKey = assertToken(item.scopeKey, `${kind}.scopeKey`);
  const normalized = { ...clone(item), producerId, [keyName]: key, scopeKey };
  if (kind === 'task') {
    if (Object.prototype.hasOwnProperty.call(item, 'affectedCount')) {
      if (item.affectedCount !== null && (!Number.isSafeInteger(item.affectedCount) || item.affectedCount < 0)) throw new MigrationReviewError('invalid_request', 'task.affectedCount must be null or a nonnegative safe integer');
      if (Array.isArray(item.affected) && item.affectedCount !== null && item.affectedCount < item.affected.length) throw new MigrationReviewError('invalid_request', 'task.affectedCount cannot be smaller than its affected ID preview');
      if (item.affectedCount === null) normalized.unknownAreas = [...new Set([...(item.unknownAreas || []), 'affected-count'])].sort();
    }
    if (!GROUPS.includes(item.group)) throw new MigrationReviewError('invalid_request', `task.group must be one of ${GROUPS.join(', ')}`);
    // Applicability (not_applicable / superseded) closes a task; a publisher may only request it
    // through applicabilityChanges, which require matching committed evidence. Never accepted inline.
    if (producerId !== 'migration-review' && Object.prototype.hasOwnProperty.call(item, 'applicability')) throw new MigrationReviewError('invalid_disposition', 'task applicability is set only through evidence-backed applicabilityChanges');
    const derivedTaskId = `task_${digest(`${producerId}:${key}`).slice(0, 20)}`;
    // A task id is derived from its producer and finding key; a chosen id could occupy another
    // owner's (including a service investigation's) slot and inherit its disposition.
    if (item.taskId !== undefined && item.taskId !== derivedTaskId) throw new MigrationReviewError('identity_collision', 'task.taskId must be derived from its producer and finding key');
    normalized.taskId = derivedTaskId;
    assertToken(normalized.taskId, 'task.taskId');
    normalized.materialFingerprint = materialFingerprint({ ...normalized, requirement: item.requirement || (item.required === true ? 'required' : item.required === false ? 'optional' : null) });
    normalized.requirement = item.requirement || (item.required === true ? 'required' : item.required === false ? 'optional' : null);
    if (!['required', 'optional'].includes(normalized.requirement)) throw new MigrationReviewError('invalid_request', 'task requirement must be explicit');
    if (normalized.requirement === 'required' && !normalized.dismissalAcknowledgment) normalized.dismissalAcknowledgment = normalized.consequence;
    if (normalized.requirement === 'required' && !normalized.dismissalAcknowledgment) throw new MigrationReviewError('invalid_request', 'required task must describe its consequence');
    normalized.verificationPolicy = normalized.verificationPolicy || 'manual';
    if (!['manual', 'machine_required'].includes(normalized.verificationPolicy)) throw new MigrationReviewError('invalid_request', 'unknown task verification policy');
    normalized.evidenceStatus = normalized.evidenceStatus || 'unassessed';
  } else {
    normalized.resultId = item.resultId || `result_${digest(`${producerId}:${key}`).slice(0, 20)}`;
    assertToken(normalized.resultId, 'result.resultId');
  }
  return normalized;
}

async function loadRevision(root, revisionId) {
  if (!revisionId) return { contractVersion: CONTRACT_VERSION, revisionId: null, tasks: {}, results: {}, coverage: {}, captures: [], scopeFrontier: {} };
  const revision = await readJson(path.join(root, 'revisions', safeName(revisionId), 'manifest.json'));
  if (revision.revisionId !== revisionId) throw new MigrationReviewError('corrupt_store', 'revision path and identity disagree');
  const content = Object.fromEntries(['completionReportDigest', 'tasks', 'results', 'coverage', 'captures', 'scopeFrontier'].map((key) => [key, revision[key]]));
  if (`rev_${digest(content).slice(0, 24)}` !== revisionId) throw new MigrationReviewError('corrupt_store', 'revision content differs from its immutable identity');
  return revision;
}

async function validateCaptures(root, state, execution, captureIds) {
  const captures = [];
  for (const captureId of captureIds || []) {
    if (!state.captures || !state.captures[captureId] || state.captures[captureId].executionId !== execution.executionId) throw new MigrationReviewError('missing_evidence', 'capture is not committed for this execution');
    const row = await readJson(path.join(root, 'evidence', 'captures', `${state.captures[captureId].captureHash}.json`), { optional: true });
    if (!row || row.captureId !== captureId || row.executionId !== execution.executionId) {
      throw new MigrationReviewError('missing_evidence', `capture ${captureId} does not belong to execution ${execution.executionId}`);
    }
    if (digest(row) !== state.captures[captureId].captureHash) throw new MigrationReviewError('evidence_integrity', 'capture metadata differs from its committed hash');
    const objectPath = path.join(root, 'evidence', 'objects', row.objectHash);
    const object = await readJson(objectPath, { optional: true });
    if (!object || digest(object) !== row.objectHash) throw new MigrationReviewError('evidence_integrity', `capture ${captureId} has missing or changed evidence bytes`);
    captures.push({ ...row, evidence: object });
  }
  return captures;
}

async function readExecutionEvidence(projectDir, executionId, captureIds) {
  const { root, state } = await loadIdentityAndState(projectDir);
  const execution = await loadExecution(root, state, executionId);
  const ids = captureIds || Object.entries(state.captures || {}).filter(([, row]) => row.executionId === executionId).map(([id]) => id);
  return { execution, captures: await validateCaptures(root, state, execution, ids) };
}

async function checkExecutionCaptureBoundaries(projectDir, executionId) {
  const { execution, captures } = await readExecutionEvidence(projectDir, executionId);
  const missing = execution.assessedScope.flatMap((scope) => missingImportBoundaries(captures, scope).map((phase) => ({ scope, phase })));
  if (missing.length) throw new MigrationReviewError('missing_evidence', 'real execution is missing committed import-boundary captures', { executionId, missing });
  return { contractVersion: CONTRACT_VERSION, executionId, assessedScope: execution.assessedScope, captureIds: captures.filter((row) => ['before-write', 'write-outcome'].includes(row.phase) && !row.evidence.probeNonce).map((row) => row.captureId) };
}

function missingImportBoundaries(captures, scope) {
  return ['before-write', 'write-outcome'].filter((phase) => !captures.some((row) => row.phase === phase && row.scope.includes(scope) && !row.evidence.probeNonce));
}

function identityDestination(state) { return state.destination; }

function validateSetupLinks(task, destination) {
  const links = [task.setupUrl, ...(task.links || []).map((link) => link.url)].filter(Boolean);
  for (const link of links) {
    let url; try { url = new URL(link); } catch { throw new MigrationReviewError('invalid_link', 'task link must be an absolute URL'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new MigrationReviewError('invalid_link', 'task link must use HTTP or HTTPS');
    const wixHost = url.hostname === 'wix.com' || url.hostname.endsWith('.wix.com');
    const dashboard = /^\/dashboard(?:\/([^/]+))?(?:\/|$)/.exec(url.pathname);
    const editor = url.hostname === 'editor.wix.com' || url.hostname === 'editorx.wix.com' || /(?:^|\/)(?:editor|editorx)(?:\/|$)/.test(url.pathname);
    let dashboardSite;
    try { dashboardSite = dashboard && decodeURIComponent(dashboard[1] || ''); } catch { throw new MigrationReviewError('invalid_link', 'dashboard site identifier is malformed'); }
    const siteParams = ['metaSiteId', 'metasiteId', 'siteId'].flatMap((key) => url.searchParams.getAll(key));
    if ((url.hostname === 'manage.wix.com' || (wixHost && (dashboard || editor))) &&
        (url.protocol !== 'https:' || url.username || url.password ||
         (dashboard ? dashboardSite !== destination.siteId : !editor || !siteParams.length) ||
         siteParams.some((id) => id !== destination.siteId))) throw new MigrationReviewError('binding_mismatch', 'dashboard/editor link does not match the bound destination');
    if ((!wixHost && (url.hostname.includes('wix.com') || siteParams.length && /editor|dashboard/.test(url.pathname)))) throw new MigrationReviewError('invalid_link', 'site management links must use a Wix host');
  }
}

function validateVerification(task, captured) {
  const proof = captured.find((row) => row.captureId === task.verificationCaptureId && row.category === 'explanations_checks' && row.scope.includes(task.scopeKey));
  const check = proof && (proof.evidence.checks || []).find((item) => item.findingKey === task.findingKey && item.materialFingerprint === task.materialFingerprint && item.kind === 'machine' && item.status === 'passed' && item.checkId && Number.isFinite(Date.parse(item.observedAt)));
  if (!check) throw new MigrationReviewError('verification_required', 'machine verification requires a committed check matching this finding and material scope');
}

// The committed captures named by a closing disposition still prove it for this task's current
// material facts (same check as applicabilityChanges, against each capture's own execution).
async function closingEvidenceHolds(root, state, task, applicability) {
  const ids = Array.isArray(applicability.captureIds) ? applicability.captureIds : [];
  for (const captureId of ids) {
    const ref = state.captures && state.captures[captureId];
    if (!ref) continue;
    let capture;
    try { [capture] = await validateCaptures(root, state, await loadExecution(root, state, ref.executionId), [captureId]); } catch { continue; }
    if (capture && capture.scope.includes(task.scopeKey) && (capture.evidence.dispositions || []).some((item) => item.findingKey === task.findingKey && item.materialFingerprint === task.materialFingerprint && item.status === applicability.status)) return true;
  }
  return false;
}

async function publishEvidence(projectDir, request, options = {}) {
  const producerId = assertToken(request.producerId, 'producerId');
  if (producerId === 'migration-review' || producerId.startsWith('migration-review')) throw new MigrationReviewError('invalid_request', 'migration-review is reserved for service-owned scope investigations');
  // Task ids are derived from `${producerId}:${findingKey}`; a ':' in the producer id would make
  // that boundary ambiguous and let a crafted pair hash to another owner's task id.
  if (producerId.includes(':')) throw new MigrationReviewError('invalid_request', 'producerId must not contain ":"');
  assertToken(request.executionId, 'executionId');
  if (request.completionReportDigest !== undefined) assertToken(request.completionReportDigest, 'completionReportDigest');
  if (!Array.isArray(request.assessedScope) || request.assessedScope.length === 0) throw new MigrationReviewError('invalid_request', 'publish assessedScope must not be empty');
  if (!request.coverage || !['complete', 'incomplete'].includes(request.coverage.status)) throw new MigrationReviewError('invalid_request', 'coverage.status must be complete or incomplete');
  if (request.coverage.unknownAreas !== undefined && !Array.isArray(request.coverage.unknownAreas)) throw new MigrationReviewError('invalid_request', 'coverage unknownAreas must be a list');
  return commitMutation(projectDir, 'publish-evidence', request, async ({ root, state }) => {
    const execution = await loadExecution(root, state, request.executionId);
    if (execution.producerId && execution.producerId !== producerId) throw new MigrationReviewError('scope_violation', 'publication producer differs from the registered execution owner');
    const assessed = [...new Set(request.assessedScope)].sort();
    for (const scope of assessed) if (!execution.assessedScope.includes(scope)) throw new MigrationReviewError('scope_violation', `execution did not register assessed scope ${scope}`);
    const captured = (await validateCaptures(root, state, execution, request.captureIds || [])).filter((row) => execution.executionKind !== 'import' || !row.evidence.probeNonce);
    const base = await loadRevision(root, state.currentRevisionId);
    const tasks = clone(base.tasks || {});
    const results = clone(base.results || {});
    const taskByKey = new Map(Object.values(tasks).map((row) => [row.findingKey, row]));
    const resultByKey = new Map(Object.values(results).map((row) => [row.resultKey, row]));
    const frontier = clone(state.scopeFrontier || {});
    for (const scope of assessed) {
      const key = `${producerId}\u0000${scope}`;
      const prior = frontier[key];
      if (prior && Number(prior.generation) > Number(execution.generation)) {
        throw new MigrationReviewError('stale_scope', `execution generation ${execution.generation} cannot replace generation ${prior.generation} for ${scope}`);
      }
    }
    for (const scope of assessed) {
      const prior = frontier[`${producerId}\u0000${scope}`];
      const oldSource = prior && prior.sourceSnapshot;
      const nextSource = execution.sourceSnapshot;
      if (oldSource && canonical(oldSource) !== canonical(nextSource)) {
        const previousAt = Date.parse(oldSource.observedAt), nextAt = Date.parse(nextSource && nextSource.observedAt);
        if (!Number.isFinite(previousAt) || !Number.isFinite(nextAt) || nextAt <= previousAt) throw new MigrationReviewError('source_provenance_conflict', 'source observations cannot advance this scope without newer or explicitly reconciled provenance');
      }
    }
    const normalizedTasks = (request.tasks || []).map((item) => normalizeFinding(item, producerId, 'task'));
    if (normalizedTasks.some((row) => row.findingKey.startsWith('review-evidence:'))) throw new MigrationReviewError('invalid_request', 'coverage investigation keys are reserved for the service');
    const normalizedResults = (request.results || []).map((item) => normalizeFinding(item, producerId, 'result'));
    for (const rows of [normalizedTasks, normalizedResults]) {
      const keys = rows.map((row) => row.findingKey || row.resultKey);
      if (new Set(keys).size !== keys.length) throw new MigrationReviewError('identity_collision', 'publication contains duplicate finding/result keys');
    }
    for (const item of [...normalizedTasks, ...normalizedResults]) {
      if (!assessed.includes(item.scopeKey)) throw new MigrationReviewError('scope_violation', `${item.scopeKey} is outside this publication's assessed scope`);
    }
    for (const task of normalizedTasks) {
      const canonicalExisting = taskByKey.get(task.findingKey);
      if (canonicalExisting && canonicalExisting.producerId !== producerId) {
        throw new MigrationReviewError('shared_finding_requires_owner', `finding ${task.findingKey} is already owned by ${canonicalExisting.producerId}; reuse that canonical producer instead of duplicating it`, { taskId: canonicalExisting.taskId });
      }
      validateSetupLinks(task, identityDestination(state));
      const earlier = taskByKey.get(task.findingKey);
      if (earlier && (earlier.taskId !== task.taskId || earlier.scopeKey !== task.scopeKey)) throw new MigrationReviewError('identity_collision', 'a finding cannot change task identity or owned scope on rerun');
      if (task.verificationPolicy === 'machine_required' && task.evidenceStatus === 'verified') validateVerification(task, captured);
      const prior = tasks[task.taskId];
      if (prior && (prior.producerId !== producerId || prior.findingKey !== task.findingKey)) throw new MigrationReviewError('identity_collision', `task identity collision for ${task.taskId}`);
      // A republished task keeps an earlier closing disposition only while its identity and material
      // facts are unchanged and the committed evidence that closed it still proves it.
      if (prior && prior.applicability && ['not_applicable', 'superseded'].includes(prior.applicability.status)
        && prior.scopeKey === task.scopeKey && prior.materialFingerprint === task.materialFingerprint
        && await closingEvidenceHolds(root, state, task, prior.applicability)) task.applicability = clone(prior.applicability);
      tasks[task.taskId] = task;
      taskByKey.set(task.findingKey, task);
    }
    // A carried supersession still needs its replacement finding.
    for (const task of normalizedTasks) {
      const app = tasks[task.taskId].applicability;
      if (app && app.status === 'superseded' && !Object.values(tasks).some((row) => row.findingKey === app.supersededBy && row.producerId === producerId && row.findingKey !== task.findingKey)) delete tasks[task.taskId].applicability;
    }
    for (const result of normalizedResults) {
      const earlier = resultByKey.get(result.resultKey);
      if (earlier && (earlier.producerId !== producerId || earlier.resultId !== result.resultId || earlier.scopeKey !== result.scopeKey)) throw new MigrationReviewError('identity_collision', 'a result key already has a canonical owner/identity/scope');
      const prior = results[result.resultId];
      if (prior && (prior.producerId !== producerId || prior.resultKey !== result.resultKey)) throw new MigrationReviewError('identity_collision', `result identity collision for ${result.resultId}`);
      results[result.resultId] = result;
      resultByKey.set(result.resultKey, result);
    }
    for (const scope of assessed) frontier[`${producerId}\u0000${scope}`] = { generation: execution.generation, executionId: execution.executionId, sourceSnapshot: execution.sourceSnapshot };
    const coverage = clone(base.coverage || {});
    for (const scope of assessed) {
      const missing = EVIDENCE_CATEGORIES.filter((category) => !captured.some((row) => row.category === category && row.scope.includes(scope)));
      const missingBoundaries = execution.executionKind === 'import' ? missingImportBoundaries(captured, scope) : [];
      const sourceUnknown = captured.filter((row) => row.scope.includes(scope)).flatMap((row) => row.evidence.unknownAreas || row.evidence.unassessed || row.evidence.unknown || []);
      if (sourceUnknown.some((item) => typeof item !== 'string')) throw new MigrationReviewError('invalid_request', 'unknown evidence areas must name scopes');
      const unknownAreas = [...new Set([...(request.coverage.unknownAreas || []), ...sourceUnknown, ...missing.map((category) => `${scope}:${category}`), ...missingBoundaries.map((phase) => `${scope}:import-boundary:${phase}`)])].sort();
      const key = `${producerId}\u0000${scope}`;
      coverage[key] = { producerId, scopeKey: scope, status: missing.length || unknownAreas.length || request.coverage.status !== 'complete' ? 'incomplete' : 'complete', unknownAreas, missingCategories: missing };
      if (execution.executionKind === 'import') Object.assign(coverage[key], { executionId: execution.executionId, missingBoundaries });
      const findingKey = `review-evidence:${scope}`;
      const investigation = normalizeFinding({ findingKey, scopeKey: scope, group: 'Data', title: `Review missing ${scope} evidence`, summary: 'Evidence coverage is incomplete; inspect the named missing areas before treating the report as complete.', affected: [], affectedCount: null, consequence: 'Unrecorded migration gaps may remain.', action: 'Investigate and capture the missing evidence.', requirement: 'required', verificationPolicy: 'machine_required', evidenceStatus: 'unassessed', unknownAreas }, producerId, 'task');
      // The service opens or closes only its own investigation row under that id.
      const held = tasks[investigation.taskId];
      if (held && held.findingKey !== investigation.findingKey) throw new MigrationReviewError('identity_collision', `task ${investigation.taskId} is not the coverage investigation for ${scope}`);
      if (coverage[key].status === 'incomplete') tasks[investigation.taskId] = investigation;
      else if (held) tasks[investigation.taskId] = { ...held, applicability: { status: 'not_applicable', reason: 'Required coverage is now evidenced.', captureIds: request.captureIds } };
    }
    for (const change of request.applicabilityChanges || []) {
      // Coverage investigations are service-owned: they close only when coverage is evidenced.
      if (typeof change.findingKey === 'string' && change.findingKey.startsWith('review-evidence:')) throw new MigrationReviewError('invalid_disposition', 'coverage investigations close only when their coverage is evidenced');
      const task = Object.values(tasks).find((row) => row.findingKey === change.findingKey && row.producerId === producerId);
      if (!task || !assessed.includes(task.scopeKey) || !['not_applicable', 'superseded'].includes(change.status) || !change.reason) throw new MigrationReviewError('invalid_disposition', 'explicit disposition must identify an owned assessed finding and reason');
      const proof = captured.find((row) => (change.captureIds || []).includes(row.captureId) && row.scope.includes(task.scopeKey) && (row.evidence.dispositions || []).some((item) => item.findingKey === task.findingKey && item.materialFingerprint === task.materialFingerprint && item.status === change.status));
      if (!proof) throw new MigrationReviewError('missing_evidence', 'finding disposition requires evidence matching its current material scope');
      if (change.status === 'superseded' && !Object.values(tasks).some((row) => row.findingKey === change.supersededBy && row.producerId === producerId && row.findingKey !== task.findingKey)) throw new MigrationReviewError('invalid_disposition', 'supersession requires an existing replacement finding');
      tasks[task.taskId] = { ...task, applicability: { status: change.status, reason: change.reason, captureIds: change.captureIds, supersededBy: change.supersededBy || null } };
    }
    await reconcileExpectedScopes(root, state, coverage, tasks);
    const captures = [...new Set([...(base.captures || []), ...(request.captureIds || [])])].sort();
    const content = { completionReportDigest: request.completionReportDigest || null, tasks, results, coverage, captures, scopeFrontier: frontier };
    const revisionId = `rev_${digest(content).slice(0, 24)}`;
    const manifest = { contractVersion: CONTRACT_VERSION, revisionId, parentRevisionId: state.currentRevisionId, producerId, executionId: execution.executionId, generation: execution.generation, assessedScope: assessed, ...content };
    return { apply: async ({ root: lockedRoot, state: lockedState, now }) => {
      if (lockedState.currentRevisionId !== revisionId) {
        const stored = { ...manifest, publishedAt: now };
        const manifestPath = path.join(lockedRoot, 'revisions', safeName(revisionId), 'manifest.json');
        const existing = await readJson(manifestPath, { optional: true });
        if (existing && Object.keys(content).some((key) => canonical(existing[key]) !== canonical(content[key]))) throw new MigrationReviewError('immutable_collision', 'existing revision content differs');
        await writeImmutable(manifestPath, existing || stored);
      }
      return {
        state: { ...lockedState, currentRevisionId: revisionId, scopeFrontier: frontier },
        result: { revisionId, coverage: clone(coverage), taskCount: Object.keys(tasks).length, resultCount: Object.keys(results).length },
      };
    } };
  }, options);
}

// Account for committed scope declarations even when a publisher omits them. Older
// registrations without an owner require coverage from any producer; new ones bind it.
async function reconcileExpectedScopes(root, state, coverage, tasks) {
  const executions = new Map();
  const expected = new Map();
  function add(execution, scope) {
    const owner = execution.producerId || null;
    const key = `${owner || '*'}\u0000${scope}`;
    if (!expected.has(key) || execution.generation > expected.get(key).execution.generation) expected.set(key, { owner, scope, execution });
  }
  for (const id of Object.keys(state.executions || {})) {
    const execution = await loadExecution(root, state, id);
    executions.set(id, execution);
    for (const scope of execution.assessedScope) add(execution, scope);
  }
  for (const [id, ref] of Object.entries(state.captures || {})) {
    if (ref.category && ref.category !== 'source_scope') continue;
    const [capture] = await validateCaptures(root, state, executions.get(ref.executionId), [id]);
    if (capture.category === 'source_scope') for (const scope of capture.evidence.acceptedScopes || []) add(executions.get(ref.executionId), scope);
  }
  for (const [key, row] of Object.entries(coverage)) if (row.producerId === 'migration-review') delete coverage[key];
  const published = Object.values(coverage);
  const ownedScopes = new Set([...expected.values()].filter((row) => row.owner).map((row) => row.scope));
  for (const { owner, scope, execution } of expected.values()) {
    const findingKey = `review-evidence:unpublished:${digest({ owner, scope }).slice(0, 24)}`;
    const taskId = `task_${digest(`migration-review:${findingKey}`).slice(0, 20)}`;
    // Only the service's own row under this id may be opened or closed here.
    if (tasks[taskId] && (tasks[taskId].producerId !== 'migration-review' || tasks[taskId].findingKey !== findingKey)) throw new MigrationReviewError('identity_collision', `task ${taskId} is not the service investigation for ${scope}`);
    if (!owner && ownedScopes.has(scope)) {
      if (tasks[taskId]) tasks[taskId] = { ...tasks[taskId], applicability: { status: 'not_applicable', reason: 'Coverage for this scope is now tracked by explicitly registered producers.' } };
      continue;
    }
    if (published.some((row) => row.scopeKey === scope && (!owner || row.producerId === owner) && (execution.executionKind !== 'import' || row.executionId === execution.executionId))) {
      if (tasks[taskId]) tasks[taskId] = { ...tasks[taskId], applicability: { status: 'not_applicable', reason: 'This scope now has published coverage; any missing categories remain separate investigations.' } };
      continue;
    }
    const unknownAreas = [`${scope}:unpublished${owner ? `:${owner}` : ''}`];
    coverage[`migration-review\u0000${owner || '*'}\u0000${scope}`] = { producerId: 'migration-review', expectedProducerId: owner, scopeKey: scope, status: 'incomplete', unknownAreas, missingCategories: [...EVIDENCE_CATEGORIES] };
    tasks[taskId] = normalizeFinding({ findingKey, scopeKey: scope, group: 'Data', title: `Publish missing ${scope} evidence`, summary: 'A registered or accepted scope has no published coverage.', affected: [], affectedCount: null, action: 'Capture and publish evidence for this scope in the migration environment.', requirement: 'required', consequence: 'Unrecorded migration gaps may remain.', verificationPolicy: 'machine_required', evidenceStatus: 'unassessed', unknownAreas }, 'migration-review', 'task');
  }
}

async function loadActions(root, state) {
  const rows = [];
  for (const actionId of state.actionIds || []) rows.push(await readJson(path.join(root, 'actions', `${safeName(actionId)}.json`)));
  return rows;
}

function projectTask(task, relevant) {
  const current = relevant[relevant.length - 1] || null;
  let disposition = 'open';
  if (current && current.action === 'resolve') disposition = current.materialFingerprint === task.materialFingerprint ? 'resolved' : 'needs_review';
  if (current && current.action === 'dismiss') disposition = current.materialFingerprint === task.materialFingerprint ? 'dismissed' : 'needs_review';
  if (current && current.action === 'reopen') disposition = 'open';
  if (task.verificationPolicy === 'machine_required' && task.evidenceStatus === 'verified' && task.verificationCaptureId) disposition = 'resolved';
  if (task.applicability && ['not_applicable', 'superseded'].includes(task.applicability.status)) disposition = 'resolved';
  return { ...clone(task), disposition, resolutionSource: task.applicability && ['not_applicable', 'superseded'].includes(task.applicability.status) ? 'reconciled_evidence' : task.verificationPolicy === 'machine_required' && task.evidenceStatus === 'verified' && task.verificationCaptureId ? 'machine_verification' : current ? 'operator_action' : null, latestAction: clone(current), actionHistory: clone(relevant) };
}

async function readReport(projectDir) {
  const { root, identity, state } = await loadIdentityAndState(projectDir);
  const revision = await loadRevision(root, state.currentRevisionId);
  await reconcileExpectedScopes(root, state, revision.coverage, revision.tasks);
  const actions = await loadActions(root, state);
  const actionsByTask = new Map();
  for (const action of actions) {
    if (!actionsByTask.has(action.taskId)) actionsByTask.set(action.taskId, []);
    actionsByTask.get(action.taskId).push(action);
  }
  const tasks = Object.values(revision.tasks || {}).map((task) => projectTask(task, actionsByTask.get(task.taskId) || []));
  const coverageRows = Object.entries(revision.coverage || {});
  const incomplete = coverageRows.filter(([, row]) => row.status !== 'complete');
  return {
    contractVersion: CONTRACT_VERSION,
    migrationId: identity.migrationId,
    source: clone(identity.source),
    destination: clone(identity.destination),
    stateVersion: state.stateVersion,
    evidenceRevision: state.currentRevisionId,
    completionReportDigest: revision.completionReportDigest || null,
    coverage: { status: coverageRows.length > 0 && incomplete.length === 0 ? 'complete' : 'incomplete', producers: clone(revision.coverage || {}), unknownAreas: incomplete.flatMap(([, row]) => row.unknownAreas || []) },
    results: Object.values(revision.results || {}).map(clone),
    tasks,
    updatedAt: state.updatedAt,
  };
}

async function listTasks(projectDir, options = {}) {
  const report = await readReport(projectDir);
  let rows = report.tasks;
  if (options.group) rows = rows.filter((task) => task.group === options.group);
  if (options.disposition) rows = rows.filter((task) => task.disposition === options.disposition);
  rows.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || String(a.title).localeCompare(String(b.title)) || a.taskId.localeCompare(b.taskId));
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  return { contractVersion: CONTRACT_VERSION, migrationId: report.migrationId, stateVersion: report.stateVersion, evidenceRevision: report.evidenceRevision, total: rows.length, offset, limit, tasks: rows.slice(offset, offset + limit), groupTotals: Object.fromEntries(GROUPS.map((group) => [group, report.tasks.filter((task) => task.group === group).length])) };
}

async function readTask(projectDir, taskId) {
  const report = await readReport(projectDir);
  const task = report.tasks.find((row) => row.taskId === taskId);
  if (!task) throw new MigrationReviewError('unknown_task', `task ${taskId} does not exist in the committed revision`);
  return { contractVersion: CONTRACT_VERSION, migrationId: report.migrationId, stateVersion: report.stateVersion, evidenceRevision: report.evidenceRevision, task };
}

async function recordAction(projectDir, request, options = {}) {
  if (request.action === 'later') {
    assertVersion(request); assertToken(request.requestId, 'requestId'); assertToken(request.taskId, 'taskId');
    const report = await readReport(projectDir);
    validateBinding(request, report);
    if (request.expectedStateVersion !== report.stateVersion) throw new MigrationReviewError('state_conflict', 'review changed before Later');
    const task = report.tasks.find((item) => item.taskId === request.taskId);
    if (!task) throw new MigrationReviewError('unknown_task', 'Later requires an existing task');
    if (task.materialFingerprint !== request.materialFingerprint) throw new MigrationReviewError('stale_task', 'task facts changed before Later');
    return { contractVersion: CONTRACT_VERSION, operation: 'record-action', requestId: request.requestId, committedStateVersion: report.stateVersion, replayed: false, changed: false, result: { action: 'later', taskId: request.taskId, disposition: task.disposition } };
  }
  if (!['resolve', 'dismiss', 'reopen'].includes(request.action)) throw new MigrationReviewError('invalid_request', 'action must be resolve, dismiss, reopen or later');
  assertToken(request.taskId, 'taskId');
  assertToken(request.actor, 'actor');
  return commitMutation(projectDir, 'record-action', request, async ({ root, state }) => {
    const revision = await loadRevision(root, state.currentRevisionId);
    await reconcileExpectedScopes(root, state, revision.coverage, revision.tasks);
    const task = revision.tasks && revision.tasks[request.taskId];
    if (!task) throw new MigrationReviewError('unknown_task', `task ${request.taskId} does not exist in the committed revision`);
    if (request.materialFingerprint !== task.materialFingerprint) throw new MigrationReviewError('stale_task', 'task material facts changed; re-read before recording an action', { materialFingerprint: task.materialFingerprint });
    if (request.action === 'resolve' && task.verificationPolicy === 'machine_required' && task.evidenceStatus !== 'verified') {
      throw new MigrationReviewError('verification_required', 'machine-required task cannot be manually resolved without matching verified evidence');
    }
    if (request.action === 'dismiss' && task.dismissalAcknowledgment && request.consequenceAcknowledgment !== task.dismissalAcknowledgment) {
      throw new MigrationReviewError('acknowledgment_required', 'dismissal requires the current consequence acknowledgment');
    }
    const actionId = `action_${safeName(request.requestId)}`;
    return { apply: async ({ root: lockedRoot, state: lockedState, now }) => {
      const event = { contractVersion: CONTRACT_VERSION, actionId, taskId: task.taskId, action: request.action, actor: options.actor || 'local_operator', actorLabel: request.actor, actorKind: 'local_operator', materialFingerprint: task.materialFingerprint, evidenceRevision: lockedState.currentRevisionId, note: request.note || null, consequenceAcknowledgment: request.consequenceAcknowledgment || null, recordedAt: now };
      await writeImmutable(path.join(lockedRoot, 'actions', `${safeName(actionId)}.json`), event);
      return { state: { ...lockedState, actionIds: [...lockedState.actionIds, actionId] }, result: { taskId: task.taskId, actionId, disposition: request.action === 'resolve' ? 'resolved' : request.action === 'dismiss' ? 'dismissed' : 'open' } };
    } };
  }, options);
}

async function overview(projectDir) {
  const report = await readReport(projectDir);
  const counts = { open: 0, resolved: 0, dismissed: 0, needs_review: 0 };
  for (const task of report.tasks) counts[task.disposition] += 1;
  const groups = GROUPS.map((group) => ({ group, tasks: report.tasks.filter((task) => task.group === group && ['open', 'needs_review'].includes(task.disposition)).map((task) => ({ taskId: task.taskId, title: task.title, explanation: task.summary || task.consequence || '', affectedCount: Object.prototype.hasOwnProperty.call(task, 'affectedCount') ? task.affectedCount : (task.unknownAreas || []).includes('affected-count') ? null : Array.isArray(task.affected) ? task.affected.length : null, disposition: task.disposition, dependencies: clone(task.prerequisites || []) })) }));
  const recommended = report.tasks.find((task) => task.disposition === 'needs_review') || report.tasks.find((task) => task.disposition === 'open') || null;
  return { contractVersion: CONTRACT_VERSION, migrationId: report.migrationId, destination: report.destination, coverage: report.coverage, counts, groups, completeInventory: true, recommendedTaskId: recommended ? recommended.taskId : null, evidenceCoverageComplete: report.coverage.status === 'complete', reviewWorkRemaining: counts.open + counts.needs_review, nextOverallStep: 'Move to Wix (integration deferred)' };
}

async function prepareHandoff(projectDir, request, options = {}) {
  const receipt = await commitMutation(projectDir, 'prepare-handoff', request, async ({ state }) => {
    const report = await readReport(projectDir);
    if (!state.currentRevisionId) throw new MigrationReviewError('missing_publication', 'a review recap requires a committed publication');
    if (report.stateVersion !== state.stateVersion) throw new MigrationReviewError('state_conflict', 'review changed during recap preparation');
    return { apply: async ({ root, state: current, nextVersion, now }) => {
      const recap = { contractVersion: CONTRACT_VERSION, handoffVersion: 1, migrationId: report.migrationId, source: report.source, destination: report.destination, evidenceRevision: report.evidenceRevision, completionReportDigest: report.completionReportDigest, committedStateVersion: nextVersion, coverage: report.coverage, taskDispositions: report.tasks.map((task) => ({ taskId: task.taskId, materialFingerprint: task.materialFingerprint, disposition: task.disposition, consequenceAcknowledgment: task.latestAction && task.latestAction.consequenceAcknowledgment || null })), unresolved: report.tasks.filter((task) => ['open', 'needs_review'].includes(task.disposition)).map((task) => task.taskId), acceptedConsequences: report.tasks.filter((task) => task.disposition === 'dismissed').map((task) => ({ taskId: task.taskId, acknowledgment: task.latestAction.consequenceAcknowledgment || null })), consumerIntegration: { status: 'deferred' } };
      const handoffId = `handoff_${digest(recap).slice(0, 24)}`;
      const stored = { ...recap, handoffId, preparedAt: now };
      await writeImmutable(path.join(root, 'handoffs', `${safeName(handoffId)}.json`), stored);
      return { state: { ...current, latestHandoffId: handoffId }, result: stored };
    } };
  }, options);
  return { ...receipt.result, receipt };
}

async function readLatestHandoff(projectDir) {
  const { root, identity, state } = await loadIdentityAndState(projectDir);
  if (!state.latestHandoffId) return null;
  const recap = await readJson(path.join(root, 'handoffs', `${safeName(state.latestHandoffId)}.json`));
  if (recap.handoffId !== state.latestHandoffId || recap.migrationId !== identity.migrationId || recap.destination.siteId !== identity.destination.siteId || recap.committedStateVersion > state.stateVersion) throw new MigrationReviewError('corrupt_store', 'committed recap binding differs');
  const content = { ...recap }; delete content.handoffId; delete content.preparedAt;
  if (`handoff_${digest(content).slice(0, 24)}` !== recap.handoffId) throw new MigrationReviewError('corrupt_store', 'recap content differs from its immutable identity');
  return recap;
}

function generatedImporterReviewContract() {
  return {
    contractVersion: CONTRACT_VERSION,
    executionKind: 'import',
    phases: ['before-write', 'write-outcome', 'recovery'],
    requiredCategories: ['source_scope', 'mapping_fidelity', 'execution_recovery', 'setup_plugin', 'explanations_checks'],
    durableBeforeNextWrite: true,
    probeFlag: '--migration-review-probe',
  };
}

function validateGeneratedImporterReviewContract(value) {
  const expected = generatedImporterReviewContract();
  const problems = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['migrationReview must declare the durable evidence capture contract'];
  if (value.contractVersion !== expected.contractVersion) problems.push(`migrationReview.contractVersion must be "${expected.contractVersion}"`);
  if (value.executionKind !== expected.executionKind) problems.push('migrationReview.executionKind must be "import"');
  for (const phase of expected.phases) if (!Array.isArray(value.phases) || !value.phases.includes(phase)) problems.push(`migrationReview missing phase: ${phase}`);
  for (const category of expected.requiredCategories) if (!Array.isArray(value.requiredCategories) || !value.requiredCategories.includes(category)) problems.push(`migrationReview missing evidence category: ${category}`);
  if (value.durableBeforeNextWrite !== true) problems.push('migrationReview.durableBeforeNextWrite must be true');
  if (value.probeFlag !== expected.probeFlag) problems.push(`migrationReview.probeFlag must be "${expected.probeFlag}"`);
  return problems;
}

module.exports = {
  CONTRACT_VERSION,
  EVIDENCE_CATEGORIES,
  materialFingerprint,
  projectBinding,
  GROUPS,
  STORE_DIR,
  MigrationReviewError,
  canonical,
  digest,
  reviewRoot,
  initialize,
  registerExecution,
  captureEvidence,
  createEvidenceCaptureQueue,
  createWriteRecovery,
  PROBE_WRITE_FAILURE,
  readExecutionEvidence,
  checkExecutionCaptureBoundaries,
  publishEvidence,
  readReport,
  listTasks,
  readTask,
  recordAction,
  overview,
  prepareHandoff,
  readLatestHandoff,
  recoverLock,
  generatedImporterReviewContract,
  validateGeneratedImporterReviewContract,
};
