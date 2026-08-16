'use strict';

// Wix BI sink for the telemetry recorder — the one transport path (spec 0007).
//
// Wire format (proven end-to-end 2026-07-26, see research/bi-ingestion-surface.md):
// POST https://frog.wix.com/migration-data-validator with a JSON batch envelope
//   {"dt":0,"g":{"src":10,"evid":<evid>},"e":[{"dt":0,"f":{...fields}}]}
// capped at 100 events / ~240KB per request. No transport auth — identity is the
// claim-based `logged_user_id` field, routing every row to events.dbo.users_10.
//
// Three hard rules, each a silent-drop trap (2xx with no row, or NULL columns):
//   1. Schema fields go up in camelCase (`runId`, `errorType`, ...) — the catcher
//      matches registered param names, not the snake_case Trino column names.
//      Standard identity fields stay snake_case (`logged_user_id`).
//   2. Every GUID-typed field must be a real GUID; a non-hex value fails
//      validation before routing and drops the whole event.
//   3. Every row carries `logged_user_id` = the operator's wix_user_id (GUID).
//
// frog's HTTP status is not an ingestion receipt — only a Trino read-back proves
// arrival. The recorder treats any non-2xx or network error as a push failure
// (journaled into telemetry_health); a 2xx merely means "handed to frog".
//
// Env switches (tests / offline dev only — production runs always emit):
//   RP_TELEMETRY_BI_ENDPOINT   override the frog endpoint (contract-test mock)
//   RP_TELEMETRY_BI_DISABLED=1 skip all pushes entirely

const SRC = 10;
const EVID_RUN = 5012; // replatform_run — run-grain lifecycle, phase started|finalized
const EVID_RUN_EVENT = 5013; // replatform_run_event — one row per observation class
const DEFAULT_ENDPOINT = 'https://frog.wix.com/migration-data-validator';
const MAX_EVENTS_PER_REQUEST = 100;
const MAX_BODY_BYTES = 240 * 1024;
const PUSH_TIMEOUT_MS = 8000;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuid(value) {
  return typeof value === 'string' && GUID_RE.test(value);
}

function disabled() {
  return process.env.RP_TELEMETRY_BI_DISABLED === '1';
}

function endpoint() {
  return process.env.RP_TELEMETRY_BI_ENDPOINT || DEFAULT_ENDPOINT;
}

// Empty-value convention: unknown fields are omitted, never sent as null/"".
// JSON-typed schema fields (arrays/objects) are JSON-serialized into their value.
// GUID-typed fields are dropped unless they hold a real GUID (hard rule 2 —
// sending a non-GUID would silently drop the whole event, not just the field).
function put(fields, key, value, { json = false, guid = false } = {}) {
  if (value === undefined || value === null) return;
  if (guid && !isGuid(value)) return;
  fields[key] = json ? JSON.stringify(value) : value;
}

// `replatform_run` phase:started — built from the journal's run_start record, so
// its content is a pure function of run start and re-pushes are byte-identical
// (dedup key: (run_id, phase), latest row wins). `wixUserId` is the one late
// addition: identity may arrive via a later dims call, and the row is only
// sendable once it has (rule 3), so it rides along when known.
function startedRunRow(runStart, wixUserId) {
  const dims = runStart.dims || {};
  const f = { phase: 'started' };
  put(f, 'runId', runStart.run_id, { guid: true });
  put(f, 'projectId', runStart.project_id);
  put(f, 'attempt', runStart.attempt);
  put(f, 'sessionCount', 1);
  put(f, 'schemaVersions', runStart.schema_version);
  put(f, 'skillsVersion', runStart.skills_version);
  put(f, 'runtimeEnv', runStart.runtime_env, { json: true });
  put(f, 'wixUserId', wixUserId, { guid: true });
  put(f, 'sourcePlatform', dims.source_platform);
  put(f, 'sourcePlatformVersion', dims.source_platform_version);
  put(f, 'sourceExtensions', dims.source_extensions, { json: true });
  put(f, 'sourceSiteUrl', dims.source_site_url);
  put(f, 'sourceAcquisition', dims.source_acquisition);
  put(f, 'deliveryMode', dims.delivery_mode);
  put(f, 'destinationStrategy', dims.destination_strategy);
  put(f, 'runStarted', runStart.ts);
  return { evid: EVID_RUN, fields: f };
}

// `replatform_run` phase:finalized — the complete rollup. Local names map to the
// as-registered BI names here and nowhere else (spec 0007, Registration notes):
// schema_version→schemaVersions, verification→verificationType. skills_commit is
// local-only (not a registered BI column) and deliberately not sent.
function finalizedRunRow(rollup) {
  const f = { phase: 'finalized' };
  put(f, 'runId', rollup.run_id, { guid: true });
  put(f, 'projectId', rollup.project_id);
  put(f, 'attempt', rollup.attempt);
  put(f, 'sessionCount', rollup.session_count);
  put(f, 'schemaVersions', rollup.schema_version);
  put(f, 'skillsVersion', rollup.skills_version);
  put(f, 'runtimeEnv', rollup.runtime_env, { json: true });
  put(f, 'wixUserId', rollup.wix_user_id, { guid: true });
  put(f, 'siteId', rollup.site_id, { guid: true });
  put(f, 'sourcePlatform', rollup.source_platform);
  put(f, 'sourcePlatformVersion', rollup.source_platform_version);
  put(f, 'sourceExtensions', rollup.source_extensions, { json: true });
  put(f, 'sourceSiteUrl', rollup.source_site_url);
  put(f, 'sourceAcquisition', rollup.source_acquisition);
  put(f, 'deliveryMode', rollup.delivery_mode);
  put(f, 'destinationStrategy', rollup.destination_strategy);
  put(f, 'terminalState', rollup.terminal_state);
  put(f, 'stoppedAtStage', rollup.stopped_at_stage);
  put(f, 'stages', rollup.stages, { json: true });
  put(f, 'volumes', rollup.volumes, { json: true });
  put(f, 'verificationType', rollup.verification, { json: true });
  put(f, 'operatorAcceptance', rollup.operator_acceptance);
  put(f, 'telemetryHealth', rollup.telemetry_health, { json: true });
  put(f, 'eventCountByType', rollup.event_count_by_type, { json: true });
  put(f, 'activeMs', rollup.active_ms);
  put(f, 'waitingMs', rollup.waiting_ms);
  put(f, 'runStarted', rollup.run_started);
  put(f, 'runEnded', rollup.run_ended);
  put(f, 'bundleManifest', rollup.bundle_manifest, { json: true });
  return { evid: EVID_RUN, fields: f };
}

// `replatform_run_event` — one row per folded observation class. Re-pushing a
// class after more occurrences folded in is by design: the dedup key is
// (run_id, seq) and the latest row carries the cumulative count. Renames:
// event_type→eventTypeName, error_code→errorType, expected/actual→
// expectedSkill/actualSkill.
function eventRow(folded) {
  const f = {};
  put(f, 'runId', folded.run_id, { guid: true });
  put(f, 'seq', folded.seq);
  put(f, 'count', folded.count);
  put(f, 'stage', folded.stage);
  put(f, 'skill', folded.skill);
  put(f, 'eventTypeName', folded.event_type);
  put(f, 'subtype', folded.subtype);
  put(f, 'entityType', folded.entity_type);
  put(f, 'severity', folded.severity);
  put(f, 'wixApiSurface', folded.wix_api_surface);
  put(f, 'sourceApiSurface', folded.source_api_surface);
  put(f, 'wixAppId', folded.wix_app_id, { guid: true });
  put(f, 'errorType', folded.error_code);
  put(f, 'decisionPoint', folded.decision_point);
  put(f, 'retryCount', folded.retry_count);
  put(f, 'recovered', folded.recovered);
  put(f, 'whatHappened', folded.what_happened);
  put(f, 'expectedSkill', folded.expected);
  put(f, 'actualSkill', folded.actual);
  put(f, 'observedShapes', folded.observed_shapes, { json: true });
  put(f, 'shapesSeen', folded.shapes_seen);
  put(f, 'evidenceRefs', folded.evidence_refs, { json: true });
  return { evid: EVID_RUN_EVENT, fields: f };
}

function envelopeBody(evid, events) {
  return JSON.stringify({ dt: 0, g: { src: SRC, evid }, e: events });
}

// A single event over the body cap sheds its unbounded-ish JSON fields before
// being declared unsendable. Truncation is surfaced (telemetry_health flag),
// never silent.
const SHEDDABLE_FIELDS = ['observedShapes', 'evidenceRefs', 'bundleManifest', 'stages', 'volumes'];

function shedOversize(event) {
  const f = { ...event.f };
  let shed = false;
  for (const key of SHEDDABLE_FIELDS) {
    if (f[key] === undefined) continue;
    delete f[key];
    shed = true;
  }
  return shed ? { ...event, f } : null;
}

async function sendBatch(evid, events) {
  const body = envelopeBody(evid, events);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) return `http_${res.status}`;
    return null;
  } catch (error) {
    return error && error.name === 'TimeoutError' ? 'timeout' : 'network_error';
  }
}

// Push rows (from the builders above) as the given operator. Never throws:
// returns { sent, failures: [{evid, rows, detail}], truncated } and the caller
// journals the failures — telemetry must never block a migration.
async function pushRows(rows, loggedUserId) {
  const out = { sent: 0, failures: [], truncated: 0 };
  if (disabled() || rows.length === 0) return out;
  if (!isGuid(loggedUserId)) {
    out.failures.push({ evid: null, rows: rows.length, detail: 'no_operator_identity' });
    return out;
  }
  const byEvid = new Map();
  for (const row of rows) {
    if (!byEvid.has(row.evid)) byEvid.set(row.evid, []);
    byEvid.get(row.evid).push({ dt: 0, f: { ...row.fields, logged_user_id: loggedUserId } });
  }
  for (const [evid, events] of byEvid) {
    const queue = [events];
    while (queue.length > 0) {
      let chunk = queue.shift();
      if (chunk.length > MAX_EVENTS_PER_REQUEST) {
        const mid = Math.ceil(chunk.length / 2);
        queue.unshift(chunk.slice(0, mid), chunk.slice(mid));
        continue;
      }
      if (Buffer.byteLength(envelopeBody(evid, chunk)) > MAX_BODY_BYTES) {
        if (chunk.length > 1) {
          const mid = Math.ceil(chunk.length / 2);
          queue.unshift(chunk.slice(0, mid), chunk.slice(mid));
          continue;
        }
        const slimmed = shedOversize(chunk[0]);
        if (!slimmed || Buffer.byteLength(envelopeBody(evid, [slimmed])) > MAX_BODY_BYTES) {
          out.failures.push({ evid, rows: 1, detail: 'oversized_event' });
          continue;
        }
        out.truncated += 1;
        chunk = [slimmed];
      }
      const failureDetail = await sendBatch(evid, chunk);
      if (failureDetail) out.failures.push({ evid, rows: chunk.length, detail: failureDetail });
      else out.sent += chunk.length;
    }
  }
  return out;
}

module.exports = {
  SRC,
  EVID_RUN,
  EVID_RUN_EVENT,
  MAX_EVENTS_PER_REQUEST,
  MAX_BODY_BYTES,
  isGuid,
  disabled,
  startedRunRow,
  finalizedRunRow,
  eventRow,
  pushRows,
};
