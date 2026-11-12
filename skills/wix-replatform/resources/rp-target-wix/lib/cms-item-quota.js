'use strict';

// The site's CMS item quota is a real limit on "import everything".
//
// Wix counts every item in the site's own CMS collections (the migration archive, source pages,
// an optional crosswalk mirror) against one plan-wide item quota. When it is used up, every item
// create answers HTTP 429 with application error WDE0195 "Items limit exceeded". That 429 is not a
// rate limit: waiting does not help, only a plan upgrade or deleted items do.
//
// This module owns that condition for every caller:
//   - isCmsItemQuotaError: recognize the refusal (the code, not a guessed list);
//   - readCmsItemQuota / quotaPlanLine: read limit and usage before planning, so the plan shown
//     before consent states the expected archive rows against the quota;
//   - the hold: one typed, shared hold file (state/holds/cms-item-quota.json). The first
//     WDE0195 opens it; while it is open the client refuses CMS item creates before sending
//     (a known non-write, journaled `deferred`), re-checks the quota on a timer and on every new
//     run, and releases it by itself once the quota has room. No other entity is touched;
//   - archive scope and packing: archive rows only for records the import actually writes, and
//     one item per parent record carrying its same-parent sub-records.

const fs = require('node:fs');
const path = require('node:path');
const wixAuth = require('../../../lib/wix-auth.js');

const WIXAPIS = 'https://www.wixapis.com';
const QUOTA_ERROR_CODE = 'WDE0195';
const HOLD_CODE = 'cms-item-quota-exhausted';
// The operator's explicit decision that the waiting archive data is not needed. Never automatic.
const SKIP_CODE = 'cms-archive-skipped-by-operator';
const HOLD_FILE = 'state/holds/cms-item-quota.json';
// How often a held run asks Wix again. One read per interval, never one per record.
const RECHECK_MS = 5 * 60 * 1000;
// Wix limits one item to 512 KB across its fields; packing stays well under it.
const ITEM_BYTES_LIMIT = 400 * 1024;

// Item creates that spend quota. Updates of an existing item do not, but `save` may create.
const ITEM_CREATE_PATHS = new Set(['/wix-data/v2/items', '/wix-data/v2/items/save', '/wix-data/v2/bulk/items/insert', '/wix-data/v2/bulk/items/save']);
function consumesItemQuota(request) {
  if (!request || String(request.method || '').toUpperCase() !== 'POST') return false;
  try { const url = new URL(request.url); return url.origin === WIXAPIS && ITEM_CREATE_PATHS.has(url.pathname.replace(/\/+$/, '')); } catch { return false; }
}

// The client attaches the parsed body and `applicationErrorCode`; the message is a fallback for an
// error a caller rebuilt from text. The HTTP status is not checked: Wix sends 429 today.
function isCmsItemQuotaError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.cmsItemQuota) return true;
  const code = error.applicationErrorCode || error.body?.details?.applicationError?.code;
  if (code === QUOTA_ERROR_CODE) return true;
  return new RegExp(`\\b${QUOTA_ERROR_CODE}\\b`).test(String(error.body?.message || error.message || ''));
}

// GET Site Data Usage (wix-data/v1/site-data-usage): limit and live item count. `consistentRead`
// skips Wix's cache; used just before deciding to release a hold.
function buildGetSiteDataUsageRequest({ consistentRead = false } = {}) {
  return { method: 'GET', url: `${WIXAPIS}/wix-data/v1/site-data-usage/v1/site-data-usage${consistentRead ? '?consistentRead=true' : ''}` };
}
function parseSiteDataUsage(response) {
  const usage = response && response.siteDataUsage;
  const limit = Number(usage && usage.itemCountLimit);
  const used = Number(usage && usage.totalUsedLive && usage.totalUsedLive.items);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used < 0) return null;
  return { limit, used, remaining: Math.max(0, limit - used) };
}
// Never throws: a site or token that cannot read usage is `null`, and the first WDE0195 teaches
// the limit instead.
async function readCmsItemQuota(wix, { consistentRead = false, now = Date.now } = {}) {
  try {
    // The client accepts it only as a marked read (wix-writers marks it; required lazily, it requires us).
    const quota = parseSiteDataUsage(await wix.send(require('./wix-writers').buildGetSiteDataUsageRequest({ consistentRead })));
    return quota ? { ...quota, source: 'site-data-usage', checkedAt: new Date(now()).toISOString() } : null;
  } catch (error) {
    if (wixAuth.isRunInterruption(error)) throw error;
    return null;
  }
}

// The line the plan shows before consent. `expectedRows` is the archive (and every other custom
// collection) rows this import will create.
function quotaPlanLine({ expectedRows, quota }) {
  const expected = Number.isSafeInteger(expectedRows) && expectedRows >= 0 ? expectedRows : null;
  if (expected === null) throw Object.assign(new Error('expectedRows must be a non-negative integer'), { code: 'cms_item_quota_plan_invalid' });
  if (!quota) {
    return { status: 'unknown', expectedRows: expected, limit: null, used: null, remaining: null, shortfall: null,
      summary: `About ${expected} CMS items will be created. The site's CMS item quota could not be read; if the import reaches it, CMS rows wait in a hold and resume by themselves after more room is available.` };
  }
  const shortfall = Math.max(0, expected - quota.remaining);
  return { status: shortfall ? 'exceeds' : 'fits', expectedRows: expected, limit: quota.limit, used: quota.used, remaining: quota.remaining, shortfall, checkedAt: quota.checkedAt || null,
    summary: shortfall
      ? `About ${expected} CMS items will be created, but the site has room for ${quota.remaining} (plan limit ${quota.limit}, ${quota.used} used). The last ~${shortfall} wait in a hold until the plan is upgraded or items are deleted; everything else imports normally.`
      : `About ${expected} CMS items will be created; the site has room for ${quota.remaining} (plan limit ${quota.limit}, ${quota.used} used).` };
}

// ---------------------------------------------------------------- the shared hold ------------

function holdPath(projectDir) { return path.join(projectDir, HOLD_FILE); }
function readHold(projectDir) {
  try { return JSON.parse(fs.readFileSync(holdPath(projectDir), 'utf8')); } catch { return null; }
}
function writeHold(projectDir, value) {
  const file = holdPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

function skipRefusal(hold) {
  return Object.assign(new Error(`The operator decided the remaining CMS archive data is not needed (${HOLD_FILE}); this item is skipped, not lost from the source`), {
    code: SKIP_CODE, archiveSkipped: true, cmsItemQuota: true, decision: hold.skip,
    requestSent: false, requestApplied: false, outcomeKnown: true,
  });
}
function holdRefusal(hold) {
  return Object.assign(new Error(`CMS item quota is used up (hold ${HOLD_FILE}); this item waits and resumes when the quota frees`), {
    code: HOLD_CODE, quotaHold: true, deferReason: HOLD_CODE, cmsItemQuota: true,
    requestSent: false, requestApplied: false, outcomeKnown: true, hold: hold ? { heldAt: hold.heldAt, nextCheckAt: hold.nextCheckAt } : null,
  });
}
// The operator's skip names the archive collections it covers; any other collection (a CMS
// fallback entity's rows, source pages) keeps the ordinary hold.
const collectionOf = (request) => (request && request.body && request.body.dataCollectionId) || null;
const skips = (hold, request) => Boolean(hold && hold.skip && hold.skip.collectionIds.includes(collectionOf(request)));
// Only an insert always creates an item; a save may update one, which spends nothing.
const INSERT_PATHS = new Set(['/wix-data/v2/items', '/wix-data/v2/bulk/items/insert']);
function isInsert(request) {
  try { return INSERT_PATHS.has(new URL(request.url).pathname.replace(/\/+$/, '')); } catch { return false; }
}

// One gate per project (or per site, with no project) in this process, shared by every client:
// the quota is the site's, not one client's. The file carries the hold across processes and runs.
const gates = new Map();
function quotaGate({ projectDir = null, siteId = null, now = Date.now, recheckMs = RECHECK_MS } = {}) {
  const key = projectDir ? `project:${path.resolve(projectDir)}` : `site:${siteId || ''}`;
  if (!gates.has(key)) gates.set(key, createGate({ projectDir, now, recheckMs }));
  return gates.get(key);
}

function createGate({ projectDir, now, recheckMs }) {
  let hold = projectDir ? readHold(projectDir) : null;
  // A new run (a new process) re-checks an inherited hold at its first write, whatever the timer says.
  let checkedHere = false;
  let checking = null;
  let unsaved = 0;
  const iso = (ms) => new Date(ms).toISOString();
  const save = () => { unsaved = 0; if (projectDir) writeHold(projectDir, hold); };
  const held = () => Boolean(hold && hold.status === 'held');
  // Another process (the operator's skip, another run's release) may have changed the file.
  const reload = () => { if (projectDir) hold = readHold(projectDir) || hold; };
  function release(reason, quota) {
    hold = { ...hold, status: 'released', releasedAt: iso(now()), releaseReason: reason, ...(quota ? { quota } : {}) };
    save();
  }
  const refuse = () => { hold.refusedCount = (hold.refusedCount || 0) + 1; if (++unsaved >= 100) save(); return holdRefusal(hold); };
  // Ask Wix once. Room → release. Unreadable usage → one write (the first to claim it) is the
  // probe; its own answer releases or extends the hold.
  async function recheck(readUsage) {
    checkedHere = true;
    reload();
    if (!held()) return { verdict: 'send' };
    hold = { ...hold, lastCheckedAt: iso(now()), nextCheckAt: iso(now() + recheckMs), checks: (hold.checks || 0) + 1 };
    const quota = readUsage ? await readUsage() : null;
    if (quota && quota.remaining > 0) { release('quota-has-room', quota); return { verdict: 'send' }; }
    if (quota) { hold = { ...hold, quota }; save(); return { verdict: 'refuse' }; }
    save();
    return { verdict: 'probe', probeTaken: false };
  }
  return {
    get hold() { return hold; },
    held,
    // Before a quota-spending write. Throws the operator's skip for a skipped archive collection,
    // else the typed hold refusal while held.
    async admit({ request = null, readUsage = null } = {}) {
      if (!checkedHere && !checking) reload();
      if (skips(hold, request)) throw skipRefusal(hold);
      if (!held()) return 'send';
      if (checkedHere && Date.parse(hold.nextCheckAt || 0) > now()) throw refuse();
      // Concurrent writers share one check.
      if (!checking) checking = recheck(readUsage).finally(() => { checking = null; });
      const result = await checking;
      if (skips(hold, request)) throw skipRefusal(hold);
      if (result.verdict === 'refuse') throw refuse();
      if (result.verdict === 'probe') { if (result.probeTaken) throw refuse(); result.probeTaken = true; }
      return result.verdict;
    },
    // A quota-spending insert succeeded: the quota has room. A save may have been an update.
    passed(request = null) { if (held() && (!request || isInsert(request))) release('write-succeeded'); },
    // Wix answered WDE0195: open the hold (or push its next check out).
    opened({ request = null, error = null } = {}) {
      const at = now();
      checkedHere = true;
      reload();
      if (!held()) {
        hold = { schemaVersion: 1, ...(hold && hold.skip ? { skip: hold.skip } : {}), status: 'held', code: HOLD_CODE, heldAt: iso(at), lastCheckedAt: iso(at), nextCheckAt: iso(at + recheckMs), checks: 0, refusedCount: 0,
          firstRefusal: { collectionId: collectionOf(request), sourceStableKey: request?.sourceStableKey || null, httpStatus: error?.status ?? null, errorCode: QUOTA_ERROR_CODE },
          pending: 'Every CMS item refused while held is journaled `deferred` with reason cms-item-quota-exhausted.',
          resume: 'Automatic: the import re-checks the quota every few minutes and at the start of every run, then writes the held rows again (`--deferred-only` selects them).',
          blocker: { owner: 'site owner (billing)', requiredInput: 'Upgrade the site plan to one with more CMS items, or delete CMS items', recoveryCode: HOLD_CODE } };
      } else {
        hold = { ...hold, lastCheckedAt: iso(at), nextCheckAt: iso(at + recheckMs) };
      }
      save();
    },
    // The fields that type a WDE0195 the client received: a hold deferral, or the operator's skip.
    refusalFields(request = null) {
      if (skips(hold, request)) return { code: SKIP_CODE, archiveSkipped: true, cmsItemQuota: true, decision: hold.skip, requestApplied: false, outcomeKnown: true };
      return { code: HOLD_CODE, quotaHold: true, deferReason: HOLD_CODE, cmsItemQuota: true, requestApplied: false, outcomeKnown: true };
    },
    // Persist the refusal count (the import calls it at the end of a pass; cheap when nothing changed).
    flush() { if (unsaved && hold) save(); },
  };
}

// The journal row a caller writes for a hold refusal or a WDE0195: a typed deferral, never a
// failure and never an unknown outcome. After the operator's skip it is a recorded
// `skipped_out_of_scope` row naming the decision. Null for any other error.
function quotaDeferral(error) {
  if (error && error.archiveSkipped === true) return { status: 'skipped_out_of_scope', reason: SKIP_CODE, decision: error.decision || null, requestApplied: false };
  if (!(error && (error.quotaHold === true || isCmsItemQuotaError(error)))) return null;
  return { status: 'deferred', reason: HOLD_CODE, deferral: { reason: HOLD_CODE, hold: HOLD_FILE }, requestApplied: false };
}

// The cutover task while the hold is open: read from the file, so it survives the run that opened it.
// After the operator's skip it becomes the Import Operator's re-run, which turns the rows deferred
// before the skip into recorded skips.
const RERUN = 'node skills/wix-replatform/scripts/cms-item-quota.js status --project-dir <project>, then run the import again with --deferred-only for the cms/data-item task';
function cutoverAction(projectDir) {
  const hold = readHold(projectDir);
  if (!hold || hold.status !== 'held') return null;
  const base = { code: HOLD_CODE, kind: 'manual_action', stage: 'cutover', blocking: false, heldAt: hold.heldAt, refusedCount: hold.refusedCount || 0, quota: hold.quota || null };
  if (hold.skip) {
    return { ...base, owner: 'Import Operator', role: 'Import Operator', requiresImportOperator: true, skip: hold.skip,
      summary: `The operator decided the waiting archive data (${hold.skip.collectionIds.join(', ')}) is not needed; rows deferred before that still need one re-run to be recorded as skipped. Other CMS items still wait for quota.`,
      action: `Run: ${RERUN}.`,
      evidence: `The deferred rows of ${hold.skip.collectionIds.join(', ')} become skipped_out_of_scope with reason ${SKIP_CODE}; any other collection's rows become imported once the quota has room.` };
  }
  return { ...base, owner: 'site owner (billing)', role: 'Cutover Operator',
    summary: 'The site has used its CMS item quota; some archived source data is waiting.',
    action: 'Either: in Business Manager, upgrade the site plan to one with more CMS items (or delete unneeded CMS items); the import notices the free room and writes the waiting rows by itself. Or: decide the waiting archive data is not needed.',
    // The skip is recorded on the migration machine, so it needs the Import Operator.
    skipRequiresImportOperator: true,
    skipPrompt: `The Cutover Operator decided the remaining CMS archive data is not needed. Run: node skills/wix-replatform/scripts/cms-item-quota.js skip --project-dir <project> --collection <archive collection id> --decided-by "<name>" --reason "<why>"; then run the import again with --deferred-only for the cms/data-item task, so the rows deferred before the decision are recorded as skipped.`,
    evidence: `${HOLD_FILE} status becomes "released" and the deferred cms-item-quota-exhausted rows become imported, or it records "skip" with the decision and those rows become skipped_out_of_scope.` };
}

// The operator's explicit decision that the waiting archive data of the named collections is not
// needed: recorded in the hold file with who, why and which collections, and every later item for
// those collections is journaled skipped_out_of_scope with the decision. Never a silent drop; the
// source extract keeps every row. Other collections keep the hold. `clearArchiveSkip` undoes it.
function recordArchiveSkip(projectDir, { decidedBy, reason, collectionIds, now = Date.now } = {}) {
  if (typeof decidedBy !== 'string' || !decidedBy.trim() || typeof reason !== 'string' || !reason.trim()) throw Object.assign(new Error('an archive skip needs decidedBy and reason'), { code: 'cms_archive_skip_invalid' });
  if (!Array.isArray(collectionIds) || !collectionIds.length || collectionIds.some((id) => typeof id !== 'string' || !id.trim())) throw Object.assign(new Error('an archive skip names the archive collection ids it covers'), { code: 'cms_archive_skip_invalid' });
  const prior = readHold(projectDir) || { schemaVersion: 1, status: 'released', code: HOLD_CODE };
  const hold = { ...prior, skip: { code: SKIP_CODE, collectionIds: [...new Set(collectionIds.map((id) => id.trim()))], decidedBy: decidedBy.trim(), reason: reason.trim(), decidedAt: new Date(now()).toISOString() } };
  writeHold(projectDir, hold);
  return hold;
}
function clearArchiveSkip(projectDir, { now = Date.now } = {}) {
  const prior = readHold(projectDir);
  if (!prior || !prior.skip) return prior;
  // The next write re-checks at once: room → release, else the hold waits as before.
  const hold = { ...prior, nextCheckAt: new Date(now()).toISOString(), skipCleared: { ...prior.skip, clearedAt: new Date(now()).toISOString() } };
  delete hold.skip;
  writeHold(projectDir, hold);
  return hold;
}

// ---------------------------------------------------------------- archive scope & packing ----

// Archive rows only for a record the import writes: its entity is in the resolved execution scope
// and the record itself is in scope (an out-of-scope user or library media file is not archived).
// `inScope(sourceEntity, record)` is the same record predicate the entity's own pass uses.
function archiveScope({ resolvedEntityRefs, inScope = null }) {
  if (!Array.isArray(resolvedEntityRefs)) throw Object.assign(new Error('resolvedEntityRefs must be the execution scope'), { code: 'cms_archive_scope_invalid' });
  const resolved = new Set(resolvedEntityRefs);
  return (sourceEntity, record) => resolved.has(sourceEntity) && (!inScope || inScope(sourceEntity, record) === true);
}

// Fields with a native or extended-field home are not archived: only `cms` decisions are.
function archivedLocations(row) {
  return (row.fieldMappings || []).filter((d) => d.disposition === 'cms').flatMap((d) => d.sourcePaths || []);
}

// One archive item per parent record. Two source records of the same thing (a WordPress user and
// the WooCommerce customer with the same id) take the same parentKey: the first is the item's
// payload, each other one an `alias` carrying only the top-level fields whose value differs
// (`$absent` lists the parent's keys it lacks); its `sourceKey` joins `childKeys` so it is still
// found by its own key. Same-parent sub-records (an order and its notes) ride in
// `children`, and `childKeys` lists their keys so a lookup by a child's key still finds the item
// (`hasSome` on an array field). An item that would pass the size limit is split into
// `<parentKey>#2`, `#3`… with the same parentKey; every part is found by `parentKey`.
function packArchiveItems(entries, { itemBytesLimit = ITEM_BYTES_LIMIT } = {}) {
  const parents = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.parentKey !== 'string' || !entry.parentKey) throw Object.assign(new Error('archive entry needs a parentKey'), { code: 'cms_archive_entry_invalid' });
    if (!parents.has(entry.parentKey)) parents.set(entry.parentKey, { parent: null, aliases: [], children: [] });
    const slot = parents.get(entry.parentKey);
    if (entry.childKey) slot.children.push({ key: entry.childKey, sourceEntity: entry.sourceEntity, payload: entry.payload });
    else if (!slot.parent) slot.parent = { sourceKey: entry.sourceKey || null, sourceEntity: entry.sourceEntity, payload: entry.payload };
    else slot.aliases.push({ key: entry.sourceKey || null, sourceEntity: entry.sourceEntity, payload: changedFields(slot.parent.payload, entry.payload) });
  }
  const items = [];
  const size = (value) => Buffer.byteLength(JSON.stringify(value));
  for (const [parentKey, { parent, aliases, children }] of parents) {
    const base = { parentKey, sourceEntity: parent ? parent.sourceEntity : children[0].sourceEntity, payload: parent ? parent.payload : null };
    let item = { ...base, ...(parent?.sourceKey ? { sourceKey: parent.sourceKey } : {}), ...(aliases.length ? { aliases } : {}), children: [], childKeys: aliases.map((a) => a.key).filter(Boolean) };
    let part = 1;
    for (const child of children) {
      if ((item.children.length || item.aliases) && size(item) + size(child) > itemBytesLimit) {
        items.push(item);
        part += 1;
        item = { parentKey, itemKey: `${parentKey}#${part}`, sourceEntity: base.sourceEntity, payload: null, children: [], childKeys: [] };
      }
      item.children.push(child); item.childKeys.push(child.key);
    }
    items.push(item);
  }
  return items.map((item) => ({ itemKey: item.itemKey || item.parentKey, ...item }));
}

const ABSENT = '$absent';
function changedFields(base, other) {
  if (!other || typeof other !== 'object' || Array.isArray(other) || !base || typeof base !== 'object' || Array.isArray(base)) return other;
  const changed = Object.fromEntries(Object.entries(other).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])));
  // Keys the parent has and this record lacks, so the record is rebuilt exactly.
  const absent = Object.keys(base).filter((key) => !Object.hasOwn(other, key));
  return absent.length ? { ...changed, [ABSENT]: absent } : changed;
}

// The expected custom-collection rows, for the plan line: packed archive items plus any other
// rows (source pages, a crosswalk mirror) the caller adds.
function expectedArchiveRows(entries, { otherRows = 0, itemBytesLimit } = {}) {
  return packArchiveItems(entries, { itemBytesLimit }).length + otherRows;
}

module.exports = {
  QUOTA_ERROR_CODE, HOLD_CODE, SKIP_CODE, HOLD_FILE, RECHECK_MS, ITEM_BYTES_LIMIT,
  consumesItemQuota, isCmsItemQuotaError,
  buildGetSiteDataUsageRequest, parseSiteDataUsage, readCmsItemQuota, quotaPlanLine,
  holdPath, readHold, quotaGate, quotaDeferral, cutoverAction, recordArchiveSkip, clearArchiveSkip,
  archiveScope, archivedLocations, packArchiveItems, expectedArchiveRows,
  // Tests only: forget in-process gates so a test can model a fresh run.
  _resetGates: () => gates.clear(),
};
