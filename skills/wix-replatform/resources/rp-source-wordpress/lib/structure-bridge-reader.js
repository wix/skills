'use strict';

// Complete, resumable extraction of one structure-bridge-plugin entity.
//
// rp-import-codegen vendors this file into a generated project's `src/lib/` next to
// wix-wp-plugin-v2-client.js and calls extractStructureBridgeEntity() once per entity. The read
// contract in rp-import-codegen's "`structure-bridge-plugin` entities" section is implemented
// here once, deterministically, instead of being re-authored in every generated reader.
//
// Two variants, chosen by the artifacts discovery persisted -- never by the caller's guess:
//   - single-request: `…--<table>.structure-request.json`, paged to exhaustion;
//   - EAV: `…--<table>.eav-read-plan.json`, every batch run verbatim.
//
// Invariants both variants share:
//   - rows go to `<entity>.ndjson.tmp`, one page at a time, with a checkpoint after every append;
//   - reconciliation runs before promotion, and a failure leaves `.tmp` + checkpoint in place;
//   - the governing artifact is re-hashed immediately before promotion, even on a run that never
//     resumed, so a request/plan replaced mid-read blocks promotion;
//   - the file is promoted first and the manifest written second;
//   - an existing final file is reused only when its manifest still matches what is on disk.
//
// Complete-identity rule: an EAV plan with a non-empty
// `droppedIdentityColumns` is never promoted, and this reader never sets
// `acknowledgedDroppedColumns` -- not even when the plan on disk carries it.
//
// Every outcome is returned, never thrown, so one table's failure does not abort the others.
// `status` is `promoted`, `reused` or `deferred`; a deferred result names a `code` and `reasons`.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const client = require('./wix-wp-plugin-v2-client.js');

const PAGE_LIMIT = client.MAX_PAGE_LIMIT;
const SIDECAR_PREFIX = 'wix-wp-plugin-v2';

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
}

/** Artifact paths for one entity. Mirrors wp-discovery.js's sidecar naming. */
function structureBridgePaths({ dataDir, entity, table }) {
  if (!dataDir || !entity || !table) throw new Error('structureBridgePaths needs dataDir, entity and table');
  if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('bridge table must be a bare identifier');
  if (!/^[A-Za-z0-9_.-]+$/.test(entity) || entity === '.' || entity === '..') throw new Error('invalid bridge entity');
  const discoveryDir = path.join(dataDir, 'wp-discovery');
  const extractDir = path.join(dataDir, 'source-extract');
  const requestFile = `${SIDECAR_PREFIX}--${slugify(table)}.structure-request.json`;
  const planFile = `${SIDECAR_PREFIX}--${slugify(table)}.eav-read-plan.json`;
  const finalPath = path.join(extractDir, `${entity}.ndjson`);
  return {
    discoveryDir,
    extractDir,
    requestFile,
    requestPath: path.join(discoveryDir, requestFile),
    planFile,
    planPath: path.join(discoveryDir, planFile),
    finalPath,
    tmpPath: `${finalPath}.tmp`,
    checkpointPath: `${finalPath}.tmp.cursor.json`,
    manifestPath: path.join(extractDir, `${entity}.manifest.json`),
    deferredPath: path.join(extractDir, `${entity}.deferred.json`),
  };
}

/** Canonical (key-sorted) hash of an approved structureRequest, so formatting cannot change it. */
function structureRequestHash(request) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex').slice(0, 16);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(filePath) {
  try { await fsp.access(filePath); return true; } catch { return false; }
}

async function writeJsonAtomic(filePath, value) {
  const staging = `${filePath}.writing`;
  await fsp.writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(staging, filePath);
}

async function removeIfExists(filePath) {
  await fsp.rm(filePath, { force: true });
}

/** Line count and sha256 of a file, streamed so a large extraction is never held in memory. */
function fileStats(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) { resolve({ lines: 0, digest: null, exists: false }); return; }
    const hash = createHash('sha256');
    let lines = 0;
    fs.createReadStream(filePath)
      .on('data', (chunk) => {
        hash.update(chunk);
        for (let i = 0; i < chunk.length; i += 1) if (chunk[i] === 10) lines += 1;
      })
      .on('error', reject)
      .on('end', () => resolve({ lines, digest: hash.digest('hex'), exists: true }));
  });
}

async function appendRows(tmpPath, rows) {
  if (rows.length === 0) return;
  await fsp.appendFile(tmpPath, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
}

async function discardInProgress(paths) {
  await removeIfExists(paths.tmpPath);
  await removeIfExists(paths.checkpointPath);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isCursor = (value) => typeof value === 'string' && value !== '';

/** A checkpoint that is not even JSON is as unusable as a malformed one: restart, never throw. */
async function readCheckpoint(paths) {
  try {
    return await readJsonIfExists(paths.checkpointPath);
  } catch (error) {
    if (error instanceof SyntaxError) return { unparseable: true };
    throw error;
  }
}

/**
 * Schema and cross-field invariants of a persisted single-request checkpoint. A checkpoint is
 * only ever written after a page, so `snapshotTotal` is always the first page's frozen total.
 * Without this, a checkpoint missing `hasNext` skipped the page loop and could promote a
 * partial file whose `rowsWritten` happened to equal `snapshotTotal`.
 */
function singleRequestCheckpointProblem(checkpoint) {
  if (typeof checkpoint.hasNext !== 'boolean') return 'hasNext must be a boolean';
  if (!isCount(checkpoint.rowsWritten)) return 'rowsWritten must be a non-negative integer';
  if (!isCount(checkpoint.snapshotTotal)) return 'snapshotTotal must be a non-negative integer';
  if (checkpoint.hasNext && !isCursor(checkpoint.cursor)) return 'hasNext is true but cursor is not a non-empty string';
  if (!checkpoint.hasNext && checkpoint.cursor !== null) return 'hasNext is false but cursor is not null';
  return null;
}

function batchProblem(batch, label) {
  if (!isPlainObject(batch)) return `${label} must be an object`;
  if (!Number.isInteger(batch.batchIndex)) return `${label}.batchIndex must be an integer`;
  if (!isCount(batch.rowsRead)) return `${label}.rowsRead must be a non-negative integer`;
  if (!isCount(batch.snapshotTotal)) return `${label}.snapshotTotal must be a non-negative integer`;
  return null;
}

/**
 * Schema and cross-field invariants of a persisted EAV checkpoint, against the plan it claims.
 * Batches run in plan order, so `completedBatches` must be exactly the plan's first N batches
 * and `activeBatch`, when present, the next one, mid-page; the batch row counts must add up to
 * `rowsWritten`. Anything else is a checkpoint that would resume into the wrong batch layout.
 */
function eavCheckpointProblem(checkpoint, plan, planFile) {
  if (checkpoint.planFile !== planFile) return `planFile must be ${planFile}`;
  if (!isCount(checkpoint.rowsWritten)) return 'rowsWritten must be a non-negative integer';
  if (!Array.isArray(checkpoint.completedBatches)) return 'completedBatches must be an array';
  if (checkpoint.activeBatch !== null && !isPlainObject(checkpoint.activeBatch)) return 'activeBatch must be null or an object';
  const order = client.eavReadPlanBatches(plan).map((b) => b.batchIndex);
  let rows = 0;
  for (const [i, batch] of checkpoint.completedBatches.entries()) {
    const problem = batchProblem(batch, `completedBatches[${i}]`);
    if (problem) return problem;
    if (batch.batchIndex !== order[i]) return `completedBatches[${i}] is batch ${batch.batchIndex}, but the plan runs batch ${order[i]} there`;
    rows += batch.rowsRead;
  }
  const active = checkpoint.activeBatch;
  if (active) {
    const problem = batchProblem(active, 'activeBatch');
    if (problem) return problem;
    const expected = order[checkpoint.completedBatches.length];
    if (active.batchIndex !== expected) return `activeBatch is batch ${active.batchIndex}, but the next batch in the plan is ${expected === undefined ? 'none' : expected}`;
    if (active.hasNext !== true) return 'activeBatch.hasNext must be true (a finished batch belongs in completedBatches)';
    if (!isCursor(active.cursor)) return 'activeBatch.cursor must be a non-empty string';
    rows += active.rowsRead;
  }
  if (rows !== checkpoint.rowsWritten) return `the batches account for ${rows} row(s) but rowsWritten is ${checkpoint.rowsWritten}`;
  return null;
}

function deferred(variant, code, reasons, extra = {}) {
  return { status: 'deferred', variant, code, reasons: Array.isArray(reasons) ? reasons : [reasons], ...extra };
}

function makeRedactionTally() {
  const columns = new Set();
  let count = 0;
  return {
    add(meta) {
      if (!meta || !meta.redactedValueCount) return;
      count += meta.redactedValueCount;
      for (const column of meta.redactedColumns || []) columns.add(column);
    },
    report() { return { redactedValueCount: count, redactedColumns: [...columns].sort() }; },
  };
}

/** One page, through the vendored client -- never a hand-built request or response check. */
async function fetchPage(transport, structureRequest, cursor) {
  return client.queryStructure({
    httpClient: transport.httpClient,
    siteBaseUrl: transport.siteBaseUrl,
    auth: transport.auth,
    structureRequest,
    cursor,
    limit: PAGE_LIMIT,
    onSourceRead: transport.onSourceRead,
  });
}

function stalledCursorReason(table, previousCursor, next) {
  if (next === null || next === undefined || next === '') {
    return `table ${table}: hasNext is true but no next cursor was returned -- refusing to loop or truncate`;
  }
  if (next === previousCursor) {
    return `table ${table}: hasNext is true but the next cursor is unchanged from the one just used -- refusing to loop or truncate`;
  }
  return null;
}

// --- single-request variant --------------------------------------------------------------------

async function singleRequestReuse(paths, requestHash) {
  if (!(await exists(paths.finalPath))) return { reusable: false, reasons: ['no final file'] };
  const manifest = await readJsonIfExists(paths.manifestPath);
  if (!manifest || manifest.kind !== 'structure-request') return { reusable: false, reasons: ['no structure-request manifest -- the existing file is stale'] };
  const reasons = [];
  if (manifest.structureRequestHash !== requestHash) reasons.push(`the approved query changed since this file was written (${manifest.structureRequestHash} -> ${requestHash})`);
  if (manifest.sidecarFile !== paths.requestFile) reasons.push(`manifest names ${manifest.sidecarFile} but this entity's request is ${paths.requestFile}`);
  const stats = await fileStats(paths.finalPath);
  if (manifest.ndjsonDigest !== stats.digest) reasons.push('the extracted file does not match the digest its manifest recorded');
  if (manifest.rowsWritten !== stats.lines) reasons.push(`the extracted file holds ${stats.lines} row(s) but its manifest recorded ${manifest.rowsWritten}`);
  if (manifest.rowsWritten !== manifest.snapshotTotal) reasons.push('the manifest records an unreconciled extraction');
  return { reusable: reasons.length === 0, reasons, manifest };
}

async function extractSingleRequest({ entity, table, paths, transport, now, redactions }) {
  const variant = 'single-request';
  const structureRequest = await readJsonIfExists(paths.requestPath);
  if (!structureRequest) {
    return deferred(variant, 'missing-artifact', `table ${table}: ${paths.requestFile} does not exist -- discovery has not produced an approved query for this entity, so it cannot be extracted yet`);
  }
  // `table` is always the fulfillment's own, applied last, so a sidecar can never redirect the read.
  const request = { ...structureRequest, table };
  const requestHash = structureRequestHash(structureRequest);

  const reuse = await singleRequestReuse(paths, requestHash);
  if (reuse.reusable && !(await exists(paths.tmpPath))) {
    return { status: 'reused', variant, entity, rowsWritten: reuse.manifest.rowsWritten, manifestPath: paths.manifestPath, finalPath: paths.finalPath, reasons: [] };
  }

  await fsp.mkdir(paths.extractDir, { recursive: true });
  let checkpoint = await readCheckpoint(paths);
  const resumeNotes = [];
  if (checkpoint && checkpoint.unparseable === true) {
    resumeNotes.push('the checkpoint is not valid JSON -- discarding its rows and restarting');
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint && (!isPlainObject(checkpoint) || checkpoint.planHash !== undefined || typeof checkpoint.structureRequestHash !== 'string')) {
    resumeNotes.push('checkpoint belongs to a different read variant -- restarting');
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint && checkpoint.structureRequestHash !== requestHash) {
    resumeNotes.push('the approved query was replaced since this read started -- discarding its rows and restarting under the current request');
    await discardInProgress(paths);
    checkpoint = null;
  }
  const malformed = checkpoint ? singleRequestCheckpointProblem(checkpoint) : null;
  if (malformed) {
    resumeNotes.push(`the checkpoint is malformed (${malformed}) -- discarding its rows and restarting`);
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint) {
    const { lines } = await fileStats(paths.tmpPath);
    if (lines !== checkpoint.rowsWritten) {
      resumeNotes.push(`the in-progress file holds ${lines} row(s) but its checkpoint recorded ${checkpoint.rowsWritten} -- restarting`);
      await discardInProgress(paths);
      checkpoint = null;
    }
  } else if (await exists(paths.tmpPath)) {
    await removeIfExists(paths.tmpPath); // a .tmp with no checkpoint cannot be resumed safely
  }

  let state = checkpoint || { cursor: null, hasNext: true, rowsWritten: 0, snapshotTotal: null, structureRequestHash: requestHash };
  let queries = 0;
  if (!checkpoint) await fsp.writeFile(paths.tmpPath, '', 'utf8');

  while (state.hasNext) {
    let page;
    try {
      // eslint-disable-next-line no-await-in-loop
      page = await fetchPage(transport, request, state.cursor);
    } catch (error) {
      return deferred(variant, 'page-error', `table ${table}: ${error.message}`, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
    }
    queries += 1;
    redactions.add(page.redactionMetadata);
    const { hasNext, total, cursors } = page.pagingMetadata;
    const stalled = hasNext ? stalledCursorReason(table, state.cursor, cursors.next) : null;
    if (stalled) {
      // Nothing from this page is appended: the checkpoint still describes the file exactly.
      return deferred(variant, 'stalled-cursor', stalled, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
    }
    // eslint-disable-next-line no-await-in-loop
    await appendRows(paths.tmpPath, page.rows);
    state = {
      cursor: hasNext ? cursors.next : null,
      hasNext,
      rowsWritten: state.rowsWritten + page.rows.length,
      snapshotTotal: state.snapshotTotal === null ? total : state.snapshotTotal,
      structureRequestHash: requestHash,
    };
    // eslint-disable-next-line no-await-in-loop
    await writeJsonAtomic(paths.checkpointPath, state);
  }

  if (state.rowsWritten !== state.snapshotTotal) {
    return deferred(variant, 'count-mismatch', `table ${table}: read ${state.rowsWritten} row(s) but the first page's frozen snapshot total was ${state.snapshotTotal} -- not promoting`, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
  }

  // Final re-hash: a sidecar replaced while this read ran straight through is caught only here.
  const current = await readJsonIfExists(paths.requestPath);
  const currentHash = current ? structureRequestHash(current) : null;
  if (currentHash !== state.structureRequestHash) {
    return deferred(variant, 'request-replaced', `table ${table}: the approved query changed during this read (${state.structureRequestHash} -> ${currentHash || 'missing'}) -- not promoting; the next run restarts under the current request`, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
  }

  // Promote first, manifest second: a crash between them leaves a file the reuse check refuses.
  await fsp.rename(paths.tmpPath, paths.finalPath);
  await removeIfExists(paths.checkpointPath);
  const stats = await fileStats(paths.finalPath);
  const manifest = {
    kind: 'structure-request',
    sidecarFile: paths.requestFile,
    structureRequestHash: state.structureRequestHash,
    rowsWritten: state.rowsWritten,
    snapshotTotal: state.snapshotTotal,
    ndjsonDigest: stats.digest,
    extractedAt: new Date(now()).toISOString(),
  };
  await writeJsonAtomic(paths.manifestPath, manifest);
  return { status: 'promoted', variant, entity, rowsWritten: state.rowsWritten, queries, manifestPath: paths.manifestPath, finalPath: paths.finalPath, reasons: [], resumeNotes };
}

// --- EAV variant -------------------------------------------------------------------------------

const BEST_EFFORT_MARKER = 'the extraction is best-effort';

/** Split reconcileEavReadPlan()'s problems into blocking ones and the best-effort qualifier. */
function splitBestEffort(plan, problems) {
  const bestEffort = plan.orderByIsUnique === false ? problems.filter((p) => p.includes(BEST_EFFORT_MARKER)) : [];
  return { blocking: problems.filter((p) => !bestEffort.includes(p)), bestEffort };
}

/** Plan-level conditions no amount of reading can fix. Checked before any request is sent. */
function eavPlanBlockers(plan, table) {
  const blockers = [];
  if (Array.isArray(plan.droppedIdentityColumns) && plan.droppedIdentityColumns.length > 0) {
    blockers.push({
      code: 'dropped-identity-columns',
      reason: `table ${table}: ${plan.droppedIdentityColumns.length} identity column(s) do not fit the 50-column select cap (${plan.droppedIdentityColumns.join(', ')}). `
        + 'This fulfillment kind requires complete identity: narrow the mapping or redesign the read plan, then regenerate it. '
        + 'An acknowledgedDroppedColumns flag on the plan does not change this.',
    });
  }
  if (plan.keysTruncated) {
    blockers.push({ code: 'keys-truncated', reason: `table ${table}: key discovery hit its cap, so the key list is incomplete -- this extraction cannot be treated as whole-table` });
  }
  return blockers;
}

async function extractEav({ entity, table, paths, transport, now, redactions }) {
  const variant = 'eav';
  const plan = await readJsonIfExists(paths.planPath);
  const integrity = client.verifyEavReadPlanIntegrity(plan);
  if (integrity) return deferred(variant, 'plan-integrity', integrity, { entity });
  const planHash = client.eavReadPlanHash(plan);

  const blockers = eavPlanBlockers(plan, table);
  if (blockers.length > 0) {
    // In-progress files are left exactly as they are.
    return deferred(variant, blockers[0].code, blockers.map((b) => b.reason), { entity });
  }

  if (await exists(paths.finalPath) && !(await exists(paths.tmpPath))) {
    const manifest = await readJsonIfExists(paths.manifestPath);
    const stats = await fileStats(paths.finalPath);
    const reasons = client.eavExtractionIsReusable(plan, manifest, { planFile: paths.planFile, ndjsonDigest: stats.digest, ndjsonRowCount: stats.lines });
    const blocking = reasons.filter((r) => !(plan.orderByIsUnique === false && r.includes(BEST_EFFORT_MARKER)));
    if (blocking.length === 0) {
      return { status: 'reused', variant, entity, rowsWritten: manifest.rowsWritten, bestEffort: plan.orderByIsUnique === false, manifestPath: paths.manifestPath, finalPath: paths.finalPath, reasons: [] };
    }
  }

  await fsp.mkdir(paths.extractDir, { recursive: true });
  let checkpoint = await readCheckpoint(paths);
  const resumeNotes = [];
  if (checkpoint && checkpoint.unparseable === true) {
    resumeNotes.push('the checkpoint is not valid JSON -- discarding its rows and restarting');
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint && (!isPlainObject(checkpoint) || typeof checkpoint.planHash !== 'string')) {
    resumeNotes.push('checkpoint belongs to a different read variant -- restarting');
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint && checkpoint.planHash !== planHash) {
    resumeNotes.push('the read plan was replaced since this read started -- discarding its rows and restarting under the current plan');
    await discardInProgress(paths);
    checkpoint = null;
  }
  const malformed = checkpoint ? eavCheckpointProblem(checkpoint, plan, paths.planFile) : null;
  if (malformed) {
    resumeNotes.push(`the checkpoint is malformed (${malformed}) -- discarding its rows and restarting`);
    await discardInProgress(paths);
    checkpoint = null;
  }
  if (checkpoint) {
    const { lines } = await fileStats(paths.tmpPath);
    if (lines !== checkpoint.rowsWritten) {
      resumeNotes.push(`the in-progress file holds ${lines} row(s) but its checkpoint recorded ${checkpoint.rowsWritten} -- restarting`);
      await discardInProgress(paths);
      checkpoint = null;
    }
  } else if (await exists(paths.tmpPath)) {
    await removeIfExists(paths.tmpPath);
  }

  let state = checkpoint || { planFile: paths.planFile, planHash, activeBatch: null, completedBatches: [], rowsWritten: 0 };
  if (!checkpoint) await fsp.writeFile(paths.tmpPath, '', 'utf8');
  const done = new Set(state.completedBatches.map((b) => b.batchIndex));
  let queries = 0;

  for (const batch of client.eavReadPlanBatches(plan)) {
    if (done.has(batch.batchIndex)) continue;
    let active = state.activeBatch && state.activeBatch.batchIndex === batch.batchIndex
      ? state.activeBatch
      : { batchIndex: batch.batchIndex, cursor: null, hasNext: true, rowsRead: 0, snapshotTotal: null };
    const request = { ...batch.structureRequest, table };
    while (active.hasNext) {
      let page;
      try {
        // eslint-disable-next-line no-await-in-loop
        page = await fetchPage(transport, request, active.cursor);
      } catch (error) {
        return deferred(variant, 'page-error', `table ${table} batch ${batch.batchIndex}: ${error.message}`, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
      }
      queries += 1;
      redactions.add(page.redactionMetadata);
      const { hasNext, total, cursors } = page.pagingMetadata;
      const stalled = hasNext ? stalledCursorReason(`${table} batch ${batch.batchIndex}`, active.cursor, cursors.next) : null;
      if (stalled) return deferred(variant, 'stalled-cursor', stalled, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
      // eslint-disable-next-line no-await-in-loop
      await appendRows(paths.tmpPath, page.rows);
      active = {
        batchIndex: batch.batchIndex,
        cursor: hasNext ? cursors.next : null,
        hasNext,
        rowsRead: active.rowsRead + page.rows.length,
        snapshotTotal: active.snapshotTotal === null ? total : active.snapshotTotal,
      };
      const rowsWritten = state.rowsWritten + page.rows.length;
      state = hasNext
        ? { ...state, activeBatch: active, rowsWritten }
        : {
          ...state,
          activeBatch: null,
          completedBatches: [...state.completedBatches, { batchIndex: active.batchIndex, rowsRead: active.rowsRead, snapshotTotal: active.snapshotTotal }],
          rowsWritten,
        };
      // eslint-disable-next-line no-await-in-loop
      await writeJsonAtomic(paths.checkpointPath, state);
    }
    done.add(batch.batchIndex);
  }

  const problems = client.reconcileEavReadPlan(plan, { planHash: state.planHash, batches: state.completedBatches, rowsWritten: state.rowsWritten });
  const { blocking, bestEffort } = splitBestEffort(plan, problems);
  if (blocking.length > 0) {
    return deferred(variant, 'reconcile', blocking, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
  }

  const currentPlan = await readJsonIfExists(paths.planPath);
  const currentHash = currentPlan ? client.eavReadPlanHash(currentPlan) : null;
  if (currentHash !== state.planHash || (currentPlan && client.verifyEavReadPlanIntegrity(currentPlan))) {
    return deferred(variant, 'plan-replaced', `table ${table}: the read plan changed during this read (${state.planHash} -> ${currentHash || 'missing'}) -- not promoting; the next run restarts under the current plan`, { entity, rowsWritten: state.rowsWritten, queries, resumeNotes });
  }

  await fsp.rename(paths.tmpPath, paths.finalPath);
  await removeIfExists(paths.checkpointPath);
  const stats = await fileStats(paths.finalPath);
  // acknowledgedDroppedColumns is forced false: this reader never promotes under it.
  const manifest = client.eavExtractionManifest({ ...plan, acknowledgedDroppedColumns: false }, {
    planFile: paths.planFile,
    completedBatches: state.completedBatches,
    rowsWritten: state.rowsWritten,
    extractedAt: new Date(now()).toISOString(),
    ndjsonDigest: stats.digest,
  });
  await writeJsonAtomic(paths.manifestPath, manifest);
  return {
    status: 'promoted',
    variant,
    entity,
    rowsWritten: state.rowsWritten,
    queries,
    bestEffort: bestEffort.length > 0,
    reasons: bestEffort,
    manifestPath: paths.manifestPath,
    finalPath: paths.finalPath,
    resumeNotes,
  };
}

// --- durable deferred-extraction record ----------------------------------------------------------
//
// A deferred result in memory dies with the session, and the person who later completes the
// cutover is usually a different operator on a different machine. So every deferral is also
// written to `data/source-extract/<entity>.deferred.json`: what was not extracted, why, what it
// costs, what is kept for resuming, and the exact next step. Recovery needs the original
// migration environment (the source site's plugin credential and these in-progress files), so
// the owner is always the Import Operator and the record carries a copyable prompt for them.
// A later promotion or reuse marks the same record `resolved`, with the manifest as evidence.
//
// deferredExtractionReportInput() turns open records into completion-report `operatorActions`
// rows, which the migration handoff renders above the counts. That is the integration used until
// the shared Cutover integration exists; this file names no CMS output yet.

const DEFERRED_RECORD_KIND = 'structure-bridge-deferred-extraction';
const DEFERRED_ACTION_CODE = 'structure-bridge-extraction-deferred';
const PRODUCER = 'rp-source-wordpress/lib/structure-bridge-reader.js';
const SOURCE_PREREQUISITES = [
  'the source WordPress site is still online with the Wix WordPress plugin (wix-wp-plugin-v2) active',
  'the plugin credential this migration was configured with (Application Password or WMH2_MIGRATION_KEY) is still valid in the original migration environment',
];
const DISCOVERY_PREREQUISITES = [...SOURCE_PREREQUISITES, 'WordPress discovery can be re-run from the original migration project'];

/** What resolves each deferral code. `restart` means the rerun must pass `restart: true`. */
function recoveryFor(code, { entity, table, paths }) {
  const rerun = `re-run the extraction for ${entity}`;
  const byCode = {
    'missing-artifact': { action: `inspect the missing artifact and its discovery producer for ${entity}; regenerate it only if that producer supports this entity, otherwise prepare a validated entity read plan through the generic bridge, then ${rerun}`, prerequisites: DISCOVERY_PREREQUISITES },
    'plan-integrity': { action: `re-run WordPress discovery for table ${table} to regenerate ${paths.planFile} (it was edited after discovery wrote it), then ${rerun}`, prerequisites: DISCOVERY_PREREQUISITES },
    'keys-truncated': { action: `re-run key discovery for table ${table} with a key cap high enough for the whole key list, regenerate ${paths.planFile}, then ${rerun}`, prerequisites: DISCOVERY_PREREQUISITES },
    'dropped-identity-columns': { action: `narrow the mapping for ${entity} (or redesign its read plan) so every identity column fits each batch, regenerate ${paths.planFile}, get the mapping change reviewed, then ${rerun}`, prerequisites: [...DISCOVERY_PREREQUISITES, 'the mapping review is re-opened for this entity'] },
    'page-error': { action: `check that the source site and its plugin credential work, then ${rerun}; it resumes from the saved checkpoint`, prerequisites: SOURCE_PREREQUISITES },
    'stalled-cursor': { action: `check the Wix WordPress plugin version on the source site (it returned an invalid next-page cursor), then ${rerun}; it resumes from the saved checkpoint`, prerequisites: SOURCE_PREREQUISITES },
    'count-mismatch': { action: `the table changed while it was read; ${rerun} with restart: true so it reads the whole table again`, prerequisites: SOURCE_PREREQUISITES, restart: true },
    reconcile: { action: `a batch did not read every row its snapshot promised; ${rerun} with restart: true so it reads the whole table again`, prerequisites: SOURCE_PREREQUISITES, restart: true },
    'request-replaced': { action: `the approved query changed during the read; ${rerun} -- it restarts under the current query`, prerequisites: SOURCE_PREREQUISITES },
    'plan-replaced': { action: `the read plan changed during the read; ${rerun} -- it restarts under the current plan`, prerequisites: SOURCE_PREREQUISITES },
  };
  return { restart: false, ...(byCode[code] || { action: `fix the local cause named in the reason, then ${rerun}; in-progress files are kept`, prerequisites: SOURCE_PREREQUISITES }) };
}

function projectRelative(dataDir, filePath) {
  return path.relative(path.dirname(path.resolve(dataDir)), path.resolve(filePath)).split(path.sep).join('/');
}

async function buildDeferredRecord({ dataDir, entity, table, paths, result, previous, at }) {
  const rel = (p) => projectRelative(dataDir, p);
  const recovery = recoveryFor(result.code, { entity, table, paths });
  let checkpoint = null;
  try { checkpoint = await readJsonIfExists(paths.checkpointPath); } catch { checkpoint = null; }
  const expectedTotal = checkpoint && isCount(checkpoint.snapshotTotal) ? checkpoint.snapshotTotal : null;
  const [tmpPresent, checkpointPresent] = await Promise.all([exists(paths.tmpPath), exists(paths.checkpointPath)]);
  const reason = result.reasons[0] || result.code;
  const resolutionCheck = `${rel(paths.manifestPath)} exists, a rerun of extractStructureBridgeEntity for ${entity} returns status promoted or reused, and this record then reads status: resolved`;
  const copyPrompt = `In the original migration project for this Wix site, the ${entity} data (WordPress table ${table}) was not extracted, so none of it was imported: ${result.code} -- ${reason} `
    + `Read ${rel(paths.deferredPath)}, then ${recovery.action}. `
    + 'Use the plugin credential already configured in this environment; never paste a credential into chat, a report or this prompt. '
    + `Done when ${resolutionCheck}. Then import ${entity} to Wix and regenerate the completion report and handoff.`;
  return {
    schemaVersion: 1,
    kind: DEFERRED_RECORD_KIND,
    status: 'open',
    producer: PRODUCER,
    entity,
    table,
    variant: result.variant,
    code: result.code,
    reasons: result.reasons,
    firstDeferredAt: previous && previous.status === 'open' && previous.firstDeferredAt ? previous.firstDeferredAt : at,
    lastDeferredAt: at,
    attempts: (previous && previous.status === 'open' && isCount(previous.attempts) ? previous.attempts : 0) + 1,
    affectedRecords: { entity, extractedSoFar: isCount(result.rowsWritten) ? result.rowsWritten : 0, expectedTotal, imported: 0 },
    consequence: `No ${entity} record is imported to Wix until this extraction is promoted.`,
    resumable: {
      tmpPath: rel(paths.tmpPath),
      tmpPresent,
      checkpointPath: rel(paths.checkpointPath),
      checkpointPresent,
      restartRequired: recovery.restart,
    },
    owner: 'Import Operator',
    requiresImportOperator: true,
    action: recovery.action,
    prerequisites: recovery.prerequisites,
    timing: 'before cutover, while the source WordPress site and this migration\'s plugin credential are still available',
    resolutionCheck,
    copyPromptForImportOperator: copyPrompt,
    cutoverIntegration: 'pending: the shared Cutover integration is not defined yet; until it is, this record reaches the Cutover Operator through the completion report\'s operatorActions and the migration handoff',
  };
}

/** Write, refresh or resolve the entity's durable record. Never fails the extraction itself. */
async function recordOutcome({ dataDir, entity, table, paths, result, now }) {
  try {
    const at = new Date(now()).toISOString();
    let previous = null;
    try { previous = await readJsonIfExists(paths.deferredPath); } catch { previous = null; }
    if (result.status === 'deferred') {
      await fsp.mkdir(paths.extractDir, { recursive: true });
      await writeJsonAtomic(paths.deferredPath, await buildDeferredRecord({ dataDir, entity, table, paths, result, previous, at }));
      return { deferredRecordPath: paths.deferredPath };
    }
    if (previous && previous.status === 'open') {
      await writeJsonAtomic(paths.deferredPath, {
        ...previous,
        status: 'resolved',
        resolvedAt: at,
        resolution: { status: result.status, rowsWritten: result.rowsWritten, manifestPath: projectRelative(dataDir, paths.manifestPath) },
      });
      return { deferredRecordPath: paths.deferredPath };
    }
    return {};
  } catch (error) {
    return { deferredRecordError: `could not write ${paths.deferredPath}: ${error.message}` };
  }
}

/** Every open deferred-extraction record under `data/source-extract/`. */
async function collectDeferredExtractions(dataDir) {
  const extractDir = path.join(dataDir, 'source-extract');
  let names;
  try { names = await fsp.readdir(extractDir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const name of names.filter((n) => n.endsWith('.deferred.json')).sort()) {
    // eslint-disable-next-line no-await-in-loop
    const record = await readJsonIfExists(path.join(extractDir, name));
    if (record && record.kind === DEFERRED_RECORD_KIND && record.status === 'open') records.push(record);
  }
  return records;
}

/**
 * Completion-report input for open deferred extractions: one high-severity `operatorActions`
 * row per entity (rendered above the counts in the report and the handoff), and the
 * `complete_with_deferred_records` status so a deferred table never reads as a clean run.
 */
function deferredExtractionReportInput(records = []) {
  const operatorActions = records.map((record) => ({
    code: DEFERRED_ACTION_CODE,
    severity: 'high',
    entity: record.entity,
    affectedCount: isCount(record.affectedRecords && record.affectedRecords.expectedTotal) ? record.affectedRecords.expectedTotal : null,
    action: `Requires Import Operator: ${record.entity}${record.table ? ` (table ${record.table})` : ''} extraction is unresolved (${record.code}); affected new writes are held`
      + `${record.affectedRecords && record.affectedRecords.expectedTotal === null ? ' (row count unknown)' : ''}. ${record.action}. `
      + `Details: data/source-extract/${record.entity}.deferred.json. Copy prompt for Import Operator: "${record.copyPromptForImportOperator}"`,
    deadlineReason: 'the missing rows can only be read from the source WordPress site with this migration\'s plugin credential, which may be gone after cutover',
  }));
  return { operatorActions, statuses: operatorActions.length ? ['complete_with_deferred_records'] : [] };
}

/**
 * Extract one structure-bridge-plugin entity completely, resuming any interrupted read.
 *
 * @param options.dataDir    the project's `data/` directory (holds wp-discovery/ and source-extract/)
 * @param options.entity     source entity name, e.g. `discount-rule-definition`
 * @param options.table      the fulfillment's bare table name, e.g. `wdr_rules`
 * @param options.transport  { httpClient, siteBaseUrl, auth, onSourceRead } -- the same bridge
 *                           credential selection discovery used (see rp-import-codegen)
 * @param options.expectEav  true when discovery's schema reported an eavPair; with no read plan
 *                           on disk that means key discovery failed, and the entity is deferred
 *                           rather than read through the key-names-only request
 * @param options.restart    discard the in-progress `.tmp` and checkpoint first; the recovery for
 *                           a `count-mismatch` or `reconcile` deferral, whose checkpoint would
 *                           otherwise reconcile the same way again
 */
async function extractStructureBridgeEntity({ dataDir, entity, table, transport, expectEav = false, restart = false, readArtifacts = null, recordDeferred = true, now = () => Date.now() } = {}) {
  if (!transport || !transport.siteBaseUrl) throw new Error('extractStructureBridgeEntity needs transport.siteBaseUrl');
  const paths = structureBridgePaths({ dataDir, entity, table });
  if (readArtifacts) {
    // Bound callers supply explicit files; invalid references never select legacy sidecars.
    const { checkedFile } = require('./plugin-entity-read-plan.js');
    const projectDir = fs.realpathSync(path.dirname(path.resolve(dataDir)));
    for (const [key, ref] of Object.entries(readArtifacts)) {
      if (!['structureRequest', 'eavReadPlan'].includes(key)) throw new Error('unknown bridge read artifact');
      const file = checkedFile(projectDir, ref, ['data/wp-discovery']);
      const request = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (request.table !== table) throw new Error('read artifact physical table mismatch');
      if (key === 'eavReadPlan' && client.eavReadPlanBatches(request).some((b) => b.structureRequest.table !== table)) throw new Error('EAV batch physical table mismatch');
      const prefix = key === 'structureRequest' ? 'request' : 'plan';
      paths[`${prefix}Path`] = file;
      paths[`${prefix}File`] = path.relative(projectDir, file).split(path.sep).join('/');
    }
    if (expectEav && !readArtifacts.eavReadPlan) throw new Error('bound EAV component needs value plan');
    if (!expectEav && !readArtifacts.structureRequest) throw new Error('bound component needs request');
    if (!readArtifacts.eavReadPlan) paths.planPath = path.join(paths.extractDir, `${entity}.no-eav-plan`);
  }
  const redactions = makeRedactionTally();
  const hasPlan = await exists(paths.planPath);
  let result;
  try {
    if (restart) await discardInProgress(paths);
    if (hasPlan) {
      result = await extractEav({ entity, table, paths, transport, now, redactions });
    } else if (expectEav) {
      result = deferred('eav', 'missing-artifact', `table ${table}: the schema reports a key/value pair but ${paths.planFile} does not exist -- key discovery failed, so values cannot be extracted; the key-names request is not an extraction`);
    } else {
      result = await extractSingleRequest({ entity, table, paths, transport, now, redactions });
    }
  } catch (error) {
    // A local I/O or artifact-parse failure: in-progress files stay for the next attempt.
    result = deferred(hasPlan ? 'eav' : 'single-request', 'unexpected-error', `table ${table}: ${error.message}`);
  }
  const recorded = recordDeferred ? await recordOutcome({ dataDir, entity, table, paths, result, now }) : {};
  const recovery = result.status === 'deferred' ? recoveryFor(result.code, { entity, table, paths }) : null;
  return { entity, table, ...result, ...recorded, recovery, redactions: redactions.report() };
}

module.exports = {
  PAGE_LIMIT,
  fileStats,
  DEFERRED_ACTION_CODE,
  collectDeferredExtractions,
  deferredExtractionReportInput,
  extractStructureBridgeEntity,
  structureBridgePaths,
  structureRequestHash,
};
