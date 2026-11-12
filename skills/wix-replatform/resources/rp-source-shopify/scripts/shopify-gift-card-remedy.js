#!/usr/bin/env node
'use strict';

// Record merchant-provided gift-card remedies and export the current owed-card list.
// This script never creates a Wix card and never contacts a holder.

const fs = require('node:fs/promises');
const path = require('node:path');
const { readEnvFile } = require('../../../lib/config-env.js');
const { SHOPIFY_SOURCE_ENV } = require('../../../lib/source-access.js');
const { writeJsonAtomic } = require('../../../lib/source-coverage.js');
const { createStoreExecutor } = require('../lib/shopify-cli.js');
const session = require('../lib/shopify-session.js');
const gift = require('../lib/shopify-gift-cards.js');

const COLUMNS = Object.freeze(['id', 'wixGiftCardId', 'replacementAmount', 'currency', 'holderNotifiedOn', 'notificationConfirmedBy']);
const USAGE = 'Usage: shopify-gift-card-remedy.js <export|activity-stopped|record-replacements|keep-redeeming> --project <project> [--at <ISO> | --evidence <file.csv> | --until <YYYY-MM-DD>] [--by <name>]\n';

function parseArgs(argv) {
  const out = { command: argv[0] || null, project: null, at: null, evidence: null, until: null, by: null, help: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (['--project', '--at', '--evidence', '--until', '--by'].includes(arg)) { out[arg.slice(2)] = argv[i + 1]; i += 1; }
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => value !== ''));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readRemedy(projectDir) {
  return gift.readJson(path.join(projectDir, gift.REMEDY_FILE), { replacements: [] });
}

async function writeRemedy(projectDir, value) {
  await writeJsonAtomic(path.join(projectDir, gift.REMEDY_FILE), value);
}

async function recordActivityStopped(projectDir, { at, by, now = () => new Date().toISOString() } = {}) {
  if (!Number.isFinite(Date.parse(at))) throw new Error('--at must be an ISO timestamp');
  if (!by) throw new Error('--by is required');
  const record = { activityStoppedAt: new Date(at).toISOString(), recordedBy: by, recordedAt: now() };
  await writeJsonAtomic(path.join(projectDir, gift.ACTIVITY_FILE), record);
  return record;
}

async function shopTimezone(execute) {
  const result = await execute('query RpGiftCardShopTimezone { shop { ianaTimezone } }');
  if (result.errors && result.errors.length) throw new Error(`Shopify shop timezone could not be read: ${result.errors.map((error) => error.message).join('; ')}`);
  const timezone = result.data && result.data.shop && result.data.shop.ianaTimezone;
  if (typeof timezone !== 'string' || !timezone) throw new Error('Shopify shop timezone was missing');
  // Make Intl validate the IANA identifier now, before changing any file.
  gift.dateInTimezone(new Date(), timezone);
  return timezone;
}

async function recordReplacements(projectDir, { evidence, by, execute, now = () => new Date().toISOString() } = {}) {
  if (!evidence) throw new Error('--evidence is required');
  if (!by) throw new Error('--by is required');
  if (typeof execute !== 'function') throw new Error('a Shopify executor is required');
  const timezone = await shopTimezone(execute);
  const today = gift.dateInTimezone(new Date(now()), timezone);
  const rows = parseCsv(await fs.readFile(evidence, 'utf8'));
  if (!rows.length || rows[0].length !== COLUMNS.length || !rows[0].every((value, index) => value === COLUMNS[index])) {
    throw new Error(`CSV columns must be exactly ${COLUMNS.join(',')}`);
  }
  const { latest } = await gift.giftCardReads(projectDir);
  if (!latest) throw new Error('no successful gift-card read exists');
  const cards = new Map(gift.summarizeCards(latest.cards).owed.map((card) => [card.id, card]));
  const seen = new Set();
  const replacements = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].length !== COLUMNS.length) throw new Error(`CSV row ${index + 1} has ${rows[index].length} columns, expected ${COLUMNS.length}`);
    const candidate = Object.fromEntries(COLUMNS.map((column, at) => [column, rows[index][at]]));
    const card = cards.get(candidate.id);
    if (!card) throw new Error(`CSV row ${index + 1}: id is not an owed card in the latest read`);
    if (seen.has(candidate.id)) throw new Error(`CSV row ${index + 1}: duplicate id ${candidate.id}`);
    seen.add(candidate.id);
    if (!candidate.wixGiftCardId || !candidate.holderNotifiedOn || !candidate.notificationConfirmedBy) throw new Error(`CSV row ${index + 1}: Wix card id and holder-notification evidence are required`);
    if (!validDate(candidate.holderNotifiedOn) || candidate.holderNotifiedOn > today) throw new Error(`CSV row ${index + 1}: holderNotifiedOn must be a valid date no later than today in ${timezone}`);
    const amount = gift.decimal(candidate.replacementAmount);
    if (amount.units <= 0n) throw new Error(`CSV row ${index + 1}: replacementAmount must be above zero`);
    if (candidate.currency !== card.balance.currencyCode) throw new Error(`CSV row ${index + 1}: currency must be ${card.balance.currencyCode}`);
    replacements.push({ ...candidate, recordedBy: by, recordedAt: now() });
  }
  if (!replacements.length) throw new Error('CSV must contain at least one owed-card replacement');
  const remedy = await readRemedy(projectDir);
  const merged = new Map(((remedy && remedy.replacements) || []).map((row) => [row.id, row]));
  replacements.forEach((row) => merged.set(row.id, row));
  const next = { ...remedy, ianaTimezone: timezone, replacements: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  await writeRemedy(projectDir, next);
  return next;
}

async function keepRedeeming(projectDir, { until, by, execute, now = () => new Date().toISOString() } = {}) {
  if (!validDate(until)) throw new Error('--until must be a YYYY-MM-DD calendar date');
  if (!by) throw new Error('--by is required');
  if (typeof execute !== 'function') throw new Error('a Shopify executor is required');
  const timezone = await shopTimezone(execute);
  const remedy = await readRemedy(projectDir);
  const next = { ...remedy, replacements: Array.isArray(remedy.replacements) ? remedy.replacements : [], keepRedeemingUntil: until, keepRedeemingRecordedBy: by, keepRedeemingRecordedAt: now(), ianaTimezone: timezone };
  await writeRemedy(projectDir, next);
  return next;
}

async function exportOwed(projectDir) {
  const { latest } = await gift.giftCardReads(projectDir);
  if (!latest) throw new Error('no successful gift-card read exists');
  const summary = gift.summarizeCards(latest.cards);
  const state = await gift.evaluateGiftCardCutover(projectDir);
  const uncleared = new Set((state.uncleared || summary.owed).map((card) => card.id));
  const lines = [['id', 'lastCharacters', 'balance', 'currency', 'enabled', 'expiresOn', 'replaced']];
  for (const card of summary.owed) {
    const replaced = state.finalRead && !uncleared.has(card.id) ? 'yes' : 'no';
    lines.push([card.id, card.lastCharacters || '', card.balance.amount, card.balance.currencyCode, card.enabled ? 'true' : 'false', card.expiresOn || '', replaced]);
  }
  const text = `${lines.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
  const file = path.join(projectDir, gift.OWED_CSV_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, file);
  return { file: gift.OWED_CSV_FILE, rows: summary.owed.length };
}

async function configuredStore(projectDir) {
  const values = await readEnvFile(path.join(projectDir, SHOPIFY_SOURCE_ENV));
  if (!values.SHOPIFY_SHOP_DOMAIN) throw new Error(`SHOPIFY_SHOP_DOMAIN is missing from ${SHOPIFY_SOURCE_ENV}`);
  return session.normalizeDomain(values.SHOPIFY_SHOP_DOMAIN);
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (error) { process.stderr.write(`${error.message}\n${USAGE}`); return 1; }
  if (args.help) { process.stdout.write(USAGE); return 0; }
  if (!args.project || !['export', 'activity-stopped', 'record-replacements', 'keep-redeeming'].includes(args.command)) { process.stderr.write(USAGE); return 1; }
  const projectDir = path.resolve(args.project);
  try {
    let result;
    if (args.command === 'export') result = await exportOwed(projectDir);
    else if (args.command === 'activity-stopped') result = await recordActivityStopped(projectDir, args);
    else {
      const store = await configuredStore(projectDir);
      await session.assertConnectionReady(projectDir, store);
      const execute = createStoreExecutor({ store });
      result = args.command === 'record-replacements'
        ? await recordReplacements(projectDir, { ...args, execute })
        : await keepRedeeming(projectDir, { ...args, execute });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, command: args.command, ...result })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, command: args.command, code: error.code || 'shopify_gift_card_remedy_invalid', message: error.message })}\n`);
    return 2;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { COLUMNS, parseArgs, parseCsv, validDate, csvCell, recordActivityStopped, shopTimezone, recordReplacements, keepRedeeming, exportOwed, main };
