'use strict';

// The member pass's durable record: population gate and snapshot, one journal row pair per
// customer, and the projection of those rows into the completion report and telemetry.
//
// Why it exists: ensureMember already returned a precise outcome for every customer, and the
// generated member loop threw it away -- no journal row, nothing in the completion report, no
// telemetry. A customer could finish a migration without a Wix login and no output said so.
//
// What it guarantees:
//   * Before the first journal row or Wix call, every supplied customer has a present, unique
//     source key (and, on a subset pass, one the full pass saw). Otherwise the pass writes
//     NOTHING and reports the defect -- a partial write here would corrupt journal/crosswalk
//     identity and make the report's denominator unknowable.
//   * The report's denominator is the full pass's key snapshot; recovery passes select within it
//     and never shrink it.
//   * The report reads only the journal: latest row per source key, in append order.
//   * Telemetry is aggregate, derived from the same rows, and carries no record values.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const localState = require('./local-state.js');
const R = require('./member-outcome-registry.js');

const MEMBER_POPULATION_FILE = 'execution/member-population.json';
const POPULATION_BASIS = 'records-supplied-to-member-pass';
const SELECTION_MODES = Object.freeze(['full', 'failed-only', 'deferred-only', 'unresolved-only', 'missing-only']);
const TELEMETRY_SKILL = 'rp-execute-import';
const TELEMETRY_STAGE = 'import';
const TELEMETRY_ENTITY = 'member';
const SNAPSHOT_MISSING = 'member-population-snapshot-missing';
const MEMBER_API_SURFACE = 'members/v1';
// Severity merge: the most severe grouped record wins.
const SEVERITY_RANK = Object.freeze({ info: 0, cosmetic: 1, degraded: 2, blocking: 3 });

// The dimensions rp-telemetry's recorder folds on (telemetry-recorder.js classKeyFor), in its
// order. Grouping by anything else lets finalize merge two emitted events order-dependently.
function recorderSignature(event) {
  return [event.event_type, event.stage, event.entity_type, event.wix_api_surface,
    event.source_api_surface, event.wix_app_id, event.error_code, event.subtype]
    .map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
}
const GUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function requireString(value, field) {
  if (!value || typeof value !== 'string') throw new Error(`${field} must be a non-empty string`);
  return value;
}

function normalizeMode(mode) {
  const value = mode === undefined || mode === null ? 'full' : mode;
  if (!SELECTION_MODES.includes(value)) {
    throw new Error(`member pass mode must be one of ${SELECTION_MODES.join(', ')}`);
  }
  return value;
}

function defaultSourceStableKey(record) {
  return record ? record.sourceStableKey : undefined;
}

// --- population gate ---------------------------------------------------------------------

// Pure. Checks the WHOLE supplied list before anything is written. Never deduplicates and never
// drops a record: a defect is reported with its counts, and the caller writes nothing.
function validateMemberPopulation(records, { getSourceStableKey = defaultSourceStableKey, snapshotKeys = null } = {}) {
  if (!Array.isArray(records)) throw new Error('member population must be an array of supplied records');
  const keys = [];
  const counts = new Map();
  let missingSourceKey = 0;
  for (const record of records) {
    const key = getSourceStableKey(record);
    if (typeof key !== 'string' || key.trim() === '') {
      missingSourceKey += 1;
      keys.push(null);
      continue;
    }
    keys.push(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let duplicateSourceKey = 0;
  for (const n of counts.values()) if (n > 1) duplicateSourceKey += n;
  let unknownSourceKey = 0;
  if (snapshotKeys) {
    const known = new Set(snapshotKeys);
    for (const key of keys) if (key !== null && !known.has(key)) unknownSourceKey += 1;
  }
  const defect = { missingSourceKey, duplicateSourceKey, unknownSourceKey };
  return {
    ok: missingSourceKey === 0 && duplicateSourceKey === 0 && unknownSourceKey === 0,
    keys,
    distinctKeys: [...counts.keys()].sort(),
    extracted: records.length,
    defect,
    failingRecords: missingSourceKey + duplicateSourceKey + unknownSourceKey,
  };
}

// --- population snapshot -----------------------------------------------------------------

function populationPath(projectDir) {
  return path.join(projectDir, MEMBER_POPULATION_FILE);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error(`${MEMBER_POPULATION_FILE} must be an object`);
  if (snapshot.schemaVersion !== 1) throw new Error(`${MEMBER_POPULATION_FILE}.schemaVersion must be 1`);
  if (!Array.isArray(snapshot.keys) || snapshot.keys.some((key) => typeof key !== 'string' || !key)) {
    throw new Error(`${MEMBER_POPULATION_FILE}.keys must be an array of source keys`);
  }
  if (new Set(snapshot.keys).size !== snapshot.keys.length) throw new Error(`${MEMBER_POPULATION_FILE}.keys must be unique`);
  return snapshot;
}

async function readMemberPopulation(projectDir) {
  let text;
  try {
    text = await fs.readFile(populationPath(projectDir), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  return validateSnapshot(JSON.parse(text));
}

function buildMemberPopulation({ runId, keys, sourceFile = null, sourceChecksum = null, now = null }) {
  return validateSnapshot({
    schemaVersion: 1,
    runId: requireString(runId, 'runId'),
    createdAt: now || new Date().toISOString(),
    sourceFile: sourceFile === null ? null : String(sourceFile),
    sourceChecksum: sourceChecksum === null ? null : String(sourceChecksum),
    // Keys only, sorted: no names, emails or other record values.
    keys: [...keys].sort(),
  });
}

async function writeMemberPopulation(projectDir, snapshot) {
  validateSnapshot(snapshot);
  const filePath = populationPath(projectDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
  return filePath;
}

// --- journal rows ------------------------------------------------------------------------

function isMemberRow(row) {
  return row && row.targetEntityType === R.MEMBER_TARGET_ENTITY_TYPE && row.operation === R.MEMBER_OPERATION;
}

// Latest member row per source key, in append order (the journal fold, restricted to member
// rows), plus the pairing check: every terminal row shares its attemptId with exactly one
// earlier `started` row for the same key. Pairs are counted per (sourceStableKey, attemptId):
// a second `started` for one pair, a terminal with no earlier start for its pair, or a second
// terminal for one pair is a projection error -- a corrupted journal never reads clean.
function foldMemberJournal(rows) {
  const memberRows = (rows || []).filter(isMemberRow);
  const latestByKey = localState.foldAttemptsBySourceKey(memberRows);
  const startsByPair = new Map();
  const terminalSeen = new Set();
  const pairingErrors = [];
  const pairOf = (row) => JSON.stringify([row.sourceStableKey, row.attemptId]);
  for (const row of memberRows) {
    const pair = pairOf(row);
    const error = (code) => pairingErrors.push({ code, sourceStableKey: row.sourceStableKey, attemptId: row.attemptId });
    if (row.status === 'started') {
      const starts = (startsByPair.get(pair) || 0) + 1;
      startsByPair.set(pair, starts);
      if (starts > 1) error('duplicate-started');
      continue;
    }
    if (!startsByPair.has(pair)) error('terminal-without-started');
    else if (terminalSeen.has(pair)) error('duplicate-terminal');
    terminalSeen.add(pair);
  }
  return { memberRows, latestByKey, pairingErrors };
}

function buildStartedRow({ sourceStableKey, runId, phase, writeSpecId, mode, now = null }) {
  return {
    schemaVersion: 1,
    attemptId: crypto.randomUUID(),
    sourceStableKey: requireString(sourceStableKey, 'sourceStableKey'),
    writeSpecId: requireString(writeSpecId, 'writeSpecId'),
    operation: R.MEMBER_OPERATION,
    targetEntityType: R.MEMBER_TARGET_ENTITY_TYPE,
    status: 'started',
    runId: requireString(runId, 'runId'),
    phase: requireString(phase, 'phase'),
    startedAt: now || new Date().toISOString(),
    ...(mode && mode !== 'full' ? { selection: { offset: null, limit: null, filters: { mode } } } : {}),
  };
}

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// The terminal follow-on row for a started row (markAttempt shape: same attemptId).
// Every field telemetry and the projection need is structured here; nothing downstream parses
// a message.
function buildMemberTerminalRow(started, result, { builderFindings = [], knownMemberId = null, runId = null, phase = null, now = null } = {}) {
  const cls = R.classifyMemberResult(result);
  const policy = R.POLICY[cls];
  const findings = [...(builderFindings || []), ...((result && result.findings) || [])];
  for (const finding of findings) {
    if (!finding || !R.isMemberFinding(finding.code)) throw new Error(`unknown member finding: ${JSON.stringify(finding && finding.code)}`);
  }
  const row = {
    ...started,
    runId: runId || started.runId,
    phase: phase || started.phase,
    status: policy.journalStatus,
    outcomeCode: result.outcome,
    findingCodes: findings.map((finding) => finding.code),
    completedAt: now || new Date().toISOString(),
  };
  delete row.startedAt;
  if (policy.matchedBy) row.matchedBy = policy.matchedBy;
  if (result.memberId) row.targetId = String(result.memberId);
  if (policy.journalStatus === 'deferred') row.reason = result.outcome;
  if (cls === 'ambiguous' && Number.isInteger(result.matchCount)) row.matchCount = result.matchCount;
  if (policy.failureOutcome) {
    const error = result.error || {};
    const message = String(error.message === undefined ? '' : error.message).slice(0, 300);
    row.wixApiSurface = result.wixApiSurface || 'members/v1';
    row.failure = {
      sourceId: started.sourceStableKey,
      targetEntityId: knownMemberId ? String(knownMemberId) : null,
      operation: R.MEMBER_OPERATION,
      httpStatus: intOrNull(error.status),
      errorCode: R.deriveMemberErrorCode(error),
      scopeGroupName: null,
      outcome: policy.failureOutcome,
      message,
    };
    // An identifier in the message is extracted into a field before anything could shorten it.
    const identifiers = [...new Set((message.match(GUID_IN_TEXT) || []).map((id) => id.toLowerCase()))];
    if (identifiers.length) row.failure.identifiersInMessage = identifiers;
  }
  const retried = findings.find((finding) => finding.code === R.MEMBER_FINDING.CREATE_RETRIED);
  if (retried) {
    row.retry = {
      count: 1,
      firstErrorCode: R.deriveMemberErrorCode({
        status: retried.firstErrorStatus,
        applicationErrorCode: retried.firstErrorApplicationCode,
        outcomeKnown: retried.firstErrorOutcomeKnown,
      }),
      firstErrorStatus: intOrNull(retried.firstErrorStatus),
    };
  }
  return row;
}

// Which records a pass revisits. A subset pass selects within the snapshot by the latest row.
function selectMemberRecords(records, keys, mode, latestByKey) {
  const out = [];
  records.forEach((record, index) => {
    const key = keys[index];
    const latest = latestByKey.get(key) || null;
    const status = latest ? latest.status : null;
    let take;
    switch (mode) {
      case 'full': take = true; break;
      case 'failed-only': take = Boolean(status && status.startsWith('failed')); break;
      case 'deferred-only': take = status === 'deferred'; break;
      case 'unresolved-only': take = status === 'started' || status === 'succeeded_unverified'; break;
      case 'missing-only': take = latest === null; break;
      default: take = false;
    }
    if (take) out.push({ record, sourceStableKey: key });
  });
  return out;
}

// The member pass. The caller supplies how to build and send one member (`ensure`) and how to
// persist the crosswalk; everything about order, identity and journaling lives here.
//
//   ensure(record)                 -> { result, builderFindings?, knownMemberId? }
//   persistCrosswalk(record, result)  called before the terminal row whenever result.memberId
//
// Returns { ok, gate, snapshot, mode, selected }. `ok: false` means the population gate refused:
// zero journal rows and zero Wix calls were made. A subset pass with no snapshot throws before
// anything is written (error.code === 'member-population-snapshot-missing').
async function runMemberPass({
  projectDir,
  records,
  runId,
  phase = 'import',
  writeSpecId = 'members',
  mode = 'full',
  sample = false,
  getSourceStableKey = defaultSourceStableKey,
  sourceFile = null,
  sourceChecksum = null,
  ensure,
  persistCrosswalk = null,
} = {}) {
  requireString(projectDir, 'projectDir');
  requireString(runId, 'runId');
  const selection = normalizeMode(mode);
  if (typeof ensure !== 'function') throw new Error('runMemberPass needs an ensure(record) function');
  if (!Array.isArray(records)) throw new Error('runMemberPass needs the supplied records array');

  let snapshot = null;
  if (selection !== 'full') {
    snapshot = await readMemberPopulation(projectDir);
    if (!snapshot) {
      throw Object.assign(new Error(`${selection} member pass refused: no ${MEMBER_POPULATION_FILE} from a full pass, so the report's denominator is unknown. Run a full member pass first.`), { code: SNAPSHOT_MISSING });
    }
  }
  const gate = validateMemberPopulation(records, { getSourceStableKey, snapshotKeys: snapshot ? snapshot.keys : null });
  if (!gate.ok) return { ok: false, gate, snapshot, mode: selection, selected: 0 };

  if (selection === 'full') {
    snapshot = buildMemberPopulation({ runId, keys: gate.distinctKeys, sourceFile, sourceChecksum });
    // A sample pass writes nothing that a real pass would read as its denominator.
    if (!sample) await writeMemberPopulation(projectDir, snapshot);
  }

  const journalOptions = { sample: Boolean(sample) };
  const journal = await localState.loadAttemptJournal(projectDir, journalOptions);
  const { latestByKey } = foldMemberJournal(journal.rows);
  const selected = selectMemberRecords(records, gate.keys, selection, latestByKey);

  for (const { record, sourceStableKey } of selected) {
    const started = buildStartedRow({ sourceStableKey, runId, phase, writeSpecId, mode: selection });
    await localState.appendAttempt(projectDir, started, journalOptions);
    const outcome = await ensure(record);
    const result = outcome && outcome.result;
    R.classifyMemberResult(result); // an unknown code stops here and leaves the start dangling (unresolved), never a guessed bucket
    if (result.memberId && typeof persistCrosswalk === 'function') await persistCrosswalk(record, result);
    const terminal = buildMemberTerminalRow(started, result, {
      builderFindings: outcome.builderFindings || [],
      knownMemberId: outcome.knownMemberId || null,
    });
    await localState.appendAttempt(projectDir, terminal, journalOptions);
  }
  return { ok: true, gate, snapshot, mode: selection, selected: selected.length };
}

// --- projection --------------------------------------------------------------------------

function classOfRow(row) {
  if (!R.isMemberOutcome(row.outcomeCode)) throw new Error(`member journal row ${row.sourceStableKey}: unknown outcome code ${JSON.stringify(row.outcomeCode)}`);
  let cls;
  if (row.outcomeCode === R.MEMBER_OUTCOME.RECONCILED_EXISTING) {
    cls = row.matchedBy === 'crosswalk' ? 'reconciled-crosswalk' : row.matchedBy === 'loginEmail' ? 'reconciled-login-email' : null;
    if (!cls) throw new Error(`member journal row ${row.sourceStableKey}: reconciled row without matchedBy`);
  } else if (row.outcomeCode === R.MEMBER_OUTCOME.FAILED) {
    cls = row.status === 'succeeded_unverified' ? 'failed-unknown' : row.status === 'failed_terminal' ? 'failed-rejected' : null;
    if (!cls) throw new Error(`member journal row ${row.sourceStableKey}: member-failed with status ${row.status}`);
  } else {
    cls = R.POLICY_CLASSES.find((name) => R.POLICY[name].outcome === row.outcomeCode);
  }
  const policy = R.POLICY[cls];
  if (policy.journalStatus !== row.status) {
    throw new Error(`member journal row ${row.sourceStableKey}: ${row.outcomeCode} must carry status ${policy.journalStatus}, not ${row.status}`);
  }
  return cls;
}

// A terminal row missing a structured field telemetry or the report needs fails the projection:
// filling it from prose is the thing this design forbids.
function assertTerminalRowFields(row, cls) {
  const label = `member journal row ${row.sourceStableKey}`;
  if (!Array.isArray(row.findingCodes)) throw new Error(`${label}: findingCodes must be an array`);
  for (const code of row.findingCodes) {
    if (!R.isMemberFinding(code)) throw new Error(`${label}: unknown finding code ${JSON.stringify(code)}`);
  }
  if (R.POLICY[cls].failureOutcome) {
    const failure = row.failure;
    if (!failure || typeof failure !== 'object') throw new Error(`${label}: failure is required`);
    if (!('httpStatus' in failure)) throw new Error(`${label}: failure.httpStatus must be present`);
    if (typeof failure.errorCode !== 'string' || !failure.errorCode || failure.errorCode.length > R.ERROR_CODE_MAX || /\s/.test(failure.errorCode)) {
      throw new Error(`${label}: failure.errorCode must be a short machine code`);
    }
  }
  if (row.retry !== undefined) {
    if (!row.retry || !Number.isInteger(row.retry.count) || row.retry.count < 1 || typeof row.retry.firstErrorCode !== 'string' || !row.retry.firstErrorCode) {
      throw new Error(`${label}: retry must carry count >= 1 and firstErrorCode`);
    }
  }
}

function zeros(codes) {
  return Object.fromEntries(codes.map((code) => [code, 0]));
}

function emptyMemberOutcomes() {
  return {
    entity: R.MEMBER_ENTITY,
    populationBasis: POPULATION_BASIS,
    byOutcome: zeros(R.MEMBER_OUTCOMES),
    byClass: Object.fromEntries(R.POLICY_CLASSES.map((cls) => [cls, {
      outcome: R.POLICY[cls].outcome,
      count: 0,
      projection: R.POLICY[cls].projection,
      nextAction: R.POLICY[cls].nextAction,
    }])),
    byFinding: zeros(R.MEMBER_FINDINGS),
    populationDefect: { missingSourceKey: 0, duplicateSourceKey: 0, unknownSourceKey: 0 },
    danglingStarted: 0,
    unexpectedSkipped: 0,
    projectionErrors: [],
  };
}

function defectEvent(gate) {
  const d = gate.defect;
  return {
    event_type: 'pipeline_defect',
    subtype: 'state_inconsistency',
    stage: TELEMETRY_STAGE,
    skill: TELEMETRY_SKILL,
    entity_type: TELEMETRY_ENTITY,
    severity: 'blocking',
    count: Math.max(1, gate.failingRecords),
    what_happened: `member population gate refused the pass before any write: ${d.missingSourceKey} missing, ${d.duplicateSourceKey} duplicate, ${d.unknownSourceKey} unknown source keys`,
  };
}

// Folded rows -> completion inputs + telemetry events. `gate` is the pass's gate result; a
// refused gate projects the defect without reading the journal.
function projectMemberCompletion({ rows = [], snapshot = null, runId = null, gate = null } = {}) {
  const memberOutcomes = emptyMemberOutcomes();

  if (gate && !gate.ok) {
    memberOutcomes.populationDefect = { ...gate.defect };
    const inScope = gate.distinctKeys.length;
    memberOutcomes.unexpectedSkipped = inScope;
    return {
      completion: {
        entityCompleteness: [{
          entity: R.MEMBER_ENTITY, subtype: 'all', verificationKind: 'none',
          extracted: gate.extracted, inScope, attempted: 0, unexpectedSkipped: inScope,
          reasons: [`population gate refused the pass: ${gate.defect.missingSourceKey} missing, ${gate.defect.duplicateSourceKey} duplicate, ${gate.defect.unknownSourceKey} unknown source keys; no member was written`],
        }],
        unresolved: [],
        droppedFields: [],
        operatorActions: [],
        memberOutcomes,
        statuses: ['incomplete_with_mismatches'],
      },
      telemetryEvents: [defectEvent(gate)],
      pairingErrors: [],
    };
  }

  if (!snapshot) throw new Error('projectMemberCompletion needs the member population snapshot');
  validateSnapshot(snapshot);
  const { latestByKey, pairingErrors } = foldMemberJournal(rows);

  const unresolvedKeys = [];
  const unexpectedKeys = [];
  const ambiguousKeys = [];
  const droppedByFinding = {};
  const aggregates = new Map();
  let attempted = 0;

  // One event per distinct aggregation key -- exactly the recorder's class signature
  // (classKeyFor) -- with `count` = records carrying that key. retry_count, recovered and
  // severity are NOT in the key: records sharing a signature merge under the severity-merge rule, so the
  // recorder's finalize fold leaves every emitted event unchanged. A record contributes at most
  // once to a key, even when two of its findings map to the same key. This pass emits each key
  // once; a later member pass in the same telemetry run that emits the same signature is folded
  // by the recorder's own documented rules, unchanged.
  const addEvent = (recordKeys, event, { outcomeCode = null, findingCode = null, retryCount = 0, recovered = false } = {}) => {
    const groupKey = recorderSignature(event);
    if (recordKeys.has(groupKey)) return;
    recordKeys.add(groupKey);
    let agg = aggregates.get(groupKey);
    if (!agg) {
      agg = { event: { ...event, count: 0 }, outcomeCodes: new Set(), findingCodes: new Set(), allRecovered: true };
      if (event.event_type === 'error') agg.event.retry_count = 0;
      aggregates.set(groupKey, agg);
    }
    agg.event.count += 1;
    if (SEVERITY_RANK[event.severity] > SEVERITY_RANK[agg.event.severity]) agg.event.severity = event.severity;
    if (event.event_type === 'error') {
      agg.event.retry_count += retryCount;
      agg.allRecovered = agg.allRecovered && recovered;
    }
    if (outcomeCode) agg.outcomeCodes.add(outcomeCode);
    if (findingCode) agg.findingCodes.add(findingCode);
  };

  for (const key of snapshot.keys) {
    const row = latestByKey.get(key);
    if (!row) { unexpectedKeys.push(key); continue; }
    attempted += 1;
    if (row.status === 'started') { unresolvedKeys.push(key); memberOutcomes.danglingStarted += 1; continue; }
    const cls = classOfRow(row);
    assertTerminalRowFields(row, cls);
    const policy = R.POLICY[cls];
    memberOutcomes.byOutcome[row.outcomeCode] += 1;
    memberOutcomes.byClass[cls].count += 1;
    for (const code of new Set(row.findingCodes)) memberOutcomes.byFinding[code] += 1;
    if (policy.projection === R.PROJECTION.UNRESOLVED) unresolvedKeys.push(key);
    if (cls === 'ambiguous') ambiguousKeys.push(key);
    const droppedCodes = cls === 'written'
      ? [...new Set(row.findingCodes)].filter((code) => R.FINDING_POLICY[code].droppedField)
      : [];
    for (const code of droppedCodes) droppedByFinding[code] = (droppedByFinding[code] || 0) + 1;

    // Telemetry: only records this run concluded. A record concluded earlier is not re-emitted.
    if (!runId || row.runId !== runId) continue;
    const retryCount = row.retry ? row.retry.count : 0;
    const recordKeys = new Set();
    const base = { stage: TELEMETRY_STAGE, skill: TELEMETRY_SKILL, entity_type: TELEMETRY_ENTITY };
    if (policy.telemetry) {
      const t = policy.telemetry;
      if (t.event_type === 'error') {
        addEvent(recordKeys, {
          event_type: 'error', ...base, wix_api_surface: row.wixApiSurface || MEMBER_API_SURFACE,
          severity: t.severity, error_code: row.failure.errorCode,
        }, { outcomeCode: row.outcomeCode, retryCount, recovered: false });
      } else {
        addEvent(recordKeys, { event_type: t.event_type, subtype: t.subtype, ...base, wix_api_surface: MEMBER_API_SURFACE, severity: t.severity }, { outcomeCode: row.outcomeCode });
      }
    }
    if (cls === 'written' && retryCount > 0) {
      addEvent(recordKeys, {
        event_type: 'error', ...base, wix_api_surface: MEMBER_API_SURFACE, severity: 'info', error_code: row.retry.firstErrorCode,
      }, { outcomeCode: row.outcomeCode, retryCount, recovered: true });
    }
    for (const code of droppedCodes) {
      addEvent(recordKeys, {
        event_type: 'fidelity_loss', subtype: 'dropped_field', ...base, wix_api_surface: MEMBER_API_SURFACE, severity: 'degraded',
        observed_shapes: [{ contact: { phones: 'array' } }],
      }, { findingCode: code });
    }
  }
  memberOutcomes.unexpectedSkipped = unexpectedKeys.length;
  memberOutcomes.projectionErrors = pairingErrors.map((error) => ({ code: error.code, sourceStableKey: error.sourceStableKey }));

  const byProjection = { imported: 0, alreadyPresentByCrosswalk: 0, deferred: 0, failed: 0, unresolved: 0 };
  for (const cls of R.POLICY_CLASSES) byProjection[R.POLICY[cls].projection] += memberOutcomes.byClass[cls].count;
  byProjection.unresolved += memberOutcomes.danglingStarted;
  const partitionSum = Object.values(byProjection).reduce((a, b) => a + b, 0) + unexpectedKeys.length;
  const partitionMismatch = partitionSum !== snapshot.keys.length;

  const reasons = [];
  for (const cls of R.POLICY_CLASSES) {
    const entry = memberOutcomes.byClass[cls];
    if (!entry.count) continue;
    const label = R.POLICY[cls].reasonLine || `${entry.outcome}${cls.startsWith('failed-') ? ` (${cls === 'failed-unknown' ? 'outcome unknown' : 'rejected'})` : ''}`;
    reasons.push(`${label}: ${entry.count}${entry.nextAction ? ` -- ${entry.nextAction}` : ''}`);
  }
  if (memberOutcomes.danglingStarted) reasons.push(`write started and never concluded: ${memberOutcomes.danglingStarted} -- re-run with --unresolved-only: reads the member back by login email`);
  if (unexpectedKeys.length) reasons.push(`no journal row at all: ${unexpectedKeys.length}`);

  const events = [...aggregates.values()].map(({ event, outcomeCodes, findingCodes, allRecovered }) => {
    if (event.event_type === 'error') event.recovered = allRecovered;
    event.what_happened = findingCodes.size
      ? `${event.count} written member record(s): contact.phones dropped (${[...findingCodes].sort().join(', ')})`
      : `${event.count} member record(s) ended ${[...outcomeCodes].sort().join(', ')}${event.error_code ? ` with error ${event.error_code}` : ''}`;
    return event;
  });

  return {
    completion: {
      entityCompleteness: [{
        entity: R.MEMBER_ENTITY, subtype: 'all', verificationKind: 'none',
        extracted: snapshot.keys.length, inScope: snapshot.keys.length, attempted,
        ...byProjection,
        unexpectedSkipped: unexpectedKeys.length,
        reasons,
      }],
      unresolved: unresolvedKeys.length ? [{ entity: R.MEMBER_ENTITY, kind: 'unmapped_source', count: unresolvedKeys.length, sourceIds: unresolvedKeys }] : [],
      droppedFields: Object.entries(droppedByFinding).map(([code, n]) => ({
        entity: R.MEMBER_ENTITY, field: R.FINDING_POLICY[code].droppedField, recordCount: n, reasonCode: code,
      })),
      operatorActions: ambiguousKeys.length ? [{ ...R.OPERATOR_ACTION_AMBIGUOUS, entity: R.MEMBER_ENTITY, affectedCount: ambiguousKeys.length }] : [],
      memberOutcomes,
      statuses: pairingErrors.length || partitionMismatch ? ['incomplete_with_mismatches'] : [],
    },
    telemetryEvents: events,
    pairingErrors,
  };
}

// Read the journal (and the snapshot, when the pass did not hand one over) and project.
//
// An optional `journalRows` lets a caller that already loaded the journal once
// (to also call `attachAttemptReasons` for the non-member rows) hand those rows over directly,
// so `loadAttemptJournal` is called once per report, not once per entity. When omitted,
// `projectMemberPass` loads the journal itself exactly as it always has, so every existing
// caller is unaffected.
async function projectMemberPass(projectDir, { runId, pass = null, sample = false, journalRows = null } = {}) {
  requireString(projectDir, 'projectDir');
  if (pass && pass.ok === false) return projectMemberCompletion({ gate: pass.gate, runId });
  const snapshot = (pass && pass.snapshot) || await readMemberPopulation(projectDir);
  if (!snapshot) throw Object.assign(new Error(`no ${MEMBER_POPULATION_FILE}: run a full member pass before projecting members`), { code: SNAPSHOT_MISSING });
  const rows = journalRows !== null
    ? journalRows
    : (await localState.loadAttemptJournal(projectDir, { sample: Boolean(sample) })).rows;
  return projectMemberCompletion({ rows, snapshot, runId, gate: pass ? pass.gate : null });
}

// Merge the member fragment into the run's completion input, replacing any earlier members row.
function mergeMemberCompletion(completionInput = {}, fragment) {
  const withoutMembers = (list) => (list || []).filter((row) => row.entity !== R.MEMBER_ENTITY);
  return {
    ...completionInput,
    entityCompleteness: [...withoutMembers(completionInput.entityCompleteness), ...fragment.entityCompleteness],
    unresolved: [...withoutMembers(completionInput.unresolved), ...fragment.unresolved],
    droppedFields: [...withoutMembers(completionInput.droppedFields), ...fragment.droppedFields],
    operatorActions: [...withoutMembers(completionInput.operatorActions), ...fragment.operatorActions],
    statuses: [...(completionInput.statuses || []), ...fragment.statuses],
    memberOutcomes: fragment.memberOutcomes,
  };
}

// Emit once per aggregated event. Telemetry must never abort a migration, so failures are
// counted and returned, not thrown.
async function emitMemberTelemetry(events, record) {
  let emitted = 0;
  const failed = [];
  for (const event of events || []) {
    try {
      await record(event);
      emitted += 1;
    } catch (error) {
      failed.push({ event_type: event.event_type, error: String(error && error.message).slice(0, 200) });
    }
  }
  return { emitted, failed };
}

module.exports = {
  MEMBER_POPULATION_FILE,
  POPULATION_BASIS,
  SELECTION_MODES,
  SNAPSHOT_MISSING,
  TELEMETRY_SKILL,
  TELEMETRY_STAGE,
  validateMemberPopulation,
  readMemberPopulation,
  buildMemberPopulation,
  writeMemberPopulation,
  foldMemberJournal,
  buildStartedRow,
  buildMemberTerminalRow,
  selectMemberRecords,
  runMemberPass,
  projectMemberCompletion,
  projectMemberPass,
  mergeMemberCompletion,
  emitMemberTelemetry,
};
