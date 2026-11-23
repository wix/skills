'use strict';
// The source archive keeps only useful data, uses few CMS items, and a merchant can
// find it. Source-neutral: generic rules live in domains/cms/source-archive-fields.v1.json; a
// source module adds its own in rp-source-<platform>/archive-fields.v1.json.
//
// Pipeline (all deterministic, no network):
//   classifyArchivePath   -> keep | noise | personal-drop, per source location
//   planEntityArchive     -> per entity: kept locations, dropped locations (with record counts),
//                            values identical in every record (stored once), readable labels
//   buildArchiveRecord    -> one record's kept values under readable labels, with its Wix id
//   packArchiveRecords    -> many records per CMS item, found by sourceKeys / wixIds / names
//   entityInfoItem, archiveDataItem, expectedSourceArchiveItems, keptForReferenceSummary
//   planSourceArchive     -> the whole run: per entity collection, items, expected rows, report block
//
// Every archive item lives in the entity's own collection (`buildCmsArchiveCollectionId`), with the
// fixed fields in PACKED_ARCHIVE_FIELDS. The policy is applied here, at archive time, not as new
// mapping decisions: the mapping keeps its `cms` decisions, and no gate sees a new omission.
//
// Unknown fields are always kept: a rule may drop only what it names. As product policy,
// customer IP addresses and browser user-agent strings are not
// retained, while marketing consent and payment references always are.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('../../../lib/source-location');
const { buildCmsArchiveCollectionId } = require('../../../lib/cms-collection-id');

const POLICY_REF = 'source-archive-retention-v1';
const ITEM_BYTES_LIMIT = 400 * 1024;
const GENERIC_FILE = path.join(__dirname, '..', 'domains', 'cms', 'source-archive-fields.v1.json');
const SOURCE_MODULES = { wordpress: 'rp-source-wordpress', woocommerce: 'rp-source-wordpress' };

const ARCHIVE_NAME = 'Previous site data (kept for reference)';
// The fields of every source-archive collection (setup declares them; `packedArchiveCollection`).
const PACKED_ARCHIVE_FIELDS = Object.freeze([
  { key: 'sourceKey', fieldType: 'TEXT', displayName: 'Archive key' },
  { key: 'itemKey', fieldType: 'TEXT', displayName: 'Item' },
  { key: 'kind', fieldType: 'TEXT', displayName: 'Kind' },
  { key: 'sourceEntity', fieldType: 'TEXT', displayName: 'Old site record type' },
  { key: 'names', fieldType: 'ARRAY', displayName: 'Names / numbers' },
  { key: 'sourceKeys', fieldType: 'ARRAY', displayName: 'Old site ids' },
  { key: 'wixIds', fieldType: 'ARRAY', displayName: 'Wix ids' },
  { key: 'records', fieldType: 'OBJECT', displayName: 'Records' },
  { key: 'info', fieldType: 'OBJECT', displayName: 'About' },
  { key: 'digest', fieldType: 'TEXT', displayName: 'Content digest' },
].map(Object.freeze));
// One entity's archive collection, in the setup-requirement shape (`create-cms-collections`).
function packedArchiveCollection(sourceEntity, expectedArchiveRows = undefined) {
  return { collectionId: buildCmsArchiveCollectionId(sourceEntity), permissionsPreset: 'migration-internal',
    ...(Number.isSafeInteger(expectedArchiveRows) ? { expectedArchiveRows } : {}),
    fields: PACKED_ARCHIVE_FIELDS.map(({ key, fieldType, displayName }) => ({ key, type: fieldType, displayName })) };
}

const ABOUT_TEXT = 'Data from your previous site that has no place in Wix, kept for reference. ' +
  'It is not used by your live site. Find a record by its old id, its Wix id, or its name/number ' +
  '(order number, product name, email) with a filter on "Old site ids", "Wix ids" or "Names / numbers". ' +
  'Each "<type>#info" row lists what each label means and which old fields were not kept and why.';

// ------------------------------------------------------------------ knowledge ----

const knowledgeCache = new Map();
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function compileRules(rules = []) {
  return rules.map((rule) => {
    if (!rule || typeof rule.id !== 'string' || typeof rule.regex !== 'string' || !['any', 'leaf', 'named'].includes(rule.on)) {
      throw Object.assign(new Error(`source-archive rule is invalid: ${JSON.stringify(rule)}`), { code: 'source_archive_rule_invalid' });
    }
    return { ...rule, re: new RegExp(rule.regex) };
  });
}
// `sourcePlatform` is the plan's source system (wordpress, woocommerce, shopify, …). A platform
// with no archive-fields file uses the generic rules only.
// `ownerKeeps` names personal-data rules (by id) the site owner asked to keep after all: those
// paths are then classified like any other field (kept unless plumbing).
function loadArchiveKnowledge({ sourcePlatform = null, extra = null, ownerKeeps = [] } = {}) {
  const kept = new Set(ownerKeeps || []);
  const key = `${sourcePlatform || ''}|${[...kept].sort().join(',')}`;
  if (!extra && knowledgeCache.has(key)) return knowledgeCache.get(key);
  const generic = readJson(GENERIC_FILE);
  const parts = [generic];
  const moduleName = SOURCE_MODULES[String(sourcePlatform || '').toLowerCase()] || (sourcePlatform ? `rp-source-${String(sourcePlatform).toLowerCase()}` : null);
  const sourceFile = moduleName ? path.join(__dirname, '..', '..', moduleName, 'archive-fields.v1.json') : null;
  if (sourceFile && fs.existsSync(sourceFile)) parts.push(readJson(sourceFile));
  if (extra) parts.push(extra);
  const knowledge = {
    sourcePlatform: sourcePlatform || null,
    files: [GENERIC_FILE, ...(sourceFile && fs.existsSync(sourceFile) ? [sourceFile] : [])].map((f) => path.relative(path.join(__dirname, '..', '..'), f)),
    personalDrop: compileRules(parts.flatMap((p) => p.personalDrop || []).filter((r) => !kept.has(r.id))),
    ownerKeeps: [...kept].sort(),
    keep: compileRules(parts.flatMap((p) => p.keep || [])),
    noise: compileRules(parts.flatMap((p) => p.noise || [])),
    groups: parts.flatMap((p) => p.groups || []).map((g) => ({ ...g, re: new RegExp(g.regex) })),
  };
  if (!extra) knowledgeCache.set(key, knowledge);
  return knowledge;
}

// ------------------------------------------------------------------ classify ----

// Names a rule can see on one location: every object key, every meta key (`where key = "x"`),
// the last key, and whether the leaf sits directly in a list item or at the record root.
function pathNames(location) {
  const segs = L.parse(location);
  const keys = [], metaKeys = [];
  for (const seg of segs) {
    if (seg.key !== undefined) keys.push(String(seg.key));
    if (seg.where && seg.where.equals !== undefined && seg.where.equals !== null) metaKeys.push(String(seg.where.equals));
  }
  const last = segs[segs.length - 1];
  const leaf = last && last.key !== undefined ? String(last.key) : (keys[keys.length - 1] || '');
  const before = segs[segs.length - 2];
  return {
    all: [...keys, ...metaKeys],
    leaf,
    named: [leaf, ...metaKeys],
    underList: Boolean(before && before.each && !before.where),
    root: segs.length === 1 && last.key !== undefined,
  };
}
function ruleMatches(rule, names) {
  if (rule.under === 'list' && !names.underList) return false;
  if (rule.under === 'root' && !names.root) return false;
  const pool = rule.on === 'leaf' ? [names.leaf] : rule.on === 'named' ? names.named : names.all;
  return pool.some((name) => rule.re.test(name));
}
// keep | noise | personal-drop. Precedence: personal-drop, keep, noise; no match = keep.
function classifyArchivePath(location, knowledge = loadArchiveKnowledge()) {
  let names;
  try { names = pathNames(location); } catch { return { class: 'keep', ruleId: null, reasonCode: null }; }
  const hit = (rules) => rules.find((rule) => ruleMatches(rule, names));
  const personal = hit(knowledge.personalDrop);
  if (personal) return { class: 'personal-drop', ruleId: personal.id, reasonCode: personal.reasonCode || 'personal-data-not-retained' };
  const keep = hit(knowledge.keep);
  if (keep) return { class: 'keep', ruleId: keep.id, reasonCode: null };
  const noise = hit(knowledge.noise);
  if (noise) return { class: 'noise', ruleId: noise.id, reasonCode: noise.reasonCode || 'archive-noise' };
  return { class: 'keep', ruleId: null, reasonCode: null };
}

// ------------------------------------------------------------------ values & labels ----

function valuesFor(record, location) {
  let values;
  try { values = L.valuesAt(record, location); } catch { return undefined; }
  const present = values.filter((v) => v !== undefined);
  if (!present.length) return undefined;
  return /\[\]|\[key=|\[where/.test(location) ? present : present[0];
}
function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.every(isEmpty);
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}
const GENERIC_LEAF = /^(value|values|href|raw|rendered|display_value|text|data)$/;
function humanize(name) {
  const text = String(name).replace(/^_+/, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : String(name);
}
function labelFor(location, knowledge) {
  let segs;
  try { segs = L.parse(location); } catch { return { group: 'Other', label: `Other › ${location}` }; }
  const parts = [];
  for (const seg of segs) {
    if (seg.where && seg.where.equals !== undefined) parts.push(String(seg.where.equals));
    else if (seg.key !== undefined) parts.push(String(seg.key));
  }
  while (parts.length > 1 && GENERIC_LEAF.test(parts[parts.length - 1])) parts.pop();
  const name = parts[parts.length - 1] || location;
  const context = parts.length > 1 && /\[\]/.test(location) ? `${humanize(parts[0])}: ` : '';
  const haystack = parts.join('_').toLowerCase();
  const group = (knowledge.groups.find((g) => g.re.test(haystack)) || { group: 'Other' }).group;
  return { group, label: `${group} › ${context}${humanize(name)}` };
}

// One entity's archive plan, from its archive candidate locations (the `cms`-disposition paths,
// `archivedLocations(row)` in cms-item-quota.js) and its in-scope source records.
function planEntityArchive({ sourceEntity, locations, records, knowledge, archiveOnly = false }) {
  if (typeof sourceEntity !== 'string' || !sourceEntity) throw Object.assign(new Error('planEntityArchive needs sourceEntity'), { code: 'source_archive_plan_invalid' });
  if (!Array.isArray(locations) || !Array.isArray(records)) throw Object.assign(new Error('planEntityArchive needs locations and records arrays'), { code: 'source_archive_plan_invalid' });
  const kept = [], dropped = [];
  const candidates = new Set(locations);
  for (const location of [...candidates].sort()) {
    const c = classifyArchivePath(location, knowledge);
    if (c.class === 'keep' || archiveOnly) kept.push(location);
    else dropped.push({ path: location, class: c.class, ruleId: c.ruleId, reasonCode: c.reasonCode, recordCount: 0 });
  }
  // Archive-only entities have no other home: nothing in them is dropped except personal data.
  if (archiveOnly) {
    for (let i = kept.length - 1; i >= 0; i--) {
      const c = classifyArchivePath(kept[i], knowledge);
      if (c.class === 'personal-drop') { dropped.push({ path: kept[i], class: c.class, ruleId: c.ruleId, reasonCode: c.reasonCode, recordCount: 0 }); kept.splice(i, 1); }
    }
  }
  const seen = new Map(kept.map((l) => [l, { present: 0, first: undefined, same: true }]));
  for (const record of records) {
    for (const d of dropped) if (!isEmpty(valuesFor(record, d.path))) d.recordCount += 1;
    for (const location of kept) {
      const value = valuesFor(record, location);
      const s = seen.get(location);
      if (value === undefined) { s.same = false; continue; }
      const text = JSON.stringify(value);
      s.present += 1;
      if (s.first === undefined) s.first = text; else if (s.first !== text) s.same = false;
    }
  }
  // A value identical in every record carries no per-record information: stored once.
  const constants = {};
  if (records.length > 1 && !archiveOnly) {
    for (const [location, s] of seen) if (s.same && s.present === records.length) constants[location] = JSON.parse(s.first);
  }
  const labels = {}, used = new Map();
  for (const location of kept) {
    const { label } = labelFor(location, knowledge);
    used.set(label, (used.get(label) || 0) + 1);
    labels[location] = label;
  }
  for (const location of kept) if (used.get(labels[location]) > 1) { let shown = location; try { shown = L.readable(location); } catch { /* keep raw */ } labels[location] = `${labels[location]} (${shown})`; }
  return {
    sourceEntity, archiveOnly: Boolean(archiveOnly), recordCount: records.length,
    kept: kept.filter((l) => !Object.hasOwn(constants, l)),
    constants, labels,
    dropped: dropped.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// One record's kept values under readable labels. Returns null when nothing is left to keep
// (that record needs no archive data); archive-only entities always keep their record.
function buildArchiveRecord(record, plan, { sourceKey, wixId = null, name = null } = {}) {
  if (typeof sourceKey !== 'string' || !sourceKey) throw Object.assign(new Error('buildArchiveRecord needs sourceKey'), { code: 'source_archive_record_invalid' });
  const fields = {};
  for (const location of plan.kept) {
    const value = valuesFor(record, location);
    if (value === undefined || (!plan.archiveOnly && isEmpty(value))) continue;
    fields[plan.labels[location]] = value;
  }
  if (!Object.keys(fields).length && !plan.archiveOnly) return null;
  return { sourceKey, ...(wixId ? { wixId: String(wixId) } : {}), ...(name ? { name: String(name) } : {}), fields };
}

// ------------------------------------------------------------------ items ----

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const digestOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function finishItem(item) {
  const content = { kind: item.kind, sourceEntity: item.sourceEntity, records: item.records || null, info: item.info || null };
  return { ...item, digest: digestOf(content) };
}
// A value cut into text pieces of at most `budget` bytes (as stored), never inside a character.
function textPieces(text, budget) {
  const pieces = [];
  let i = 0;
  while (i < text.length) {
    let n = Math.min(text.length - i, budget);
    while (n > 1 && bytes(text.slice(i, i + n)) > budget) n = Math.max(1, Math.floor(n * 0.75));
    const code = text.charCodeAt(i + n - 1);
    if (n > 1 && code >= 0xd800 && code <= 0xdbff) n -= 1;
    pieces.push(text.slice(i, i + n));
    i += n;
  }
  return pieces;
}
// A record too big for one CMS item is split into parts, each its own item under the same source
// key (so the record is still found by source key, Wix id or name). Fields stay whole where they
// fit; a single field larger than a part is kept as text in numbered pieces. Deterministic: the
// same record always gives the same parts.
function splitRecordFields(rec, budget) {
  const parts = [];
  let current = {}, size = 2;
  const push = () => { if (Object.keys(current).length) parts.push(current); current = {}; size = 2; };
  for (const [label, value] of Object.entries(rec.fields || {})) {
    const cost = bytes({ [label]: value });
    if (cost <= budget) {
      if (size + cost > budget) push();
      current[label] = value; size += cost;
      continue;
    }
    push();
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const pieces = textPieces(text, budget - bytes(label) - 64);
    pieces.forEach((piece, i) => { parts.push({ [`${label} (piece ${i + 1} of ${pieces.length}${typeof value === 'string' ? '' : ', JSON text'})`]: piece }); });
  }
  push();
  return parts;
}
// The item name for one record's own item(s): the source key, prefixed with the entity only
// when the key does not already start with it (so `order:big`, not `order:order:big`).
function recordItemKey(sourceEntity, sourceKey) {
  return String(sourceKey).startsWith(`${sourceEntity}:`) ? String(sourceKey) : `${sourceEntity}:${sourceKey}`;
}
// Many records per item, in source-key order, up to the size limit. `perRecord` (archive-only
// entities a merchant browses as rows) keeps one record per item. A record that alone exceeds the
// limit becomes several part items (`<sourceKey>#part-<n>`; see recordItemKey).
function packArchiveRecords(records, { sourceEntity, itemBytesLimit = ITEM_BYTES_LIMIT, perRecord = false } = {}) {
  if (typeof sourceEntity !== 'string' || !sourceEntity) throw Object.assign(new Error('packArchiveRecords needs sourceEntity'), { code: 'source_archive_pack_invalid' });
  const sorted = records.filter(Boolean).slice().sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
  const items = [];
  let current = null, part = 0, size = 0;
  const open = (numbered = true) => { if (numbered) part += 1; size = size0; current = { itemKey: perRecord ? null : `${sourceEntity}#${part}`, kind: 'records', sourceEntity, names: [], sourceKeys: [], wixIds: [], records: {} }; };
  const close = () => { if (current && current.sourceKeys.length) items.push(finishItem(current)); current = null; };
  // Wix ids may be added after packing (the archive pass runs after the entity's own write); room
  // for one is reserved per record so item boundaries do not depend on them.
  const reserve = 64, size0 = 512;
  for (const rec of sorted) {
    const entry = { ...(rec.wixId ? { wixId: rec.wixId } : {}), ...(rec.name ? { name: rec.name } : {}), fields: rec.fields };
    // The cost leaves the Wix id out (it is covered by `reserve`), so boundaries are the same
    // whether or not ids are known yet.
    const cost = bytes({ ...(rec.name ? { name: rec.name } : {}), fields: rec.fields }) + bytes(rec.sourceKey) * 2 + reserve + (rec.name ? bytes(rec.name) : 0);
    if (size0 + cost > itemBytesLimit) {
      close();
      const budget = Math.max(1024, itemBytesLimit - size0 - (cost - bytes(rec.fields || {})) - 1024);
      const parts = splitRecordFields(rec, budget);
      parts.forEach((fieldsPart, i) => {
        open(false);
        current.itemKey = `${recordItemKey(sourceEntity, rec.sourceKey)}#part-${i + 1}`;
        current.records[rec.sourceKey] = { ...entry, fields: fieldsPart, part: { index: i + 1, of: parts.length } };
        current.sourceKeys.push(rec.sourceKey);
        if (rec.wixId) current.wixIds.push(String(rec.wixId));
        if (rec.name) current.names.push(String(rec.name));
        close();
      });
      continue;
    }
    if (perRecord) { open(); current.itemKey = recordItemKey(sourceEntity, rec.sourceKey); }
    else if (!current || (current.sourceKeys.length && size + cost > itemBytesLimit)) { close(); open(); }
    size += cost;
    current.records[rec.sourceKey] = entry;
    current.sourceKeys.push(rec.sourceKey);
    if (rec.wixId) current.wixIds.push(String(rec.wixId));
    if (rec.name) current.names.push(String(rec.name));
    if (perRecord) close();
  }
  close();
  return items;
}
function entityInfoItem(plan) {
  const labels = Object.fromEntries(Object.entries(plan.labels).map(([location, label]) => [label, location]));
  const constants = Object.fromEntries(Object.entries(plan.constants).map(([location, value]) => [plan.labels[location], value]));
  return finishItem({
    itemKey: `${plan.sourceEntity}#info`, kind: 'entity-info', sourceEntity: plan.sourceEntity, names: [], sourceKeys: [], wixIds: [],
    info: {
      about: ABOUT_TEXT,
      recordCount: plan.recordCount,
      labels,
      sameInEveryRecord: constants,
      notKept: plan.dropped.filter((d) => d.recordCount > 0).map(({ path: p, reasonCode, ruleId, recordCount }) => ({ path: p, reasonCode, ruleId, recordCount })),
    },
  });
}
// Write order so the CMS view (newest first) shows items in the order given (info row, then
// parts 1, 2, 3). Verified live: a bulk insert dates its first item newest, and a later call is
// newer than an earlier one. So: split the display order into batches, send the last batch first,
// each batch in display order. `batchSize: 1` is the order for single inserts.
function archiveWriteBatches(items, { batchSize = 50 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw Object.assign(new Error('archiveWriteBatches needs a positive batchSize'), { code: 'source_archive_pack_invalid' });
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
  return batches.reverse();
}
// Stable CMS item id from the item key, so a re-run finds (and replaces only on a digest change)
// the same item instead of inserting a duplicate.
function itemId(itemKey) {
  const h = crypto.createHash('sha256').update(`source-archive:${itemKey}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// `sourceKey` is the archive identity the import journal, the cms/data-item reconciler and the
// duplicate scan already use (`archive:<itemKey>`), so a packed item is found again like any row.
function archiveDataItem(item) {
  return { _id: itemId(item.itemKey), sourceKey: `archive:${item.itemKey}`, itemKey: item.itemKey, kind: item.kind, sourceEntity: item.sourceEntity,
    names: item.names || [], sourceKeys: item.sourceKeys || [], wixIds: item.wixIds || [],
    records: item.records || null, info: item.info || null, digest: item.digest };
}
// What a re-run does with an item it already wrote: nothing when the digest is unchanged, a full
// replace (bulk save by id, no new quota item) when it changed, an insert when it is new.
function itemWriteAction(item, previousDigest) {
  if (previousDigest === undefined || previousDigest === null) return 'insert';
  return previousDigest === item.digest ? 'skip' : 'replace';
}
// The plan line's archive count: one info item per entity plus its packed items.
function expectedSourceArchiveItems(entityItems) {
  return entityItems.reduce((sum, e) => sum + 1 + e.items.length, 0);
}

// ------------------------------------------------------------------ report ----

// The completion report's "Kept for reference" block, plus the dropped-field rows (with reason
// codes) that the report's "Fields Dropped" section lists.
function keptForReferenceSummary({ plans, entityItems, heldItems = 0 }) {
  const byEntity = new Map(entityItems.map((e) => [e.sourceEntity, e]));
  const entities = plans.map((plan) => {
    const e = byEntity.get(plan.sourceEntity) || { items: [] };
    const archived = e.items.reduce((n, item) => n + item.sourceKeys.length, 0);
    const groups = [...new Set(plan.kept.map((l) => plan.labels[l].split(' › ')[0]))].sort();
    return { sourceEntity: plan.sourceEntity, collectionId: plan.collectionId || buildCmsArchiveCollectionId(plan.sourceEntity), recordsArchived: archived, items: e.items.length + 1,
      groups, sameInEveryRecord: Object.keys(plan.constants).length,
      notKept: plan.dropped.filter((d) => d.recordCount > 0).length, archiveOnly: plan.archiveOnly };
  });
  const task = personalDataNotKeptTask(plans);
  const droppedFields = plans.flatMap((plan) => plan.dropped.filter((d) => d.recordCount > 0)
    .map((d) => ({ entity: plan.sourceEntity, field: d.path, recordCount: d.recordCount, reasonCode: d.reasonCode })));
  return {
    keptForReference: {
      collectionName: ARCHIVE_NAME, policyRef: POLICY_REF,
      totalItems: expectedSourceArchiveItems(entityItems), heldItems,
      howToFind: 'In Business Manager > CMS, open the record type\'s ImportArchive_ collection and filter "Old site ids", "Wix ids" or "Names / numbers". Each "<type>#info" row explains the labels. This data is not used by the live site.',
      entities,
      optionalTasks: task ? [task] : [],
    },
    droppedFields,
  };
}

// Optional owner task when personal data (customer IP addresses, browser user-agent strings) was
// not kept. Nothing is needed for go-live; the owner may still ask for it while the old store (or
// the saved extract) is reachable. Informational: never an urgent action, never a status change.
const PERSONAL_DATA_TASK_CODE = 'archive-personal-data-not-kept';
const PERSONAL_DATA_LABELS = { 'ip-address': 'customer IP addresses', 'user-agent': 'browser user-agent strings' };
function personalDataNotKeptTask(plans) {
  const affected = plans.flatMap((plan) => plan.dropped
    .filter((d) => d.class === 'personal-drop' && d.recordCount > 0)
    .map((d) => ({ entity: plan.sourceEntity, field: d.path, ruleId: d.ruleId, recordCount: d.recordCount })))
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.field.localeCompare(b.field));
  if (!affected.length) return null;
  const ruleIds = [...new Set(affected.map((a) => a.ruleId))].sort();
  const what = ruleIds.map((id) => PERSONAL_DATA_LABELS[id] || id).join(' and ');
  const entities = [...new Set(affected.map((a) => a.entity))];
  const fields = [...new Set(affected.map((a) => a.field))];
  const records = affected.reduce((n, a) => Math.max(n, a.recordCount), 0);
  return {
    code: PERSONAL_DATA_TASK_CODE,
    optional: true,
    goLiveImpact: 'none',
    role: 'site-owner',
    title: `Optional: ${what} from the old site were not kept`,
    action: `The import did not keep ${what} (${entities.join(', ')}; up to ${records} records). Nothing is needed to go live. ` +
      'If you want them kept anyway, ask for them to be re-imported while the old store is still reachable; otherwise no action.',
    affected,
    importOperatorPrompt: 'Requires Import Operator. The site owner asked to keep ' + what + ' that the source archive did not keep. ' +
      'In the original migration workspace, while the old store is still reachable: ' +
      '(1) record the owner\'s request (who asked and when) in orchestration/decisions.json; ' +
      `(2) rerun only the source-archive pass for ${entities.join(', ')} with planSourceArchive({ ..., ownerKeeps: ${JSON.stringify(ruleIds)} }) so ${fields.join(', ')} are kept, ` +
      'reading the saved source extract, or re-extracting those entities from the old store if the saved extract lacks the fields; ' +
      '(3) regenerate the completion report and the website handoff. Archive items are replaced in place by id; nothing else on the site changes.',
    resolutionEvidence: 'The owner declined (no action), or the regenerated report no longer lists this task and the archive rows show the fields.',
  };
}

// ------------------------------------------------------------------ run plan ----

const ARCHIVE_COLLECTION_PREFIX = 'ImportArchive_';
// Setup declares the packed fields on every source-archive collection, whatever per-field columns
// the mapping proposed, so the import never writes a field the collection lacks.
function withPackedArchiveFields(collectionId, fields = []) {
  if (typeof collectionId !== 'string' || !collectionId.startsWith(ARCHIVE_COLLECTION_PREFIX)) return fields;
  const have = new Set((fields || []).map((f) => f && f.key));
  return [...(fields || []), ...PACKED_ARCHIVE_FIELDS.filter((f) => !have.has(f.key)).map(({ key, fieldType, displayName }) => ({ key, type: fieldType, displayName }))];
}

const rowTarget = (row) => row?.targetRef || (row?.targetDomain && row?.targetEntity ? `${row.targetDomain}/${row.targetEntity}` : null);
// The source paths an entity archives: its `cms` decisions' paths, minus paths that a native or
// extended-field decision of the same entity writes without loss (`lossy` not true): that value
// already has a Wix home. A lossy decision's paths stay in the archive.
function archiveLocationsFor(row) {
  const decisions = row?.fieldMappings || [];
  const homed = new Set(decisions.filter((d) => ['native', 'extended-field'].includes(d.disposition) && d.lossy !== true && (d.outputs || []).length)
    .flatMap((d) => d.sourcePaths || []));
  const cms = decisions.filter((d) => d.disposition === 'cms').flatMap((d) => d.sourcePaths || []);
  return [...new Set(cms)].filter((p) => typeof p === 'string' && !homed.has(p)).sort();
}
// The archive collection the mapping and setup named for this entity: its `cms` outputs'
// `storage.collectionId` (built from the output's source entity, e.g. a full plugin ref), so the
// archive writes where setup created it. Falls back to the entity's own name.
function archiveCollectionIdFor(row) {
  const ids = [...new Set((row?.fieldMappings || []).filter((d) => d.disposition === 'cms')
    .flatMap((d) => (d.outputs || []).map((o) => o?.storage?.collectionId)).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) throw Object.assign(new Error(`${row.sourceEntity}: cms outputs name several archive collections (${ids.join(', ')})`), { code: 'source_archive_collection_ambiguous' });
  return buildCmsArchiveCollectionId(row?.sourceEntityRef || row?.sourceEntity);
}
function primaryKeyOf(row, record) {
  const key = typeof row?.primaryKey === 'string' && /^[A-Za-z0-9_]+$/.test(row.primaryKey) ? row.primaryKey : 'id';
  const value = record?.[key] ?? record?.id ?? record?.ID;
  return value === undefined || value === null || value === '' ? null : String(value);
}

// The run's whole source archive, offline and deterministic. Every entity with `cms` decisions
// gets one collection (the one its `cms` outputs name, `archiveCollectionIdFor`): an entity with a native Wix home packs many
// records per item; an archive-only entity (target cms/data-item) keeps one item per record.
//   plan          the mapping plan (entityMappings or entities); only entities in
//                 executionScope.resolvedEntityRefs are archived when the plan has one
//   readRecords   (sourceEntity, row) -> the entity's in-scope source records, or null (no extract)
//   identity      optional (row, record) -> { sourceKey, wixId, name } (crosswalk id and label)
// Returns { summary, entities }: `summary` holds counts only (safe to write to execution/); each
// entity carries `items`, the CMS data items to write (`archiveDataItem` shape).
function planSourceArchive({ plan, readRecords, identity = null, sourcePlatform = null, ownerKeeps = [], heldItems = 0 }) {
  if (!plan || typeof plan !== 'object') throw Object.assign(new Error('planSourceArchive needs the mapping plan'), { code: 'source_archive_plan_invalid' });
  if (typeof readRecords !== 'function') throw Object.assign(new Error('planSourceArchive needs readRecords'), { code: 'source_archive_plan_invalid' });
  const knowledge = loadArchiveKnowledge({ sourcePlatform: sourcePlatform || plan.sourcePlatform || plan.sourceSystem || null, ownerKeeps });
  const rows = plan.entityMappings || plan.entities || [];
  const resolved = Array.isArray(plan.executionScope?.resolvedEntityRefs) ? new Set(plan.executionScope.resolvedEntityRefs) : null;
  const entities = [], plans = [], entityItems = [], skipped = [];
  for (const row of rows) {
    if (!(row?.fieldMappings || []).some((d) => d.disposition === 'cms')) continue;
    const ref = row.sourceEntityRef || row.sourceEntity;
    if (resolved && !resolved.has(ref) && !resolved.has(row.sourceEntity)) { skipped.push({ sourceEntity: row.sourceEntity, reason: 'not-in-resolved-scope' }); continue; }
    const records = readRecords(row.sourceEntity, row);
    if (!Array.isArray(records)) { skipped.push({ sourceEntity: row.sourceEntity, reason: 'no-extract' }); continue; }
    const archiveOnly = rowTarget(row) === 'cms/data-item';
    const collectionId = archiveCollectionIdFor(row);
    const entityPlan = { ...planEntityArchive({ sourceEntity: row.sourceEntity, locations: archiveLocationsFor(row), records, knowledge, archiveOnly }), collectionId };
    const built = [];
    records.forEach((record, index) => {
      const id = (identity && identity(row, record)) || {};
      const sourceKey = id.sourceKey || primaryKeyOf(row, record) || `#${index + 1}`;
      const rec = buildArchiveRecord(record, entityPlan, { sourceKey: String(sourceKey), wixId: id.wixId || null, name: id.name || null });
      if (rec) built.push(rec);
    });
    const packed = packArchiveRecords(built, { sourceEntity: row.sourceEntity, perRecord: archiveOnly });
    const items = [entityInfoItem(entityPlan), ...packed];
    plans.push(entityPlan); entityItems.push({ sourceEntity: row.sourceEntity, items: packed });
    entities.push({
      sourceEntity: row.sourceEntity, collectionId, archiveOnly,
      recordCount: records.length, recordsArchived: built.length, expectedRows: items.length,
      kept: entityPlan.kept.length, sameInEveryRecord: Object.keys(entityPlan.constants).length,
      notKept: entityPlan.dropped.filter((d) => d.recordCount > 0).map(({ path: p, reasonCode, ruleId, recordCount }) => ({ path: p, reasonCode, ruleId, recordCount })),
      itemKeys: items.map((item) => item.itemKey),
      items: items.map(archiveDataItem),
    });
  }
  const report = keptForReferenceSummary({ plans, entityItems, heldItems });
  return {
    summary: {
      schemaVersion: 1, policyRef: POLICY_REF, knowledgeFiles: knowledge.files,
      expectedRows: entities.reduce((n, e) => n + e.expectedRows, 0),
      entities: entities.map(({ items, ...rest }) => rest), skipped,
      keptForReference: report.keptForReference,
    },
    entities,
  };
}

const { SUMMARY_PATH, readArchivePlanSummary, writeArchivePlanSummary } = require('../../../lib/source-archive-summary');

module.exports = {
  SUMMARY_PATH, readArchivePlanSummary, writeArchivePlanSummary,
  POLICY_REF, ITEM_BYTES_LIMIT, ARCHIVE_NAME, ABOUT_TEXT, PACKED_ARCHIVE_FIELDS, ARCHIVE_COLLECTION_PREFIX,
  loadArchiveKnowledge, pathNames, classifyArchivePath, labelFor,
  planEntityArchive, buildArchiveRecord, packArchiveRecords, entityInfoItem, itemId,
  archiveDataItem, itemWriteAction, expectedSourceArchiveItems, recordItemKey, archiveWriteBatches,
  keptForReferenceSummary, personalDataNotKeptTask, PERSONAL_DATA_TASK_CODE,
  packedArchiveCollection, withPackedArchiveFields, archiveLocationsFor, archiveCollectionIdFor, planSourceArchive,
};
