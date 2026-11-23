'use strict';

// Read-only CMS archive duplicate report shared by the installed CLI and the
// vendored completion/handoff libraries. Keep this module under lib/ because
// generated importers vendor lib/ and do not carry the toolkit's scripts/ tree.

const fs = require('node:fs');
const path = require('node:path');

const DUPLICATE_REPORT_PATH = 'execution/cms-archive-duplicates.json';

// packArchiveItems uses the parentKey for the first item and appends #2, #3… to
// itemKey when one parent record is split across multiple archive rows. Those rows
// are parts of one record, not duplicate records; use each part's itemKey for the
// duplicate key while retaining the legacy parentKey preference for all other rows.
function isSplitArchivePart(data) {
  if (typeof data?.parentKey !== 'string' || typeof data?.itemKey !== 'string') return false;
  const prefix = `${data.parentKey}#`;
  if (!data.itemKey.startsWith(prefix)) return false;
  const partNumber = data.itemKey.slice(prefix.length);
  return /^[2-9]\d*$/.test(partNumber);
}

function readEnv(projectDir) {
  const file = path.join(projectDir, 'config', 'wix.env');
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(([, key, value]) => [key, value.trim()]));
}

function duplicateArchiveItems(items, { sourceFields = ['sourceKey', 'parentKey'] } = {}) {
  const groups = new Map();
  for (const item of items || []) {
    const data = item?.data || {};
    const field = isSplitArchivePart(data) ? 'itemKey' : ['parentKey', ...sourceFields.filter(name => name !== 'parentKey')]
      .find(name => data[name] !== undefined && data[name] !== null && String(data[name]) !== '');
    if (!field) continue;
    const sourceKey = String(data[field]);
    const key = `${field}\u0000${sourceKey}`;
    if (!groups.has(key)) groups.set(key, { sourceField: field, sourceKey, items: [] });
    groups.get(key).items.push({ id: item.id || data._id || null });
  }
  return [...groups.values()].filter(group => group.items.length > 1)
    .sort((a, b) => `${a.sourceField}:${a.sourceKey}`.localeCompare(`${b.sourceField}:${b.sourceKey}`));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

async function writeDuplicateReport(projectDir, collections, { generatedAt = new Date().toISOString() } = {}) {
  const document = {
    schemaVersion: 1,
    reportType: 'cms-archive-duplicates',
    generatedAt,
    readOnly: true,
    collections,
  };
  writeJsonAtomic(path.join(projectDir, DUPLICATE_REPORT_PATH), document);
  return document;
}

function readDuplicateReport(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, DUPLICATE_REPORT_PATH), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function duplicateArchiveOperatorActions(projectDir) {
  const document = readDuplicateReport(projectDir);
  if (!document || document.schemaVersion !== 1 || document.reportType !== 'cms-archive-duplicates') return [];
  const duplicateGroups = (document.collections || []).flatMap(collection =>
    (collection.duplicates || []).map(group => ({ ...group, collectionId: collection.collectionId })));
  const affectedIds = [...new Set(duplicateGroups.flatMap(group =>
    (group.items || []).map(item => item.id).filter(id => id !== null && id !== undefined).map(String)))].sort();
  if (!affectedIds.length) return [];
  const collectionCount = new Set(duplicateGroups.map(group => group.collectionId)).size;
  return [{
    actionId: 'cms-archive-duplicates',
    code: 'cms-archive-duplicates',
    severity: 'high',
    role: 'cutover-operator',
    entity: 'cms/data-item',
    action: `Cutover Operator: ${affectedIds.length} duplicate CMS archive item(s) were found across ${collectionCount} collection(s). Review the listed target ids in ${DUPLICATE_REPORT_PATH} and coordinate merchant-approved cleanup; RePlatform performs no deletion.`,
    deadlineReason: 'before switching traffic; duplicate archive rows can confuse historical-content lookup',
    affectedCount: affectedIds.length,
    affectedIds,
    artifactRefs: [DUPLICATE_REPORT_PATH],
    prerequisites: ['The CMS archive collections are available in Business Manager.'],
    resolutionEvidence: 'The Cutover Operator records the merchant-approved cleanup decision and verifies the retained archive rows.',
  }];
}

async function report(projectDir, collections, { sourceFields } = {}) {
  if (!collections?.length) throw new Error('at least one --collection is required');
  const env = readEnv(projectDir);
  const wixAuth = require('./wix-auth.js');
  const writers = require('../resources/rp-target-wix/lib/wix-writers.js');
  const wix = writers.createWixClient({
    siteId: env.WIX_SITE_ID,
    tokenSource: wixAuth.createWixTokenSource({ projectDir, siteId: env.WIX_SITE_ID }),
  });
  const result = [];
  for (const collectionId of collections) {
    const items = await writers.queryAllDataItemsWithIds(wix, collectionId);
    result.push({ collectionId, itemCount: items.length, duplicates: duplicateArchiveItems(items, { sourceFields }) });
  }
  await writeDuplicateReport(projectDir, result);
  return result;
}

module.exports = {
  DUPLICATE_REPORT_PATH,
  duplicateArchiveItems,
  duplicateArchiveOperatorActions,
  isSplitArchivePart,
  parseArgs,
  readDuplicateReport,
  readEnv,
  report,
  writeDuplicateReport,
};

function parseArgs(argv) {
  const args = { collections: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--project-dir') args.projectDir = path.resolve(argv[++i]);
    else if (flag === '--collection') args.collections.push(argv[++i]);
    else if (flag === '--source-field') (args.sourceFields = args.sourceFields || []).push(argv[++i]);
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}
