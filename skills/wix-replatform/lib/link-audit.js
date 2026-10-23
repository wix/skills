'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const RELATIVE_PATH = 'state/url-preservation/link-audit.json';
const UNRESOLVED_REASONS = new Set([
  'target-not-imported', 'source-broken', 'collision', 'ambiguous-target', 'unsupported-family',
]);
const INTEGRATION_PROMPT = 'Resume internal-link writer integration for the listed audit records: establish exclusive ownership of each content field, keep source-origin URL rewriting limited to non-content configuration, and connect the dedicated blog-post link writer to verified destinations and a checkpointed post-frontend update, publish and read-back phase. Run the scoped compatibility and end-to-end checks, resume only compatible writers, and return the refreshed link audit, report and handoff. If a required writer or lifecycle is unavailable, keep the affected repairs pending and report the missing contract.';
const ROUTE_PROMPT = "Resume app page routing for the listed page families and original paths: inspect the destination's current route configuration, apply the supported source-matching configuration, record any unsupported family with its actual Wix destination and redirect requirement, and return the refreshed capability matrix, configuration read-back and report.";
const UNRESOLVED_PROMPT = 'Resume app routing and internal-link reconciliation for the listed audit occurrence IDs; obtain missing capture/adapter access, resolve intended targets, apply approved repairs, and return the refreshed link audit and report.';
const PENDING_PROMPT = 'Run the post-frontend routing and link verification step for this migration: confirm the frontend deployment origin and mount path, read back generated entity URLs, run the read-only calibration and budget estimate, and only within the approved budget check the per-family samples and verify and repair the stored destinations, and return the refreshed link audit and report.';
const UNAVAILABLE_PROMPT = 'Rerun internal-link verification for the listed audit occurrence and destination IDs against the current Wix deployment: confirm deployment origin, mount path, permissions and safe session fixtures, re-check route identity, rendered links, fragments and actions, and return the refreshed link audit and report.';
const BUDGET_PROMPT = 'Present the recorded link counts, estimate and budget to the migration owner and request a decision to continue, reduce scope or stop. Then resume verification and repair for the listed audit within the approved limit and return the refreshed link audit and report.';

function auditPath(projectDir) {
  return path.join(projectDir, RELATIVE_PATH);
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function unique(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

// The queues partition navigation occurrences. A missing or duplicated occurrence must never
// disappear from cutover just because a backend import succeeded.
function validateLinkAudit(audit) {
  if (!audit || audit.schemaVersion !== 1) throw new Error('link audit schemaVersion must be 1');
  if (audit.postDnsStatus === 'verified' && (!audit.postDnsEvidence || !audit.postDnsEvidence.host || !audit.postDnsEvidence.checkedAt || audit.postDnsEvidence.wixIdentityMatched !== true)) {
    throw new Error('verified post-DNS status requires public-host Wix identity evidence');
  }
  const occurrences = audit.occurrences || [];
  const pending = audit.pendingDestinations || [];
  const unresolved = audit.unresolved || [];
  const outcomes = audit.outcomes || [];
  const ids = new Set();
  for (const row of occurrences) {
    nonempty(row.id, 'occurrence.id');
    if (ids.has(row.id)) throw new Error(`duplicate occurrence ${row.id}`);
    ids.add(row.id);
  }
  const assigned = new Map();
  const assign = (id, location) => {
    if (!ids.has(id)) throw new Error(`${location} references missing occurrence ${id}`);
    if (assigned.has(id)) throw new Error(`occurrence ${id} appears in both ${assigned.get(id)} and ${location}`);
    assigned.set(id, location);
  };
  for (const row of pending) {
    nonempty(row.id, 'pending.id');
    nonempty(row.targetRecordId, 'pending.targetRecordId');
    nonempty(row.expectedPath, 'pending.expectedPath');
    if (!row.expectedPath.startsWith('/') || row.expectedPath.startsWith('//')) throw new Error('pending.expectedPath must be root-relative');
    nonempty(row.pageFamily, 'pending.pageFamily');
    unique(row.occurrenceIds, 'pending.occurrenceIds');
    row.occurrenceIds.forEach((id) => assign(id, `pending ${row.id}`));
  }
  for (const row of unresolved) {
    nonempty(row.id, 'unresolved.id');
    if ('expectedPath' in row) throw new Error('unresolved entries cannot carry expectedPath');
    if (!UNRESOLVED_REASONS.has(row.reason)) throw new Error(`invalid unresolved reason ${row.reason}`);
    unique(row.occurrenceIds, 'unresolved.occurrenceIds');
    row.occurrenceIds.forEach((id) => assign(id, `unresolved ${row.id}`));
  }
  for (const row of outcomes) {
    nonempty(row.occurrenceId, 'outcome.occurrenceId');
    nonempty(row.status, 'outcome.status');
    assign(row.occurrenceId, 'outcome');
  }
  for (const id of ids) if (!assigned.has(id)) throw new Error(`unaccounted navigation occurrence ${id}`);
  for (const row of audit.writerIntegrations || []) {
    nonempty(row.field, 'writerIntegration.field');
    nonempty(row.status, 'writerIntegration.status');
    unique(row.occurrenceIds || [], 'writerIntegration.occurrenceIds');
    for (const id of row.occurrenceIds || []) if (!ids.has(id)) throw new Error(`writer integration references missing occurrence ${id}`);
  }
  return audit;
}

async function readLinkAudit(projectDir) {
  try {
    return validateLinkAudit(JSON.parse(await fs.readFile(auditPath(projectDir), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeLinkAudit(projectDir, audit) {
  validateLinkAudit(audit);
  const target = auditPath(projectDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(audit, null, 2)}\n`);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return target;
}

function linkOperatorActions(audit) {
  if (!audit) return [];
  validateLinkAudit(audit);
  const actions = [];
  const pendingWriter = (audit.writerIntegrations || []).filter((row) => row.status === 'pending');
  if (pendingWriter.length) {
    actions.push({
      code: 'link_writer_integration', severity: 'high',
      action: `Requires Import Operator. ${INTEGRATION_PROMPT} Affected fields: ${pendingWriter.map((row) => row.field).join(', ')}. Evidence: ${RELATIVE_PATH}.`,
      deadlineReason: 'After compatible writers and lifecycle are available, before DNS; destination checks alone do not complete content repair.',
      entity: 'internal-links', affectedCount: new Set(pendingWriter.flatMap((row) => row.occurrenceIds)).size,
    });
  }
  const ownershipGaps = audit.unresolved.filter((row) => row.detail !== 'fragment-anchor-unverified');
  if (ownershipGaps.length) actions.push({
    code: 'unresolved_internal_links', severity: 'high',
    action: `Requires Import Operator. ${UNRESOLVED_PROMPT} Evidence: ${RELATIVE_PATH}; ambiguous ownership needs a human decision.`,
    deadlineReason: 'Before website handoff; unresolved navigation can open missing or wrong pages.',
    entity: 'internal-links', affectedCount: ownershipGaps.reduce((count, row) => count + row.occurrenceIds.length, 0),
  });
  const routeIssues = (audit.routes || []).filter((row) => !['configured', 'reused'].includes(row.status));
  if (routeIssues.length) actions.push({
    code: 'app_route_configuration', severity: 'high',
    action: `Requires Import Operator. ${ROUTE_PROMPT} Evidence: ${RELATIVE_PATH}. Conflicting ownership needs a human decision.`,
    deadlineReason: 'After apps are installed and before DNS; a planned or unsupported route is not a served page.',
    entity: 'app-routes', affectedCount: routeIssues.length,
  });
  const scanGaps = (audit.manifest || []).filter((row) => ['unsupported', 'unsupported-construct', 'unreadable', 'missing'].includes(row.disposition));
  if (scanGaps.length) actions.push({
    code: 'internal_link_scan_gaps', severity: 'high',
    action: `Requires Import Operator. ${UNRESOLVED_PROMPT} Evidence: ${RELATIVE_PATH}.`,
    deadlineReason: 'Before website handoff; unsupported or unreadable files cannot count as verified link coverage.',
    entity: 'internal-links', affectedCount: scanGaps.length,
  });
  if (audit.stage !== 'verified' || audit.pendingDestinations.length) actions.push({
    code: 'pending_link_verification', severity: 'high',
    action: `Requires Import Operator. ${PENDING_PROMPT} Evidence: ${RELATIVE_PATH}.`,
    deadlineReason: 'After frontend creation and before DNS; planned paths have not been shown to serve intended pages.',
    entity: 'internal-links', affectedCount: audit.pendingDestinations.reduce((count, row) => count + row.occurrenceIds.length, 0),
  });
  const unavailable = (audit.pendingDestinations || []).filter((row) => row.reason && row.reason !== 'writer-or-link-verification-pending');
  const fragmentGaps = (audit.unresolved || []).filter((row) => row.detail === 'fragment-anchor-unverified');
  if (unavailable.length || fragmentGaps.length) actions.push({
    code: 'link_verification_unavailable', severity: 'high',
    action: `Requires Import Operator. ${UNAVAILABLE_PROMPT} Evidence: ${RELATIVE_PATH}.`,
    deadlineReason: 'Before DNS; a served-page response alone does not prove link behavior, fragments or current content.',
    entity: 'internal-links', affectedCount: unavailable.reduce((sum, row) => sum + row.occurrenceIds.length, 0) + fragmentGaps.reduce((sum, row) => sum + row.occurrenceIds.length, 0),
  });
  if (audit.stage === 'budget-hold') actions.push({
    code: 'link_verification_budget', severity: 'high',
    action: `Requires Import Operator. ${BUDGET_PROMPT} Evidence: ${RELATIVE_PATH}.`,
    deadlineReason: 'The approved 30-minute live-work or 100,000 exception-review-token ceiling would be exceeded; resume only after an explicit decision.',
    entity: 'internal-links', affectedCount: audit.pendingDestinations.reduce((count, row) => count + row.occurrenceIds.length, 0),
  });
  if (audit.postDnsStatus !== 'verified') actions.push({
    code: 'post_dns_route_check', severity: 'medium',
    action: `Cutover Operator: after DNS and HTTPS readiness, check the public host against the routes listed in ${RELATIVE_PATH}; return any local repair to the Import Operator.`,
    deadlineReason: 'After DNS; preview-host checks do not prove the final public route.',
    entity: 'app-routes', affectedCount: (audit.routes || []).length,
  });
  return actions;
}

module.exports = { RELATIVE_PATH, auditPath, validateLinkAudit, readLinkAudit, writeLinkAudit, linkOperatorActions };
