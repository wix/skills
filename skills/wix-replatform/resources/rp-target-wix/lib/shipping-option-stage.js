'use strict';

// rp-target-wix — the shipping-option part of the import's shipping stage, as
// deterministic code. A generated importer calls runShippingOptionStage after its delivery regions
// exist, and the finished-project audit (rp-execute-import/scripts/shipping-estimate-audit.js)
// calls runShippingEstimateAudit. Neither ever POSTs or PATCHes a crosswalked option. On a new
// site the import stage deletes Wix's placeholder "Free shipping" option (regionState).
//
// What it guarantees, in order:
//   1. the estimate resolution (execution/shipping-estimates.json) is written before any write;
//   2. every crosswalked option takes the read-only path first (crosswalk wins over every attempt
//      state and pass mode), including recorded missing-target decisions;
//   3. unresolved rows are recovered (read back), never re-sent;
//   4. creates happen only on a complete per-region snapshot, advanced only with known ids;
//   5. the completion fragment is built from the CURRENT state, so each run replaces the last.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const s = require('./shipping-build.js');
const w = require('./wix-writers.js');
const local = require('../../../lib/local-state.js');
const recovery = require('../../../lib/import-recovery.js');
const wixAuth = require('../../../lib/wix-auth.js');
const { getDecisionValue, isNewSiteStrategy } = require('../../../lib/orchestration-decisions.js');

const EXTRACT_FILE = 'data/source-extract/shipping-zone.ndjson';
const EXTRACT_MANIFEST = 'data/source-extract/shipping-zone.manifest.json';
const DECISIONS_FILE = 'orchestration/decisions.json';
const COMPLETION_REPORT = 'execution/completion-report.json';
const COMPLETION_SUMMARY = 'execution/completion-summary.md';
const PASS_MODES = ['unfiltered', 'missing-only', 'unresolved-only', 'failed-only'];

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, filePath);
}

// The shipping stage refuses to run on an in-progress or unmanifested extract.
async function readShippingZoneExtract(projectDir, { required = true } = {}) {
  const file = path.join(projectDir, EXTRACT_FILE);
  const manifest = path.join(projectDir, EXTRACT_MANIFEST);
  const [hasFile, hasManifest] = await Promise.all([exists(file), exists(manifest)]);
  if (!hasFile || !hasManifest) {
    if (!required) return null;
    throw new Error(`shipping stage: ${EXTRACT_FILE} and ${EXTRACT_MANIFEST} must both exist (a .tmp extract is still in progress)`);
  }
  const text = await fs.readFile(file, 'utf8');
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${EXTRACT_FILE}:${index + 1} invalid NDJSON: ${error.message}`);
    }
  });
}

async function readDecisions(projectDir) {
  const decisions = await readJsonIfExists(path.join(projectDir, DECISIONS_FILE));
  return decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {};
}

async function readSiteLanguage(wix) {
  try {
    return s.siteLanguageFromProperties(await w.getSiteProperties(wix));
  } catch (error) {
    if (wixAuth.isRunInterruption(error)) throw error;
    return null; // a failed read is treated as an unsupported language: no invented text
  }
}

function shippingAttemptRows(rows) {
  return (rows || []).filter((row) => row && row.sourceEntityType === 'shipping-option');
}

function latestShippingAttempts(rows) {
  return recovery.foldAttemptsBySource(shippingAttemptRows(rows));
}

// Zone → region id: the importer's own map wins; a finished project falls back to the zones'
// crosswalk rows (ecom/delivery-profile, keyed like "shipping-zone:1" with sourceId "1").
function regionIdsByZone(regionIdByZone, crosswalkBySource) {
  const out = {};
  for (const row of Object.values(crosswalkBySource || {})) {
    if (!row || row.targetEntityType !== 'ecom/delivery-profile' || !row.targetId) continue;
    const zoneId = row.sourceId ? String(row.sourceId) : String(row.sourceStableKey || '').split(':').pop();
    if (zoneId) out[zoneId] = row.targetId;
  }
  return { ...out, ...(regionIdByZone || {}) };
}

async function readPlaceholderLedger(projectDir) {
  const ledger = await readJsonIfExists(path.join(projectDir, s.SHIPPING_PLACEHOLDER_LEDGER));
  return ledger && Array.isArray(ledger.deletions) ? ledger : { schemaVersion: 1, deletions: [] };
}

// What was on each region before the migration's first create there (the earliest `started`
// shipping-option row's reconcile.preWriteTargetIds), and the regions where a create's outcome is
// still unknown. Only an option in the first set can be Wix's; while a region is in the second, an
// uncrosswalked option there may be the migration's own, so nothing there is deleted.
function regionWriteHistory(journalRows) {
  const rows = shippingAttemptRows(journalRows);
  const before = new Map();
  for (const row of rows) {
    const reconcile = row.reconcile || {};
    if (row.status === 'started' && reconcile.deliveryRegionId && Array.isArray(reconcile.preWriteTargetIds) && !before.has(reconcile.deliveryRegionId)) {
      before.set(reconcile.deliveryRegionId, new Set(reconcile.preWriteTargetIds));
    }
  }
  const unresolved = new Set(Object.values(latestShippingAttempts(rows))
    .filter((row) => row.status === 'started' || row.status === 'succeeded_unverified')
    .map((row) => row.reconcile && row.reconcile.deliveryRegionId).filter(Boolean));
  return { before, unresolved };
}

// The live delivery-region state for the completion fragment, and -- in the import stage only, on
// a NEW site (Elad KC, 2026-10-29) -- the deletion of Wix's placeholder "Free shipping" option from
// a zone's region once the migration's own options are on it. Only an option that was on the region
// before the migration first wrote there is a candidate; the source store's own "Free shipping",
// even one whose create outcome is unknown, never is. The full option is written to the
// ledger BEFORE the DELETE, so it can be re-created; a row left `deleting` by a crash is retried
// (a 404 means it is already gone). An existing site keeps every option and only reports it.
// `snapshots` are the stage's own per-region scans (advanced with the ids it created), reused so a
// region is still read once per run; a region without one is read here.
async function regionState(wix, { projectDir, zonePlans = [], regionIdByZone = {}, crosswalkBySource = {}, decisions = {}, mayDelete = false, snapshots = null, journalRows = [] } = {}) {
  const byZone = regionIdsByZone(regionIdByZone, crosswalkBySource);
  let regions = null;
  try {
    regions = (await w.queryDeliveryProfiles(wix)).flatMap((profile) => profile.deliveryRegions || profile.regions || []);
  } catch (error) {
    if (wixAuth.isRunInterruption(error)) throw error;
    regions = null; // coverage is then not reported this run; nothing is guessed
  }
  const coverage = regions ? s.regionCoverage({ zonePlans, regionIdByZone: byZone, regions }) : [];
  const nameOf = (regionId) => (regions && (regions.find((region) => region.id === regionId) || {}).name) || null;
  const zonesOf = (regionId) => zonePlans.filter((plan) => byZone[String(plan.zone.id)] === regionId).map((plan) => `zone ${plan.zone.name ? `"${plan.zone.name}"` : plan.zone.id}`);
  const ours = new Set(Object.values(shippingCrosswalk(crosswalkBySource)).map((row) => row.targetId).filter(Boolean));
  const newSite = isNewSiteStrategy(getDecisionValue(decisions, 'targetSiteStrategy'));
  const ledger = await readPlaceholderLedger(projectDir);
  const saveLedger = () => writeJsonAtomic(path.join(projectDir, s.SHIPPING_PLACEHOLDER_LEDGER), ledger);
  const history = regionWriteHistory(journalRows);
  const preexisting = [];
  for (const regionId of new Set(zonePlans.map((plan) => byZone[String(plan.zone.id)]).filter(Boolean))) {
    const snapshot = snapshots && snapshots.get(regionId);
    const scan = snapshot && snapshot.complete && !snapshot.unprovable
      ? { complete: true, options: [...snapshot.options, ...[...snapshot.ids].filter((id) => !snapshot.options.some((option) => option.id === id)).map((id) => ({ id }))] }
      : await w.queryAllShippingOptions(wix, { deliveryRegionId: regionId });
    let foreign = scan.options.filter((option) => !ours.has(option.id));
    const replaced = scan.complete && scan.options.some((option) => ours.has(option.id));
    const settled = !history.unresolved.has(regionId) && !(snapshot && snapshot.unprovable);
    if (mayDelete && newSite && replaced && settled && history.before.has(regionId)) {
      const wixOwned = history.before.get(regionId);
      const pending = ledger.deletions.filter((entry) => entry.regionId === regionId && entry.status === 'deleting').map((entry) => entry.option);
      const targets = [...pending, ...foreign.filter((option) => wixOwned.has(option.id) && s.isWixPlaceholderShippingOption(option) && !pending.some((p) => p.id === option.id))];
      for (const option of targets) {
        let entry = ledger.deletions.find((row) => row.option && row.option.id === option.id);
        if (!entry) {
          entry = { optionId: option.id, regionId, regionName: nameOf(regionId), zones: zonesOf(regionId), option, status: 'deleting', at: new Date().toISOString() };
          ledger.deletions.push(entry);
          await saveLedger();
        }
        try {
          const result = await w.deleteShippingOption(wix, option.id);
          Object.assign(entry, { status: result.deleted ? 'deleted' : 'already-gone', at: new Date().toISOString() });
        } catch (error) {
          if (wixAuth.isRunInterruption(error)) throw error;
          Object.assign(entry, { status: 'failed', error: String((error && error.message) || error).slice(0, 300), at: new Date().toISOString() });
        }
        await saveLedger();
        if (entry.status !== 'failed') foreign = foreign.filter((other) => other.id !== option.id);
      }
    }
    preexisting.push({ regionId, regionName: nameOf(regionId), zones: zonesOf(regionId), complete: scan.complete,
      options: foreign.map((option) => ({ id: option.id, title: option.title || null })) });
  }
  return { coverage, preexisting, deletions: ledger.deletions };
}

function shippingCrosswalk(bySource) {
  const out = {};
  for (const [key, row] of Object.entries(bySource || {})) if (row && row.targetEntityType === s.SHIPPING_OPTION_TARGET_TYPE) out[key] = row;
  return out;
}

async function writeEstimates(projectDir, resolution, fragment, audit) {
  const document = {
    ...(resolution || { schemaVersion: 1, siteLanguage: null, options: [], ignoredDecisions: [] }),
    legacy: (audit && audit.legacyBlank) || [],
    items: (fragment && fragment.items) || [],
  };
  await writeJsonAtomic(path.join(projectDir, s.SHIPPING_ESTIMATES_FILE), document);
  return document;
}

async function persistUpserts(projectDir, audit) {
  for (const row of (audit && audit.crosswalkUpserts) || []) await local.upsertCrosswalkRow(projectDir, row);
}

function passFilters(passMode) {
  if (!PASS_MODES.includes(passMode)) throw new Error(`shipping stage: passMode must be one of ${PASS_MODES.join(', ')}`);
  return {
    missingOnly: passMode === 'missing-only',
    unresolvedOnly: passMode === 'unresolved-only',
    failedOnly: passMode === 'failed-only',
  };
}

// Routing for a record with NO crosswalk row. `--missing-only` routes like
// an unfiltered pass here: it differs only in skipping crosswalked records, which never reach this
// function. Never creates an option whose latest row is unresolved or failed_terminal.
function routeFor(latest, passMode) {
  const normal = passMode === 'unfiltered' || passMode === 'missing-only';
  if (!latest) return normal ? 'create' : 'skip';
  if (latest.status === 'imported') return 'skip';
  if (latest.status === 'started' || latest.status === 'succeeded_unverified') return passMode === 'failed-only' ? 'skip' : 'recover';
  if (latest.status === 'failed_retryable') return normal || passMode === 'failed-only' ? 'create' : 'skip';
  return 'skip'; // failed_terminal (including NOT_FOUND) and anything else: the operator decides
}

// Only a zone with destinations can have a delivery region, so only those can carry options.
function writableZonePlans(zones) {
  return s.planShippingZones(zones).filter((plan) => plan.destinations.length > 0 && plan.shippingOptions.length > 0);
}

async function runShippingOptionStage(wix, {
  projectDir,
  regionIdByZone = {},
  sourceSystem = 'wordpress',
  runId,
  phase = 'import',
  passMode = 'unfiltered',
  writeSpecId = 'ecom/shipping-option',
  newAttemptId = () => crypto.randomUUID(),
} = {}) {
  if (!projectDir) throw new Error('runShippingOptionStage: projectDir is required');
  if (!runId) throw new Error('runShippingOptionStage: runId is required');
  const filters = passFilters(passMode);
  const zones = await readShippingZoneExtract(projectDir);
  const zonePlans = writableZonePlans(zones);
  const decisions = await readDecisions(projectDir);
  const siteLanguage = await readSiteLanguage(wix);
  const resolution = s.planShippingEstimates({ zonePlans, decisions, siteLanguage });
  await writeEstimates(projectDir, resolution, null, null);
  const resolutionByKey = new Map(resolution.options.map((option) => [option.optionKey, option]));
  // A zone already written on an earlier run keeps its region through its crosswalk row.
  const regionByZone = regionIdsByZone(regionIdByZone, (await local.loadCrosswalk(projectDir)).bySource);

  // Planned payloads, keyed by the raw option key.
  const planned = [];
  for (const plan of zonePlans) {
    const zoneId = String(plan.zone.id);
    for (const option of plan.shippingOptions) {
      const optionKey = s.shippingOptionKey(zoneId, option);
      // A zone whose region could not be written (e.g. an unresolved destination collision) keeps
      // its options planned with no input: they get a retryable not-attempted row below, and the
      // rest of the stage runs. One zone never stops the import.
      const deliveryRegionId = regionByZone[zoneId] || null;
      const estimate = resolutionByKey.get(optionKey);
      planned.push({
        id: optionKey,
        optionKey,
        zoneId,
        deliveryRegionId,
        input: deliveryRegionId ? s.buildShippingOptionInput(option.classified, { deliveryRegionId, estimatedDeliveryTime: estimate.text, rates: option.rates }) : null,
      });
    }
  }

  // Crosswalk first, for EVERY linked option and every pass mode: read-only, never a POST.
  const preRunCrosswalk = await local.loadCrosswalk(projectDir);
  let journal = await local.loadAttemptJournal(projectDir);
  const audit = await s.auditShippingEstimates(wix, {
    crosswalkBySource: shippingCrosswalk(preRunCrosswalk.bySource),
    attemptRows: journal.rows,
    resolution,
    decisions,
  });
  await persistUpserts(projectDir, audit);

  const selection = recovery.selectImportRecords(planned, {
    sourceSystem,
    filters: { ...filters, entity: 'shipping-option' },
    crosswalkBySource: preRunCrosswalk.bySource,
    attemptRows: journal.rows,
  });

  const readBack = { ...audit.readBack };
  const results = [];
  const regions = new Map();
  const ctxFor = (record, attemptId, reconcile) => ({
    attemptId,
    sourceSystem,
    sourceId: record.optionKey,
    sourceStableKey: recovery.sourceStableKey(sourceSystem, 'shipping-option', record.optionKey),
    writeSpecId,
    runId,
    phase,
    ...(reconcile ? { reconcile } : {}),
  });

  const routed = selection.selected
    .filter((entry) => !entry.existing)
    .map((entry) => ({ ...entry, route: routeFor(entry.latestAttempt, passMode) }));

  // 1. Recover unresolved rows first: read back, never re-send.
  for (const entry of routed.filter((item) => item.route === 'recover')) {
    const record = entry.record;
    const latest = entry.latestAttempt;
    if (!record.input) {
      results.push({ optionKey: record.optionKey, route: 'recover', outcome: 'shipping-option-recovery-incomplete', errorCode: 'DELIVERY_REGION_MISSING' });
      continue; // nothing to compare against until the zone has a region; the row stays as it was
    }
    const result = await w.recoverShippingOption(wix, latest, record.input, { decisions });
    if (result.outcome === 'shipping-option-recovery-incomplete') {
      results.push({ optionKey: record.optionKey, route: 'recover', outcome: result.outcome });
      continue; // the row stays exactly as it was
    }
    const { attempt, crosswalk } = s.shippingOptionWriteRecord(result, ctxFor(record, latest.attemptId, latest.reconcile));
    await local.markAttempt(projectDir, latest.attemptId, { ...attempt, failure: attempt.failure });
    if (crosswalk) await local.appendCrosswalkRow(projectDir, crosswalk);
    if (result.outcome === 'shipping-option-created' && result.stored) readBack[record.optionKey] = result.stored;
    results.push({ optionKey: record.optionKey, route: 'recover', outcome: result.outcome, status: attempt.status });
  }

  // 2. Creates, on a complete per-region snapshot advanced only with known ids.
  for (const entry of routed.filter((item) => item.route === 'create')) {
    const record = entry.record;
    const regionId = record.deliveryRegionId;
    if (!regionId) {
      const errorCode = 'DELIVERY_REGION_MISSING';
      const { attempt } = s.shippingOptionWriteRecord({ outcome: 'shipping-option-not-attempted', id: null, errorCode, reason: `zone ${record.zoneId} has no delivery region yet; created on the next run once it has one` }, ctxFor(record, newAttemptId()));
      await local.appendAttempt(projectDir, attempt);
      results.push({ optionKey: record.optionKey, route: 'create', outcome: 'not-attempted', errorCode });
      continue;
    }
    if (!regions.has(regionId)) {
      const scan = await w.queryAllShippingOptions(wix, { deliveryRegionId: regionId });
      regions.set(regionId, { complete: scan.complete, ids: new Set(scan.options.map((option) => option.id)), unprovable: false, options: scan.options });
    }
    const region = regions.get(regionId);
    if (!region.complete || region.unprovable) {
      const errorCode = region.complete ? 'REGION_SNAPSHOT_UNPROVABLE' : 'SNAPSHOT_INCOMPLETE';
      const reason = region.complete
        ? 'an earlier create in this region had an unknown outcome; the region is rescanned next run'
        : 'the region snapshot scan was incomplete; nothing is created in this region this run';
      const { attempt } = s.shippingOptionWriteRecord({ outcome: 'shipping-option-not-attempted', id: null, errorCode, reason }, ctxFor(record, newAttemptId(), { deliveryRegionId: regionId }));
      await local.appendAttempt(projectDir, attempt);
      results.push({ optionKey: record.optionKey, route: 'create', outcome: 'not-attempted', errorCode });
      continue;
    }
    const attemptId = newAttemptId();
    const reconcile = { deliveryRegionId: regionId, preWriteTargetIds: [...region.ids] };
    // The start half of the shared start/terminal pair: written BEFORE the POST, so a crash
    // mid-write leaves a `started` row carrying the snapshot recovery needs.
    const ctx = ctxFor(record, attemptId, reconcile);
    await local.appendAttempt(projectDir, {
      schemaVersion: 1,
      attemptId,
      sourceSystem,
      sourceEntityType: 'shipping-option',
      sourceId: ctx.sourceId,
      sourceStableKey: ctx.sourceStableKey,
      writeSpecId,
      runId,
      phase,
      operation: s.SHIPPING_OPTION_OPERATION,
      targetEntityType: s.SHIPPING_OPTION_TARGET_TYPE,
      status: 'started',
      reconcile,
      updatedAt: new Date().toISOString(),
    });
    const result = await w.createShippingOptionVerified(wix, record.input);
    const { attempt, crosswalk } = s.shippingOptionWriteRecord(result, ctx);
    await local.markAttempt(projectDir, attemptId, { ...attempt, failure: attempt.failure });
    if (crosswalk) await local.appendCrosswalkRow(projectDir, crosswalk);
    if (result.id) region.ids.add(result.id);
    if (result.outcome === 'shipping-option-unknown') region.unprovable = true;
    if (result.outcome === 'shipping-option-created' && result.stored) readBack[record.optionKey] = result.stored;
    results.push({ optionKey: record.optionKey, route: 'create', outcome: result.outcome, status: attempt.status });
  }

  journal = await local.loadAttemptJournal(projectDir);
  const latestAttempts = latestShippingAttempts(journal.rows);
  const regionReport = await regionState(wix, { projectDir, zonePlans, regionIdByZone: regionByZone, crosswalkBySource: (await local.loadCrosswalk(projectDir)).bySource, decisions, mayDelete: true, snapshots: regions, journalRows: journal.rows });
  const fragment = s.shippingEstimateCompletionFragment({ resolution, readBack, latestAttempts, audit, projectDir, regions: regionReport });
  const estimates = await writeEstimates(projectDir, resolution, fragment, audit);
  return { resolution, estimates, fragment, audit, results, selection: selection.summary };
}

// --- Finished projects -----------------------------------------------------------
// Replaces the shipping rows of an already-written completion report and regenerates the
// post-execution handoff. Every other part of the report is kept as written: the report's own
// rows are already the final record of that run, and re-deriving them could double rows the
// writer joined (source coverage) or derived (voucher/coverage-check actions). The merged rows go
// through createCompletionReport's own operator-action normalization before they are written.
async function rebuildCompletionWithFragment(projectDir, fragment) {
  const { createCompletionReport, renderCompletionSummary } = require('../../../lib/completion-report.js');
  const { generatePostExecutionHandoff } = require('../../../lib/website-handoff.js');
  const reportPath = path.join(projectDir, COMPLETION_REPORT);
  const report = await readJsonIfExists(reportPath);
  if (!report) return { completionReport: null, handoff: { ok: false, reason: 'missing_completion_report' } };
  const merged = s.mergeShippingEstimateCompletion(report, fragment);
  const normalized = createCompletionReport({ operatorActions: merged.operatorActions, lastWriteAt: report.lastWriteAt || null }).operatorActions;
  const rebuilt = { ...report, operatorActions: normalized };
  await writeJsonAtomic(reportPath, rebuilt);
  await fs.writeFile(path.join(projectDir, COMPLETION_SUMMARY), renderCompletionSummary(rebuilt), 'utf8');
  // Rewriting import outcomes also refreshes the discovered-set join before its handoff.
  if (rebuilt.managementImportMode !== 'quick') {
    await require('../../../lib/discovered-set-status.js').buildDiscoveredSetStatus(projectDir);
  }
  const handoff = await generatePostExecutionHandoff(projectDir, { runId: report.runId || null });
  return { completionReport: rebuilt, handoff };
}

async function runShippingEstimateAudit(wix, { projectDir } = {}) {
  if (!projectDir) throw new Error('runShippingEstimateAudit: projectDir is required');
  const decisions = await readDecisions(projectDir);
  const zones = await readShippingZoneExtract(projectDir, { required: false });
  const siteLanguage = await readSiteLanguage(wix);
  const resolution = zones ? s.planShippingEstimates({ zonePlans: writableZonePlans(zones), decisions, siteLanguage }) : null;
  const crosswalk = await local.loadCrosswalk(projectDir);
  const journal = await local.loadAttemptJournal(projectDir);
  const audit = await s.auditShippingEstimates(wix, {
    crosswalkBySource: shippingCrosswalk(crosswalk.bySource),
    attemptRows: journal.rows,
    resolution,
    decisions,
  });
  await persistUpserts(projectDir, audit);
  const latestAttempts = latestShippingAttempts(journal.rows);
  // The audit only reads: it reports the region state and never deletes.
  const regionReport = await regionState(wix, { projectDir, zonePlans: zones ? writableZonePlans(zones) : [], crosswalkBySource: crosswalk.bySource, decisions });
  const fragment = s.shippingEstimateCompletionFragment({ resolution, readBack: audit.readBack, latestAttempts, audit, projectDir, regions: regionReport });
  const previous = await readJsonIfExists(path.join(projectDir, s.SHIPPING_ESTIMATES_FILE));
  const base = resolution || (previous ? { ...previous } : null);
  const estimates = await writeEstimates(projectDir, base, fragment, audit);
  const rebuilt = await rebuildCompletionWithFragment(projectDir, fragment);
  return { resolution, audit, fragment, estimates, ...rebuilt };
}

async function listShippingEstimateItems(projectDir, code) {
  const document = await readJsonIfExists(path.join(projectDir, s.SHIPPING_ESTIMATES_FILE));
  return ((document && document.items) || []).filter((item) => !code || item.code === code);
}

module.exports = {
  EXTRACT_FILE,
  EXTRACT_MANIFEST,
  PASS_MODES,
  readShippingZoneExtract,
  runShippingOptionStage,
  runShippingEstimateAudit,
  rebuildCompletionWithFragment,
  listShippingEstimateItems,
};
