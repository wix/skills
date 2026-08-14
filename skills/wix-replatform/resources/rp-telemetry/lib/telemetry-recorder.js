'use strict';

// Telemetry recorder for RePlatform migration runs.
//
// The recorder owns everything mechanical and error-prone: schema validation
// (enums, subtype-per-event-type), timestamping, per-class event aggregation,
// the run/attempt/session resume model, the mechanical privacy scrub, atomic
// journal appends, and the well-formedness gate at finalize. The rp-telemetry
// companion skill carries judgment only (what to record, which subtype,
// observation-only prose) and always persists through this module — the signal
// layer is never hand-written.
//
// Storage layout, per migration project:
//   telemetry/events.jsonl                          append-only journal of the
//                                                   current (unfinalized) run
//   run-telemetry.json                              latest finalized signal doc
//   telemetry/runs/run-<attempt>-<run_id>.json      archived finalized signal docs
//   telemetry/runs/run-<attempt>-<run_id>.jsonl     archived raw journals
//
// The journal is the source of truth during a run; the finalized document is a
// pure function of the journal (assembleDocument), so a crash between the
// finalize append and the document write is recoverable on the next call.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const biSink = require('./bi-sink.js');

// 1.1.0 — added `skills_commit` to the run-start record and rollup (additive).
// 1.2.0 — BI sink (spec 0007): added `telemetry_health.bi_push_failures`, the
//         `bi_push_failed`/`bi_push_truncated` journal record types (additive;
//         readers per the external reader contract skip unknown record types).
const TELEMETRY_SCHEMA_VERSION = '1.2.0';
const FREE_TEXT_MAX = 400;
const SHAPES_KEPT_PER_CLASS = 3;
const SHAPES_MAX_PER_CALL = 10;
const EVIDENCE_REFS_MAX = 5;
// A resume gap below this is treated as in-session noise, not a wait interval.
const IMPLICIT_WAIT_MIN_MS = 60 * 1000;
// A wait at least this long with no halt_needs_user event in its stage means the
// capture lost *why* the run stalled — flagged at finalize, never silent.
const WAIT_WITHOUT_HALT_FLAG_MS = 5 * 60 * 1000;
// Metered durations may legitimately overlap slightly with elapsed time (clock granularity,
// concurrent API calls inside one stage), so allow modest slack before calling it a contradiction.
const OVER_ATTRIBUTION_TOLERANCE = 1.25;
// Absolute slack on top of the ratio, so a very short stage is not flagged over a few hundred ms.
const OVER_ATTRIBUTION_FLOOR_MS = 5 * 1000;
const EVIDENCE_SIZE_FLAG_BYTES = 2 * 1024 * 1024;

const STAGES = [
  'config', 'discovery', 'mcp_gate', 'mapping', 'mapping_review', 'setup_discovery',
  'codegen', 'approval_gate', 'setup_provisioning', 'storefront_build', 'extract',
  'import', 'finish',
];
const STAGE_OUTCOMES = ['passed', 'halted', 'failed', 'skipped'];
const TERMINAL_STATES = ['completed', 'halted_needs_user', 'failed', 'abandoned_by_user'];
const SEVERITIES = ['blocking', 'degraded', 'cosmetic', 'info'];
const SOURCE_PLATFORMS = ['wordpress', 'woocommerce', 'shopify', 'csv', 'other'];
const DELIVERY_MODES = ['management', 'website'];
const DESTINATION_STRATEGIES = ['new_site', 'existing_site'];
const OPERATOR_ACCEPTANCE = ['accepted', 'rework_needed', 'rejected', 'unknown'];
const VOLUME_TARGETS = ['native', 'cms', 'none'];
const VERIFICATION_METHODS = ['query_back', 'route_check', 'manual_inspection'];

const EVENT_SUBTYPES = {
  halt_needs_user: ['missing_input', 'manual_only', 'systemic_failure'],
  manual_action_required: ['plan_or_billing', 'dashboard_only', 'external_dependency', 'other'],
  error: null,
  fidelity_loss: ['dropped_field', 'unverified_enum', 'no_target', 'coerced_value'],
  api_gap: ['missing_api', 'missing_capability', 'internal_only', 'other'],
  skill_coverage_gap: ['guessed_value', 'undocumented_workaround', 'ambiguous_instruction', 'path_not_covered'],
  user_decision: ['accepted', 'declined', 'deferred', 'amended'],
  pipeline_defect: ['state_inconsistency', 'ordering_violation', 'record_defect', 'other'],
};
const EVENT_TYPES = Object.keys(EVENT_SUBTYPES);

// Privacy tiers travel with the record so no sink can ignore them. Floors, not
// defaults: identifying:* fields are never transmitted raw without the
// pseudonymization floor or the locus-appropriate authority.
const FIELD_TIERS = {
  'rollup.source_site_url': 'identifying:client',
  'rollup.wix_user_id': 'identifying:operator',
  '*': 'behavioral',
};

const OUTCOME_FOR_TERMINAL = {
  completed: 'passed',
  failed: 'failed',
  halted_needs_user: 'halted',
  abandoned_by_user: 'halted',
};

// Last-line-of-defense scrub over free text, shape field names, and locators.
// Order matters: broader assignment/JWT shapes before generic opaque strings.
const SCRUB_PATTERNS = [
  ['secret_assignment', /\b(?:token|secret|password|passwd|api[_-]?key|authorization|bearer)\b\s*[:=]\s*\S+/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,}){1,4}\b/g],
  ['url', /\b(?:https?|ftp):\/\/\S+/gi],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g],
  ['opaque', /(?=[A-Za-z0-9+/_-]*[0-9])[A-Za-z0-9+/_-]{32,}={0,2}/g],
];

class ValidationError extends Error {
  constructor(errors, hint) {
    super(Array.isArray(errors) ? errors.join('; ') : String(errors));
    this.name = 'ValidationError';
    this.errors = Array.isArray(errors) ? errors : [String(errors)];
    this.hint = hint || null;
  }
}

function nowIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string') return new Date(now).toISOString();
  return new Date().toISOString();
}

function tsMs(iso) {
  return Date.parse(iso);
}

function telemetryDir(projectDir) {
  return path.join(projectDir, 'telemetry');
}

function journalPath(projectDir) {
  return path.join(telemetryDir(projectDir), 'events.jsonl');
}

function runsDir(projectDir) {
  return path.join(telemetryDir(projectDir), 'runs');
}

function signalPath(projectDir) {
  return path.join(projectDir, 'run-telemetry.json');
}

function scrubText(value) {
  let hits = 0;
  let text = String(value);
  for (const [name, re] of SCRUB_PATTERNS) {
    text = text.replace(re, () => {
      hits += 1;
      return `[scrubbed:${name}]`;
    });
  }
  return { text, hits };
}

function normalizeToken(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checkEnum(errors, field, value, allowed) {
  if (!allowed.includes(value)) {
    errors.push(`${field} must be one of: ${allowed.join(', ')} (got: ${JSON.stringify(value)})`);
    return false;
  }
  return true;
}

function checkBoundedText(errors, field, value, { required = false, max = FREE_TEXT_MAX } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field} is required (a sentence or two, observation-only)`);
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  if (value.length > max) {
    errors.push(`${field} exceeds ${max} chars (got ${value.length}) — keep it to a sentence or two; the coded fields carry the structure`);
    return null;
  }
  return value.trim();
}

function checkApiSurface(errors, field, value) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  if (/:\/\//.test(str) || /[?\s]/.test(str)) {
    errors.push(`${field} must be an API/endpoint class like "stores/v3" or "wp/v2/posts", never a URL (URLs can embed auth)`);
    return null;
  }
  if (str.length > 64 || !/^[A-Za-z0-9/_.:-]+$/.test(str)) {
    errors.push(`${field} must be a short endpoint class matching [A-Za-z0-9/_.:-], max 64 chars`);
    return null;
  }
  return str;
}

function checkOpaqueId(errors, field, value, { max = 64 } = {}) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  if (/[\s]/.test(str) || /:\/\//.test(str) || str.length > max) {
    errors.push(`${field} must be an opaque identifier (no whitespace, no URL), max ${max} chars`);
    return null;
  }
  return str;
}

function checkCount(errors, field, value, { defaultValue = 0, min = 0 } = {}) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < min) {
    errors.push(`${field} must be an integer >= ${min}`);
    return defaultValue;
  }
  return value;
}

function normalizeOrigin(errors, value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push('source_site_url must be an http(s) URL');
      return null;
    }
    // Bare origin only — drops path, query, and any embedded credentials.
    return `${url.protocol}//${url.host}`;
  } catch {
    errors.push(`source_site_url is not a parseable URL: ${JSON.stringify(String(value))}`);
    return null;
  }
}

function sanitizeShapeValue(value, errors, keyPath, depth, counter) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 64) {
      errors.push(`observed_shapes${keyPath} string value exceeds 64 chars — shapes carry field names and types, never record values`);
      return null;
    }
    const { text, hits } = scrubText(value);
    counter.hits += hits;
    return text;
  }
  if (depth >= 4) {
    errors.push(`observed_shapes${keyPath} nests deeper than 4 levels`);
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => sanitizeShapeValue(item, errors, `${keyPath}[${i}]`, depth + 1, counter));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // Custom field names on a client site can themselves be identifying.
      const { text, hits } = scrubText(key);
      counter.hits += hits;
      out[text] = sanitizeShapeValue(item, errors, `${keyPath}.${key}`, depth + 1, counter);
    }
    return out;
  }
  errors.push(`observed_shapes${keyPath} has unsupported value type ${typeof value}`);
  return null;
}

function validateEvidenceRefs(errors, value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('evidence_refs must be a non-empty array of {artifact, locator?} or omitted');
    return null;
  }
  if (value.length > EVIDENCE_REFS_MAX) {
    errors.push(`evidence_refs is capped at ${EVIDENCE_REFS_MAX} sample refs per event`);
    return null;
  }
  const refs = [];
  for (const [i, ref] of value.entries()) {
    if (!ref || typeof ref !== 'object' || typeof ref.artifact !== 'string') {
      errors.push(`evidence_refs[${i}] must be {artifact: <project-relative path>, locator?: <heading/anchor>}`);
      continue;
    }
    const artifact = ref.artifact.replace(/\\/g, '/');
    if (path.isAbsolute(artifact) || artifact.split('/').includes('..')) {
      errors.push(`evidence_refs[${i}].artifact must be a project-root-relative path (no absolute paths, no ..)`);
      continue;
    }
    if (/(^|\/)config\//.test(artifact) || artifact.endsWith('.env')) {
      errors.push(`evidence_refs[${i}].artifact must never point at secret-bearing config files`);
      continue;
    }
    let locator = null;
    if (ref.locator !== undefined && ref.locator !== null) {
      if (typeof ref.locator !== 'string' || ref.locator.length > 120) {
        errors.push(`evidence_refs[${i}].locator must be a string of at most 120 chars (prefer a section heading — line ranges break on regeneration)`);
        continue;
      }
      locator = scrubText(ref.locator).text;
    }
    refs.push({ artifact, locator });
  }
  return refs;
}

// --- dimension (rollup identity) fields -------------------------------------

// --- cost/latency metering -------------------------------------------------
// Duration fields split `active_ms` into its three real components. Before this existed,
// active_ms was a single wall-clock number fusing agent reasoning, subprocess execution, remote
// API latency and defect-repair time — which made it impossible to localize a bottleneck.
//
// Anything NOT attributed by a meter call stays visible as `unattributed_ms`. That is deliberate:
// a partially-metered stage must not look fully explained.
const METER_DURATION_KEYS = ['model_ms', 'api_ms', 'script_ms'];
const METER_COUNT_KEYS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'api_calls', 'api_retries'];
const METER_ALLOWED_KEYS = new Set([...METER_DURATION_KEYS, ...METER_COUNT_KEYS, 'stage']);

function validateMeter(input, { openStage, lastStage }) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['meter payload must be a JSON object']);
  }
  for (const key of Object.keys(input)) {
    if (!METER_ALLOWED_KEYS.has(key)) {
      errors.push(`unknown meter field: ${key} (allowed: ${[...METER_ALLOWED_KEYS].join(', ')})`);
    }
  }
  const stageName = input.stage || openStage || lastStage;
  if (!stageName) errors.push('no stage is open and none was named; pass --stage <stage>');
  else checkEnum(errors, 'stage', stageName, STAGES);

  const out = { stage: stageName };
  let any = false;
  for (const key of [...METER_DURATION_KEYS, ...METER_COUNT_KEYS]) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = input[key];
    if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
      errors.push(`${key} must be a non-negative integer`);
      continue;
    }
    out[key] = value;
    any = true;
  }
  if (!any) errors.push(`meter needs at least one measurement (${[...METER_DURATION_KEYS, ...METER_COUNT_KEYS].join(', ')})`);
  if (errors.length > 0) {
    throw new ValidationError(errors, 'meter records measured numbers only — never estimate them by hand');
  }
  return out;
}

// A pricing snapshot makes historical cost recomputable when list prices change. Rates are per
// MILLION tokens, matching how model pricing is published.
function validatePricingSnapshot(errors, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('model_pricing_snapshot must be an object of { <model>: { input_per_mtok, output_per_mtok, ... } }');
    return undefined;
  }
  const out = {};
  const rateKeys = ['input_per_mtok', 'output_per_mtok', 'cache_read_per_mtok', 'cache_write_per_mtok'];
  for (const [model, rates] of Object.entries(value)) {
    if (typeof model !== 'string' || model.length > 64) {
      errors.push('model_pricing_snapshot keys must be short model ids');
      continue;
    }
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) {
      errors.push(`model_pricing_snapshot.${model} must be an object of numeric rates`);
      continue;
    }
    const entry = {};
    for (const [key, rate] of Object.entries(rates)) {
      if (!rateKeys.includes(key)) {
        errors.push(`model_pricing_snapshot.${model}.${key} is not a known rate (allowed: ${rateKeys.join(', ')})`);
        continue;
      }
      if (!Number.isFinite(rate) || rate < 0) {
        errors.push(`model_pricing_snapshot.${model}.${key} must be a non-negative number`);
        continue;
      }
      entry[key] = rate;
    }
    out[model] = entry;
  }
  return out;
}

const DIM_VALIDATORS = {
  model_pricing_snapshot: (errors, v) => validatePricingSnapshot(errors, v),
  source_platform: (errors, v) => (checkEnum(errors, 'source_platform', v, SOURCE_PLATFORMS) ? v : undefined),
  source_platform_version: (errors, v) => {
    if (typeof v !== 'string' || v.length > 32) {
      errors.push('source_platform_version must be a short version string');
      return undefined;
    }
    return v;
  },
  source_site_url: (errors, v) => {
    const origin = normalizeOrigin(errors, v);
    return origin === null ? undefined : origin;
  },
  source_extensions: (errors, v) => {
    if (!Array.isArray(v) || v.length > 64 || v.some((item) => typeof item !== 'string' || item.length > 48)) {
      errors.push('source_extensions must be an array of short extension/plugin class names');
      return undefined;
    }
    return [...new Set(v.map(normalizeToken).filter(Boolean))];
  },
  source_acquisition: (errors, v) => {
    const token = normalizeToken(v);
    if (!token || token.length > 32) {
      errors.push('source_acquisition must be a short class token, e.g. admin_api | public_storefront | file_export');
      return undefined;
    }
    return token;
  },
  delivery_mode: (errors, v) => (checkEnum(errors, 'delivery_mode', v, DELIVERY_MODES) ? v : undefined),
  destination_strategy: (errors, v) => (checkEnum(errors, 'destination_strategy', v, DESTINATION_STRATEGIES) ? v : undefined),
  site_id: (errors, v) => {
    const id = checkOpaqueId(errors, 'site_id', v);
    return id === null ? undefined : id;
  },
  wix_user_id: (errors, v) => {
    const id = checkOpaqueId(errors, 'wix_user_id', v);
    return id === null ? undefined : id;
  },
  skills_version: (errors, v) => {
    if (typeof v !== 'string' || v.length > 32) {
      errors.push('skills_version must be a short version string');
      return undefined;
    }
    return v.trim();
  },
  skills_commit: (errors, v) => {
    if (typeof v !== 'string' || !/^[0-9a-f]{7,40}$/.test(v.trim())) {
      errors.push('skills_commit must be a git commit SHA (7-40 hex chars)');
      return undefined;
    }
    return v.trim();
  },
  runtime_env: (errors, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      errors.push('runtime_env must be an object with {os?, node_version?, agent_runtime?, model?}');
      return undefined;
    }
    const out = {};
    for (const key of ['os', 'node_version', 'agent_runtime', 'model']) {
      if (v[key] === undefined || v[key] === null) continue;
      if (typeof v[key] !== 'string' || v[key].length > 64 || /[/\\]/.test(v[key])) {
        errors.push(`runtime_env.${key} must be a coarse platform fact (short string, no paths)`);
        continue;
      }
      out[key] = v[key];
    }
    const unknown = Object.keys(v).filter((k) => !['os', 'node_version', 'agent_runtime', 'model'].includes(k));
    if (unknown.length > 0) {
      errors.push(`runtime_env has unknown keys: ${unknown.join(', ')}`);
      return undefined;
    }
    return out;
  },
};

function validateDims(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['dimensions must be a JSON object']);
  }
  const errors = [];
  const dims = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const validator = DIM_VALIDATORS[key];
    if (!validator) {
      errors.push(`unknown dimension field: ${key} (allowed: ${Object.keys(DIM_VALIDATORS).join(', ')})`);
      continue;
    }
    const normalized = validator(errors, value);
    if (normalized !== undefined) dims[key] = normalized;
  }
  if (errors.length > 0) throw new ValidationError(errors);
  return dims;
}

// --- event validation --------------------------------------------------------

const EVENT_ALLOWED_KEYS = new Set([
  'event_type', 'subtype', 'stage', 'skill', 'entity_type', 'severity',
  'wix_api_surface', 'source_api_surface', 'wix_app_id', 'error_code',
  'what_happened', 'expected', 'actual', 'observed_shapes', 'evidence_refs',
  'count', 'retry_count', 'recovered', 'decision_point',
]);

function validateEvent(input, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['event must be a JSON object']);
  }
  const errors = [];
  const scrub = { hits: 0 };

  for (const key of Object.keys(input)) {
    if (!EVENT_ALLOWED_KEYS.has(key)) {
      errors.push(`unknown event field: ${key} — there is deliberately no fix/root_cause/recommendation field; record the observation only`);
    }
  }

  const eventType = input.event_type;
  checkEnum(errors, 'event_type', eventType, EVENT_TYPES);

  let subtype = null;
  if (EVENT_SUBTYPES[eventType] === null) {
    if (input.subtype !== undefined && input.subtype !== null) {
      errors.push(`event_type ${eventType} defines no subtypes (error_code is its discriminator)`);
    }
  } else if (EVENT_SUBTYPES[eventType]) {
    if (checkEnum(errors, `subtype (for ${eventType})`, input.subtype, EVENT_SUBTYPES[eventType])) {
      subtype = input.subtype;
    }
  }

  let stage = input.stage;
  if (stage === undefined || stage === null) {
    stage = context.openStage || context.lastStage || null;
    if (!stage) {
      errors.push('stage is required (no stage has been started yet to default to)');
    }
  } else {
    checkEnum(errors, 'stage', stage, STAGES);
  }

  if (typeof input.skill !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.skill)) {
    errors.push('skill is required — the active rp-* resource (e.g. "rp-mapper") or "replatform"');
  }

  checkEnum(errors, 'severity', input.severity, SEVERITIES);

  let entityType = null;
  if (input.entity_type !== undefined && input.entity_type !== null) {
    entityType = normalizeToken(input.entity_type);
    if (!entityType || entityType.length > 32) {
      errors.push('entity_type must be a short entity class token (e.g. product, post, media)');
      entityType = null;
    }
  }

  const wixApiSurface = checkApiSurface(errors, 'wix_api_surface', input.wix_api_surface);
  const sourceApiSurface = checkApiSurface(errors, 'source_api_surface', input.source_api_surface);
  const wixAppId = checkOpaqueId(errors, 'wix_app_id', input.wix_app_id);

  let errorCode = null;
  if (input.error_code !== undefined && input.error_code !== null) {
    const str = String(input.error_code);
    if (str.length > 48 || /\s/.test(str)) {
      errors.push('error_code must be a short machine code (e.g. 428, WDE0110)');
    } else {
      errorCode = str;
    }
  }
  if (eventType === 'error' && errorCode === null) {
    errors.push('error events require error_code — it is the discriminator for this type');
  }
  if (eventType === 'api_gap' && wixApiSurface === null) {
    errors.push('api_gap events require wix_api_surface — it is part of the stable signature');
  }

  const whatHappened = checkBoundedText(errors, 'what_happened', input.what_happened, { required: true });
  const expected = checkBoundedText(errors, 'expected', input.expected);
  const actual = checkBoundedText(errors, 'actual', input.actual);

  const count = checkCount(errors, 'count', input.count, { defaultValue: 1, min: 1 });

  let retryCount;
  let recovered;
  if (eventType === 'error') {
    retryCount = checkCount(errors, 'retry_count', input.retry_count, { defaultValue: 0, min: 0 });
    recovered = input.recovered === undefined || input.recovered === null ? false : input.recovered;
    if (typeof recovered !== 'boolean') {
      errors.push('recovered must be a boolean');
      recovered = false;
    }
  } else {
    if (input.retry_count !== undefined || input.recovered !== undefined) {
      errors.push('retry_count/recovered are only valid on error events');
    }
  }

  let decisionPoint;
  if (eventType === 'user_decision') {
    decisionPoint = typeof input.decision_point === 'string' ? normalizeToken(input.decision_point) : '';
    if (!decisionPoint || decisionPoint.length > 48) {
      errors.push('user_decision events require decision_point — which checkpoint or fork (e.g. mapping_review, approval_gate)');
    }
  } else if (input.decision_point !== undefined) {
    errors.push('decision_point is only valid on user_decision events');
  }

  let observedShapes = null;
  if (input.observed_shapes !== undefined && input.observed_shapes !== null) {
    if (!Array.isArray(input.observed_shapes) || input.observed_shapes.length === 0) {
      errors.push('observed_shapes must be a non-empty array of sanitized shape objects or omitted');
    } else if (input.observed_shapes.length > SHAPES_MAX_PER_CALL) {
      errors.push(`observed_shapes is capped at ${SHAPES_MAX_PER_CALL} shapes per call (folding keeps ${SHAPES_KEPT_PER_CLASS} distinct per class)`);
    } else {
      observedShapes = input.observed_shapes.map((shape, i) => {
        if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
          errors.push(`observed_shapes[${i}] must be an object of field names and types`);
          return null;
        }
        return sanitizeShapeValue(shape, errors, `[${i}]`, 0, scrub);
      });
    }
  }

  const evidenceRefs = validateEvidenceRefs(errors, input.evidence_refs);

  if (errors.length > 0) {
    throw new ValidationError(errors, classKeyFor({
      event_type: eventType, stage, entity_type: entityType, wix_api_surface: wixApiSurface,
      source_api_surface: sourceApiSurface, wix_app_id: wixAppId, error_code: errorCode,
      subtype, decision_point: decisionPoint,
    }));
  }

  const scrubbedWhat = scrubText(whatHappened);
  const scrubbedExpected = expected === null ? null : scrubText(expected);
  const scrubbedActual = actual === null ? null : scrubText(actual);
  scrub.hits += scrubbedWhat.hits + (scrubbedExpected ? scrubbedExpected.hits : 0) + (scrubbedActual ? scrubbedActual.hits : 0);

  const event = {
    event_type: eventType,
    subtype,
    stage,
    skill: input.skill,
    entity_type: entityType,
    severity: input.severity,
    wix_api_surface: wixApiSurface,
    source_api_surface: sourceApiSurface,
    wix_app_id: wixAppId,
    error_code: errorCode,
    what_happened: scrubbedWhat.text,
    expected: scrubbedExpected ? scrubbedExpected.text : null,
    actual: scrubbedActual ? scrubbedActual.text : null,
    observed_shapes: observedShapes,
    evidence_refs: evidenceRefs,
    count,
  };
  if (eventType === 'error') {
    event.retry_count = retryCount;
    event.recovered = recovered;
  }
  if (eventType === 'user_decision') {
    event.decision_point = decisionPoint;
  }
  return { event, classKey: classKeyFor(event), scrubHits: scrub.hits };
}

function classKeyFor(event) {
  const parts = [
    event.event_type, event.stage, event.entity_type, event.wix_api_surface,
    event.source_api_surface, event.wix_app_id, event.error_code, event.subtype,
  ];
  if (event.event_type === 'user_decision') parts.push(event.decision_point);
  return parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
}

// --- rollup (finalize) validation --------------------------------------------

function validateVolumes(errors, input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    errors.push('volumes must be an array of per-entity-type volume records');
    return [];
  }
  const volumes = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`volumes[${i}] must be an object`);
      continue;
    }
    const entityType = typeof raw.entity_type === 'string' ? normalizeToken(raw.entity_type) : '';
    if (!entityType) {
      errors.push(`volumes[${i}].entity_type is required`);
      continue;
    }
    let target = null;
    if (raw.target !== undefined && raw.target !== null) {
      if (checkEnum(errors, `volumes[${i}].target`, raw.target, VOLUME_TARGETS)) target = raw.target;
    }
    const targetSurface = checkApiSurface(errors, `volumes[${i}].target_surface`, raw.target_surface);
    const volume = {
      entity_type: entityType,
      target,
      target_surface: targetSurface,
      discovered: checkCount(errors, `volumes[${i}].discovered`, raw.discovered),
      planned: raw.planned === undefined || raw.planned === null
        ? null
        : checkCount(errors, `volumes[${i}].planned`, raw.planned),
      attempted: checkCount(errors, `volumes[${i}].attempted`, raw.attempted),
      succeeded: checkCount(errors, `volumes[${i}].succeeded`, raw.succeeded),
      failed: checkCount(errors, `volumes[${i}].failed`, raw.failed),
      skipped: checkCount(errors, `volumes[${i}].skipped`, raw.skipped),
      already_imported: checkCount(errors, `volumes[${i}].already_imported`, raw.already_imported),
    };
    if (volume.attempted !== volume.succeeded + volume.failed) {
      errors.push(`volumes[${i}] (${entityType}): attempted must equal succeeded + failed (${volume.attempted} != ${volume.succeeded} + ${volume.failed})`);
    }
    volumes.push(volume);
  }
  return volumes;
}

function validateVerification(errors, input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    errors.push('verification must be an array of verification records');
    return [];
  }
  const records = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`verification[${i}] must be an object`);
      continue;
    }
    const subject = typeof raw.subject === 'string' ? normalizeToken(raw.subject) : '';
    if (!subject) {
      errors.push(`verification[${i}].subject is required (an entity_type, or "routes")`);
      continue;
    }
    if (!checkEnum(errors, `verification[${i}].method`, raw.method, VERIFICATION_METHODS)) continue;
    const record = {
      subject,
      method: raw.method,
      checked: checkCount(errors, `verification[${i}].checked`, raw.checked),
      passed: checkCount(errors, `verification[${i}].passed`, raw.passed),
      failed: checkCount(errors, `verification[${i}].failed`, raw.failed),
    };
    if (record.passed + record.failed > record.checked) {
      errors.push(`verification[${i}] (${subject}): passed + failed must not exceed checked`);
    }
    records.push(record);
  }
  return records;
}

function validateFinalizeInput(input, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['finalize payload must be a JSON object']);
  }
  const errors = [];
  const dimKeys = {};
  const known = new Set(['terminal_state', 'stopped_at_stage', 'operator_acceptance', 'volumes', 'verification']);
  for (const [key, value] of Object.entries(input)) {
    if (known.has(key)) continue;
    if (DIM_VALIDATORS[key]) {
      dimKeys[key] = value;
      continue;
    }
    errors.push(`unknown finalize field: ${key}`);
  }

  checkEnum(errors, 'terminal_state', input.terminal_state, TERMINAL_STATES);

  let stoppedAtStage = null;
  if (input.terminal_state === 'completed') {
    if (input.stopped_at_stage !== undefined && input.stopped_at_stage !== null) {
      errors.push('stopped_at_stage must be null when terminal_state is completed');
    }
  } else if (input.stopped_at_stage !== undefined && input.stopped_at_stage !== null) {
    if (checkEnum(errors, 'stopped_at_stage', input.stopped_at_stage, STAGES)) {
      stoppedAtStage = input.stopped_at_stage;
    }
  } else {
    stoppedAtStage = context.openStage || context.lastStage || 'config';
  }

  let operatorAcceptance = 'unknown';
  if (input.operator_acceptance !== undefined && input.operator_acceptance !== null) {
    if (checkEnum(errors, 'operator_acceptance', input.operator_acceptance, OPERATOR_ACCEPTANCE)) {
      operatorAcceptance = input.operator_acceptance;
    }
  }

  const volumes = validateVolumes(errors, input.volumes);
  const verification = validateVerification(errors, input.verification);

  let dims = {};
  try {
    dims = validateDims(dimKeys);
  } catch (error) {
    errors.push(...error.errors);
  }

  if (errors.length > 0) throw new ValidationError(errors);
  return {
    terminal_state: input.terminal_state,
    stopped_at_stage: stoppedAtStage,
    operator_acceptance: operatorAcceptance,
    volumes,
    verification,
    dims,
  };
}

// --- journal ------------------------------------------------------------------

function readJournalFile(file) {
  const records = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

function readJournal(projectDir) {
  const file = journalPath(projectDir);
  if (!fs.existsSync(file)) return null;
  return readJournalFile(file);
}

function appendJournal(projectDir, record) {
  const file = journalPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function replay(records) {
  const state = {
    runStart: null,
    dims: {},
    sessionCount: 1,
    seq: 0,
    events: [],
    rejected: [],
    entries: [],
    waits: [],
    meters: [],
    openStage: null,
    openStageStart: null,
    lastStage: null,
    openWait: null,
    scrubHits: 0,
    biPushFailures: 0,
    biPushTruncated: 0,
    finalize: null,
    lastTs: null,
  };
  for (const record of records) {
    state.seq = Math.max(state.seq, record.seq || 0);
    state.lastTs = record.ts || state.lastTs;
    switch (record.type) {
      case 'run_start':
        state.runStart = record;
        Object.assign(state.dims, record.dims || {});
        break;
      case 'session_start':
        state.sessionCount = record.session;
        break;
      case 'dims':
        Object.assign(state.dims, record.dims || {});
        break;
      case 'stage_start':
        state.openStage = record.stage;
        state.openStageStart = record.ts;
        state.lastStage = record.stage;
        break;
      case 'stage_end':
        if (state.openStage === record.stage) {
          state.entries.push({ stage: record.stage, start: state.openStageStart, end: record.ts, outcome: record.outcome });
          state.openStage = null;
          state.openStageStart = null;
        }
        break;
      case 'wait_start':
        state.openWait = { stage: record.stage, start: record.ts };
        break;
      case 'wait_end':
        if (state.openWait) {
          state.waits.push({ ...state.openWait, end: record.ts });
          state.openWait = null;
        }
        break;
      case 'meter':
        // Accumulate: a stage may be entered more than once, and each generated script reports its
        // own invocation. Summing is the only reading that survives a resume.
        state.meters.push(record.meter);
        break;
      case 'event':
        state.events.push(record);
        state.scrubHits += record.scrub_hits || 0;
        break;
      case 'rejected':
        state.rejected.push(record);
        break;
      case 'bi_push_failed':
        state.biPushFailures += 1;
        break;
      case 'bi_push_truncated':
        state.biPushTruncated += record.rows || 1;
        break;
      case 'finalize':
        state.finalize = record;
        break;
      default:
        break;
    }
  }
  return state;
}

function requireActiveRun(projectDir) {
  const journal = readJournal(projectDir);
  if (!journal) {
    throw new ValidationError(
      ['no active telemetry run in this project'],
      "call `rp-telemetry.js start '<dims-json>'` first",
    );
  }
  const state = replay(journal.records);
  if (!state.runStart) {
    throw new ValidationError(['telemetry journal is corrupt: missing run-start record']);
  }
  if (state.finalize) {
    // A crash after the finalize append but before archival: finish the archival
    // now, then report no active run.
    archiveFinalizedJournal(projectDir, journal, state);
    throw new ValidationError(
      ['the previous run is already finalized'],
      "call `rp-telemetry.js start '<dims-json>'` to open the next run",
    );
  }
  return { journal, state };
}

// --- fold + document assembly ---------------------------------------------------

function foldEvents(eventRecords, runId) {
  const byClass = new Map();
  for (const record of eventRecords) {
    const e = record.event;
    let folded = byClass.get(record.class_key);
    if (!folded) {
      folded = {
        run_id: runId,
        seq: record.seq,
        count: 0,
        stage: e.stage,
        skill: e.skill,
        event_type: e.event_type,
        subtype: e.subtype,
        entity_type: e.entity_type,
        severity: e.severity,
        wix_api_surface: e.wix_api_surface,
        source_api_surface: e.source_api_surface,
        wix_app_id: e.wix_app_id,
        error_code: e.error_code,
        what_happened: e.what_happened,
        expected: e.expected,
        actual: e.actual,
        observed_shapes: null,
        evidence_refs: null,
        _shapes: new Map(),
        _refs: new Map(),
      };
      if (e.event_type === 'error') {
        folded.retry_count = 0;
        folded.recovered = false;
      }
      if (e.event_type === 'user_decision') folded.decision_point = e.decision_point;
      byClass.set(record.class_key, folded);
    }
    folded.count += e.count;
    if (e.event_type === 'error') {
      folded.retry_count += e.retry_count || 0;
      // A retry chain is often recorded per attempt. The latest occurrence knows
      // whether the operation ultimately succeeded, and a recovering occurrence's
      // `actual` carries the change that made it succeed — the first (failing)
      // attempt's fields must never erase that half of the observation.
      folded.recovered = Boolean(e.recovered);
      if (e.recovered && e.actual) folded.actual = e.actual;
    }
    for (const shape of e.observed_shapes || []) {
      const key = stableStringify(shape);
      if (!folded._shapes.has(key)) folded._shapes.set(key, shape);
    }
    for (const ref of e.evidence_refs || []) {
      const key = `${ref.artifact}#${ref.locator || ''}`;
      if (!folded._refs.has(key)) folded._refs.set(key, ref);
    }
  }
  const events = [...byClass.values()].sort((a, b) => a.seq - b.seq);
  for (const event of events) {
    const shapes = [...event._shapes.values()];
    if (shapes.length > 0) {
      event.observed_shapes = shapes.slice(0, SHAPES_KEPT_PER_CLASS);
      // Surfaced bound, never a silent one.
      if (shapes.length > SHAPES_KEPT_PER_CLASS) event.shapes_seen = shapes.length;
    }
    const refs = [...event._refs.values()];
    if (refs.length > 0) event.evidence_refs = refs.slice(0, EVIDENCE_REFS_MAX);
    delete event._shapes;
    delete event._refs;
  }
  return events;
}

// Event types that mean the stage did not run clean. `contained_recovery` is DERIVED from these
// rather than self-reported, because a stage that spent its time debugging is exactly the stage an
// agent is least likely to remember to flag.
const RECOVERY_EVENT_TYPES = new Set(['error', 'pipeline_defect']);

function computeStages(state, finalizeTs) {
  const entries = [...state.entries];
  const waits = [...state.waits];
  if (state.openWait) {
    waits.push({ ...state.openWait, end: finalizeTs });
  }
  const byStage = new Map();
  const order = [];
  const stageRecord = (stage) => {
    if (!byStage.has(stage)) {
      byStage.set(stage, { stage, outcome: 'halted', active_ms: 0, waiting_ms: 0, _entries: [] });
      order.push(stage);
    }
    return byStage.get(stage);
  };
  for (const entry of entries) {
    const record = stageRecord(entry.stage);
    record.outcome = entry.outcome;
    record._entries.push(entry);
  }
  for (const wait of waits) {
    const record = stageRecord(wait.stage || 'config');
    record.waiting_ms += Math.max(0, tsMs(wait.end) - tsMs(wait.start));
  }
  // Metered measurements, summed per stage. A stage named by a meter but never opened still gets a
  // record, so a mis-attributed meter is visible instead of silently discarded.
  for (const meter of state.meters || []) {
    const record = stageRecord(meter.stage);
    for (const key of [...METER_DURATION_KEYS, ...METER_COUNT_KEYS]) {
      if (meter[key] === undefined) continue;
      record[key] = (record[key] || 0) + meter[key];
    }
  }

  // Stages that contained an error or a pipeline defect. Without this, a clean run and a thrash are
  // indistinguishable in the rollup, and every per-stage duration silently includes repair time.
  const recoveryStages = new Set(
    (state.events || [])
      .filter((e) => RECOVERY_EVENT_TYPES.has(e.event && e.event.event_type ? e.event.event_type : e.event_type))
      .map((e) => (e.event && e.event.stage ? e.event.stage : e.stage))
      .filter(Boolean),
  );

  for (const stage of order) {
    const record = byStage.get(stage);
    let active = 0;
    for (const entry of record._entries) {
      active += Math.max(0, tsMs(entry.end) - tsMs(entry.start));
      for (const wait of waits) {
        if ((wait.stage || 'config') !== stage) continue;
        const overlap = Math.min(tsMs(entry.end), tsMs(wait.end)) - Math.max(tsMs(entry.start), tsMs(wait.start));
        if (overlap > 0) active -= overlap;
      }
    }
    record.active_ms = Math.max(0, active);
    record.contained_recovery = recoveryStages.has(stage);
    // The remainder of active_ms that no meter explained. This is the honesty field: it is how much
    // of the stage is still a black box, and it must never be silently folded into a component.
    const attributed = METER_DURATION_KEYS.reduce((sum, key) => sum + (record[key] || 0), 0);
    record.unattributed_ms = Math.max(0, record.active_ms - attributed);
    delete record._entries;
  }
  return order.map((stage) => byStage.get(stage));
}

// Cost is DERIVED from token counts and the pricing snapshot, never recorded as a figure — a stored
// dollar amount silently goes wrong the moment list prices change, while tokens are a fact.
function computeCost(stages, pricingSnapshot, model) {
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  for (const stage of stages) {
    for (const key of Object.keys(totals)) totals[key] += stage[key] || 0;
  }
  const anyTokens = Object.values(totals).some((v) => v > 0);
  const rates = pricingSnapshot && model ? pricingSnapshot[model] : null;
  if (!anyTokens || !rates) {
    return { tokens: totals, estimated_cost_usd: null, cost_basis: rates ? 'no_tokens_recorded' : 'no_pricing_snapshot' };
  }
  const perM = (count, rate) => (rate === undefined ? 0 : (count / 1e6) * rate);
  const usd = perM(totals.input_tokens, rates.input_per_mtok)
    + perM(totals.output_tokens, rates.output_per_mtok)
    + perM(totals.cache_read_tokens, rates.cache_read_per_mtok)
    + perM(totals.cache_write_tokens, rates.cache_write_per_mtok);
  return { tokens: totals, estimated_cost_usd: Number(usd.toFixed(6)), cost_basis: 'derived_from_snapshot' };
}

const MANIFEST_EXCLUDE_DIRS = new Set(['config', 'data', 'preview', 'node_modules', 'frontend', 'telemetry']);
// .ndjson: the pipeline's audit logs (logs/audit-*.ndjson) are spec-named
// evidence — a pipeline_defect deep-dive depends on them being in the bundle.
const MANIFEST_EXTENSIONS = new Set(['.md', '.json', '.jsonl', '.ndjson', '.js', '.mjs', '.cjs', '.ts', '.sh', '.yaml', '.yml']);

function walkEvidence(projectDir) {
  const files = [];
  const walk = (rel) => {
    const abs = rel === '' ? projectDir : path.join(projectDir, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (MANIFEST_EXCLUDE_DIRS.has(entry.name)) continue;
        walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.env')) continue;
      if (relPath === 'run-telemetry.json') continue; // added explicitly, first
      if (!MANIFEST_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push({ path: relPath, bytes: fs.statSync(path.join(projectDir, relPath)).size });
    }
  };
  walk('');
  return files;
}

function assembleDocument(projectDir, records, malformedLines = 0) {
  const state = replay(records);
  state.malformedLines = malformedLines;
  const runStart = state.runStart;
  const payload = state.finalize.payload;
  const finalizeTs = state.finalize.ts;
  const dims = { ...state.dims, ...payload.dims };

  const events = foldEvents(state.events, runStart.run_id);
  const stages = computeStages(state, finalizeTs);
  const activeMs = stages.reduce((sum, s) => sum + s.active_ms, 0);
  const waitingMs = stages.reduce((sum, s) => sum + s.waiting_ms, 0);

  // The headline question this schema exists to answer: how much of the run was deterministic code
  // versus model reasoning. `unattributed_ms` is reported alongside so the split is never mistaken
  // for a complete accounting of active_ms.
  const sumOver = (key) => stages.reduce((sum, s) => sum + (s[key] || 0), 0);
  const agenticMs = sumOver('model_ms');
  const deterministicMs = sumOver('script_ms') + sumOver('api_ms');
  const unattributedMs = sumOver('unattributed_ms');
  const recoveryStages = stages.filter((s) => s.contained_recovery).map((s) => s.stage);
  const cost = computeCost(
    stages,
    dims.model_pricing_snapshot || null,
    (runStart.runtime_env && runStart.runtime_env.model) || (dims.runtime_env && dims.runtime_env.model) || null,
  );
  const timing = {
    active_ms: activeMs,
    waiting_ms: waitingMs,
    agentic_ms: agenticMs,
    deterministic_ms: deterministicMs,
    unattributed_ms: unattributedMs,
    // What fraction of the EXPLAINED time was the model. Null when nothing was metered, rather
    // than a misleading 0.
    agentic_share: agenticMs + deterministicMs > 0
      ? Number((agenticMs / (agenticMs + deterministicMs)).toFixed(4))
      : null,
    api_calls: sumOver('api_calls'),
    api_retries: sumOver('api_retries'),
    stages_with_recovery: recoveryStages,
  };

  const eventCountByType = {};
  for (const event of events) {
    const entry = eventCountByType[event.event_type] || { classes: 0, occurrences: 0 };
    entry.classes += 1;
    entry.occurrences += event.count;
    eventCountByType[event.event_type] = entry;
  }

  const acceptedClasses = new Set(state.events.map((r) => r.class_key));
  const dropped = state.rejected.filter((r) => !r.class_key || !acceptedClasses.has(r.class_key)).length;

  const flags = [];
  const hasEventType = (...types) => events.some((e) => types.includes(e.event_type));
  if (payload.volumes.some((v) => v.failed > 0) && !hasEventType('error')) {
    flags.push('volumes_report_failures_but_no_error_events');
  }
  for (const volume of payload.volumes) {
    if (volume.planned !== null && volume.attempted > volume.planned + volume.already_imported) {
      // Execution diverging from the approved plan must surface mechanically.
      flags.push(`attempted_exceeds_planned:${volume.entity_type}`);
    }
    if (volume.attempted + volume.skipped + volume.already_imported > volume.discovered) {
      flags.push(`volumes_exceed_discovered:${volume.entity_type}`);
    }
  }
  // Metering flags cover data that is WRONG, never data that is merely ABSENT.
  //
  // A run that meters nothing is not unhealthy — it is a runtime that does not report usage, which
  // describes every run recorded before metering existed. Flagging those would fire on ~all
  // historical runs and train readers to ignore the flag list. Absence is already visible, and
  // queryable, in `timing`: `agentic_share` is null and `unattributed_ms` carries the whole stage.
  // So only contradictions are flagged here, and each one implies metering was in use.
  for (const stage of stages) {
    const attributed = METER_DURATION_KEYS.reduce((sum, key) => sum + (stage[key] || 0), 0);
    if (attributed === 0) continue;
    // Partially metered is more dangerous than not metered at all: it looks explained.
    if (stage.unattributed_ms > stage.active_ms * 0.5) {
      flags.push(`stage_mostly_unattributed:${stage.stage}`);
    }
    // Attributed time exceeding elapsed time is impossible, so it means the measurements are wrong:
    // usually the same interval metered twice across a resume, or concurrent work summed serially.
    // unattributed_ms clamps at 0, so without this flag the contradiction would be invisible.
    if (attributed > stage.active_ms * OVER_ATTRIBUTION_TOLERANCE + OVER_ATTRIBUTION_FLOOR_MS) {
      flags.push(`stage_over_attributed:${stage.stage}`);
    }
  }
  if (cost.cost_basis === 'no_pricing_snapshot' && (cost.tokens.input_tokens > 0 || cost.tokens.output_tokens > 0)) {
    flags.push('tokens_recorded_without_pricing_snapshot');
  }
  if (payload.verification.some((v) => v.failed > 0) && !hasEventType('error', 'fidelity_loss')) {
    flags.push('verification_failures_but_no_matching_events');
  }
  if (state.malformedLines > 0) {
    flags.push(`journal_malformed_lines:${state.malformedLines}`);
  }
  if (state.biPushTruncated > 0) {
    flags.push(`bi_push_truncated:${state.biPushTruncated}`);
  }
  // A stalled wait whose stage has no halt_needs_user event lost the "why" of
  // the stall — the single most actionable signal for where runs stall.
  const haltStages = new Set(events.filter((e) => e.event_type === 'halt_needs_user').map((e) => e.stage));
  const allWaits = [...state.waits, ...(state.openWait ? [{ ...state.openWait, end: finalizeTs }] : [])];
  const flaggedWaitStages = new Set();
  for (const w of allWaits) {
    const waitStage = w.stage || 'config';
    if (tsMs(w.end) - tsMs(w.start) < WAIT_WITHOUT_HALT_FLAG_MS) continue;
    if (haltStages.has(waitStage) || flaggedWaitStages.has(waitStage)) continue;
    flaggedWaitStages.add(waitStage);
    flags.push(`wait_without_halt_event:${waitStage}`);
  }
  // Discovery is where extension classes become known; a null left after a
  // passed discovery usually means the dims call was skipped, not that the
  // source has no extensions (stamp [] explicitly for that).
  const discoveryPassed = state.entries.some((e) => e.stage === 'discovery' && e.outcome === 'passed');
  if (discoveryPassed && (dims.source_extensions === undefined || dims.source_extensions === null)
    && dims.source_platform !== 'csv') {
    flags.push('source_extensions_null_after_discovery');
  }

  const evidence = walkEvidence(projectDir);
  const evidenceBytes = evidence.reduce((sum, f) => sum + f.bytes, 0);
  if (evidenceBytes > EVIDENCE_SIZE_FLAG_BYTES) {
    flags.push(`evidence_unusually_large:${Math.round(evidenceBytes / 1024)}kb`);
  }

  const rollup = {
    run_id: runStart.run_id,
    project_id: runStart.project_id,
    attempt: runStart.attempt,
    session_count: state.sessionCount,
    schema_version: TELEMETRY_SCHEMA_VERSION,
    skills_version: dims.skills_version || runStart.skills_version || null,
    skills_commit: dims.skills_commit || runStart.skills_commit || null,
    runtime_env: runStart.runtime_env || dims.runtime_env
      ? { ...(runStart.runtime_env || {}), ...(dims.runtime_env || {}) }
      : null,
    site_id: dims.site_id ?? null,
    wix_user_id: dims.wix_user_id ?? null,
    source_platform: dims.source_platform ?? null,
    source_platform_version: dims.source_platform_version ?? null,
    source_site_url: dims.source_site_url ?? null,
    source_extensions: dims.source_extensions ?? null,
    source_acquisition: dims.source_acquisition ?? null,
    delivery_mode: dims.delivery_mode ?? null,
    destination_strategy: dims.destination_strategy ?? null,
    terminal_state: payload.terminal_state,
    stopped_at_stage: payload.stopped_at_stage,
    stages,
    volumes: payload.volumes,
    verification: payload.verification,
    operator_acceptance: payload.operator_acceptance,
    telemetry_health: {
      rejected_calls: state.rejected.length,
      dropped_events: dropped,
      scrub_hits: state.scrubHits,
      bi_push_failures: state.biPushFailures,
      flags,
    },
    event_count_by_type: eventCountByType,
    active_ms: activeMs,
    waiting_ms: waitingMs,
    timing,
    cost,
    model_pricing_snapshot: dims.model_pricing_snapshot ?? null,
    run_started: runStart.ts,
    run_ended: finalizeTs,
    bundle_manifest: ['run-telemetry.json', ...evidence.map((f) => f.path)],
  };

  return {
    document: {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      field_tiers: FIELD_TIERS,
      rollup,
      events,
    },
    evidenceBytes,
    evidenceFiles: evidence,
  };
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function archiveName(state) {
  return `run-${state.runStart.attempt}-${state.runStart.run_id}`;
}

function archiveFinalizedJournal(projectDir, journal, state) {
  // Deterministic completion of a finalize: rebuild the document from the
  // journal (idempotent), write signal + archive copies, move the journal.
  const assembled = assembleDocument(projectDir, journal.records, journal.malformed);
  const base = archiveName(state);
  fs.mkdirSync(runsDir(projectDir), { recursive: true });
  writeJsonAtomic(signalPath(projectDir), assembled.document);
  writeJsonAtomic(path.join(runsDir(projectDir), `${base}.json`), assembled.document);
  fs.renameSync(journalPath(projectDir), path.join(runsDir(projectDir), `${base}.jsonl`));
  return assembled;
}

function lastFinalizedAttempt(projectDir) {
  let last = 0;
  const signal = signalPath(projectDir);
  if (fs.existsSync(signal)) {
    try {
      const doc = JSON.parse(fs.readFileSync(signal, 'utf8'));
      if (doc && doc.rollup && Number.isInteger(doc.rollup.attempt)) last = Math.max(last, doc.rollup.attempt);
    } catch {
      // unreadable prior signal file — fall through to the archive scan
    }
  }
  const dir = runsDir(projectDir);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const match = /^run-(\d+)-/.exec(name);
      if (match) last = Math.max(last, Number(match[1]));
    }
  }
  return last;
}

function resolveSkillsVersion() {
  let dir = __dirname;
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = path.join(dir, 'VERSION');
    if (fs.existsSync(candidate)) {
      const version = fs.readFileSync(candidate, 'utf8').trim();
      if (/^\d+\.\d+\.\d+$/.test(version)) return version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveSkillsCommit() {
  // The exact source commit behind this bundle — the drill-down provenance the
  // coarse, hand-bumped `skills_version` (semver) cannot give. Two sources, in
  // order of authority:
  //
  // 1. `.publish-manifest.json`, stamped by publish-skills-to-wix.sh next to
  //    VERSION at publish time. This is the only source that works in a partner
  //    runtime (no git there) AND the only correct one once the bundle lives
  //    inside the consuming wix/skills repo — where a git probe would return
  //    that repo's HEAD, not the replatform source commit. So it wins.
  // 2. Dev-mode git fallback: runs straight from the replatform checkout, where
  //    the recorder's own directory is inside the source repo, have no manifest
  //    but do have git — so `git -C __dirname rev-parse --short HEAD` is the source
  //    commit. Never reached once a manifest is present (case 1).
  let dir = __dirname;
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = path.join(dir, '.publish-manifest.json');
    if (fs.existsSync(candidate)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (typeof manifest.sourceCommit === 'string' && /^[0-9a-f]{7,40}$/.test(manifest.sourceCommit)) {
          return manifest.sourceCommit;
        }
      } catch {
        // unreadable manifest — fall through to the dev-mode git probe
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const sha = execFileSync('git', ['-C', __dirname, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
  } catch {
    // no git, not a repo, or git unavailable — commit provenance stays null
  }
  return null;
}

// --- BI sink (spec 0007) ----------------------------------------------------------

// Push rows to BI and journal any failures/truncation so telemetry loss is
// visible in telemetry_health, never silent. Never throws — BI unreachable,
// slow, or rejecting is a telemetry failure, not a run failure. Returns the
// last journal seq used plus sent/failed row counts.
async function pushToBi(projectDir, ts, seq, rows, loggedUserId, target) {
  const result = await biSink.pushRows(rows, loggedUserId);
  if (result.truncated > 0) {
    seq += 1;
    appendJournal(projectDir, { type: 'bi_push_truncated', ts, seq, target, rows: result.truncated });
  }
  for (const failure of result.failures) {
    seq += 1;
    appendJournal(projectDir, {
      type: 'bi_push_failed', ts, seq, target, rows: failure.rows, detail: failure.detail,
    });
  }
  return {
    seq,
    sent: result.sent,
    failed: result.failures.reduce((sum, f) => sum + f.rows, 0),
  };
}

// The folded BI row for one event class: prior journal records of the class plus
// the just-appended one. Re-pushes of a growing class are safe — the reviewer
// dedupes on (run_id, seq), latest row wins with the cumulative count.
function foldedRowForClass(state, eventRecord) {
  const classRecords = [
    ...state.events.filter((r) => r.class_key === eventRecord.class_key),
    eventRecord,
  ];
  return biSink.eventRow(foldEvents(classRecords, state.runStart.run_id)[0]);
}

// --- public command API ---------------------------------------------------------

async function start(projectDir, dimsInput, { now } = {}) {
  const ts = nowIso(now);
  const dims = validateDims(dimsInput);
  const journal = readJournal(projectDir);

  if (journal) {
    const state = replay(journal.records);
    if (!state.runStart) {
      throw new ValidationError(['telemetry journal is corrupt: missing run-start record']);
    }
    if (state.finalize) {
      archiveFinalizedJournal(projectDir, journal, state);
    } else {
      // Resume: same run_id, same attempt, one more session. Cross-session user
      // latency lands in waiting_ms, never in a phantom second run.
      let seq = state.seq;
      if (state.openWait) {
        seq += 1;
        appendJournal(projectDir, { type: 'wait_end', ts, seq });
      } else if (state.lastTs && tsMs(ts) - tsMs(state.lastTs) >= IMPLICIT_WAIT_MIN_MS) {
        // The run stopped without an open wait (e.g. a crash); the dead interval
        // is waiting time, not active time.
        const stage = state.openStage || state.lastStage || 'config';
        seq += 1;
        appendJournal(projectDir, { type: 'wait_start', ts: state.lastTs, seq, stage, imputed: true });
        seq += 1;
        appendJournal(projectDir, { type: 'wait_end', ts, seq, imputed: true });
      }
      seq += 1;
      appendJournal(projectDir, { type: 'session_start', ts, seq, session: state.sessionCount + 1 });
      if (Object.keys(dims).length > 0) {
        seq += 1;
        appendJournal(projectDir, { type: 'dims', ts, seq, dims });
      }
      // Operator identity arriving on a resume means the phase:started row could
      // not have been sent yet — send it now (dedup makes a re-send harmless).
      if (biSink.isGuid(dims.wix_user_id)) {
        await pushToBi(projectDir, ts, seq,
          [biSink.startedRunRow(state.runStart, dims.wix_user_id)], dims.wix_user_id, 'run_started');
      }
      return {
        resumed: true,
        run_id: state.runStart.run_id,
        attempt: state.runStart.attempt,
        session_count: state.sessionCount + 1,
        open_stage: state.openStage,
      };
    }
  }

  const attempt = lastFinalizedAttempt(projectDir) + 1;
  const runtimeEnv = {
    os: `${os.platform()} ${os.release()}`,
    node_version: process.version,
    agent_runtime: (dims.runtime_env && dims.runtime_env.agent_runtime) || null,
    model: (dims.runtime_env && dims.runtime_env.model) || null,
    ...(dims.runtime_env || {}),
  };
  delete dims.runtime_env;
  const skillsVersion = dims.skills_version || resolveSkillsVersion();
  delete dims.skills_version;
  const skillsCommit = dims.skills_commit || resolveSkillsCommit();
  delete dims.skills_commit;

  const record = {
    type: 'run_start',
    ts,
    seq: 1,
    run_id: crypto.randomUUID(),
    project_id: path.basename(path.resolve(projectDir)),
    attempt,
    session: 1,
    schema_version: TELEMETRY_SCHEMA_VERSION,
    skills_version: skillsVersion,
    skills_commit: skillsCommit,
    runtime_env: runtimeEnv,
    dims,
  };
  appendJournal(projectDir, record);
  // Emit `replatform_run` phase:started (spec 0007). Without a GUID operator
  // identity there is no BI route yet — a later dims call carrying wix_user_id
  // (or the finalize re-push) sends it then.
  if (biSink.isGuid(dims.wix_user_id)) {
    await pushToBi(projectDir, ts, record.seq,
      [biSink.startedRunRow(record, dims.wix_user_id)], dims.wix_user_id, 'run_started');
  }
  return {
    resumed: false,
    run_id: record.run_id,
    project_id: record.project_id,
    attempt,
    session_count: 1,
    skills_version: skillsVersion,
    skills_commit: skillsCommit,
  };
}

async function dims(projectDir, dimsInput, { now } = {}) {
  const ts = nowIso(now);
  const { state } = requireActiveRun(projectDir);
  const validated = validateDims(dimsInput);
  if (Object.keys(validated).length === 0) {
    throw new ValidationError(['dims payload contains no known dimension fields']);
  }
  appendJournal(projectDir, { type: 'dims', ts, seq: state.seq + 1, dims: validated });
  // Identity becoming known mid-run unlocks the BI route: send the
  // phase:started row that start() had to hold back.
  if (biSink.isGuid(validated.wix_user_id)) {
    await pushToBi(projectDir, ts, state.seq + 1,
      [biSink.startedRunRow(state.runStart, validated.wix_user_id)], validated.wix_user_id, 'run_started');
  }
  return { recorded: Object.keys(validated) };
}

async function record(projectDir, eventInput, { now } = {}) {
  const ts = nowIso(now);
  const { state } = requireActiveRun(projectDir);
  let validated;
  try {
    validated = validateEvent(eventInput, state);
  } catch (error) {
    if (error instanceof ValidationError) {
      // The schema gate refused the call: count it so telemetry loss is never
      // silent, then surface the errors for a retry.
      appendJournal(projectDir, {
        type: 'rejected',
        ts,
        seq: state.seq + 1,
        class_key: error.hint || null,
        reasons: error.errors,
      });
      error.hint = 'fix the listed fields and retry the record call';
    }
    throw error;
  }
  const eventRecord = {
    type: 'event',
    ts,
    seq: state.seq + 1,
    class_key: validated.classKey,
    scrub_hits: validated.scrubHits,
    event: validated.event,
  };
  appendJournal(projectDir, eventRecord);
  // Emit the folded `replatform_run_event` row (spec 0007). No identity yet →
  // hold back; the finalize full re-push sends every folded class regardless.
  if (biSink.isGuid(state.dims.wix_user_id)) {
    await pushToBi(projectDir, ts, eventRecord.seq,
      [foldedRowForClass(state, eventRecord)], state.dims.wix_user_id, 'run_event');
  }
  const priorInClass = state.events.filter((r) => r.class_key === validated.classKey).length;
  return {
    recorded: true,
    seq: state.seq + 1,
    event_type: validated.event.event_type,
    folded_into_existing_class: priorInClass > 0,
    scrub_hits: validated.scrubHits,
  };
}

function stage(projectDir, action, stageName, { outcome, now } = {}) {
  const ts = nowIso(now);
  const { state } = requireActiveRun(projectDir);
  const errors = [];
  checkEnum(errors, 'stage', stageName, STAGES);
  if (errors.length > 0) throw new ValidationError(errors);
  if (state.openWait) {
    throw new ValidationError(
      [`a wait interval is open (stage ${state.openWait.stage})`],
      'call `wait end` before stage boundaries',
    );
  }
  if (action === 'start') {
    if (state.openStage) {
      throw new ValidationError(
        [`stage ${state.openStage} is still open`],
        `call \`stage end ${state.openStage} --outcome <passed|halted|failed|skipped>\` first`,
      );
    }
    appendJournal(projectDir, { type: 'stage_start', ts, seq: state.seq + 1, stage: stageName });
    return { stage: stageName, started: true };
  }
  if (action === 'end') {
    if (state.openStage !== stageName) {
      throw new ValidationError([
        state.openStage
          ? `open stage is ${state.openStage}, not ${stageName}`
          : `no stage is open (last stage: ${state.lastStage || 'none'})`,
      ]);
    }
    const resolvedOutcome = outcome === undefined || outcome === null ? 'passed' : outcome;
    const outcomeErrors = [];
    checkEnum(outcomeErrors, 'outcome', resolvedOutcome, STAGE_OUTCOMES);
    if (outcomeErrors.length > 0) throw new ValidationError(outcomeErrors);
    appendJournal(projectDir, { type: 'stage_end', ts, seq: state.seq + 1, stage: stageName, outcome: resolvedOutcome });
    return { stage: stageName, ended: true, outcome: resolvedOutcome };
  }
  throw new ValidationError([`stage action must be start or end (got: ${action})`]);
}

// Attach measured latency/token counts to a stage. Separate from `stage end` on purpose: a stage may
// be metered several times (each generated script reports its own invocation), and token counts are
// known by the agent runtime rather than by whatever closed the stage.
function meter(projectDir, input, { now } = {}) {
  const ts = nowIso(now);
  const { state } = requireActiveRun(projectDir);
  const payload = validateMeter(input, { openStage: state.openStage, lastStage: state.lastStage });
  appendJournal(projectDir, { type: 'meter', ts, seq: state.seq + 1, stage: payload.stage, meter: payload });
  const recorded = Object.keys(payload).filter((k) => k !== 'stage');
  return { metered: true, stage: payload.stage, fields: recorded };
}

async function wait(projectDir, action, { now, haltSubtype, skill, what } = {}) {
  const ts = nowIso(now);
  const { state } = requireActiveRun(projectDir);
  if (action === 'start') {
    if (state.openWait) {
      throw new ValidationError(['a wait interval is already open']);
    }
    const attributedStage = state.openStage || state.lastStage || 'config';
    let seq = state.seq;
    let haltRecorded = false;
    if (haltSubtype !== undefined && haltSubtype !== null) {
      // The paired halt_needs_user event is emitted mechanically so a stalled
      // run never loses the "why" to a missed record call.
      const validated = validateEvent({
        event_type: 'halt_needs_user',
        subtype: haltSubtype,
        stage: attributedStage,
        skill: skill || 'replatform',
        severity: 'blocking',
        what_happened: what || `Run halted at ${attributedStage} waiting on the user (${haltSubtype}).`,
      }, state);
      seq += 1;
      const eventRecord = {
        type: 'event', ts, seq, class_key: validated.classKey, scrub_hits: validated.scrubHits, event: validated.event,
      };
      appendJournal(projectDir, eventRecord);
      if (biSink.isGuid(state.dims.wix_user_id)) {
        const pushed = await pushToBi(projectDir, ts, seq,
          [foldedRowForClass(state, eventRecord)], state.dims.wix_user_id, 'run_event');
        seq = pushed.seq;
      }
      haltRecorded = true;
    } else if (skill !== undefined || what !== undefined) {
      throw new ValidationError(['--skill/--what on wait start are only valid together with --halt <subtype>']);
    }
    seq += 1;
    appendJournal(projectDir, { type: 'wait_start', ts, seq, stage: attributedStage });
    return { waiting: true, stage: attributedStage, halt_recorded: haltRecorded };
  }
  if (action === 'end') {
    if (!state.openWait) {
      throw new ValidationError(['no wait interval is open']);
    }
    appendJournal(projectDir, { type: 'wait_end', ts, seq: state.seq + 1 });
    return { waiting: false, waited_ms: Math.max(0, tsMs(ts) - tsMs(state.openWait.start)) };
  }
  throw new ValidationError([`wait action must be start or end (got: ${action})`]);
}

async function finalize(projectDir, rollupInput, { now } = {}) {
  const ts = nowIso(now);
  const { journal, state } = requireActiveRun(projectDir);
  const payload = validateFinalizeInput(rollupInput, state);

  let seq = state.seq;
  if (state.openWait) {
    seq += 1;
    appendJournal(projectDir, { type: 'wait_end', ts, seq });
  }
  if (state.openStage) {
    seq += 1;
    appendJournal(projectDir, {
      type: 'stage_end',
      ts,
      seq,
      stage: state.openStage,
      outcome: OUTCOME_FOR_TERMINAL[payload.terminal_state],
    });
  }
  seq += 1;
  appendJournal(projectDir, { type: 'finalize', ts, seq, payload });

  // BI push before archival, so a failed push is journaled into the run and
  // lands in the archived telemetry_health. The full re-push (started row +
  // every folded event class + the finalized rollup) heals any mid-run failure
  // or identity-not-yet-known hold-back: the stream is append-only and the
  // reviewer dedupes on the natural keys, latest row wins. The pushed rollup's
  // own health can't include this push's outcome (it is assembled first) — if
  // the push fails there is no BI row at all, and the local document, which is
  // authoritative, records the failure.
  let biPush = { sent: 0, failed: 0 };
  if (!biSink.disabled()) {
    const provisionalJournal = readJournal(projectDir);
    const provisional = assembleDocument(projectDir, provisionalJournal.records, provisionalJournal.malformed);
    const rollup = provisional.document.rollup;
    if (biSink.isGuid(rollup.wix_user_id)) {
      const rows = [
        biSink.startedRunRow(replay(provisionalJournal.records).runStart, rollup.wix_user_id),
        ...provisional.document.events.map(biSink.eventRow),
        biSink.finalizedRunRow(rollup),
      ];
      const pushed = await pushToBi(projectDir, ts, seq, rows, rollup.wix_user_id, 'finalize');
      seq = pushed.seq;
      biPush = { sent: pushed.sent, failed: pushed.failed };
    } else {
      // No operator identity by run end: the run is unroutable in BI. Journal
      // it as a push failure — this is real telemetry loss, not a hold-back.
      const rowCount = provisional.document.events.length + 2;
      seq += 1;
      appendJournal(projectDir, {
        type: 'bi_push_failed', ts, seq, target: 'finalize', rows: rowCount, detail: 'no_operator_identity',
      });
      biPush = { sent: 0, failed: rowCount };
    }
  }

  const finalJournal = readJournal(projectDir);
  const finalState = replay(finalJournal.records);
  const assembled = archiveFinalizedJournal(projectDir, finalJournal, finalState);

  const health = assembled.document.rollup.telemetry_health;
  return {
    finalized: true,
    run_id: finalState.runStart.run_id,
    attempt: finalState.runStart.attempt,
    terminal_state: payload.terminal_state,
    bi_push: biPush,
    signal_file: 'run-telemetry.json',
    event_classes: assembled.document.events.length,
    telemetry_health: health,
    evidence_bytes: assembled.evidenceBytes,
    ...(assembled.evidenceBytes > EVIDENCE_SIZE_FLAG_BYTES
      ? {
          evidence_breakdown: assembled.evidenceFiles
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 10),
        }
      : {}),
  };
}

async function rebuild(projectDir, { attempt, push } = {}) {
  // Re-assemble a finalized run's signal document from its archived journal.
  // The document is a pure function of the journal, so recorder fixes (fold
  // semantics, manifest rules, health flags) can be applied to past runs
  // without touching the captured record itself. With `push`, the rebuilt run
  // is re-emitted to BI (outage backfill / post-fix re-push) — idempotent by
  // the reviewer's query-time dedup on the natural keys.
  const dir = runsDir(projectDir);
  const archived = fs.existsSync(dir)
    ? fs.readdirSync(dir)
      .map((name) => {
        const match = /^run-(\d+)-.+\.jsonl$/.exec(name);
        return match ? { attempt: Number(match[1]), name } : null;
      })
      .filter(Boolean)
    : [];
  if (archived.length === 0) {
    throw new ValidationError(
      ['no archived run journals to rebuild from'],
      'rebuild re-assembles a finalized signal document from telemetry/runs/run-<attempt>-<run_id>.jsonl',
    );
  }
  const latestAttempt = archived.reduce((max, a) => Math.max(max, a.attempt), 0);
  const target = attempt === undefined || attempt === null
    ? archived.find((a) => a.attempt === latestAttempt)
    : archived.find((a) => a.attempt === attempt);
  if (!target) {
    throw new ValidationError([`no archived journal for attempt ${attempt} (have: ${archived.map((a) => a.attempt).join(', ')})`]);
  }
  const journal = readJournalFile(path.join(dir, target.name));
  const state = replay(journal.records);
  if (!state.runStart || !state.finalize) {
    throw new ValidationError([`archived journal ${target.name} is not a finalized run`]);
  }
  const assembled = assembleDocument(projectDir, journal.records, journal.malformed);
  writeJsonAtomic(path.join(dir, `${archiveName(state)}.json`), assembled.document);
  const signalUpdated = target.attempt === latestAttempt;
  if (signalUpdated) {
    writeJsonAtomic(signalPath(projectDir), assembled.document);
  }
  // The archived journal is immutable, so a backfill push's outcome cannot be
  // journaled into the run — it is reported here, to the operator running the
  // explicit backfill, instead.
  let biPush;
  if (push) {
    const rollup = assembled.document.rollup;
    const rows = [
      biSink.startedRunRow(state.runStart, rollup.wix_user_id),
      ...assembled.document.events.map(biSink.eventRow),
      biSink.finalizedRunRow(rollup),
    ];
    const result = await biSink.pushRows(rows, rollup.wix_user_id);
    biPush = {
      sent: result.sent,
      failed: result.failures.reduce((sum, f) => sum + f.rows, 0),
      ...(result.failures.length > 0 ? { failure_details: [...new Set(result.failures.map((f) => f.detail))] } : {}),
    };
  }
  return {
    rebuilt: true,
    run_id: state.runStart.run_id,
    attempt: target.attempt,
    signal_file_updated: signalUpdated,
    event_classes: assembled.document.events.length,
    telemetry_health: assembled.document.rollup.telemetry_health,
    ...(biPush ? { bi_push: biPush } : {}),
  };
}

function status(projectDir) {
  const journal = readJournal(projectDir);
  if (!journal) {
    const lastAttempt = lastFinalizedAttempt(projectDir);
    return { active: false, finalized_attempts: lastAttempt };
  }
  const state = replay(journal.records);
  return {
    active: !state.finalize,
    run_id: state.runStart ? state.runStart.run_id : null,
    attempt: state.runStart ? state.runStart.attempt : null,
    session_count: state.sessionCount,
    open_stage: state.openStage,
    open_wait: Boolean(state.openWait),
    events_recorded: state.events.length,
    distinct_classes: new Set(state.events.map((r) => r.class_key)).size,
    rejected_calls: state.rejected.length,
    last_seq: state.seq,
  };
}

module.exports = {
  TELEMETRY_SCHEMA_VERSION,
  STAGES,
  STAGE_OUTCOMES,
  TERMINAL_STATES,
  SEVERITIES,
  EVENT_SUBTYPES,
  FIELD_TIERS,
  FREE_TEXT_MAX,
  SHAPES_KEPT_PER_CLASS,
  ValidationError,
  scrubText,
  validateDims,
  validateEvent,
  validateFinalizeInput,
  journalPath,
  signalPath,
  runsDir,
  readJournal,
  start,
  dims,
  record,
  stage,
  meter,
  wait,
  finalize,
  rebuild,
  status,
  validateMeter,
  computeCost,
  METER_DURATION_KEYS,
  METER_COUNT_KEYS,
};
