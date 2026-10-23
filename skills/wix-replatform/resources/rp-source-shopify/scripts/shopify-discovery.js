#!/usr/bin/env node
'use strict';

// Shopify private-data discovery, read through the Shopify CLI.
//
//   node scripts/shopify-discovery.js --project <migrations-root>/<project> --store <shop>.myshopify.com
//        [--reread <entity> ...] [--restart] [--progress-log <path>]
//
// Runs the discovery steps in a fixed order. Each step records its result in
// data/shopify-discovery/discovery-steps.json before the next starts, so a restart -- or a return
// after a merchant question -- runs only the steps not yet recorded and reads nothing it already
// captured. The last step writes data/shopify-discovery/source-coverage.json (rows: [] when
// clean). All recorded state is bound to the one store it was read from: a run for a different
// store stops with shopify_discovery_store_mismatch instead of mixing files, and --restart is the
// explicit way to discard the capture and begin again. source-profile.md and source-schema.json are synthesized from the capture afterwards and
// promoted with rp-discovery's promote-source-coverage.js --adapter shopify.
//
// Exit codes: 0 complete; 3 waiting on a merchant question (the run holds at
// awaiting_user_action); 2 stopped (the printed code says why; recorded steps are kept);
// 1 usage or unexpected error.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../../../lib/progress-log.js');
const { buildShopifyCoverageRows, buildCoverageFile, ADAPTER_RAW_DIRS, SOURCE_COVERAGE_FILE, writeJsonAtomic } = require('../../../lib/source-coverage.js');
const { createUserAction, readUserAction } = require('../../../lib/user-actions.js');
const bulk = require('../lib/shopify-bulk.js');
const giftCards = require('../lib/shopify-gift-cards.js');
const { createStoreExecutor, ShopifyCliError } = require('../lib/shopify-cli.js');
const { ALL_READS, ORDER_WINDOW_READS, SAMPLE_LIMIT, operationName, at } = require('../lib/discovery-reads.js');
const { ShopifySessionStop, assertConnectionReady, recordAuthExpired, runSessionCheck } = require('../lib/shopify-session.js');
const protectedFields = require('../lib/shopify-protected-fields.js');

const RAW_DIR = ADAPTER_RAW_DIRS.shopify;
const STEPS_FILE = 'discovery-steps.json';
const ENTITIES_DIR = 'entities';
const STEPS_SCHEMA_VERSION = 1;
// What discovery hands to the mapper once it has been synthesized and promoted. They live outside
// the raw directory, so a restart cannot clear them: it refuses to switch stores once they exist.
const HANDOFF_FILES = Object.freeze(['source-profile.md', 'source-schema.json', SOURCE_COVERAGE_FILE]);
const STORE_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
// Connection records, not capture: a restart keeps them. The staff-account record
// outlives any capture -- the account exists until the owner removes it.
const CONNECTION_FILES = Object.freeze(['session-receipt.json', 'staff-access.json']);
const ORDER_WINDOW_FILE = 'order-window.json';
const ORDER_WINDOW_DAYS = 60;

class ShopifyDiscoveryStop extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ShopifyDiscoveryStop';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------------------------
// Store identity -- every recorded artifact belongs to exactly one store
// ---------------------------------------------------------------------------------------------

function normalizeStore(store) {
  const value = typeof store === 'string' ? store.trim().toLowerCase() : '';
  if (!STORE_PATTERN.test(value)) {
    throw new ShopifyDiscoveryStop('shopify_store_invalid', 'store must be the *.myshopify.com domain the Shopify CLI session is bound to');
  }
  return value;
}

function storeMismatch(recorded, store, what) {
  return new ShopifyDiscoveryStop(
    'shopify_discovery_store_mismatch',
    `Shopify discovery data in this project (${what}) was read from ${recorded || 'an unrecorded store'}, not ${store}. Nothing was read or changed. Run discovery for ${recorded || 'the original store'}, or restart discovery with --restart to discard the recorded capture and read ${store} from scratch.`,
    { recorded: recorded || null, store },
  );
}

// ---------------------------------------------------------------------------------------------
// Step state
// ---------------------------------------------------------------------------------------------

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readSteps(rawDir, now, store) {
  const state = await readJson(path.join(rawDir, STEPS_FILE));
  if (state && state.schemaVersion === STEPS_SCHEMA_VERSION && state.steps && typeof state.steps === 'object') return state;
  return { schemaVersion: STEPS_SCHEMA_VERSION, platform: 'shopify', store, startedAt: now(), steps: {} };
}

// Refuse to continue on anything recorded for another store (or for none): the steps file, and
// every entity file already on disk, which is what a resume would otherwise accept.
async function assertBoundToStore(rawDir, store) {
  const steps = await readJson(path.join(rawDir, STEPS_FILE));
  if (steps && steps.store !== store) throw storeMismatch(steps.store, store, STEPS_FILE);
  let names = [];
  try {
    names = await fs.readdir(path.join(rawDir, ENTITIES_DIR));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const record = await readJson(path.join(rawDir, ENTITIES_DIR, name));
    if (record && record.store !== store) throw storeMismatch(record.store, store, `${ENTITIES_DIR}/${name}`);
  }
}

// The store the recorded capture belongs to: the steps file's, else any entity file's, else none.
async function recordedStore(rawDir) {
  const steps = await readJson(path.join(rawDir, STEPS_FILE));
  if (steps && typeof steps.store === 'string') return steps.store;
  let names = [];
  try {
    names = await fs.readdir(path.join(rawDir, ENTITIES_DIR));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const record = await readJson(path.join(rawDir, ENTITIES_DIR, name));
    if (record && typeof record.store === 'string') return record.store;
  }
  return null;
}

async function existingHandoffFiles(projectDir) {
  const found = [];
  for (const rel of HANDOFF_FILES) {
    try {
      await fs.access(path.join(projectDir, rel));
      found.push(rel);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return found;
}

// --restart: discard the whole Shopify raw directory so the next run reads from scratch and no
// file from the previous capture -- including files the technical steps add -- can survive by
// omission from a list. The mapper's handoff (source-profile.md, source-schema.json and the
// promoted coverage file) is outside that directory, so a restart that would leave the previous
// store's handoff in place for a different store is refused: that project belongs to the first
// store, and the other one needs its own migration project. A restart for the same store is
// allowed. Questions the previous run asked are tied to it; while one is still pending the run is
// holding at awaiting_user_action, so the restart also waits until it is answered.
async function restartDiscovery(projectDir, rawDir, store) {
  const handoff = await existingHandoffFiles(projectDir);
  const previousStore = await recordedStore(rawDir);
  if (handoff.length && previousStore !== store) {
    throw new ShopifyDiscoveryStop(
      'shopify_restart_blocked_handoff',
      `this project already hands ${previousStore || 'an unrecorded store'}'s discovery to mapping (${handoff.join(', ')}), so ${store} cannot be read into it. Nothing was read or changed. Start a new migration project for ${store}.`,
      { recorded: previousStore, store, handoff },
    );
  }
  const previous = await readJson(path.join(rawDir, STEPS_FILE));
  if (previous && previous.steps && previous.startedAt) {
    for (const entry of Object.values(previous.steps)) {
      for (const question of (entry.record && entry.record.questions) || []) {
        try {
          const action = await readUserAction(projectDir, questionRequestId(previous.startedAt, question.key));
          if (action.status !== 'answered') {
            throw new ShopifyDiscoveryStop('shopify_restart_blocked', `a merchant question from the previous discovery is still pending (${action.requestId}); answer it first, then restart`, { requestId: action.requestId });
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  let names = [];
  try {
    names = await fs.readdir(rawDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names) {
    if (CONNECTION_FILES.includes(name) || name.startsWith('staff-access.json.unreadable-')) continue;
    await fs.rm(path.join(rawDir, name), { recursive: true, force: true });
  }
}

async function writeSteps(rawDir, state) {
  await writeJsonAtomic(path.join(rawDir, STEPS_FILE), state);
}

function entityFile(entity) {
  return path.join(ENTITIES_DIR, `${entity}.json`);
}

// ---------------------------------------------------------------------------------------------
// Step 1 -- capture: one count (where one exists) and up to SAMPLE_LIMIT samples per entity
// ---------------------------------------------------------------------------------------------

function errorEntries(read, errors) {
  return (errors || []).map((error) => ({
    read,
    code: (error && error.extensions && error.extensions.code) || 'GRAPHQL_ERROR',
    message: String((error && error.message) || 'GraphQL error').slice(0, 500),
  }));
}

// A read Shopify throttled on all its calls is a failed read of that entity: a
// capture-failed row, never an empty entity. Every other CLI failure stops the step.
async function readOrThrottled(execute, query, variables = null) {
  try {
    return await execute(query, variables);
  } catch (error) {
    if (error instanceof ShopifyCliError && error.code === 'shopify_throttled') {
      return { data: null, errors: [{ message: 'Shopify throttled this read on every call (31 s of backoff)', extensions: { code: 'shopify_throttled' } }] };
    }
    throw error;
  }
}

async function captureEntity(read, { execute: rawExecute, sampleLimit, store }) {
  const execute = (query, variables) => readOrThrottled(rawExecute, query, variables);
  const record = { entity: read.entity, store, scopes: read.scopes, reads: [], count: null, countPrecision: null, countExact: false, samples: [], sampleCount: 0, errors: [] };
  if (read.count) {
    const name = operationName(read.count);
    record.reads.push(name);
    const result = await execute(read.count);
    if (result.errors && result.errors.length) {
      record.errors.push(...errorEntries(name, result.errors));
    } else {
      const counted = at(result.data, read.countPath);
      record.count = counted && Number.isInteger(counted.count) ? counted.count : null;
      record.countPrecision = counted && typeof counted.precision === 'string' ? counted.precision : null;
      // Only an EXACT answer is a record count. Anything else (AT_LEAST, a missing precision) is a
      // lower bound at best: `count` keeps it, `countExact` says it is not the store's total.
      record.countExact = record.count !== null && record.countPrecision === 'EXACT';
      if (record.count === null) record.errors.push({ read: name, code: 'COUNT_MISSING', message: 'the count read returned no count' });
    }
  }
  const name = operationName(read.sample);
  record.reads.push(name);
  const result = await execute(read.sample, /\$first\b/.test(read.sample) ? { first: sampleLimit } : null);
  if (result.errors && result.errors.length) {
    record.errors.push(...errorEntries(name, result.errors));
  } else {
    const value = at(result.data, read.samplePath);
    if (value === undefined || value === null) {
      record.errors.push({ read: name, code: 'SAMPLE_MISSING', message: 'the sample read returned nothing at its path' });
    } else if (Array.isArray(value.nodes)) {
      record.samples = value.nodes.slice(0, sampleLimit);
    } else if (Array.isArray(value)) {
      record.samples = value.slice(0, sampleLimit);
    } else {
      record.samples = [value];
    }
    record.sampleCount = record.samples.length;
  }
  return record;
}

async function captureStep(ctx) {
  const failed = [];
  const entities = [];
  for (const read of ctx.reads) {
    const rel = entityFile(read.entity);
    const file = path.join(ctx.rawDir, rel);
    let record = await readJson(file);
    if (record && record.entity === read.entity && record.store !== ctx.store) {
      throw storeMismatch(record.store, ctx.store, rel);
    }
    if (!record || record.entity !== read.entity) {
      ctx.progress('Reading Shopify entity', { entity: read.entity });
      record = { ...(await captureEntity(read, ctx)), capturedAt: ctx.now() };
      await writeJsonAtomic(file, record);
    }
    entities.push({ entity: read.entity, count: record.count, countExact: record.countExact === true, sampleCount: record.sampleCount, file: rel });
    if (record.errors.length) {
      failed.push({ entity: read.entity, artifact: `${RAW_DIR}/${rel}`, reads: record.reads, errors: record.errors });
    }
  }
  return { entities, failed };
}

// ---------------------------------------------------------------------------------------------
// Steps owned by the technical specs. Until a bundle ships a step's implementation, discovery
// stops at it: a run that skipped it would look complete while missing what it checks.
// ---------------------------------------------------------------------------------------------

function unavailableStep(id, checks) {
  return {
    id,
    run: async () => {
      throw new ShopifyDiscoveryStop(
        'shopify_discovery_step_unavailable',
        `Shopify discovery step "${id}" (${checks}) is not available in this version of the Shopify adapter, so Shopify private-data discovery cannot finish. Recorded steps are kept; re-run discovery once the step ships.`,
        { step: id },
      );
    },
  };
}

const WITHHELD_DETAILS_STEP = Object.freeze({ id: 'withheld-details', run: protectedFields.runDiscoveryProbes });

// ---------------------------------------------------------------------------------------------
// Step 4 -- the order-history window
// ---------------------------------------------------------------------------------------------

// Through the CLI connector Shopify shows only the last ~60 days of orders, on every read path.
// Orders are complete only when the shop itself is younger than the window and no imported
// (back-dated) orders exist: the visible orders' dates are never used as proof.
const IMPORTED_ORDERS_KEY = 'imported-orders';
const ORDER_WINDOW_ROW_ID = 'shopify:orders-before-window';

function orderWindowRow(evidence) {
  return {
    coverageId: ORDER_WINDOW_ROW_ID,
    platform: 'shopify',
    capability: 'commerce.orders',
    sourceEntity: 'orders-before-window',
    routes: ['orders'],
    reason: 'auth-gated',
    evidence,
    recoverability: 'requires-development',
    disposition: null,
  };
}

function windowEvidencePointer(record, answer) {
  const parts = [
    `shopCreatedAt=${record.shopCreatedAt || 'unreadable'}`,
    `windowStart=${record.windowStart}`,
    'session-receipt.json grantedScopes lacks read_all_orders',
  ];
  if (record.backdatedOrder) parts.push(`order processedAt ${record.oldestProcessedAt} precedes shopCreatedAt`);
  if (answer) parts.push(`imported orders: ${answer}`);
  return parts.join('; ');
}

async function orderWindowStep(ctx) {
  const [createdRead, oldestRead] = ORDER_WINDOW_READS;
  const nowIso = ctx.now();
  const windowStart = new Date(Date.parse(nowIso) - ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const record = { store: ctx.store, readAt: nowIso, windowDays: ORDER_WINDOW_DAYS, windowStart, shopCreatedAt: null, young: false, oldestProcessedAt: null, backdatedOrder: false, errors: [], rowRequired: true };
  const created = await readOrThrottled(ctx.execute, createdRead.query);
  const shopCreatedAt = created.data && created.data.shop && typeof created.data.shop.createdAt === 'string' ? created.data.shop.createdAt : null;
  if (created.errors && created.errors.length) record.errors.push(...errorEntries(operationName(createdRead.query), created.errors));
  if (shopCreatedAt && Number.isFinite(Date.parse(shopCreatedAt))) {
    record.shopCreatedAt = shopCreatedAt;
    record.young = Date.parse(shopCreatedAt) > Date.parse(windowStart);
  } else if (!record.errors.length) {
    record.errors.push({ read: operationName(createdRead.query), code: 'CREATED_AT_MISSING', message: 'shop.createdAt was not readable' });
  }
  if (record.young) {
    const oldest = await readOrThrottled(ctx.execute, oldestRead.query);
    if (oldest.errors && oldest.errors.length) {
      record.errors.push(...errorEntries(operationName(oldestRead.query), oldest.errors));
    } else {
      const node = oldest.data && oldest.data.orders && Array.isArray(oldest.data.orders.nodes) ? oldest.data.orders.nodes[0] : null;
      record.oldestProcessedAt = node && typeof node.processedAt === 'string' ? node.processedAt : null;
      record.backdatedOrder = Boolean(record.oldestProcessedAt && Date.parse(record.oldestProcessedAt) < Date.parse(record.shopCreatedAt));
      // A young store with no back-dated visible order: only the merchant can say whether orders
      // were imported with dates Shopify keys the window on.
      record.rowRequired = record.backdatedOrder;
    }
  }
  await writeJsonAtomic(path.join(ctx.rawDir, ORDER_WINDOW_FILE), record);
  const result = { ...record, file: ORDER_WINDOW_FILE };
  if (record.young && !record.backdatedOrder && !record.errors.length) {
    result.questions = [{
      key: IMPORTED_ORDERS_KEY,
      title: 'Imported Shopify orders',
      prompt: 'Were orders imported into this Shopify store from another system?',
      response: { mode: 'choice' },
      choices: [
        { id: 'no', label: 'No' },
        { id: 'yes', label: 'Yes' },
        { id: 'unknown', label: 'I don\'t know' },
      ],
      artifactRefs: [{ path: `${RAW_DIR}/${ORDER_WINDOW_FILE}`, mediaType: 'application/json' }],
    }];
  }
  return result;
}

function orderWindowRows(record, answers) {
  const asked = Array.isArray(record.questions) && record.questions.some((question) => question.key === IMPORTED_ORDERS_KEY);
  if (asked) {
    const answer = answers[IMPORTED_ORDERS_KEY];
    const choice = answer && answer.answer ? answer.answer.choice : null;
    if (choice === 'no') return [];
    // `yes`, `unknown`, or no recorded answer: fail closed.
    return [orderWindowRow({ artifact: answer ? answer.evidence : `${RAW_DIR}/${ORDER_WINDOW_FILE}`, pointer: windowEvidencePointer(record, choice || 'unanswered') })];
  }
  if (record.rowRequired === false) return [];
  return [orderWindowRow({ artifact: `${RAW_DIR}/${ORDER_WINDOW_FILE}`, pointer: windowEvidencePointer(record, null) })];
}

const ORDER_WINDOW_STEP = Object.freeze({ id: 'order-window', run: orderWindowStep, rows: orderWindowRows });

const GIFT_CARD_CENSUS_STEP = Object.freeze({
  id: 'gift-card-census',
  run: (ctx) => giftCards.giftCardCensusStep(ctx, bulk),
  rows: (record) => record.rows || [],
});

// ---------------------------------------------------------------------------------------------
// Step 5 -- questions to the merchant, raised by earlier steps as `record.questions[]`
// ---------------------------------------------------------------------------------------------

// Deterministic per discovery run and question, so a crash between creating the action and
// recording it never asks twice.
function questionRequestId(startedAt, key) {
  const hex = crypto.createHash('sha256').update(`shopify-discovery\0${startedAt}\0${key}`).digest('hex');
  return `uar_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function ensureQuestion(ctx, question) {
  const requestId = questionRequestId(ctx.state.startedAt, question.key);
  try {
    return await readUserAction(ctx.projectDir, requestId);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return createUserAction(ctx.projectDir, {
    requestId,
    kind: 'question',
    stage: 'discovery',
    title: question.title,
    prompt: question.prompt,
    response: { mode: question.response && question.response.mode ? question.response.mode : 'choice' },
    choices: question.choices || [],
    artifactRefs: question.artifactRefs || [],
  });
}

async function questionsStep(ctx) {
  const questions = [];
  for (const [stepId, entry] of Object.entries(ctx.state.steps)) {
    for (const question of (entry.record && entry.record.questions) || []) questions.push({ stepId, ...question });
  }
  const answers = {};
  const pending = [];
  for (const question of questions) {
    const action = await ensureQuestion(ctx, question);
    if (action.status === 'answered') {
      answers[question.key] = { stepId: question.stepId, requestId: action.requestId, answer: action.answer, evidence: `orchestration/user-actions/${action.requestId}.json` };
    } else {
      pending.push(action.requestId);
    }
  }
  if (pending.length) return { awaiting: pending };
  return { answers };
}

// ---------------------------------------------------------------------------------------------
// Step 6 -- the coverage file and the raw-capture index
// ---------------------------------------------------------------------------------------------

function countCell(entry) {
  if (entry.count === null) return '—';
  return entry.countExact ? String(entry.count) : `≥ ${entry.count} (not exact)`;
}

function renderIndex(capture, rows, generatedAt) {
  const lines = [
    '# Shopify discovery capture',
    '',
    `Generated ${generatedAt}. Raw evidence only: \`source-profile.md\` and \`source-schema.json\` are synthesized from it.`,
    '',
    '| Entity | Count | Samples | File |',
    '| --- | --- | --- | --- |',
    ...capture.entities.map((entry) => `| ${entry.entity} | ${countCell(entry)} | ${entry.sampleCount} | \`${entry.file}\` |`),
    '',
    `Coverage rows: ${rows.length} (\`source-coverage.json\`).`,
  ];
  for (const row of rows) lines.push(`- \`${row.coverageId}\` — ${row.reason}`);
  return `${lines.join('\n')}\n`;
}

async function coverageStep(ctx) {
  const capture = ctx.state.steps.capture && ctx.state.steps.capture.record;
  if (!capture) throw new ShopifyDiscoveryStop('shopify_discovery_state_invalid', 'the capture step is not recorded; re-run discovery');
  const answers = (ctx.state.steps.questions && ctx.state.steps.questions.record && ctx.state.steps.questions.record.answers) || {};
  const stepRows = [];
  for (const step of ctx.steps) {
    const entry = ctx.state.steps[step.id];
    if (!entry || !entry.record || step.id === 'capture' || step.id === 'coverage') continue;
    const rows = typeof step.rows === 'function' ? step.rows(entry.record, answers) : entry.record.rows;
    if (Array.isArray(rows)) stepRows.push(...rows);
  }
  const generatedAt = ctx.now();
  const rows = buildShopifyCoverageRows({ captureFailures: capture.failed, stepRows, rawDir: RAW_DIR });
  const file = buildCoverageFile({ platform: 'shopify', adapter: 'shopify', rows, generatedAt });
  await writeJsonAtomic(path.join(ctx.rawDir, 'source-coverage.json'), file);
  await fs.writeFile(path.join(ctx.rawDir, 'README.md'), renderIndex(capture, file.rows, generatedAt), 'utf8');
  return { rows: file.rows.map((row) => row.coverageId) };
}

// ---------------------------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------------------------

const DEFAULT_STEPS = Object.freeze([
  { id: 'capture', run: captureStep },
  WITHHELD_DETAILS_STEP,
  GIFT_CARD_CENSUS_STEP,
  ORDER_WINDOW_STEP,
  { id: 'questions', run: questionsStep },
  { id: 'coverage', run: coverageStep },
]);

// Forget what the named entities captured, so the next run reads exactly those again. The capture
// and coverage records are re-derived; every other recorded step is kept.
async function resetEntities(projectDir, rawDir, entities, now, store) {
  if (!entities.length) return;
  const known = new Set(ALL_READS.map((read) => read.entity));
  for (const entity of entities) {
    if (!known.has(entity)) throw new ShopifyDiscoveryStop('shopify_entity_unknown', `unknown Shopify entity ${entity}; known: ${[...known].join(', ')}`);
    await fs.rm(path.join(rawDir, entityFile(entity)), { force: true });
  }
  const state = await readSteps(rawDir, now, store);
  delete state.steps.capture;
  delete state.steps.coverage;
  if (await protectedFields.resetProbeEntities(projectDir, entities)) delete state.steps['withheld-details'];
  await writeSteps(rawDir, state);
}

async function runDiscovery({
  projectDir,
  store,
  execute,
  steps = DEFAULT_STEPS,
  reads = ALL_READS,
  sampleLimit = SAMPLE_LIMIT,
  reread = [],
  restart = false,
  now = () => new Date().toISOString(),
  progress = () => {},
  sessionCheck = async () => ({ ok: true }),
} = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  if (typeof execute !== 'function') throw new Error('execute is required');
  const boundStore = normalizeStore(store);
  const rawDir = path.join(projectDir, RAW_DIR);
  if (restart) await restartDiscovery(projectDir, rawDir, boundStore);
  // Bind before anything is read or reset: a different store's data is refused here, and the
  // store is recorded in the steps file before the first read of a new run.
  await assertBoundToStore(rawDir, boundStore);
  await fs.mkdir(path.join(rawDir, ENTITIES_DIR), { recursive: true });
  await resetEntities(projectDir, rawDir, reread, now, boundStore);
  const state = await readSteps(rawDir, now, boundStore);
  if (!state.steps || typeof state.steps !== 'object') state.steps = {};
  await writeSteps(rawDir, state);

  const ran = [];
  for (const step of steps) {
    if (state.steps[step.id] && state.steps[step.id].status === 'done') continue;
    progress(`Shopify discovery step ${step.id}`, { step: step.id });
    const ctx = { projectDir, rawDir, store: boundStore, execute, reads, sampleLimit, now, progress, state, steps, sessionCheck };
    let record;
    try {
      record = await step.run(ctx);
    } catch (error) {
      // The connection lapsed: hold at a re-approval request. Recorded steps and
      // captured entities are kept, so the resumed run reads only what is not yet captured.
      if (error instanceof ShopifyCliError && error.code === 'source_auth_expired') {
        const action = await recordAuthExpired(projectDir, { stage: 'discovery', store: boundStore });
        throw new ShopifyDiscoveryStop('source_auth_expired', `the Shopify connection for ${boundStore} expired during discovery step ${step.id}. Re-approval request ${action.requestId} is pending: run the Shopify session check (with --connect if asked), then answer it and run discovery again. Finished reads are not repeated.`, { step: step.id, requestId: action.requestId });
      }
      throw error;
    }
    ran.push(step.id);
    if (record && Array.isArray(record.awaiting)) {
      return { status: 'awaiting_user_action', requestIds: record.awaiting, stepsRun: ran };
    }
    state.steps[step.id] = { status: 'done', completedAt: now(), record: record || {} };
    await writeSteps(rawDir, state);
  }
  const coverage = state.steps.coverage && state.steps.coverage.record;
  return { status: 'complete', stepsRun: ran, rows: coverage ? coverage.rows : [] };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { project: null, store: null, reread: [], restart: false, confirmWithheldExport: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project') { args.project = argv[i + 1]; i += 1; }
    else if (arg === '--store') { args.store = argv[i + 1]; i += 1; }
    else if (arg === '--reread') { args.reread.push(argv[i + 1]); i += 1; }
    else if (arg === '--restart') args.restart = true;
    else if (arg === '--confirm-withheld-export') { args.confirmWithheldExport = argv[i + 1]; i += 1; }
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

const USAGE = 'Usage: shopify-discovery.js --project <migrations-root>/<project> (--store <shop>.myshopify.com [--reread <entity> ...] [--restart] | --confirm-withheld-export owner-exported) [--progress-log <path>]\n';

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  const logger = createProgressLogger({ script: 'skills/wix-replatform/resources/rp-source-shopify/scripts/shopify-discovery.js', ...parsed.progress });
  let args;
  try {
    args = parseArgs(parsed.args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (args.help) { process.stdout.write(USAGE); return 0; }
  if (!args.project || (!args.store && !args.confirmWithheldExport) || (args.store && args.confirmWithheldExport)) { process.stderr.write(USAGE); return 1; }
  logger.start('Shopify discovery started', { phase: 'discovery' });
  try {
    if (args.confirmWithheldExport) {
      try {
        const confirmation = await protectedFields.confirmWithheldExport(path.resolve(args.project), args.confirmWithheldExport);
        process.stdout.write(`${JSON.stringify({ ok: true, status: 'confirmed', file: protectedFields.WITHHELD_EXPORT_FILE, confirmation })}\n`);
        logger.complete('Shopify withheld-details export confirmed', { phase: 'discovery' });
        return 0;
      } catch (error) {
        throw new ShopifyDiscoveryStop('shopify_withheld_export_confirmation_failed', error.message);
      }
    }
    const store = normalizeStore(args.store);
    // Discovery starts only after a passing session check for this store, approved from a
    // confirmed dedicated migration staff account.
    await assertConnectionReady(path.resolve(args.project), store);
    const execute = createStoreExecutor({ store });
    const result = await runDiscovery({
      projectDir: path.resolve(args.project),
      store,
      execute,
      reread: args.reread,
      restart: args.restart,
      sessionCheck: async () => {
        try {
          await runSessionCheck({ projectDir: path.resolve(args.project), store, askFirstConnection: false });
          return { ok: true };
        } catch (error) {
          if (error instanceof ShopifySessionStop || error instanceof ShopifyCliError) return { ok: false, error: { code: error.code, message: error.message } };
          throw error;
        }
      },
      progress: (message, fields) => logger.progress(message, { phase: 'discovery', ...fields }),
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    logger.complete(`Shopify discovery ${result.status}`, { phase: 'discovery' });
    return result.status === 'complete' ? 0 : 3;
  } catch (error) {
    if (error instanceof ShopifyDiscoveryStop || error instanceof ShopifyCliError || error instanceof ShopifySessionStop) {
      process.stdout.write(`${JSON.stringify({ ok: false, status: 'stopped', code: error.code, message: error.message })}\n`);
      logger.error(error.message, { phase: 'discovery' });
      return 2;
    }
    throw error;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  RAW_DIR,
  STEPS_FILE,
  DEFAULT_STEPS,
  HANDOFF_FILES,
  ShopifyDiscoveryStop,
  captureEntity,
  captureStep,
  questionsStep,
  coverageStep,
  unavailableStep,
  orderWindowStep,
  orderWindowRows,
  WITHHELD_DETAILS_STEP,
  ORDER_WINDOW_STEP,
  GIFT_CARD_CENSUS_STEP,
  ORDER_WINDOW_FILE,
  CONNECTION_FILES,
  questionRequestId,
  runDiscovery,
  normalizeStore,
  parseArgs,
};
