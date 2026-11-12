'use strict';

// Shopify never exposes a reusable gift-card code through this adapter. This module
// therefore keeps cards out of Wix import files, gates every read against Shopify's exact count,
// and derives the merchant's per-card cutover obligation from durable local evidence.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { upsertAdapterCoverageRows, writeJsonAtomic } = require('../../../lib/source-coverage.js');
const { ShopifyCliError } = require('./shopify-cli.js');

const GIFT_QUERY = 'gift-cards';
const GIFT_CODES_COVERAGE_ID = 'shopify:gift-card-codes';
const GIFT_READ_COVERAGE_ID = 'shopify:gift-cards';
const GIFT_ACTION_CODE = 'shopify-gift-card-codes-not-migrated';
const RAW_DISCOVERY_DIR = 'data/shopify-discovery';
const EXTRACT_DIR = 'data/source-extract';
const CUTOVER_DIR = 'data/shopify-cutover';
const CENSUS_FILE = `${RAW_DISCOVERY_DIR}/gift-card-census.json`;
const ACTIVITY_FILE = `${CUTOVER_DIR}/gift-card-activity.json`;
const REMEDY_FILE = `${CUTOVER_DIR}/gift-card-remedy.json`;
const OWED_CSV_FILE = `${CUTOVER_DIR}/gift-cards-owed.csv`;
const CLOSED_TEXT = 'Every owed gift card was replaced and its holder told, against the final read';
const COUNT_WAITS_MS = Object.freeze([2000, 4000]);

function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    const error = new Error(`invalid plain decimal ${JSON.stringify(value)}`);
    error.code = 'shopify_gift_card_amount_invalid';
    throw error;
  }
  const [whole, fraction = ''] = value.split('.');
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function scaleTo(value, scale) {
  return value.units * (10n ** BigInt(scale - value.scale));
}

function compareDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaleTo(left, scale);
  const b = scaleTo(right, scale);
  return a === b ? 0 : (a < b ? -1 : 1);
}

function formatDecimal(units, scale) {
  const negative = units < 0n;
  let digits = String(negative ? -units : units);
  if (scale) digits = digits.padStart(scale + 1, '0');
  const value = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return negative ? `-${value}` : value;
}

function sumMoney(rows) {
  const totals = new Map();
  for (const money of rows) {
    if (!money || typeof money.currencyCode !== 'string' || !money.currencyCode) {
      const error = new Error('gift-card money has no currencyCode');
      error.code = 'shopify_gift_card_amount_invalid';
      throw error;
    }
    const amount = decimal(money.amount);
    const prior = totals.get(money.currencyCode);
    if (!prior) totals.set(money.currencyCode, amount);
    else {
      const scale = Math.max(prior.scale, amount.scale);
      totals.set(money.currencyCode, { units: scaleTo(prior, scale) + scaleTo(amount, scale), scale });
    }
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => [currency, formatDecimal(total.units, total.scale)]));
}

function isPositive(amount) {
  return decimal(amount).units > 0n;
}

function sanitizeCard(card) {
  if (!card || typeof card !== 'object' || typeof card.id !== 'string') {
    const error = new Error('gift-card record has no id');
    error.code = 'shopify_gift_card_amount_invalid';
    throw error;
  }
  // Validate both money fields even though only balance decides what is owed.
  decimal(card.balance && card.balance.amount);
  decimal(card.initialValue && card.initialValue.amount);
  if (!card.balance || typeof card.balance.currencyCode !== 'string' || !card.initialValue || typeof card.initialValue.currencyCode !== 'string') {
    const error = new Error('gift-card money has no currencyCode');
    error.code = 'shopify_gift_card_amount_invalid';
    throw error;
  }
  return {
    id: card.id,
    lastCharacters: card.lastCharacters || null,
    balance: { amount: card.balance.amount, currencyCode: card.balance.currencyCode },
    initialValue: { amount: card.initialValue.amount, currencyCode: card.initialValue.currencyCode },
    enabled: card.enabled === true,
    expiresOn: card.expiresOn || null,
    createdAt: card.createdAt || null,
  };
}

function summarizeCards(cards) {
  const sanitized = cards.map(sanitizeCard);
  const owed = sanitized.filter((card) => isPositive(card.balance.amount));
  return {
    cards: sanitized,
    owed,
    cardCount: sanitized.length,
    owedCount: owed.length,
    owedBalance: sumMoney(owed.map((card) => card.balance)),
    owedDisabledOrExpiredCount: owed.filter((card) => card.enabled === false || Boolean(card.expiresOn)).length,
  };
}

function giftCodesCoverageRow(evidence = CENSUS_FILE) {
  return {
    coverageId: GIFT_CODES_COVERAGE_ID,
    platform: 'shopify',
    capability: 'commerce.gift-cards',
    sourceEntity: 'gift-card-codes',
    routes: ['gift-cards'],
    reason: 'route-unsupported',
    evidence: { artifact: evidence, pointer: 'every card is code-less; see owed counts and balances' },
    recoverability: 'not-recoverable',
    disposition: null,
  };
}

function failedReadCoverageRow({ artifact, pointer, recoveryAction }) {
  return {
    coverageId: GIFT_READ_COVERAGE_ID,
    platform: 'shopify',
    capability: 'commerce.gift-cards',
    sourceEntity: 'gift-cards',
    routes: ['gift-cards'],
    reason: 'capture-failed',
    evidence: { artifact, pointer },
    recoverability: 'import-operator',
    recoveryAction,
    disposition: null,
  };
}

function errorsText(errors) {
  return (errors || []).map((error) => String((error && error.message) || 'GraphQL error')).join('; ').slice(0, 500);
}

function transientError(error) {
  if (!error) return false;
  if (error instanceof ShopifyCliError && error.code === 'shopify_throttled') return true;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)) return true;
  return /\b(?:HTTP )?5\d\d\b|network|socket|timed? ?out|temporar/i.test(`${String(error.message || '')}\n${String(error.stderrTail || '')}`);
}

function transientGraphql(errors) {
  return (errors || []).some((error) => {
    const code = error && error.extensions && error.extensions.code;
    return code === 'THROTTLED' || code === 'INTERNAL_SERVER_ERROR' || /temporar|throttl/i.test(String(error && error.message));
  });
}

function countQuery(createdAt = null) {
  const filter = createdAt ? `query: "created_at:<='${createdAt}'", ` : '';
  return `query RpGiftCardsCount { giftCardsCount(${filter}limit: null) { count precision } }`;
}

async function readGiftCardCount(execute, { createdAt = null, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const call = typeof execute.once === 'function' ? execute.once.bind(execute) : execute;
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await call(countQuery(createdAt));
      if (result && Array.isArray(result.errors) && result.errors.length) {
        last = { errors: result.errors };
        if (transientGraphql(result.errors) && attempt < 2) { await sleep(COUNT_WAITS_MS[attempt]); continue; }
        return { error: errorsText(result.errors), errors: result.errors };
      }
      const counted = result && result.data && result.data.giftCardsCount;
      if (!counted || !Number.isInteger(counted.count)) return { error: 'the count read returned no integer count' };
      return { count: counted.count, precision: counted.precision || null };
    } catch (error) {
      if (error instanceof ShopifyCliError && error.code === 'source_auth_expired') throw error;
      last = { thrown: error };
      if (transientError(error) && attempt < 2) { await sleep(COUNT_WAITS_MS[attempt]); continue; }
      return { error: String(error.message || error), thrown: error };
    }
  }
  return { error: last && last.thrown ? String(last.thrown.message || last.thrown) : errorsText(last && last.errors) };
}

async function writeNdjsonAtomic(file, rows) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
  await fsp.rename(temp, file);
}

function safeOperationId(operationId) {
  return String(operationId || 'unknown').split('/').filter(Boolean).pop().replace(/[^A-Za-z0-9._-]/g, '_');
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function coverageHasGiftCodes(projectDir) {
  for (const rel of ['discovery/source-coverage.json', `${RAW_DISCOVERY_DIR}/source-coverage.json`]) {
    const file = await readJson(path.join(projectDir, rel));
    if (file && Array.isArray(file.rows) && file.rows.some((row) => row.coverageId === GIFT_CODES_COVERAGE_ID)) return true;
  }
  return false;
}

async function giftCardReassemble(context) {
  let summary;
  try {
    const cards = [];
    for await (const card of context.records) cards.push(card);
    summary = summarizeCards(cards);
  } catch (error) {
    if (error.code === 'shopify_gift_card_amount_invalid') return { ok: false, errorCode: error.code, message: error.message, evidence: { valueClass: 'invalid decimal amount' } };
    throw error;
  }
  const readCreatedAt = context.entry.createdAt;
  const counted = await readGiftCardCount(context.execute, { createdAt: readCreatedAt, sleep: context.sleep });
  const atOrBefore = summary.cards.filter((card) => Number.isFinite(Date.parse(card.createdAt)) && Date.parse(card.createdAt) <= Date.parse(readCreatedAt)).length;
  if (counted.error || counted.precision !== 'EXACT') {
    return { ok: false, errorCode: 'shopify_gift_card_count_inexact', message: counted.error || `Shopify returned count precision ${counted.precision || 'missing'}`, evidence: { precision: counted.precision || null, error: counted.error || null, received: atOrBefore } };
  }
  if (atOrBefore < counted.count) {
    return { ok: false, errorCode: 'shopify_gift_card_count_short', message: `the gift-card read contains ${atOrBefore} card(s) created by ${readCreatedAt}, below Shopify's exact count ${counted.count}`, evidence: { expected: counted.count, received: atOrBefore, precision: counted.precision, readCreatedAt } };
  }

  const read = {
    operationId: context.entry.operationId || null,
    createdAt: readCreatedAt || null,
    completedAt: context.entry.completedAt || null,
    lineCount: context.lines,
    exactCount: counted.count,
    countPrecision: counted.precision,
  };
  const entryFields = {
    giftCardCount: summary.cardCount,
    owedGiftCardCount: summary.owedCount,
    owedGiftCardBalance: summary.owedBalance,
    giftCardCountCheck: { expected: counted.count, received: atOrBefore, precision: counted.precision, queryCreatedAt: readCreatedAt },
  };

  if (context.caller === 'census') {
    const census = {
      cardCount: summary.cardCount,
      owedCount: summary.owedCount,
      owedBalance: summary.owedBalance,
      owedDisabledOrExpiredCount: summary.owedDisabledOrExpiredCount,
      read,
    };
    await writeJsonAtomic(path.join(context.projectDir, CENSUS_FILE), census);
    return { ok: true, records: [], result: census, entry: entryFields };
  }

  const cardsFile = `${EXTRACT_DIR}/gift-card-reads/${safeOperationId(context.entry.operationId)}.ndjson`;
  await writeNdjsonAtomic(path.join(context.projectDir, cardsFile), summary.cards);
  entryFields.cardsFile = cardsFile;
  const response = { ok: true, records: summary.cards, outputFile: 'gift-cards-codeless.ndjson', entry: entryFields };
  if (summary.cardCount > 0 && !(await coverageHasGiftCodes(context.projectDir))) {
    const row = giftCodesCoverageRow(`${EXTRACT_DIR}/extract-manifest.json`);
    const update = await upsertAdapterCoverageRows(context.projectDir, { adapter: 'shopify', rows: [row] });
    response.stop = {
      code: 'shopify_gift_card_codes_unreadable',
      message: 'Shopify gift cards first appeared during the extract. Their reusable codes are unreadable; the coverage row was added and the run must return to mapping.',
      details: { coverageId: row.coverageId, ...update },
    };
  }
  return response;
}

async function giftCardFailedHandler(context) {
  await fsp.rm(path.join(context.stagingDir, 'gift-cards.jsonl'), { force: true });
  const artifact = context.caller === 'extract' ? `${EXTRACT_DIR}/extract-manifest.json` : `${RAW_DISCOVERY_DIR}/bulk-manifest.json`;
  const evidence = context.entry.error && context.entry.error.evidence;
  const pointer = `queries.gift-cards; ${context.entry.errorCode || 'unknown'}${evidence ? `; ${JSON.stringify(evidence)}` : ''}`;
  const row = failedReadCoverageRow({
    artifact,
    pointer,
    recoveryAction: context.caller === 'extract'
      ? 'Fix the count or amount read, then run shopify-extract.js --retry-failed.'
      : 'The extract reads gift cards again with the same exact-count gate; fix source access before import.',
  });
  if (context.caller === 'extract') await upsertAdapterCoverageRows(context.projectDir, { adapter: 'shopify', rows: [row] });
  return { handlerOutcome: { coverageId: row.coverageId, ...(context.caller === 'extract' ? {} : { row }) } };
}

function registerGiftCardHandlers(bulk) {
  bulk.registerHandlers({
    failed: { byQuery: { [GIFT_QUERY]: giftCardFailedHandler } },
    reassemble: { [GIFT_QUERY]: giftCardReassemble },
  });
}

async function giftCardCensusStep(ctx, bulk) {
  const manifestPath = path.join(ctx.rawDir, 'bulk-manifest.json');
  const existing = await readJson(manifestPath);
  if (!existing) {
    const initial = await readGiftCardCount(ctx.execute);
    if (initial.error || initial.precision !== 'EXACT') {
      return { rows: [failedReadCoverageRow({ artifact: `${RAW_DISCOVERY_DIR}/discovery-steps.json`, pointer: initial.error || `giftCardsCount precision ${initial.precision || 'missing'}`, recoveryAction: 'Fix the Shopify gift-card count read; the extract will read the cards again through its exact-count gate.' })] };
    }
    if (initial.count === 0) return { rows: [], count: 0, precision: 'EXACT' };
  }
  registerGiftCardHandlers(bulk);
  const runner = bulk.createBulkRunner({
    projectDir: ctx.projectDir,
    store: ctx.store,
    caller: 'census',
    manifestPath,
    stagingDir: path.join(ctx.rawDir, 'bulk-staging'),
    queries: existing ? null : [{ name: GIFT_QUERY, entity: GIFT_QUERY, text: bulk.generateQueryText(GIFT_QUERY) }],
    execute: ctx.execute,
    now: () => Date.parse(ctx.now()),
    progress: ctx.progress,
  });
  const result = await runner.run();
  const entry = result.manifest && result.manifest.queries && result.manifest.queries[GIFT_QUERY];
  if (entry && entry.state === 'done') {
    return {
      rows: entry.result && entry.result.cardCount > 0 ? [giftCodesCoverageRow()] : [],
      census: entry.result || null,
    };
  }
  const row = entry && entry.handlerOutcome && entry.handlerOutcome.row;
  return { rows: [row || failedReadCoverageRow({ artifact: `${RAW_DISCOVERY_DIR}/bulk-manifest.json`, pointer: `queries.gift-cards state ${(entry && entry.state) || 'unknown'}`, recoveryAction: 'Fix source access before import; the extract reads gift cards again.' })] };
}

async function readNdjson(file) {
  const text = await fsp.readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function manifestFiles(projectDir) {
  const dir = path.join(projectDir, EXTRACT_DIR);
  let names = [];
  try { names = await fsp.readdir(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return names.filter((name) => name === 'extract-manifest.json' || /^extract-manifest\..+\.json$/.test(name)).map((name) => path.join(dir, name));
}

async function giftCardReads(projectDir) {
  const currentPath = path.join(projectDir, EXTRACT_DIR, 'extract-manifest.json');
  const reads = [];
  let currentManifest = null;
  let currentRead = null;
  let currentCardsFileMissing = false;
  for (const file of await manifestFiles(projectDir)) {
    const manifest = await readJson(file);
    if (file === currentPath) currentManifest = manifest;
    const entry = manifest && manifest.queries && manifest.queries[GIFT_QUERY];
    if (!entry || entry.state !== 'done' || !entry.cardsFile || !Number.isFinite(Date.parse(entry.createdAt))) continue;
    try {
      const read = { entry, cards: await readNdjson(path.join(projectDir, entry.cardsFile)), manifestPath: file, current: file === currentPath };
      reads.push(read);
      if (read.current) currentRead = read;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (file === currentPath) currentCardsFileMissing = true;
    }
  }
  reads.sort((a, b) => Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt));
  return { latest: reads[reads.length - 1] || null, currentManifest, currentRead, currentCardsFileMissing, reads };
}

function replacementClears(card, replacement) {
  if (!replacement || replacement.currency !== card.balance.currencyCode) return false;
  try { return compareDecimals(decimal(replacement.replacementAmount), decimal(card.balance.amount)) >= 0; }
  catch { return false; }
}

function dateInTimezone(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now instanceof Date ? now : new Date(now));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function balanceText(balance) {
  const entries = Object.entries(balance);
  return entries.length ? entries.map(([currency, amount]) => `${currency} ${amount}`).join(', ') : 'no positive balance';
}

async function hasGiftCodesRow(projectDir) {
  return coverageHasGiftCodes(projectDir);
}

async function evaluateGiftCardCutover(projectDir, { now = new Date() } = {}) {
  if (!(await hasGiftCodesRow(projectDir))) return { present: false, action: null, cutoverAction: null };
  const { latest, currentManifest, currentRead, currentCardsFileMissing } = await giftCardReads(projectDir);
  const activity = await readJson(path.join(projectDir, ACTIVITY_FILE));
  const remedy = await readJson(path.join(projectDir, REMEDY_FILE), { replacements: [] });
  const replacements = new Map(((remedy && remedy.replacements) || []).map((row) => [row.id, row]));
  const latestSummary = latest ? summarizeCards(latest.cards) : { owed: [], owedCount: 0, owedBalance: {} };
  const current = currentManifest && currentManifest.queries && currentManifest.queries[GIFT_QUERY];
  const finalExists = Boolean(activity && Number.isFinite(Date.parse(activity.activityStoppedAt)) && currentRead && Date.parse(currentRead.entry.createdAt) > Date.parse(activity.activityStoppedAt));
  let finalSummary = null;
  if (finalExists) finalSummary = summarizeCards(currentRead.cards);
  const owed = finalSummary ? finalSummary.owed : latestSummary.owed;
  const uncleared = finalSummary ? owed.filter((card) => !replacementClears(card, replacements.get(card.id))) : owed;
  if (finalSummary && uncleared.length === 0) return { present: true, closed: true, action: null, cutoverAction: CLOSED_TEXT, finalRead: current };

  const balances = sumMoney(uncleared.map((card) => card.balance));
  let actionText;
  if (!latest) actionText = 'Gift-card read failed — see shopify:gift-cards. No balance can be treated as cleared.';
  else if (!finalSummary) {
    const missing = currentCardsFileMissing ? ' The current gift-card read file is missing, so it cannot be final.' : '';
    actionText = `Awaiting the final gift-card read after activity stops; ${latestSummary.owedCount} card(s), ${balanceText(latestSummary.owedBalance)}, remain potentially owed.${missing}`;
  }
  else actionText = `Replace ${uncleared.length} Shopify gift card(s) and notify their holders; ${balanceText(balances)} remains owed.`;
  if (remedy && remedy.keepRedeemingUntil) {
    const today = dateInTimezone(now, remedy.ianaTimezone || 'UTC');
    actionText += today > remedy.keepRedeemingUntil
      ? ` The keep-redeeming date ${remedy.keepRedeemingUntil} has passed; balances are still owed.`
      : ` Shopify keeps redeeming until ${remedy.keepRedeemingUntil}; this does not clear the balances.`;
  }
  return {
    present: true,
    closed: false,
    finalRead: finalSummary ? current : null,
    latestRead: latest && latest.entry,
    uncleared,
    balances: finalSummary ? balances : latestSummary.owedBalance,
    cutoverAction: actionText,
    action: {
      code: GIFT_ACTION_CODE,
      severity: 'high',
      action: actionText,
      deadlineReason: 'outstanding gift-card balances are customer money',
      entity: 'commerce.gift-cards',
      affectedCount: finalSummary ? uncleared.length : latestSummary.owedCount,
    },
  };
}

module.exports = {
  GIFT_QUERY,
  GIFT_CODES_COVERAGE_ID,
  GIFT_READ_COVERAGE_ID,
  GIFT_ACTION_CODE,
  CENSUS_FILE,
  ACTIVITY_FILE,
  REMEDY_FILE,
  OWED_CSV_FILE,
  CLOSED_TEXT,
  COUNT_WAITS_MS,
  decimal,
  compareDecimals,
  formatDecimal,
  sumMoney,
  isPositive,
  sanitizeCard,
  summarizeCards,
  giftCodesCoverageRow,
  failedReadCoverageRow,
  countQuery,
  readGiftCardCount,
  giftCardReassemble,
  giftCardFailedHandler,
  registerGiftCardHandlers,
  giftCardCensusStep,
  readJson,
  writeNdjsonAtomic,
  readNdjson,
  giftCardReads,
  replacementClears,
  dateInTimezone,
  evaluateGiftCardCutover,
};
