'use strict';

// Durable cutover projection for the site locale entity. Rows are rebuilt from the source,
// setup receipt, user actions and execution manifest; prose never clears an action.

const fs = require('node:fs');
const path = require('node:path');

const core = require('./site-regional.js');
const sr = require('./source-regional.js');
const gate = require('./site-regional-gate.js');

const FIELD_NAME = Object.freeze({ currency: 'currency', timeZone: 'time zone', language: 'language', locale: 'locale' });
const SOURCE_FIELD = Object.freeze({ currency: 'paymentCurrency', timeZone: 'timeZone', language: 'language', locale: 'locale' });
const projectLabel = (projectDir) => path.basename(path.resolve(projectDir));
function runLabel(projectDir) {
  const run = core.readJsonSync(path.join(projectDir, 'orchestration', 'run.json'));
  return (run && (run.runId || run.lastEventId || run.startedAt)) || 'latest';
}

function promptAnswer({ project, run, siteId, requestId }) {
  return `Requires Import Operator. Resume migration ${project}/${run} for destination ${siteId} in the original environment. Review site-locale request ${requestId}. The owner's answer arrives as CHOICE: change or CHOICE: keep. If it is missing or different, record nothing. Otherwise answer the durable request, rerun setup, and report every field action and read-back value.`;
}
function promptSupply({ project, run, field, adapter }) {
  const supplied = `record ${SOURCE_FIELD[field]} in discovery/source-locale.json as state \"supplied\" with its value, evidence and suppliedBy`;
  const recovery = adapter === 'sfcc' || String(adapter || '').startsWith('quick-')
    ? `${supplied}, then re-run ${String(adapter || '').startsWith('quick-') ? 'the quick plan and ' : ''}setup`
    : `record it as supplied in the adapter source-locale file, promote discovery, then rerun setup`;
  return `Requires Import Operator. Resume migration ${project}/${run} in the original environment. Re-run source discovery for ${FIELD_NAME[field]}; if the source does not expose it, ask the merchant and ${recovery}. Do not guess. Report the current site/locale receipt.`;
}
function promptCatchUp({ project, run, siteId, refs, fields }) {
  return `Requires Import Operator. Resume migration ${project}/${run} for destination ${siteId}. The owner chose change, or the site now matches, for ${fields.join(', ')}. Record the updated locale answer, rerun site/locale, then run catch-up for ${refs.join(', ')}. Report the current receipt and task-ledger completion; do not clear this action while any listed ref remains held.`;
}
function promptPayment({ project, run, siteId, requestId, currency }) {
  return `Requires Import Operator. Resume migration ${project}/${run} for destination ${siteId}. The Cutover Operator confirmed in Business Manager that connected payment methods accept ${currency}. Acknowledge user action ${requestId}, regenerate the completion report, and verify site-locale-payment-methods-unconfirmed is absent. If confirmation is missing, record nothing and leave the action open.`;
}

function promptTimeZone({ project, run, siteId, requestId, value }) {
  return `Requires Import Operator. Resume migration ${project}/${run} for destination ${siteId}. The Cutover Operator confirmed the site time zone (${value}, or the zone they set instead). Acknowledge user action ${requestId}, regenerate the completion report, and verify site-locale-time-zone-unconfirmed is absent. If confirmation is missing, record nothing and leave the action open.`;
}

function userActionFiles(projectDir) {
  const dir = path.join(projectDir, 'orchestration', 'user-actions');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^uar_.*\.json$/.test(name)) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); } catch { /* fail closed elsewhere */ }
  }
  return out;
}

function manifestTasks(projectDir) {
  const manifest = core.readJsonSync(path.join(projectDir, 'execution', 'execution-manifest.json'));
  return ((manifest && manifest.tasks) || []).filter((task) => task && task.kind === 'import');
}

function ndjson(projectDir, relative) {
  try { return fs.readFileSync(path.join(projectDir, relative), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function refsStillAwaitingCatchUp(projectDir, siteId, verification, refs, tasks) {
  const manifest = core.readJsonSync(path.join(projectDir, 'execution', 'execution-manifest.json'));
  if (!manifest) return refs;
  const finishedAfter = Date.parse(verification?.generatedAt || '') || Infinity;
  let manifestDigest; let setupPlanDigest; let mappingPlanDigest;
  try {
    manifestDigest = core.fileSha256(projectDir, 'execution/execution-manifest.json');
    setupPlanDigest = core.fileSha256(projectDir, 'setup/setup-plan.json');
    mappingPlanDigest = core.fileSha256(projectDir, 'mapping/mapping-plan.json');
  } catch { return refs; }
  const passes = ndjson(projectDir, 'state/readiness/task-passes.ndjson');
  const taskPassed = (task) => passes.some((pass) => pass?.taskId === task.id
    && pass.siteId === siteId && pass.dryRun === false && pass.selection?.mode === 'full'
    && pass.planVersion === manifest.planVersion && pass.manifestDigest === manifestDigest
    && pass.setupPlanDigest === setupPlanDigest && pass.mappingPlanDigest === mappingPlanDigest
    && Date.parse(pass.finishedAt) >= finishedAfter);
  return refs.filter((ref) => {
    const owners = tasks.filter((task) => (task.entityRefs || []).includes(ref));
    return owners.length === 0 || owners.some((task) => !taskPassed(task));
  });
}

function regionalReportRows(projectDir) {
  const operatorActions = [];
  const headline = [];
  const project = projectLabel(projectDir);
  const run = runLabel(projectDir);
  const siteId = core.destinationSiteId(projectDir) || 'the destination site';
  const tasks = manifestTasks(projectDir);
  const actions = userActionFiles(projectDir);
  let source = null;
  try { source = sr.readSourceRegionalSync(projectDir); } catch { source = null; }
  const pendingLocale = actions.find((request) => request.status === 'pending' && request.effect?.kind === core.ANSWER_EFFECT);

  if (source) {
    for (const field of core.SETTINGS) {
      if (sr.settingValue(source, field) !== null) continue;
      if (field === 'timeZone' && sr.keepsSiteTimeZone(source)) continue; // site zone kept; the confirm task below covers it
      operatorActions.push({
        code: 'site-locale-not-ready', severity: 'high', entity: `site/locale:${field}`, affectedCount: tasks.length || null,
        deadlineReason: 'before any entity import',
        action: `The source ${FIELD_NAME[field]} is missing (${sr.unknownReason(source, field) || 'not-exposed'}). ${promptSupply({ project, run, field, adapter: source.adapter })}`,
      });
    }
  }

  if (pendingLocale) {
    const fields = (pendingLocale.subject?.changes || []).map((change) => change.field);
    operatorActions.push({
      code: 'site-locale-not-ready', severity: 'high', entity: 'site/locale:owner-decision', affectedCount: tasks.length || null,
      deadlineReason: 'before any entity import',
      action: `The existing site has an order or product, so changing ${fields.map((field) => FIELD_NAME[field]).join(', ')} needs the owner's one answer. ${promptAnswer({ project, run, siteId, requestId: pendingLocale.requestId })}`,
    });
  }

  const { verification, row } = gate.verificationRow(projectDir);
  let current = false;
  try { current = gate.receiptIsCurrent(projectDir, siteId, verification, row); } catch { current = false; }
  const regional = row && row.regional;
  // Actual migrations always plan site/locale. Keeping the fallback scoped to projects that
  // carry that plan (or another locale artifact) avoids inventing cutover work for callers that
  // use completion-report utilities outside a migration project.
  const localeApplicable = Boolean(pendingLocale || row || core.planHasRegionalStep(projectDir));
  if (localeApplicable && !current && !operatorActions.some((item) => item.code === 'site-locale-not-ready')) {
    operatorActions.push({
      code: 'site-locale-not-ready', severity: 'high', entity: 'site/locale', affectedCount: tasks.length || null,
      deadlineReason: 'before any entity import',
      action: `The site/locale receipt is missing, stale or failed. Requires Import Operator. Resume migration ${project}/${run}, rerun setup for ${siteId}, and verify a current passed receipt before resuming imports.`,
    });
  }

  if (current && regional) {
    const keptFields = ['currency', 'timeZone'].filter((field) => regional.fields?.[field]?.action === 'kept');
    let catchUpFields = keptFields;
    let refs = [];
    if (keptFields.length) {
      const blocked = new Set();
      for (const task of tasks) {
        const dependency = gate.regionalDependency({ projectDir, siteId, entityRefs: task.entityRefs || [] });
        if (!dependency.ok && dependency.code === 'SITE_LOCALE_KEPT') for (const ref of dependency.affectedRefs || []) blocked.add(ref);
      }
      refs = [...blocked].sort();
    } else if (regional.heldCatchUp?.refs?.length) {
      catchUpFields = regional.heldCatchUp.fields || [];
      refs = refsStillAwaitingCatchUp(projectDir, siteId, verification, regional.heldCatchUp.refs, tasks);
    }
    if (refs.length) {
      operatorActions.push({
        code: 'site-locale-kept-blocking-imports', severity: 'high', entity: 'site/locale:kept', affectedCount: refs.length,
        deadlineReason: 'before launch completeness is accepted',
        action: `Neutral entities may import, but these refs remain held or await catch-up: ${refs.join(', ')}. ${promptCatchUp({ project, run, siteId, refs, fields: catchUpFields })}`,
      });
    }
    const applied = Object.entries(regional.fields || {}).filter(([, entry]) => entry.action === 'applied');
    if (applied.length) headline.push({ entity: 'site/locale', subtype: 'site-locale', message: `Site locale applied and verified: ${applied.map(([field]) => FIELD_NAME[field]).join(', ')}` });
    else headline.push({ entity: 'site/locale', subtype: 'site-locale', message: 'Site locale receipt is current' });
  }

  for (const request of actions) {
    if (request.status !== 'pending' || request.subject?.type !== 'site-locale-payment-methods-confirmation') continue;
    operatorActions.push({
      code: 'site-locale-payment-methods-unconfirmed', severity: 'high', entity: 'site/locale:payment-methods', affectedCount: null,
      deadlineReason: 'before checkout is enabled',
      action: `Cutover Operator: confirm in Business Manager that connected payment methods accept ${request.subject.after}. ${promptPayment({ project, run, siteId, requestId: request.requestId, currency: request.subject.after })}`,
    });
  }

  for (const request of actions) {
    if (request.status !== 'pending' || request.subject?.type !== core.TIME_ZONE_CONFIRMATION) continue;
    operatorActions.push({
      code: 'site-locale-time-zone-unconfirmed', severity: 'medium', entity: 'site/locale:timeZone', affectedCount: null,
      deadlineReason: 'before launch',
      action: `Cutover Operator: confirm the site time zone ${request.subject.value} in Business Manager > Settings > Language & region (the source store had no named zone; ${request.subject.basis === 'single-zone-country' ? 'picked from the store country' : request.subject.basis === 'unresolved' ? 'none could be picked, so the site kept its own zone' : 'picked from the store country and its fixed offset'}). Change it there if it is wrong. ${promptTimeZone({ project, run, siteId, requestId: request.requestId, value: request.subject.value })}`,
    });
  }

  return { operatorActions, headline };
}

module.exports = { regionalReportRows, promptAnswer, promptCatchUp, promptSupply, promptPayment, promptTimeZone };
