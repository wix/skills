'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const census = require('./discovered-census.js');
const coverage = require('./source-coverage.js');
const {
  getDecisionValue,
  isExplicitUserOneClick
} = require('./orchestration-decisions.js');
const FILE = 'mapping/review/census-reconciliation.json';
const ASSIGNMENTS = 'mapping/review/finalized-census-assignments.json';
const STATES = ['pending', 'unsupported', 'excluded', 'manual', 'planned', 'reference-only', 'no-data'];
const EXPECTED = {
  'migration-planned': 'planned',
  'manual-mapping': 'manual',
  'no-need-to-migrate': 'no-data',
  pending: 'pending',
  'requires-development': 'unsupported'
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const gapsOf = value => Array.isArray(value) ? value : value && Array.isArray(value.gaps) ? value.gaps : [];
async function readReconciliation(projectDir) {
  try {
    return await census.readJson(projectDir, FILE);
  } catch (error) {
    if (error instanceof SyntaxError) return {
      schemaVersion: null,
      rows: [],
      errors: []
    };
    throw error;
  }
}
function validCensusReference(ref) {
  return Boolean(ref && typeof ref === 'object' && ref.kind === 'census-reconciliation' && ref.path === FILE && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(ref.sha256));
}
async function reconcileSourceCoverageForMapping(projectDir, {
  mappingStatus = 'approved',
  registers = null
} = {}) {
  try {
    const contract = await coverage.readCoverageContract(projectDir);
    if (!contract.stamped) return {
      ok: true,
      failures: [],
      resolved: [],
      stamped: false
    };
    const inputs = await coverage.loadCoverageInputs(projectDir);
    return {
      ...coverage.reconcileSourceCoverage({
        ...inputs,
        sourceSchema: contract.document,
        registers: registers || (await coverage.loadRegisters()),
        approvals: {
          mapping: {
            status: mappingStatus
          }
        }
      }),
      stamped: true
    };
  } catch (error) {
    if (!(error instanceof coverage.SourceCoverageError)) throw error;
    return {
      ok: false,
      failures: error.failures.length ? error.failures : [{
        code: 'invalid_coverage',
        message: error.message
      }],
      resolved: [],
      stamped: true
    };
  }
}
async function inputDigests(projectDir, options = {}) {
  const decisions = (await census.readJson(projectDir, 'orchestration/decisions.json')) || {};
  const selectedDecisions = Object.fromEntries(Object.entries(decisions).filter(([key]) => key.startsWith('sourceCoverage:')));
  const gaps = gapsOf(await census.readJson(projectDir, 'mapping/review/mapping-gaps.json'));
  const cited = new Map();
  const registers = options.registers || (await coverage.loadRegisters());
  for (const gap of gaps) {
    if (!gap.coverageId || !gap.gateEvidence || !nonempty(gap.gateEvidence.register)) continue;
    const {
      register,
      capability
    } = gap.gateEvidence;
    // Match 0017's registerEntry exactly, including its named human actor requirement.
    const entry = (registers[register] || []).find(row => row && row.capability === capability && nonempty(row.decidedBy)) || null;
    cited.set(`${register}:${capability}`, entry);
  }
  return {
    census: await census.fileDigest(projectDir, census.CENSUS_FILE),
    mappingPlan: await census.fileDigest(projectDir, 'mapping/mapping-plan.json'),
    mappingGaps: await census.fileDigest(projectDir, 'mapping/review/mapping-gaps.json'),
    finalizedAssignments: await census.fileDigest(projectDir, ASSIGNMENTS),
    sourceCoverageDecisions: Object.keys(selectedDecisions).length ? census.digestJson(selectedDecisions) : null,
    sourceCoverageRegisters: cited.size ? census.digestJson(Object.fromEntries([...cited].sort(([a], [b]) => a.localeCompare(b)))) : null
  };
}
async function isReviewOnly(projectDir, options) {
  const classify = options.classifyFinalizedRun || require('./migration-completion.js').classifyFinalizedRun;
  const result = await classify(projectDir, {
    decisions: (await census.readJson(projectDir, 'orchestration/decisions.json')) || {}
  });
  return result.kind === 'valid-v1';
}
async function buildReconciliation(projectDir, options = {}) {
  const c = await census.readCensus(projectDir);
  const errors = [];
  const addError = (code, censusId = null, details = {}) => errors.push({
    code,
    censusId,
    ...details
  });
  if (!c) addError('census_missing');else if (!(await census.censusFreshness(projectDir, c, options)).ok) addError('census_stale');
  const reviewOnly = await isReviewOnly(projectDir, options);
  const plan = await census.readJson(projectDir, 'mapping/mapping-plan.json');
  const gaps = gapsOf(await census.readJson(projectDir, 'mapping/review/mapping-gaps.json'));
  const finalized = await census.readJson(projectDir, ASSIGNMENTS);
  if (finalized && !reviewOnly) addError('finalized_assignments_not_allowed');
  if (reviewOnly) {
    const validation = await require('./website-handoff.js').validateWebsiteHandoff(projectDir);
    if (!validation.ok) addError('finalized_plan_changed', null, {
      changes: validation.changes || []
    });
  }
  const planRows = require('./website-handoff.js').readEntityMappings(plan);
  const byId = new Map((c && c.rows || []).map(row => [row.censusId, row]));
  const assignments = new Map();
  function assign(id, item) {
    const row = byId.get(id);
    if (!row) return addError('unknown_census_id', id);
    if (!row.decisionRow) return addError('not_a_decision_row', id);
    if (!assignments.has(id)) assignments.set(id, []);
    assignments.get(id).push(item);
  }
  const links = new Map();
  if (reviewOnly && finalized) {
    if (finalized.schemaVersion !== 1 || !Array.isArray(finalized.planLinks) || !Array.isArray(finalized.gaps)) addError('invalid_evidence', null, {
      source: ASSIGNMENTS
    });
    for (const [index, entry] of (finalized.planLinks || []).entries()) {
      if (!Number.isInteger(entry.planRow) || !planRows[entry.planRow] || !Array.isArray(entry.censusIds)) {
        addError('invalid_evidence', null, {
          source: `finalized-planLinks#${index}`
        });
        continue;
      }
      if (!links.has(entry.planRow)) links.set(entry.planRow, []);
      links.get(entry.planRow).push(...entry.censusIds);
    }
  }
  planRows.forEach((row, index) => {
    const implicit = nonempty(row.sourceEntity) ? [`entity:${row.sourceEntity}`] : [];
    const nativeIds = Array.isArray(row.censusIds) ? row.censusIds : implicit;
    const ids = [...nativeIds, ...(links.get(index) || [])];
    const state = row.targetClassification === 'manual-mapping' ? 'manual' : 'planned';
    const linkedEntities = ids.filter(id => byId.has(id) && ['entity', 'sub-part'].includes(byId.get(id).kind));
    for (const id of ids) assign(id, {
      state,
      assignedBy: `mapping-plan#${index}`,
      row,
      relatedEntityIds: linkedEntities
    });
  });
  for (const [index, gap] of [...gaps, ...(reviewOnly && finalized && Array.isArray(finalized.gaps) ? finalized.gaps : [])].entries()) {
    if (gap.censusId == null) continue; // Existing record-level and 0017 gaps retain their own contracts.
    assign(gap.censusId, {
      state: gap.disposition,
      assignedBy: `mapping-gaps#${index}`,
      gap,
      relatedEntityIds: []
    });
  }
  const resolvedStates = new Map();
  for (const [id, entries] of assignments) {
    if (entries.length > 1) addError('duplicate_disposition', id);
    resolvedStates.set(id, entries[0].state);
  }
  let summary = '';
  try {
    summary = await fs.readFile(path.join(projectDir, 'mapping/review/mapping-summary.md'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manualSection = summary.match(/^#{1,6}\s+[^\n]*manual[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im);
  const manualText = manualSection ? manualSection[1] : '';
  const stepText = step => typeof step === 'string' ? step : step && (step.description || step.instruction || step.action || step.text);
  const stepsShown = steps => Array.isArray(steps) && steps.length > 0 && steps.every(step => nonempty(stepText(step)) && manualText.includes(stepText(step)));
  function validEvidence(row, item) {
    const {
      state,
      gap,
      row: planRow
    } = item;
    const reason = gap && gap.reasonCode;
    if (!STATES.includes(state)) return false;
    if (reason === 'import-after-finalization' && (!reviewOnly || state !== 'pending')) return false;
    if (row.kind === 'capability' && EXPECTED[row.coverageStatus] !== state && !nonempty(gap && gap.rationale || planRow && planRow.rationale)) return false;
    if (planRow) {
      if (state === 'manual' && !stepsShown(planRow.manualSteps)) return false;
      if (row.kind === 'capability' && state === 'planned') {
        if (!item.relatedEntityIds.length || item.relatedEntityIds.some(id => !['planned', 'manual'].includes(resolvedStates.get(id)))) return false;
      }
      return true;
    }
    if (state === 'planned') return false;
    if (state === 'manual') return row.kind === 'capability' && row.coverageStatus === 'manual-mapping' && (stepsShown(gap.manualSteps) || manualText.includes(row.capability));
    if (state === 'no-data') return row.recordCount === 0 || row.kind === 'capability' && row.coverageStatus === 'no-need-to-migrate' && Boolean(row.basis || row.rationale);
    if (state === 'reference-only') return Array.isArray(gap.referencedBy) && gap.referencedBy.length > 0 && gap.referencedBy.every(id => resolvedStates.get(id) === 'planned') && nonempty(gap.rationale);
    if (state === 'unsupported') return nonempty(reason) && nonempty(gap.severity) && (row.kind !== 'capability' || row.coverageStatus === 'requires-development');
    if (state === 'excluded') return nonempty(reason) && nonempty(gap.rationale) && Object.prototype.hasOwnProperty.call(gap, 'count') && (gap.count === null || typeof gap.count === 'number' && Number.isFinite(gap.count));
    if (state === 'pending') return nonempty(gap.question);
    return false;
  }
  const coverageResult = await reconcileSourceCoverageForMapping(projectDir, {
    mappingStatus: 'approved',
    registers: options.registers
  });
  const coverageById = new Map((coverageResult.resolved || []).map(entry => [entry.row.coverageId, entry]));
  const rows = [];
  for (const row of c && c.rows || []) {
    if (row.kind === 'plugin' && !row.decisionRow) continue;
    if (row.kind === 'source-coverage') {
      const entry = coverageById.get(row.coverageId);
      rows.push({
        ...row,
        state: 'source-coverage',
        assignedBy: 'source-coverage',
        count: null,
        disposition: entry && entry.disposition || null,
        treatment: entry && entry.treatment || null
      });
      continue;
    }
    const entries = assignments.get(row.censusId) || [];
    if (!entries.length) addError('missing_disposition', row.censusId);
    const item = entries[0];
    if (item && !validEvidence(row, item)) addError('invalid_evidence', row.censusId);
    rows.push({
      ...row,
      ...(item && item.gap || {}),
      censusId: row.censusId,
      kind: row.kind,
      state: item ? item.state : 'pending',
      assignedBy: item ? item.assignedBy : null,
      count: item && item.gap && Object.prototype.hasOwnProperty.call(item.gap, 'count') ? item.gap.count : row.recordCount == null ? null : row.recordCount,
      relatedEntityIds: item ? item.relatedEntityIds : []
    });
  }
  if (plan?.dependencyBindings || rows.some(row => row.dependencyFieldRules)) {
    const contract = require('./dependency-readiness').validateAssociations({ plan, reconciliation: { rows } });
    for (const code of contract.errors) addError(code);
  }
  const rowMap = new Map(rows.map(row => [row.censusId, row]));
  for (const row of c && c.rows || []) {
    if (row.kind !== 'plugin' || row.decisionRow) continue;
    const states = row.linkedCapabilities.map(id => rowMap.get(id) && rowMap.get(id).state || 'pending');
    rows.push({
      ...row,
      state: STATES.find(state => states.includes(state)) || 'pending',
      assignedBy: 'derived',
      count: null
    });
  }
  rows.sort((a, b) => a.censusId.localeCompare(b.censusId));
  const result = {
    schemaVersion: 1,
    inputs: await inputDigests(projectDir, options),
    reviewOnly,
    rows,
    ...(plan?.dependencyBindings ? { dependencyBindings: plan.dependencyBindings } : {}),
    errors,
    pendingCount: rows.filter(row => row.state === 'pending' && row.reasonCode !== 'import-after-finalization').length,
    importAfterFinalizationCount: rows.filter(row => row.reasonCode === 'import-after-finalization').length
  };
  if (options.write !== false) {
    await coverage.writeJsonAtomic(path.join(projectDir, FILE), result);
    const section = renderDiscoveredSet(result, c);
    const withoutOld = summary.replace(/\n?<!-- discovered-set:start -->[\s\S]*?<!-- discovered-set:end -->\n?/g, '\n');
    await fs.writeFile(path.join(projectDir, 'mapping/review/mapping-summary.md'), `${withoutOld.trimEnd()}\n\n${section}\n`);
  }
  return result;
}
function renderDiscoveredSet(reconciliation, censusArtifact) {
  const order = ['pending', 'excluded', 'unsupported', 'source-coverage', 'manual', 'reference-only', 'no-data', 'planned'];
  const lines = ['<!-- discovered-set:start -->', '## Discovered set', '', 'Approving this mapping approves the exclusions listed here.'];
  for (const state of order) {
    const rows = reconciliation.rows.filter(row => row.state === state);
    if (!rows.length) continue;
    lines.push('', `### ${state}`, '');
    for (const row of rows) lines.push(`- ${row.censusId}: ${row.count == null ? 'unknown' : row.count}${row.blocked && row.blocked.length ? `; unresolved blockers: ${row.blocked.length}` : ''}`);
  }
  if (!censusArtifact || !censusArtifact.inputs.subPartRegistry) lines.push('', 'Sub-parts were not checked for this source.');
  if (!censusArtifact || !censusArtifact.inputs.sourceCoverage) lines.push('', 'Uncaptured rows were not checked for this source.');
  const dependencySection = renderDependencyRules(reconciliation);
  if (dependencySection) lines.push('', dependencySection);
  lines.push('<!-- discovered-set:end -->');
  return lines.join('\n');
}
function renderDependencyRules(reconciliation) {
  const bindings = reconciliation.dependencyBindings || [];
  const rules = (reconciliation.rows || []).flatMap(row => (row.dependencyFieldRules || []).map(rule => ({ ...rule, censusId: row.censusId, count: row.count ?? null })));
  if (!bindings.length && !rules.length) return '';
  const lines = ['<!-- dependency-rules:start -->', '### Dependency associations and payload consequences', ''];
  for (const binding of [...bindings].sort((a, b) => a.ref.localeCompare(b.ref))) lines.push(`- Target ${binding.ref}: ${[...binding.censusIds].sort().join(', ')}`);
  for (const rule of rules.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) lines.push(`- ${rule.censusId} (${rule.count === null ? 'unknown population' : rule.count + ' source records'}): ${rule.dependentRef} depends on ${rule.dependencyRef}; ${rule.action} ${rule.path}. ${rule.action === 'omit' ? 'The excluded reference will be absent from affected imported records.' : 'Affected dependent records will remain deferred.'}`);
  lines.push('<!-- dependency-rules:end -->'); return lines.join('\n');
}
async function dependencyRulesShown(projectDir, reconciliation) {
  const section = renderDependencyRules(reconciliation);
  if (!section) return true;
  try { return (await fs.readFile(path.join(projectDir, 'mapping/review/mapping-summary.md'), 'utf8')).includes(section); } catch { return false; }
}
async function censusReconciliationFreshness(projectDir, reconciliation, options = {}) {
  if (!reconciliation || reconciliation.schemaVersion !== 1 || !Array.isArray(reconciliation.rows) || !Array.isArray(reconciliation.errors)) return {
    ok: false,
    staleInputs: ['reconciliation']
  };
  try {
    const current = await inputDigests(projectDir, options);
    const staleInputs = Object.keys(current).filter(key => !reconciliation.inputs || current[key] !== reconciliation.inputs[key]);
    const c = await census.readCensus(projectDir);
    if (!(await census.censusFreshness(projectDir, c, options)).ok && !staleInputs.includes('census')) staleInputs.push('census');
    return {
      ok: staleInputs.length === 0,
      staleInputs
    };
  } catch {
    return {
      ok: false,
      staleInputs: ['reconciliation']
    };
  }
}
async function mappingApprovalBound(projectDir, approval, options = {}) {
  if (!approval || !['approved', 'provisional'].includes(approval.status)) return false;
  const refs = (approval.artifactRefs || []).filter(validCensusReference);
  if (refs.length !== 1) return false;
  let reconciliation;
  try {
    reconciliation = await readReconciliation(projectDir);
  } catch {
    return false;
  }
  return Boolean(reconciliation && refs[0].sha256 === (await census.fileDigest(projectDir, FILE)) && (await censusReconciliationFreshness(projectDir, reconciliation, options)).ok);
}
async function bindCensusReconciliation(projectDir, {
  approvalType,
  status,
  decidedBy,
  requestRef = null,
  ...options
}) {
  const decisions = (await census.readJson(projectDir, 'orchestration/decisions.json')) || {};
  const fail = (code, details = {}) => ({
    ok: false,
    code,
    ...details
  });
  if (approvalType !== 'mapping' || ['pending', 'rejected'].includes(status) || getDecisionValue(decisions, 'managementImportMode') === 'quick') return {
    ok: true,
    ref: null
  };
  if (!['user', 'agent'].includes(decidedBy)) return fail('approval_actor_invalid');
  if (decidedBy === 'agent' && !isExplicitUserOneClick(decisions)) return fail('approval_actor_not_one_click');
  let reconciliation;
  try {
    reconciliation = await readReconciliation(projectDir);
  } catch {
    return fail('census_reconciliation_stale', {
      staleInputs: ['reconciliation']
    });
  }
  if (!reconciliation) return fail('census_reconciliation_missing');
  const freshness = await censusReconciliationFreshness(projectDir, reconciliation, options);
  if (!freshness.ok) return fail('census_reconciliation_stale', freshness);
  if (!(await dependencyRulesShown(projectDir, reconciliation))) return fail('dependency_rules_not_shown');
  if (reconciliation.errors.length) return fail('census_reconciliation_blocking', {
    errors: reconciliation.errors
  });
  const gate = await reconcileSourceCoverageForMapping(projectDir, {
    mappingStatus: status,
    registers: options.registers
  });
  if (!gate.ok) return fail('source_coverage_unreconciled', {
    failures: gate.failures
  });
  if (status === 'approved' && decidedBy === 'user' && reconciliation.pendingCount > 0) return fail('approval_pending_rows');
  const sha256 = await census.fileDigest(projectDir, FILE);
  if (requestRef && (!validCensusReference(requestRef) || requestRef.sha256 !== sha256)) return fail('approval_reference_stale');
  return {
    ok: true,
    ref: {
      kind: 'census-reconciliation',
      path: FILE,
      sha256
    }
  };
}
async function ownerApprovedCensusIds(projectDir, options = {}) {
  const approvals = await census.readJson(projectDir, 'orchestration/approvals.json');
  const approval = approvals && approvals.mapping;
  if (!approval || approval.status !== 'approved' || approval.decidedBy !== 'user' || !(await mappingApprovalBound(projectDir, approval, options))) return new Set();
  const reconciliation = await readReconciliation(projectDir);
  if (reconciliation.errors.length || !(await dependencyRulesShown(projectDir, reconciliation))) return new Set();
  return new Set(reconciliation.rows.filter(row => ['excluded', 'unsupported'].includes(row.state)).map(row => row.censusId));
}
module.exports = {
  renderDependencyRules, dependencyRulesShown,
  FILE,
  RECONCILIATION_FILE: FILE,
  ASSIGNMENTS,
  STATES,
  buildReconciliation,
  readReconciliation,
  renderDiscoveredSet,
  censusReconciliationFreshness,
  reconcileSourceCoverageForMapping,
  mappingApprovalBound,
  bindCensusReconciliation,
  ownerApprovedCensusIds,
  validCensusReference
};
