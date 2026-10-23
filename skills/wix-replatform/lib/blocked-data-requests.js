'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const OUTCOME_RANK = new Map([
  ['fulfilled', 0],
  ['warning', 1],
  ['deferred', 2],
  ['failed', 3],
]);

function sourceEntitySlug(sourceEntityRef) {
  if (!sourceEntityRef || typeof sourceEntityRef !== 'string') throw new Error('sourceEntityRef is required');
  return sourceEntityRef.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function checksum(data) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
}

function requestDirectory(projectDir) {
  return path.join(projectDir, 'state', 'blocked-data-requests');
}

function requestPath(projectDir, sourceEntityRef) {
  return path.join(requestDirectory(projectDir), `${sourceEntitySlug(sourceEntityRef)}.json`);
}

function snapshotPath(projectDir, sourceEntityRef, version) {
  return path.join(requestDirectory(projectDir), `${sourceEntitySlug(sourceEntityRef)}.extraction.v${version}.json`);
}

async function writeJsonAtomic(filePath, value, { immutable = false } = {}) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let tempExists = false;
  try {
    await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    tempExists = true;
    if (immutable) {
      try {
        // link(2) is an atomic no-clobber publish: only one concurrent writer can create
        // filePath, while the uniquely named same-directory temporary file keeps partial
        // snapshot contents out of the version namespace.
        await fsp.link(tempPath, filePath);
      } catch (error) {
        if (error.code === 'EEXIST') {
          const collision = new Error(`immutable snapshot already exists: ${filePath}`);
          collision.code = 'IMMUTABLE_SNAPSHOT_EXISTS';
          throw collision;
        }
        throw error;
      }
      await fsp.unlink(tempPath);
      tempExists = false;
    } else {
      await fsp.rename(tempPath, filePath);
      tempExists = false;
    }
  } finally {
    if (tempExists) {
      try { await fsp.unlink(tempPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

async function readJsonIfExists(filePath) {
  try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function listSnapshotVersions(projectDir, sourceEntityRef) {
  let names = [];
  try { names = await fsp.readdir(requestDirectory(projectDir)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const prefix = `${sourceEntitySlug(sourceEntityRef)}.extraction.v`;
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => Number(name.slice(prefix.length, -5)))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function snapshotValidationErrors(snapshot, { request, expectedVersion } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['snapshot must be a JSON object'];
  const errors = [];
  if (!request || snapshot.requestId !== request.requestId) errors.push('requestId does not match the blocked data request');
  if (!request || snapshot.sourceEntityRef !== request.sourceEntityRef) errors.push('sourceEntityRef does not match the blocked data request');
  if (!Number.isInteger(snapshot.version) || snapshot.version < 1) errors.push('version must be a positive integer');
  if (Number.isInteger(expectedVersion) && snapshot.version !== expectedVersion) errors.push('version does not match the snapshot filename');
  if (!request || !request.fulfillment || snapshot.handlerId !== request.fulfillment.handlerId) errors.push('handlerId does not match the fulfillment request');
  if (typeof snapshot.handlerVersion !== 'string' || snapshot.handlerVersion.length === 0) errors.push('handlerVersion is required');
  const extractedTime = typeof snapshot.extractedAt === 'string' ? Date.parse(snapshot.extractedAt) : NaN;
  if (!Number.isFinite(extractedTime) || new Date(extractedTime).toISOString() !== snapshot.extractedAt) errors.push('extractedAt must be a canonical ISO date-time');
  if (!Number.isInteger(snapshot.sourceCount) || snapshot.sourceCount < 0) errors.push('sourceCount must be a non-negative integer');
  if (!Number.isInteger(snapshot.expectedTotal) || snapshot.expectedTotal < 0) errors.push('expectedTotal must be a non-negative integer');
  if (snapshot.sourceCount !== snapshot.expectedTotal) errors.push('sourceCount must equal expectedTotal');
  if (snapshot.reconciled !== true) errors.push('reconciled must be true');
  if (!snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) {
    errors.push('data must be a JSON object');
  } else if (snapshot.checksum !== checksum(snapshot.data)) {
    errors.push('checksum does not match snapshot data');
  }
  return errors;
}

function invalidSnapshotError(filePath, errors, cause) {
  const error = new Error(`invalid blocked data snapshot ${filePath}: ${errors.join('; ')}`);
  error.code = 'INVALID_BLOCKED_DATA_SNAPSHOT';
  error.snapshotPath = filePath;
  if (cause) error.cause = cause;
  return error;
}

async function readSnapshotVersion(projectDir, request, version) {
  const filePath = snapshotPath(projectDir, request.sourceEntityRef, version);
  let snapshot;
  try { snapshot = await readJsonIfExists(filePath); }
  catch (error) { throw invalidSnapshotError(filePath, ['snapshot is not valid JSON'], error); }
  if (snapshot === null) return null;
  const errors = snapshotValidationErrors(snapshot, { request, expectedVersion: version });
  if (errors.length > 0) throw invalidSnapshotError(filePath, errors);
  return snapshot;
}

async function readCurrentSnapshot(projectDir, request) {
  let version = Number.isInteger(request.currentSnapshotVersion) ? request.currentSnapshotVersion : null;
  if (version === null) {
    const versions = await listSnapshotVersions(projectDir, request.sourceEntityRef);
    version = versions[versions.length - 1] || null;
  }
  return version === null ? null : readSnapshotVersion(projectDir, request, version);
}

function dependenciesOf(targetEntity) {
  return Array.isArray(targetEntity.blockedSourceDependencies) ? targetEntity.blockedSourceDependencies : [];
}

function resultReconciles(result) {
  return Boolean(result && result.reconciled === true
    && Number.isInteger(result.sourceCount) && result.sourceCount >= 0
    && Number.isInteger(result.expectedTotal) && result.sourceCount === result.expectedTotal);
}

async function buildBlockedDataRequests({ targetEntities = [], sourceEntitiesByRef = new Map(), existingRequests = [], readiness, askedInteractively = false, now = new Date() } = {}) {
  const bySource = new Map();
  const previousBySource = new Map(existingRequests.map((request) => [request.sourceEntityRef, request]));
  for (const targetEntity of targetEntities) {
    const targetRef = targetEntity.ref || `${targetEntity.domain}/${targetEntity.entity}`;
    for (const dependency of dependenciesOf(targetEntity)) {
      const previous = previousBySource.get(dependency.sourceEntityRef);
      const existing = bySource.get(dependency.sourceEntityRef) || {
        ...(previous ? JSON.parse(JSON.stringify(previous)) : {}),
        requestId: dependency.sourceEntityRef,
        sourceEntityRef: dependency.sourceEntityRef,
        dependentEntities: [],
        fulfillment: null,
        fulfillmentOptions: [],
        consequenceIfMissing: null,
        status: previous ? previous.status : 'offered',
        askedInteractively: Boolean(askedInteractively || (previous && previous.askedInteractively)),
        createdAt: previous && previous.createdAt ? previous.createdAt : new Date(now).toISOString(),
        currentSnapshotVersion: previous ? previous.currentSnapshotVersion : null,
        stale: previous ? Boolean(previous.stale) : false,
        dependentOutcomes: [],
        history: previous && Array.isArray(previous.history) ? previous.history : [{ status: 'offered', at: new Date(now).toISOString() }],
      };
      const dependent = {
        targetEntity: targetRef,
        degradedField: dependency.degradedField,
        pitfallCode: dependency.pitfallCode,
      };
      if (!existing.dependentEntities.some((item) => item.targetEntity === targetRef && item.degradedField === dependency.degradedField)) {
        const previousOutcome = (previous && previous.dependentOutcomes || []).find((item) => (
          item.targetEntity === dependent.targetEntity
          && item.degradedField === dependent.degradedField
          && item.pitfallCode === dependent.pitfallCode
        ));
        existing.dependentEntities.push(dependent);
        existing.dependentOutcomes.push({
          ...(previousOutcome || {}),
          ...dependent,
          recordOutcome: previousOutcome ? previousOutcome.recordOutcome : null,
        });
      }
      const pitfall = (targetEntity.pitfalls || []).find((item) => item.code === dependency.pitfallCode);
      if (!existing.consequenceIfMissing && pitfall) existing.consequenceIfMissing = pitfall.summary;
      bySource.set(dependency.sourceEntityRef, existing);
    }
  }

  const readinessCache = new Map();
  for (const request of bySource.values()) {
    const sourceEntity = sourceEntitiesByRef instanceof Map
      ? sourceEntitiesByRef.get(request.sourceEntityRef)
      : sourceEntitiesByRef[request.sourceEntityRef];
    const blockers = sourceEntity ? [
      ...(sourceEntity.blocked || []),
      ...(sourceEntity.pitfalls || []).flatMap((pitfall) => pitfall.blocked || []),
    ] : [];
    for (const blocker of blockers) {
      if (!blocker.fulfillment) continue;
      const candidate = { freshnessWindowHours: 24, ...blocker.fulfillment };
      const cacheKey = JSON.stringify(candidate);
      let result = readinessCache.get(cacheKey);
      if (!result) {
        result = readiness ? await readiness(candidate) : { ready: false, reason: 'readiness-not-provided' };
        readinessCache.set(cacheKey, result);
      }
      if (result.ready) {
        request.fulfillmentOptions.push({ ...candidate });
        if (!request.fulfillment) request.fulfillment = candidate;
      } else if (!request.fulfillment) {
        request.fulfillmentReadiness = result;
      }
    }
  }
  return [...bySource.values()].sort((a, b) => a.sourceEntityRef.localeCompare(b.sourceEntityRef));
}

function renderBlockedDataRequests(requests) {
  const lines = ['# Blocked data requests', ''];
  if (!requests.length) return `${lines.join('\n')}No target fields depend on blocked source data.\n`;
  for (const request of requests) {
    lines.push(`## ${request.sourceEntityRef}`, '');
    lines.push(request.fulfillmentOptions.length
      ? `Available fulfillment: ${request.fulfillmentOptions.map((item) => item.kind).join(', ')}.`
      : 'No built and production-ready fulfillment option is available yet; the import will use the target entity’s existing default.');
    if (request.consequenceIfMissing) lines.push('', `Consequence: ${request.consequenceIfMissing}`);
    lines.push('', 'Affected fields:');
    for (const dependent of request.dependentEntities) lines.push(`- ${dependent.targetEntity}.${dependent.degradedField} (${dependent.pitfallCode})`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function writeBlockedDataRequestArtifacts(projectDir, requests) {
  if (!projectDir) throw new Error('projectDir is required');
  for (const request of requests) await writeJsonAtomic(requestPath(projectDir, request.sourceEntityRef), request);
  const reviewPath = path.join(projectDir, 'mapping', 'review', 'blocked-data-requests.md');
  await fsp.mkdir(path.dirname(reviewPath), { recursive: true });
  await fsp.writeFile(reviewPath, renderBlockedDataRequests(requests), 'utf8');
  return { requestPaths: requests.map((request) => requestPath(projectDir, request.sourceEntityRef)), reviewPath };
}

async function attemptFulfillment(request, { handlerRegistry, namespaceProbe, handlerContext = {} } = {}) {
  const fulfillment = request.fulfillment;
  if (!fulfillment || !request.fulfillmentOptions || request.fulfillmentOptions.length === 0) return { status: 'missing' };
  const handler = handlerRegistry && handlerRegistry[fulfillment.handlerId];
  if (!handler) return { status: 'invalid', error: 'handler-not-registered' };

  if (fulfillment.kind === 'csv-upload') {
    const inputPath = path.resolve(handlerContext.projectDir || '.', fulfillment.expectedInputPath);
    if (!fs.existsSync(inputPath)) return { status: 'missing' };
    try {
      const result = await handler.parse({ inputPath, ...handlerContext });
      return resultReconciles(result) ? { status: 'fulfilled', result, handler } : { status: 'invalid', error: 'input-did-not-reconcile' };
    } catch (error) { return { status: 'invalid', error: error.message }; }
  }

  if (fulfillment.kind === 'bridge-plugin') {
    if (typeof namespaceProbe !== 'function') return { status: 'missing' };
    let namespacePresent = false;
    try {
      const probe = await namespaceProbe(fulfillment.expectedNamespace);
      namespacePresent = Array.isArray(probe) ? probe.includes(fulfillment.expectedNamespace) : probe === true;
    } catch (error) { return { status: 'missing', error: error.message }; }
    if (!namespacePresent) return { status: 'missing' };
    try {
      const result = await handler.extract({ ...handlerContext, extractionRoute: fulfillment.extractionRoute });
      return resultReconciles(result) ? { status: 'fulfilled', result, handler } : { status: 'invalid', error: 'route-did-not-reconcile' };
    } catch (error) { return { status: 'invalid', error: error.message }; }
  }
  return { status: 'invalid', error: `unsupported fulfillment kind ${fulfillment.kind}` };
}

function snapshotData(result) {
  const { sourceCount, expectedTotal, reconciled, ...data } = result;
  return data;
}

async function persistSnapshot(projectDir, request, result, handler, now, knownSnapshotVersion = 0) {
  const data = snapshotData(result);
  let ignoredThroughVersion = knownSnapshotVersion;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const versions = await listSnapshotVersions(projectDir, request.sourceEntityRef);
    const latestVersion = versions[versions.length - 1] || 0;
    if (latestVersion > ignoredThroughVersion) {
      try {
        const winner = await readSnapshotVersion(projectDir, request, latestVersion);
        if (winner) return winner;
      } catch (error) {
        if (error.code !== 'INVALID_BLOCKED_DATA_SNAPSHOT') throw error;
      }
      // Never reuse a missing or invalid collision winner. Move past it and publish a
      // new immutable version on the next iteration instead.
      ignoredThroughVersion = latestVersion;
      continue;
    }

    const version = latestVersion + 1;
    const snapshot = {
      requestId: request.requestId,
      sourceEntityRef: request.sourceEntityRef,
      version,
      extractedAt: new Date(now).toISOString(),
      handlerId: request.fulfillment.handlerId,
      handlerVersion: handler.version || 'unknown',
      sourceCount: result.sourceCount,
      expectedTotal: result.expectedTotal,
      reconciled: true,
      checksum: checksum(data),
      data,
    };
    try {
      await writeJsonAtomic(snapshotPath(projectDir, request.sourceEntityRef, version), snapshot, { immutable: true });
      return snapshot;
    } catch (error) {
      if (error.code !== 'IMMUTABLE_SNAPSHOT_EXISTS') throw error;
      // Another resolver won this version. Loop, validate its complete snapshot, and
      // coalesce onto it instead of failing or manufacturing redundant versions.
    }
  }
  throw new Error(`could not publish or reuse a concurrent snapshot for ${request.sourceEntityRef}`);
}

function applySnapshot(request, snapshot, stale) {
  request.status = 'fulfilled';
  request.stale = Boolean(stale);
  request.currentSnapshotVersion = snapshot.version;
  request.snapshot = {
    version: snapshot.version,
    extractedAt: snapshot.extractedAt,
    checksum: snapshot.checksum,
  };
  request.fulfilledData = snapshot.data;
}

async function resolveBlockedDataRequest({ projectDir, request, handlerRegistry, namespaceProbe, handlerContext = {}, now = new Date(), refresh = false } = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  const resolved = JSON.parse(JSON.stringify(request));
  delete resolved.lastError;
  delete resolved.refreshError;
  delete resolved.fulfillmentErrorCode;
  delete resolved.fulfilledData;
  delete resolved.snapshot;
  const observedVersions = await listSnapshotVersions(projectDir, resolved.sourceEntityRef);
  const knownSnapshotVersion = observedVersions[observedVersions.length - 1] || 0;
  let snapshot = null;
  let snapshotError = null;
  try { snapshot = await readCurrentSnapshot(projectDir, resolved); }
  catch (error) {
    if (error.code !== 'INVALID_BLOCKED_DATA_SNAPSHOT') throw error;
    snapshotError = error;
  }
  const configuredFreshnessHours = resolved.fulfillment ? Number(resolved.fulfillment.freshnessWindowHours) : NaN;
  const freshnessHours = Number.isFinite(configuredFreshnessHours) ? configuredFreshnessHours : 24;
  const fresh = snapshot && (new Date(now).getTime() - new Date(snapshot.extractedAt).getTime()) < freshnessHours * 3600000;
  if (snapshot && fresh && !refresh) {
    applySnapshot(resolved, snapshot, false);
  } else {
    const attempt = await attemptFulfillment(resolved, {
      handlerRegistry,
      namespaceProbe,
      handlerContext: { projectDir, ...handlerContext },
    });
    if (attempt.error) resolved.fulfillmentErrorCode = attempt.error;
    if (attempt.status === 'fulfilled') {
      const written = await persistSnapshot(projectDir, resolved, attempt.result, attempt.handler, now, knownSnapshotVersion);
      applySnapshot(resolved, written, false);
    } else if (snapshot) {
      applySnapshot(resolved, snapshot, true);
      resolved.refreshError = attempt.error || attempt.status;
    } else if (snapshotError) {
      resolved.status = 'invalid';
      resolved.stale = false;
      resolved.lastError = `${snapshotError.message}; refresh failed: ${attempt.error || attempt.status}`;
    } else if (attempt.status === 'invalid') {
      resolved.status = 'invalid';
      resolved.stale = false;
      resolved.lastError = attempt.error;
    } else if (resolved.status === 'declined' && resolved.askedInteractively === true) {
      resolved.status = 'declined';
      resolved.stale = false;
    } else {
      resolved.status = 'missing';
      resolved.stale = false;
      if (attempt.error) resolved.lastError = attempt.error;
    }
  }
  resolved.history = [...(resolved.history || []), { status: resolved.status, stale: resolved.stale, at: new Date(now).toISOString() }];
  const persisted = { ...resolved };
  delete persisted.fulfilledData;
  await writeJsonAtomic(requestPath(projectDir, resolved.sourceEntityRef), persisted);
  return resolved;
}

function aggregateOutcome(dependentOutcomes = []) {
  return dependentOutcomes.reduce((worst, item) => {
    const candidate = item.recordOutcome;
    if (!OUTCOME_RANK.has(candidate)) return worst;
    return !worst || OUTCOME_RANK.get(candidate) > OUTCOME_RANK.get(worst) ? candidate : worst;
  }, null);
}

module.exports = {
  OUTCOME_RANK,
  aggregateOutcome,
  buildBlockedDataRequests,
  checksum,
  readCurrentSnapshot,
  renderBlockedDataRequests,
  requestPath,
  resolveBlockedDataRequest,
  snapshotPath,
  sourceEntitySlug,
  snapshotValidationErrors,
  writeJsonAtomic,
  writeBlockedDataRequestArtifacts,
};
