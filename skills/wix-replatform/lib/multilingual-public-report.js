'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./multilingual-public.js');

const PLAN = 'mapping/multilingual-public-plan.ndjson';
const TOPOLOGY = 'discovery/public-source-languages.json';
const DECISIONS = 'state/multilingual-public/decisions.ndjson';
const RECEIPT = 'state/multilingual-public/receipt.json';
const COST = 'state/multilingual-public/cost.json';
const CHANGES = 'state/multilingual-public/changes.ndjson';
const RESTORES = 'state/multilingual-public/restores.ndjson';
const SETUP = 'state/multilingual-public/setup.json';
const JOURNAL_REMOVAL = 'state/multilingual-public/journal-removal.json';
const CAPABILITIES = 'mapping/multilingual-public-capabilities.json';

const TEMPLATES = Object.freeze({
  LANG_PUBLIC_TOPOLOGY_UNRESOLVED: ['high', 'before multilingual planning', 'Update the named public-language evidence, rerun topology discovery, and leave default import results unchanged.', 'Current topology artifact proves the locale state.'],
  LANG_PUBLIC_SOURCE_GAP: ['medium', 'before launch', 'Rerun public discovery for the named locale/object/field if new public evidence is supplied; do not request private credentials in this phase. If the owner accepts the gap, record accept-gap with the decision recorder.', 'Imported value or a current accept-gap decision.'],
  LANG_PUBLIC_IDENTITY_UNRESOLVED: ['high', 'during discovery and mapping', 'Capture an API-supported stable source-to-Wix member ID or record an owner-approved accept-gap decision; never join by text or position.', 'Pairing receipt or a current accept-gap decision.'],
  LANG_TARGET_SETUP_CONFIRMATION_REQUIRED: ['high', 'before multilingual setup', 'Show the owner the exact setup proposal, record confirm-setup or decline-setup with the decision recorder, and rerun setup only after a matching confirmation.', 'Current decision plus locale/settings read-back, or a matching decline.'],
  LANG_TARGET_LOCALE_NOT_READY: ['high', 'before sidecar mapping', 'Inspect the setup result, wait only within the bounded policy, and resume after locale/settings read-back passes.', 'Current locale/settings read-back.'],
  LANG_TARGET_DEFAULT_CONTENT_NOT_READY: ['high', 'after default import', 'Confirm the named default-object receipt, refresh translation content, and resume only when the entity and keys resolve.', 'Current capability manifest resolves the entity and keys.'],
  LANG_TARGET_SCHEMA_UNRESOLVED: ['high', 'during sidecar mapping', 'Refresh the named Wix schema/content inventory and resume only when its schema, parent, and concrete key are proven.', 'Current capability manifest resolves the schema chain.'],
  LANG_TARGET_FIELD_UNSUPPORTED: ['medium', 'during mapping', 'Preserve the named unsupported-field gap; record accept-gap only after the owner accepts it, and rerun only after Wix exposes a compatible writable field.', 'Compatible current manifest or a current accept-gap decision.'],
  LANG_TARGET_PLAN_BLOCKED: ['high', 'before execution', 'Inspect the named plan row, assign a specific supported reason when possible, and do not mutate the target while it remains generic.', 'Rebuilt plan row has a specific decision and reason.'],
  LANG_TARGET_MUTATION_UNVERIFIED: ['high', 'before first route use', 'Run the named documented route on a disposable target, record versioned request/read-back evidence without secrets, and rebuild the plan; never mark it verified from documentation alone.', 'Versioned disposable-site contract evidence.'],
  LANG_RECOVERY_JOURNAL_NOT_READY: ['high', 'before value mutation', 'Repair or provision the administrator-only recovery collection, verify its permissions and typed-row read-back, then rebuild the plan.', 'Collection schema and permissions check plus typed-row read-back digest.'],
  LANG_TARGET_TRANSLATION_OVERWRITTEN: ['high', 'after verified overwrite and before launch', 'Tell the owner which named values were replaced and how to request restore, then record ack-overwrite-notice with the decision recorder. If the owner requests restore, record request-restore with the recovery row ID.', 'Recovery reference and verified replacement plus a current acknowledgement decision.'],
  LANG_TRANSLATION_RESTORE_REQUIRED: ['high', 'after owner request', 'Run the multilingual restore command for the named recovery-row ID; stop if the live replacement digest no longer matches, and retain a refusal as an open action.', 'Passing restore receipt and target read-back.'],
  LANG_SOURCE_TRANSLATION_REMOVED: ['medium', 'during catch-up', 'Leave the named target field unchanged. If the owner accepts retaining it, record accept-retained-removal with the decision recorder; otherwise rerun only after the source supplies a value.', 'Source value returns or a current accept-retained-removal decision.'],
  LANG_RECOVERY_JOURNAL_REMOVE: ['medium', 'after the cutover recovery window', 'After the owner separately authorizes removal, record authorize-journal-removal, delete the recovery collection without exporting it, and prove it is absent.', 'Current authorization decision and collection-absence read-back.'],
  LANG_PUBLIC_READBACK_MISMATCH: ['high', 'after an attempt', 'Reconcile the named write step with Wix, restore from the target recovery row if required, and retry only unverified fields.', 'Passing value, publication, visibility, and snapshot receipt.'],
  LANG_PRIVATE_SOURCE_DEFERRED: ['medium', 'after public verification', 'Route the named field to the private-source phase. If the owner accepts leaving it unmigrated, record accept-gap with the decision recorder.', 'Private-source receipt or a current accept-gap decision.'],
  LANG_FRONTEND_DEFERRED: ['medium', 'after application receipt', 'Route the named presentation field to frontend work. If the owner accepts leaving it out, record accept-gap with the decision recorder.', 'Frontend receipt or a current accept-gap decision.'],
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function decisionCloses(action, decisions) {
  if (action.reasonCode === 'LANG_RECOVERY_JOURNAL_REMOVE') return false;
  return decisions.some((entry) => entry.actionId === action.actionId && entry.scopeDigest === action.scopeDigest
    && entry.kind !== 'request-restore' && core.DECISION_KINDS[entry.kind]?.includes(action.reasonCode));
}

function actionForRow(row) {
  const template = TEMPLATES[row.reasonCode] || TEMPLATES.LANG_TARGET_PLAN_BLOCKED;
  const id = core.actionId(row.reasonCode, row.rowId);
  const scope = core.scopeDigest(row);
  return {
    actionId: id,
    reasonCode: row.reasonCode,
    scopeDigest: scope,
    affectedIds: [row.rowId],
    code: row.reasonCode,
    severity: template[0],
    action: `Requires Import Operator: ${template[2]}`,
    deadlineReason: template[1],
    entity: `multilingual-public:${row.rowId}`,
    affectedCount: 1,
    role: 'import-operator',
    importOperatorPrompt: template[2],
    artifactRefs: [PLAN, DECISIONS, RECEIPT],
    prerequisites: ['Resume the original migration environment with destination credentials.'],
    resolutionEvidence: template[3],
  };
}

function topologyAction(topology) {
  if (!topology || !['unknown'].includes(topology.mode)) return null;
  const row = { rowId: core.stableId('topology', core.digest(topology)), reasonCode: 'LANG_PUBLIC_TOPOLOGY_UNRESOLVED', state: topology.mode, decision: 'blocked' };
  const action = actionForRow(row);
  return { ...action, artifactRefs: [TOPOLOGY, DECISIONS] };
}

function restoreActions(decisions, restores) {
  return decisions.filter((entry) => entry.kind === 'request-restore').flatMap((entry) => {
    const restored = restores.some((row) => row.recoveryRowId === entry.recoveryRowId && row.status === 'restored');
    if (restored) return [];
    const template = TEMPLATES.LANG_TRANSLATION_RESTORE_REQUIRED;
    return [{
      actionId: core.actionId('LANG_TRANSLATION_RESTORE_REQUIRED', entry.decisionId),
      reasonCode: 'LANG_TRANSLATION_RESTORE_REQUIRED',
      scopeDigest: core.digest(entry),
      affectedIds: [entry.recoveryRowId],
      code: 'LANG_TRANSLATION_RESTORE_REQUIRED',
      severity: template[0],
      action: `Requires Import Operator: ${template[2]}`,
      deadlineReason: template[1],
      entity: `multilingual-public:restore:${entry.recoveryRowId}`,
      affectedCount: 1,
      role: 'import-operator',
      importOperatorPrompt: template[2],
      artifactRefs: [DECISIONS, RESTORES],
      prerequisites: ['Owner restore request is recorded with a recovery row ID.', 'Resume the original migration environment with destination credentials.'],
      resolutionEvidence: template[3],
    }];
  });
}

function durableOverwriteAction(row) {
  const stored = row.operatorAction;
  if (!stored || stored.reasonCode !== 'LANG_TARGET_TRANSLATION_OVERWRITTEN') return null;
  const template = TEMPLATES.LANG_TARGET_TRANSLATION_OVERWRITTEN;
  const recoveryRowId = row.recoveryRowId || row.id;
  return {
    ...stored,
    code: stored.reasonCode,
    severity: template[0],
    action: `Requires Import Operator: ${template[2]}`,
    deadlineReason: template[1],
    entity: `multilingual-public:${stored.affectedIds[0]}`,
    affectedCount: stored.affectedIds.length,
    role: 'import-operator',
    importOperatorPrompt: template[2],
    artifactRefs: [CAPABILITIES, CHANGES, DECISIONS],
    prerequisites: ['A verified destination recovery row is retained.', 'Resume the original migration environment with destination credentials.'],
    resolutionEvidence: template[3],
    recoveryRowId,
  };
}

function failureAction(failure, artifactRefs) {
  if (!failure?.code) return null;
  const reasonCode = TEMPLATES[failure.code] ? failure.code : 'LANG_TARGET_PLAN_BLOCKED';
  const row = {
    rowId: failure.rowId || core.stableId('multilingual-failure', reasonCode, failure.route || ''),
    reasonCode,
    state: 'failed',
    decision: 'blocked',
  };
  return { ...actionForRow(row), artifactRefs };
}

function candidateActionsForProject(projectDir) {
  const planRows = core.readNdjson(path.join(projectDir, PLAN));
  const changes = core.readNdjson(path.join(projectDir, CHANGES));
  const capabilities = readJson(path.join(projectDir, CAPABILITIES));
  const durable = [...(capabilities?.recoveryRows || []), ...changes]
    .filter((row) => row.outcome === 'verified')
    .sort((left, right) => String(left.verifiedAt || '').localeCompare(String(right.verifiedAt || '')))
    .map(durableOverwriteAction)
    .filter(Boolean);
  const currentByAction = new Map(durable.map((row) => [row.actionId, row]));
  for (const action of planRows.filter((row) => row.reasonCode).map(actionForRow)) currentByAction.set(action.actionId, action);
  return [...currentByAction.values()];
}

function multilingualReportRows(projectDir) {
  const planRows = core.readNdjson(path.join(projectDir, PLAN));
  const decisions = core.readNdjson(path.join(projectDir, DECISIONS));
  const restores = core.readNdjson(path.join(projectDir, RESTORES));
  const topology = readJson(path.join(projectDir, TOPOLOGY));
  const receipt = readJson(path.join(projectDir, RECEIPT));
  const setup = readJson(path.join(projectDir, SETUP));
  const journalRemoval = readJson(path.join(projectDir, JOURNAL_REMOVAL));
  const capabilities = readJson(path.join(projectDir, CAPABILITIES));
  const candidateActions = candidateActionsForProject(projectDir);
  const capabilityFailure = failureAction(capabilities?.failure, [CAPABILITIES]);
  if (capabilityFailure) candidateActions.push(capabilityFailure);
  const receiptFailure = failureAction(receipt?.failure, [RECEIPT, COST]);
  if (receiptFailure) candidateActions.push(receiptFailure);
  const setupFailure = failureAction(setup?.failure, [SETUP]);
  if (setupFailure) candidateActions.push(setupFailure);
  const topologyRow = topologyAction(topology);
  if (topologyRow) candidateActions.push(topologyRow);
  if (setup?.status === 'confirmation-required' && setup.action) {
    const template = TEMPLATES.LANG_TARGET_SETUP_CONFIRMATION_REQUIRED;
    candidateActions.push({
      ...setup.action,
      code: 'LANG_TARGET_SETUP_CONFIRMATION_REQUIRED',
      severity: template[0],
      action: `Requires Import Operator: ${template[2]}`,
      deadlineReason: template[1],
      entity: `multilingual-public:setup:${setup.proposalDigest}`,
      affectedCount: setup.action.affectedIds.length,
      role: 'import-operator',
      importOperatorPrompt: template[2],
      artifactRefs: [SETUP, DECISIONS],
      prerequisites: ['Site owner has reviewed the exact proposal.', 'Resume the original migration environment with destination credentials.'],
      resolutionEvidence: template[3],
    });
  }
  if (journalRemoval?.status === 'requested') {
    const template = TEMPLATES.LANG_RECOVERY_JOURNAL_REMOVE;
    candidateActions.push({
      actionId: journalRemoval.actionId,
      reasonCode: 'LANG_RECOVERY_JOURNAL_REMOVE',
      scopeDigest: journalRemoval.scopeDigest,
      affectedIds: ['ReplatformTranslationRecovery'],
      code: 'LANG_RECOVERY_JOURNAL_REMOVE',
      severity: template[0],
      action: `Requires Import Operator: ${template[2]}`,
      deadlineReason: template[1],
      entity: 'multilingual-public:recovery-journal',
      affectedCount: 1,
      role: 'import-operator',
      importOperatorPrompt: template[2],
      artifactRefs: [JOURNAL_REMOVAL, DECISIONS],
      prerequisites: ['Recovery window has ended.', 'Owner separately authorizes deletion.', 'Resume the original migration environment with destination credentials.'],
      resolutionEvidence: template[3],
    });
  }
  const operatorActions = candidateActions.filter((action) => !decisionCloses(action, decisions));
  operatorActions.push(...restoreActions(decisions, restores));
  const receiptById = new Map((receipt?.rows || []).map((row) => [row.rowId, row]));
  const byLocale = new Map();
  for (const row of planRows) {
    if (!byLocale.has(row.locale)) byLocale.set(row.locale, []);
    byLocale.get(row.locale).push(row);
  }
  const headline = [];
  for (const [locale, rows] of byLocale) {
    const ready = rows.length > 0 && rows.every((row) => receiptById.get(row.rowId)?.status === 'verified' || decisionCloses(actionForRow(row), decisions));
    if (ready) headline.push({ code: 'LANG_PUBLIC_READY', entity: `multilingual-public:${locale}`, subtype: locale, message: `${locale}: public application translations are verified and published; frontend work is separate.` });
  }
  return { operatorActions, headline };
}

module.exports = { CAPABILITIES, CHANGES, COST, DECISIONS, JOURNAL_REMOVAL, PLAN, RECEIPT, RESTORES, SETUP, TEMPLATES, actionForRow, candidateActionsForProject, multilingualReportRows };
