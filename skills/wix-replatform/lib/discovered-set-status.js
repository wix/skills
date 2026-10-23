'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  writeJsonAtomic
} = require('./orchestration-state.js');
const STATUS_FILE = 'execution/discovered-set-status.json';
const STATUS_MARKDOWN = 'execution/review/discovered-set-status.md';
const RESOLUTIONS_FILE = 'execution/discovered-set-resolutions.ndjson';
const RECONCILIATION_FILE = 'mapping/review/census-reconciliation.json';
const REPORT_FILE = 'execution/completion-report.json';
const OUTCOME_ORDER = ['failed', 'unresolved', 'deferred', 'partial', 'no-outcome-recorded', 'not-decided', 'unsupported', 'excluded', 'manual-open', 'manual-done', 'imported', 'reference-only', 'no-data'];
const CLOSED = new Set(['imported', 'manual-done', 'reference-only', 'no-data']);
const COVERAGE_OPEN = {
  recovered: false,
  'gated-exclusion': false,
  'ungated-exclusion': true,
  'accepted-loss': true,
  unresolved: true
};
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sorted(value) {
  return Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
}
async function raw(projectDir, file) {
  try {
    return await fs.readFile(path.join(projectDir, file), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function json(projectDir, file) {
  const value = await raw(projectDir, file);
  return value === null ? null : JSON.parse(value);
}
function refusal(code, detail = {}) {
  return Object.assign(new Error(code), {
    code,
    ...detail
  });
}
async function resolutionInputs(projectDir) {
  const text = await raw(projectDir, RESOLUTIONS_FILE);
  const lines = text === null ? [] : text.split('\n').filter(Boolean);
  // The journal has one canonical newline per entry; reject malformed or partial entries.
  for (const line of lines) JSON.parse(line);
  return {
    text,
    lines,
    sha256: text === null ? null : digest(text)
  };
}
async function inputDigests(projectDir) {
  const [report, reconciliation, approvals, resolutions] = await Promise.all([raw(projectDir, REPORT_FILE), raw(projectDir, RECONCILIATION_FILE), json(projectDir, 'orchestration/approvals.json'), resolutionInputs(projectDir)]);
  return {
    completionReport: report === null ? null : digest(report),
    reconciliation: reconciliation === null ? null : digest(reconciliation),
    approvalsMapping: digest(JSON.stringify(sorted(approvals?.mapping ?? null))),
    resolutions: {
      sha256: resolutions.sha256,
      lines: resolutions.lines.length
    }
  };
}
async function discoveredSetStatusFreshness(projectDir, status) {
  const current = await inputDigests(projectDir);
  const staleInputs = Object.keys(current).filter(key => JSON.stringify(current[key]) !== JSON.stringify(status?.inputs?.[key]));
  const reconciliation = await json(projectDir, RECONCILIATION_FILE);
  const {
    censusReconciliationFreshness
  } = require('./census-reconciliation.js');
  if (!reconciliation || !(await censusReconciliationFreshness(projectDir, reconciliation)).ok) {
    if (!staleInputs.includes('reconciliation')) staleInputs.push('reconciliation');
  }
  return {
    ok: staleInputs.length === 0,
    staleInputs
  };
}
function deriveFinalStatus(backendStatus, statusReport) {
  return backendStatus === 'complete' && statusReport?.openCount > 0 ? 'complete_with_warnings' : backendStatus;
}
function labelFor(row) {
  return row.label || (row.entity ? `${row.entity}${row.subtype && row.subtype !== 'all' ? `/${row.subtype}` : ''}` : row.capability || row.censusId);
}
function actionFor(projectDir, row, outcome, count) {
  if (CLOSED.has(outcome) || (outcome === 'excluded' || outcome === 'unsupported') && row.ownerApproved) return null;
  if (outcome === 'manual-open') return {
    owner: 'Cutover Operator',
    action: 'Complete the recorded manual steps, then record resolution evidence',
    timing: 'before-dns',
    consequence: 'The discovered capability still needs manual setup',
    affectedCount: count,
    resolvedWhen: 'A merchant or Cutover Operator records completion evidence',
    importOperatorPrompt: null
  };
  const label = labelFor(row);
  let instruction;
  if (outcome === 'not-decided' && row.reasonCode === 'import-after-finalization') instruction = 'was discovered after this migration finalized, and the owner wants it imported. Importing into the finalized site needs a separate human decision. Do not import it. Raise that decision with the migration owner and record the answer.';else if (outcome === 'not-decided') instruction = `is pending: ${row.question || 'Ask the owner how to handle this discovered scope'}. Ask the owner, record the answer as a closed state with rp-mapper, rebuild the census reconciliation, record the mapping approval, then rebuild the discovered-set status report and the post-execution handoff.`;else if (outcome === 'excluded' || outcome === 'unsupported') instruction = `is ${outcome} without the owner's approval. Present the mapping review to the owner for approval, or reverse the exclusion with rp-mapper, then rebuild the status report and handoff.`;else instruction = `has outcome ${outcome}. Recover it through the existing import recovery path, then rebuild the completion report, the discovered-set status report and the post-execution handoff.`;
  return {
    owner: 'Import Operator',
    action: outcome === 'not-decided' ? 'Ask the migration owner and record the decision' : ['excluded', 'unsupported'].includes(outcome) ? 'Obtain owner approval or reverse the exclusion' : 'Recover through the import recovery path',
    timing: 'before-dns',
    consequence: `Discovered scope ${row.censusId} is ${outcome}`,
    affectedCount: count,
    resolvedWhen: outcome === 'not-decided' ? 'A fresh approved reconciliation records a closed decision' : ['excluded', 'unsupported'].includes(outcome) ? 'A current user approval covers this exact reconciliation' : 'A fresh completion report gives this row imported',
    importOperatorPrompt: `Open the RePlatform migration project at ${path.resolve(projectDir)} in the original migration environment. Census row ${row.censusId} (${label}) ${instruction} Do not paste or log record values.`
  };
}
function leastFavorable(rows) {
  return rows.reduce((worst, row) => !worst || OUTCOME_ORDER.indexOf(row.outcome) < OUTCOME_ORDER.indexOf(worst.outcome) ? row : worst, null);
}
function deriveRows(projectDir, reconciliation, report, approvedIds, resolutions) {
  const resolvedIds = new Set(resolutions.map(row => row.censusId));
  const censusRows = reconciliation.rows || [];
  const rows = censusRows.map(source => {
    const row = {
      ...source,
      ownerApproved: ['excluded', 'unsupported'].includes(source.state) ? approvedIds.has(source.censusId) : null
    };
    let outcome = source.state;
    if (source.kind === 'source-coverage') {
      outcome = (report.sourceCoverage || []).find(entry => entry.coverageId === source.coverageId)?.treatment || 'recovered';
      if (!(outcome in COVERAGE_OPEN)) throw refusal('source_coverage_treatment_unknown', {
        coverageId: source.coverageId
      });
    } else if (source.state === 'manual') outcome = resolvedIds.has(source.censusId) ? 'manual-done' : 'manual-open';else if (source.state === 'pending') outcome = 'not-decided';else if (source.state === 'planned' && ['entity', 'sub-part'].includes(source.kind)) {
      const completeness = (report.entityCompleteness || []).find(entry => entry.entity === source.entity && (entry.subtype || 'all') === (source.subtype || 'all'));
      const dropped = (report.droppedFields || []).some(field => {
        if (field.entity !== source.entity) return false;
        if (field.subtype) return field.subtype === (source.subtype || 'all');
        const subparts = censusRows.filter(entry => entry.kind === 'sub-part' && entry.entity === field.entity && (entry.evidenceFields || []).includes(field.field));
        return subparts.length ? subparts.some(entry => entry.censusId === source.censusId) : (source.subtype || 'all') === 'all';
      });
      outcome = !completeness ? 'no-outcome-recorded' : completeness.failed > 0 ? 'failed' : completeness.unresolved > 0 ? 'unresolved' : completeness.deferred > 0 ? 'deferred' : completeness.imported + completeness.alreadyPresentByCrosswalk < completeness.inScope || dropped ? 'partial' : 'imported';
    }
    if (source.state === 'planned' && source.kind === 'plugin' && !(source.linkedCapabilities || []).length) outcome = 'no-outcome-recorded';
    return {
      censusId: source.censusId,
      kind: source.kind,
      state: source.state,
      outcome,
      ownerApproved: row.ownerApproved,
      count: Object.prototype.hasOwnProperty.call(source, 'count') ? typeof source.count === 'number' ? source.count : null : typeof source.recordCount === 'number' ? source.recordCount : null,
      open: source.kind === 'source-coverage' ? COVERAGE_OPEN[outcome] : !CLOSED.has(outcome) && !(['excluded', 'unsupported'].includes(outcome) && row.ownerApproved),
      action: null,
      ...(source.kind === 'source-coverage' ? {
        actionSource: 'completion-report'
      } : {})
    };
  });
  // Capabilities are based on actual plan links, never guessed from source entity names.
  for (const row of rows.filter(entry => entry.kind === 'capability' && entry.state === 'planned')) {
    const source = censusRows.find(entry => entry.censusId === row.censusId);
    const children = (source.relatedEntityIds || []).map(id => rows.find(entry => entry.censusId === id)).filter(Boolean);
    const worst = leastFavorable(children);
    row.outcome = worst?.outcome || 'no-outcome-recorded';
    row.open = children.length ? children.some(entry => entry.open) : true;
  }
  for (const row of rows.filter(entry => entry.kind === 'plugin')) {
    const source = censusRows.find(entry => entry.censusId === row.censusId);
    if (!(source.linkedCapabilities || []).length) continue;
    const children = source.linkedCapabilities.map(id => rows.find(entry => entry.censusId === id)).filter(Boolean);
    const worst = leastFavorable(children);
    row.outcome = worst?.outcome || 'no-outcome-recorded';
    row.open = children.length ? children.some(entry => entry.open) : true;
    row.ownerApproved = ['excluded', 'unsupported'].includes(row.outcome) ? children.every(entry => !entry.open) : null;
  }
  for (const row of rows) if (row.open && row.kind !== 'source-coverage') row.action = actionFor(projectDir, {
    ...censusRows.find(entry => entry.censusId === row.censusId),
    ownerApproved: row.ownerApproved
  }, row.outcome, row.count);
  return rows;
}
function renderStatus(status) {
  return ['# Discovered set status', '', '| Census ID | State | Outcome | Count | Open |', '| --- | --- | --- | --- | --- |', ...status.rows.map(row => `| ${row.censusId} | ${row.state || 'derived'} | ${row.outcome} | ${row.count === null ? 'unknown' : row.count} | ${row.open ? 'yes' : 'no'} |`), '', `Open discovered-set rows: ${status.openCount}`, ''].join('\n');
}
async function buildDiscoveredSetStatus(projectDir) {
  const {
    censusReconciliationFreshness,
    mappingApprovalBound,
    ownerApprovedCensusIds
  } = require('./census-reconciliation.js');
  const reconciliation = await json(projectDir, RECONCILIATION_FILE);
  if (!reconciliation) throw refusal('census_reconciliation_missing');
  const fresh = await censusReconciliationFreshness(projectDir, reconciliation);
  if (!fresh.ok) throw refusal('census_reconciliation_stale', fresh);
  if (reconciliation.errors?.length) throw refusal('census_reconciliation_blocking', {
    errors: reconciliation.errors
  });
  const approval = (await json(projectDir, 'orchestration/approvals.json'))?.mapping;
  const ref = approval?.artifactRefs?.find(ref => ref && typeof ref === 'object' && ref.kind === 'census-reconciliation' && ref.path === RECONCILIATION_FILE && /^[0-9a-f]{64}$/i.test(ref.sha256));
  if (!ref) throw refusal('approval_missing_census_reference');
  if (!(await mappingApprovalBound(projectDir, approval))) throw refusal('mapping_approval_stale_census');
  const report = await json(projectDir, REPORT_FILE);
  if (!report) throw refusal('completion_report_missing');
  const resolutions = await resolutionInputs(projectDir);
  const rows = deriveRows(projectDir, reconciliation, report, await ownerApprovedCensusIds(projectDir), resolutions.lines.map(JSON.parse));
  const status = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: await inputDigests(projectDir),
    rows,
    openCount: rows.filter(row => row.open && row.kind !== 'source-coverage').length
  };
  await writeJsonAtomic(path.join(projectDir, STATUS_FILE), status);
  await fs.mkdir(path.dirname(path.join(projectDir, STATUS_MARKDOWN)), {
    recursive: true
  });
  await fs.writeFile(path.join(projectDir, STATUS_MARKDOWN), renderStatus(status));
  return status;
}
async function resolveDiscoveredSet(projectDir, {
  censusId,
  by,
  evidence
}) {
  if (!['merchant', 'cutover-operator'].includes(by) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 || /[\r\n\x00]/.test(evidence) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(evidence)) throw refusal('resolution_invalid');
  // Recompute from trusted inputs before appending; callers cannot resolve a forged status row.
  const status = await buildDiscoveredSetStatus(projectDir);
  if (!status.rows.some(row => row.censusId === censusId && row.outcome === 'manual-open')) throw refusal('resolution_not_manual_open');
  const entry = {
    censusId,
    by,
    evidence: evidence.trim(),
    recordedAt: new Date().toISOString()
  };
  await fs.appendFile(path.join(projectDir, RESOLUTIONS_FILE), `${JSON.stringify(entry)}\n`);
  return buildDiscoveredSetStatus(projectDir);
}
async function checkResolutionPrefix(projectDir, recorded) {
  const current = await resolutionInputs(projectDir);
  if (current.lines.length < recorded.lines) return false;
  if (!recorded.lines) return recorded.sha256 === null || recorded.sha256 === digest('');
  return digest(`${current.lines.slice(0, recorded.lines).join('\n')}\n`) === recorded.sha256;
}
module.exports = {
  STATUS_FILE,
  STATUS_MARKDOWN,
  RESOLUTIONS_FILE,
  RECONCILIATION_FILE,
  inputDigests,
  discoveredSetStatusFreshness,
  deriveFinalStatus,
  deriveRows,
  buildDiscoveredSetStatus,
  resolveDiscoveredSet,
  checkResolutionPrefix,
  renderStatus
};
