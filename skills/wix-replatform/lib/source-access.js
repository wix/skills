'use strict';

// Source access that outlives the migration. A Shopify private-data run reads the
// store through a connection approved from a staff account the store owner created for the
// migration. That account can change the live store, so the owner removes it after cutover, and
// every completion report lists the removal as an operator action until the import operator
// records the owner's confirmation.
//
// The record is data/shopify-discovery/staff-access.json -- no secret and no personal data:
//   { schemaVersion: 1, accounts: [{ shopDomain, state: "pending"|"confirmed", createdAt,
//     reconstructed?, confirmedAt?, confirmation? }] }
// It is always written through a temp file and a rename.
//
// Reads are fail-visible: the action is listed while an entry is pending, while the file is
// unreadable, and while the file is missing but a passing session receipt shows a connection
// happened. Only a confirmed entry, or no evidence of any connection, lists nothing.

const fs = require('node:fs');
const path = require('node:path');
const { parseEnvText } = require('./config-env.js');

const SHOPIFY_ACCESS_DIR = 'data/shopify-discovery';
const STAFF_ACCESS_FILE = `${SHOPIFY_ACCESS_DIR}/staff-access.json`;
const SESSION_RECEIPT_FILE = `${SHOPIFY_ACCESS_DIR}/session-receipt.json`;
const SHOPIFY_SOURCE_ENV = 'config/source.shopify.env';
const STAFF_ACCESS_SCHEMA_VERSION = 1;
const STAFF_REMOVAL_CODE = 'shopify-staff-account-removal';
const STAFF_REMOVAL_CONFIRMATION = 'owner-removed-account';
const WITHHELD_EXPORT_FILE = `${SHOPIFY_ACCESS_DIR}/withheld-export.json`;
const SHOPIFY_COVERAGE_FILE = 'discovery/source-coverage.json';
const SHOPIFY_EXTRACT_MANIFEST_FILE = 'data/source-extract/extract-manifest.json';
const WITHHELD_EXPORT_CODE = 'shopify-withheld-details-export';
const WITHHELD_EXPORT_CONFIRMATION = 'owner-exported';
const SESSION_CHECK_SCRIPT = 'skills/wix-replatform/resources/rp-source-shopify/scripts/shopify-session-check.js';
const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function readJsonFileSync(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing', value: null };
    return { state: 'unreadable', value: null, error: error.message };
  }
  try {
    return { state: 'ok', value: JSON.parse(text) };
  } catch (error) {
    return { state: 'unreadable', value: null, error: error.message };
  }
}

function validIsoTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validAccount(entry) {
  if (!entry || typeof entry !== 'object'
    || !SHOPIFY_DOMAIN_PATTERN.test(entry.shopDomain)
    || !validIsoTime(entry.createdAt)
    || (entry.reconstructed !== undefined && entry.reconstructed !== true)) {
    return false;
  }
  if (entry.state === 'pending') {
    return entry.confirmedAt === undefined && entry.confirmation === undefined;
  }
  return entry.state === 'confirmed'
    && validIsoTime(entry.confirmedAt)
    && entry.confirmation === STAFF_REMOVAL_CONFIRMATION;
}

// { state: 'missing' | 'unreadable' | 'ok', accounts }
function readStaffAccess(projectDir) {
  const read = readJsonFileSync(path.join(projectDir, STAFF_ACCESS_FILE));
  if (read.state !== 'ok') return { state: read.state, accounts: [] };
  const value = read.value;
  if (!value || typeof value !== 'object'
    || value.schemaVersion !== STAFF_ACCESS_SCHEMA_VERSION
    || !Array.isArray(value.accounts)
    || value.accounts.length === 0
    || !value.accounts.every(validAccount)) {
    return { state: 'unreadable', accounts: [] };
  }
  return { state: 'ok', accounts: value.accounts };
}

// Temp file, then rename: a crash between the two leaves the previous file intact. `io` is
// injectable so a test can crash between them.
function writeJsonAtomicSync(file, value, io = fs) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  io.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  io.renameSync(temp, file);
}

function writeStaffAccess(projectDir, accounts, { io = fs } = {}) {
  writeJsonAtomicSync(path.join(projectDir, STAFF_ACCESS_FILE), { schemaVersion: STAFF_ACCESS_SCHEMA_VERSION, accounts }, io);
}

function readSessionReceipt(projectDir) {
  const read = readJsonFileSync(path.join(projectDir, SESSION_RECEIPT_FILE));
  return read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : null;
}

function passingReceipt(receipt) {
  return Boolean(receipt && typeof receipt.shopDomain === 'string' && Array.isArray(receipt.missingScopes) && receipt.missingScopes.length === 0);
}

function configuredShopDomain(projectDir) {
  try {
    const values = parseEnvText(fs.readFileSync(path.join(projectDir, SHOPIFY_SOURCE_ENV), 'utf8'));
    const value = String(values.SHOPIFY_SHOP_DOMAIN || '').trim().toLowerCase();
    return value || null;
  } catch {
    return null;
  }
}

function removalAction(domain, { recordProblem = null } = {}) {
  const prompt = `In this project, once the store owner confirms the migration staff account is removed, run \`node ${SESSION_CHECK_SCRIPT} --project <project> --confirm-staff-removal ${STAFF_REMOVAL_CONFIRMATION}\` (if it reports the record is unreadable or missing, run \`node ${SESSION_CHECK_SCRIPT} --project <project> --repair-staff-access\` first), then regenerate the completion report and check this action is gone. Requires Import Operator; the Cutover Operator asks the store owner to remove the account in Shopify Admin after cutover and after the last read from Shopify, including any catch-up.`;
  const reason = 'The Shopify staff account the migration connection was approved from can still change the live store through Shopify Admin until the store owner removes it.';
  return {
    code: STAFF_REMOVAL_CODE,
    severity: 'high',
    action: `Ask the store owner to remove the migration staff account from ${domain || 'the Shopify store'}. ${prompt}`,
    deadlineReason: recordProblem ? `${reason} Record ${recordProblem} — run ${SESSION_CHECK_SCRIPT} --repair-staff-access.` : reason,
    entity: domain || null,
    affectedCount: 1,
  };
}

// Operator-action rows for completion-report.json. Never throws for a damaged record.
function sourceAccessOperatorActions(projectDir) {
  const record = readStaffAccess(projectDir);
  const receipt = readSessionReceipt(projectDir);
  const configuredDomain = configuredShopDomain(projectDir);
  const receiptMatchesConfiguration = passingReceipt(receipt)
    && (!configuredDomain || receipt.shopDomain === configuredDomain);
  const connectedDomain = receiptMatchesConfiguration ? receipt.shopDomain : null;
  if (record.state === 'ok') {
    const actions = record.accounts.filter((entry) => entry.state === 'pending').map((entry) => removalAction(entry.shopDomain));
    if (connectedDomain && !record.accounts.some((entry) => entry.shopDomain === connectedDomain)) {
      actions.push(removalAction(connectedDomain, { recordProblem: 'has no entry for the connected store' }));
    }
    return actions;
  }
  const domain = configuredDomain || (receipt && receipt.shopDomain) || null;
  if (record.state === 'unreadable') return [removalAction(domain, { recordProblem: 'unreadable' })];
  // Missing: list it only when a passing receipt for the configured domain shows a connection.
  if (receiptMatchesConfiguration) {
    return [removalAction(receipt.shopDomain, { recordProblem: 'missing' })];
  }
  return [];
}

function withheldCoverageId(value) {
  return /^shopify:(?:customer|order)-(?:name|email|phone|address)$/.test(String(value))
    || value === 'shopify:customers-withheld-identity';
}

function manifestLatestReadAt(manifest) {
  const times = [];
  for (const entry of Object.values((manifest && manifest.queries) || {})) {
    for (const value of Object.values((entry && entry.readAt) || {})) {
      if (validIsoTime(value)) times.push(value);
    }
  }
  times.sort((a, b) => Date.parse(a) - Date.parse(b));
  return times[times.length - 1] || null;
}

function entityAffectedCount(manifest, coverageId) {
  if (coverageId === 'shopify:customers-withheld-identity') return Number(manifest && manifest.withheldIdentityCount) || 0;
  const entity = coverageId.startsWith('shopify:customer-') ? 'customers' : 'orders';
  const count = manifest && manifest.counts && manifest.counts[entity];
  if (count && Number.isInteger(count.expected)) return count.expected;
  if (count && Number.isInteger(count.received)) return count.received;
  const query = entity === 'customers' ? 'customers' : 'orders-core';
  return Number(manifest && manifest.queries && manifest.queries[query] && manifest.queries[query].records) || 0;
}

// A separate action remains after any mapping disposition until the merchant's
// export is attested after the latest Shopify read. Damaged or stale confirmation is simply open.
function withheldDetailsOperatorActions(projectDir) {
  const coverageRead = readJsonFileSync(path.join(projectDir, SHOPIFY_COVERAGE_FILE));
  if (coverageRead.state !== 'ok' || !coverageRead.value || !Array.isArray(coverageRead.value.rows)) return [];
  const coverageIds = coverageRead.value.rows.map((row) => row && row.coverageId).filter(withheldCoverageId).sort();
  if (!coverageIds.length) return [];
  const manifestRead = readJsonFileSync(path.join(projectDir, SHOPIFY_EXTRACT_MANIFEST_FILE));
  const manifest = manifestRead.state === 'ok' && manifestRead.value && typeof manifestRead.value === 'object' ? manifestRead.value : null;
  const latestReadAt = manifestLatestReadAt(manifest);
  const confirmationRead = readJsonFileSync(path.join(projectDir, WITHHELD_EXPORT_FILE));
  const confirmation = confirmationRead.state === 'ok' ? confirmationRead.value : null;
  const covered = confirmation
    && confirmation.schemaVersion === 1
    && confirmation.confirmation === WITHHELD_EXPORT_CONFIRMATION
    && validIsoTime(confirmation.confirmedAt)
    && validIsoTime(confirmation.afterReadAt)
    && Array.isArray(confirmation.coverageIds)
    && coverageIds.every((coverageId) => confirmation.coverageIds.includes(coverageId))
    && latestReadAt
    && Date.parse(confirmation.afterReadAt) >= Date.parse(latestReadAt);
  if (covered) return [];
  const affectedCount = Math.max(0, ...coverageIds.map((coverageId) => entityAffectedCount(manifest, coverageId)));
  return [{
    code: WITHHELD_EXPORT_CODE,
    severity: 'high',
    entity: 'customers',
    affectedCount,
    action: 'Ask the merchant to export customers and orders from Shopify Admin (or re-collect the withheld details) after the final Shopify read. Requires Import Operator: once the merchant confirms the export, run `shopify-discovery.js --project <project> --confirm-withheld-export owner-exported`, regenerate the completion report, and check this action is gone.',
    deadlineReason: 'Shopify holds the only copy of these details; export them before the store is closed.',
  }];
}

module.exports = {
  STAFF_ACCESS_FILE,
  SESSION_RECEIPT_FILE,
  SHOPIFY_SOURCE_ENV,
  STAFF_REMOVAL_CODE,
  STAFF_REMOVAL_CONFIRMATION,
  WITHHELD_EXPORT_FILE,
  WITHHELD_EXPORT_CODE,
  WITHHELD_EXPORT_CONFIRMATION,
  readStaffAccess,
  writeStaffAccess,
  writeJsonAtomicSync,
  readSessionReceipt,
  passingReceipt,
  configuredShopDomain,
  sourceAccessOperatorActions,
  withheldDetailsOperatorActions,
};
