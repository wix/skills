'use strict';

// CMS fallback for a recognized plugin capability: two gates, both required.
//
//   1. Eligibility (repository, human-signed): plugins/cms-fallback-eligible.json says nothing
//      native fits this capability, CMS may keep its records, and what the merchant loses.
//   2. Approval (per migration, merchant): orchestration/decisions.json carries
//      `pluginCmsFallback:<capability>` with the merchant's answer, bound to the exact proposal
//      that was shown (`proposalDigest`). No agent, automation mode or repository entry supplies it.
//
// Everything that decides whether a CMS plan is still valid goes through this one module, so
// the validator, the decision writer, the classifier, the router and the write-time guard can
// never disagree about what "approved" or "fresh" means.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DECISION_PREFIX = 'pluginCmsFallback:';
const DECISION_VALUES = new Set(['approved', 'declined']);
const DIGEST_VERSION = 1;

const DEFAULT_PLUGINS_ROOT = path.resolve(__dirname, '..', 'resources', 'rp-source-wordpress', 'plugins');
const DEFAULT_TARGET_KNOWLEDGE_ROOT = path.resolve(__dirname, '..', 'resources', 'rp-target-wix', 'domains');

function pluginKnowledge() {
  return require('../resources/rp-source-wordpress/lib/plugin-knowledge.js');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Canonical JSON: object keys sorted at every depth, arrays kept in order (callers sort the
// arrays whose order carries no meaning before hashing).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value === undefined ? null : value;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function decisionKey(capability) {
  return `${DECISION_PREFIX}${capability}`;
}

// Exact, case-sensitive prefix. A look-alike key is not this family and keeps the generic
// fail-closed decision checks.
function isCmsFallbackDecisionKey(key) {
  return typeof key === 'string' && key.startsWith(DECISION_PREFIX);
}

function capabilityOfKey(key) {
  return isCmsFallbackDecisionKey(key) ? key.slice(DECISION_PREFIX.length) : null;
}

function canonicalTargetRefsByEntity(map) {
  const out = {};
  if (!isPlainObject(map)) return out;
  for (const key of Object.keys(map).sort()) {
    out[key] = Array.isArray(map[key]) ? [...map[key]].map(String).sort() : [];
  }
  return out;
}

// The proposal binding: what the merchant was shown. A changed ref, a ref moved between
// entities, an added/removed entity, or a changed featureLoss sentence changes the digest.
function cmsFallbackProposalDigest(entry) {
  return sha256({
    capability: entry && entry.capability ? String(entry.capability) : null,
    targetRefsByEntity: canonicalTargetRefsByEntity(entry && entry.targetRefsByEntity),
    featureLoss: entry && typeof entry.featureLoss === 'string' ? entry.featureLoss : null,
  });
}

function unionTargetRefs(targetRefsByEntity) {
  return Array.from(new Set(Object.values(canonicalTargetRefsByEntity(targetRefsByEntity)).flat())).sort();
}

// A register entry the runtime may use. Unsigned or structurally incomplete entries are
// ignored (the row stays pending), exactly like the other signed registers.
function isUsableEligibilityEntry(entry) {
  if (!isPlainObject(entry) || !entry.capability || !entry.decidedBy || !entry.decidedOn) return false;
  if (typeof entry.featureLoss !== 'string' || entry.featureLoss.length === 0) return false;
  if (!isPlainObject(entry.targetRefsByEntity) || Object.keys(entry.targetRefsByEntity).length === 0) return false;
  return Object.values(entry.targetRefsByEntity).every((refs) => Array.isArray(refs) && refs.length > 0
    && refs.every((ref) => typeof ref === 'string' && ref.startsWith('cms/')));
}

function eligibilityByCapability(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    if (isUsableEligibilityEntry(entry)) map.set(entry.capability, entry);
  }
  return map;
}

// The audit timestamp the writer records (`Date#toISOString()`): a full ISO-8601 UTC/offset
// date-time that is also a real calendar instant. Anything else is a hand edit.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
function isValidDecidedAt(decidedAt) {
  if (typeof decidedAt !== 'string' || !ISO_DATE_TIME.test(decidedAt)) return false;
  const time = Date.parse(decidedAt);
  if (Number.isNaN(time)) return false;
  // Reject calendar roll-over such as 2026-02-31 (Date.parse would accept it as March 3).
  const [year, month, day] = decidedAt.slice(0, 10).split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// Shape check for one `pluginCmsFallback:*` entry. Shared by validateDecisions (quarantine),
// the classifier, the writer's stale check and the write-time guard.
function cmsFallbackDecisionShape(key, value) {
  if (!isPlainObject(value)) return { ok: false, problem: 'not-object' };
  const capability = capabilityOfKey(key);
  if (!capability) return { ok: false, problem: 'capability-missing' };
  if (!DECISION_VALUES.has(value.value)) return { ok: false, problem: 'value-invalid' };
  if (value.source !== 'user') return { ok: false, problem: 'source-not-user' };
  if (!isValidDecidedAt(value.decidedAt)) return { ok: false, problem: 'decided-at-invalid' };
  if (typeof value.approvedBy !== 'string' || value.approvedBy.trim().length === 0) {
    return { ok: false, problem: 'approved-by-missing' };
  }
  if (!isPlainObject(value.proposal) || !isPlainObject(value.proposal.targetRefsByEntity)
      || typeof value.proposal.featureLoss !== 'string') {
    return { ok: false, problem: 'proposal-missing' };
  }
  const rehash = cmsFallbackProposalDigest({ capability, ...value.proposal });
  if (typeof value.proposalDigest !== 'string' || rehash !== value.proposalDigest) {
    return { ok: false, problem: 'digest-mismatch' };
  }
  return { ok: true, problem: null };
}

// What the stored answer means against the current register entry:
//   none | approved | declined | stale (valid shape, different proposal) | invalid (quarantined)
function evaluateCmsFallbackDecision({ capability, entry = null, decisions = {} }) {
  const key = decisionKey(capability);
  const raw = decisions ? decisions[key] : undefined;
  if (raw === undefined) return { state: 'none', key, raw: null };
  const shape = cmsFallbackDecisionShape(key, raw);
  if (!shape.ok) return { state: 'invalid', key, raw, problem: shape.problem };
  if (!entry || raw.proposalDigest !== cmsFallbackProposalDigest(entry)) return { state: 'stale', key, raw };
  return { state: raw.value, key, raw };
}

function cmsFallbackDecisionKeys(decisions = {}) {
  return Object.keys(decisions || {}).filter(isCmsFallbackDecisionKey).sort();
}

// ---- resolution-input digest -----------------------------------------------------------

function entitiesForCapability(entities, capability) {
  const list = entities || [];
  const hasAttribution = list.some((entity) => entity && entity.capability);
  return hasAttribution ? list.filter((entity) => entity.capability === capability) : list;
}

// The `<plugin>/<entity>` keys the register must cover for this capability, from the entity
// declarations the classifier will actually use.
function entityKeysForCapability(plugins, capability) {
  const keys = [];
  for (const plugin of plugins || []) {
    for (const entity of entitiesForCapability(plugin.entities, capability)) {
      keys.push(`${plugin.plugin}/${entity.entity}`);
    }
  }
  return keys.sort();
}

function signedRegisterEntry(entries, capability, { requireSignature = true } = {}) {
  const entry = (entries || []).find((candidate) => candidate && candidate.capability === capability);
  if (!entry) return null;
  if (requireSignature && !(entry.decidedBy && entry.decidedOn)) return null;
  return entry;
}

function resolveTargetKnowledge(targetKnowledge) {
  return typeof targetKnowledge === 'function' ? targetKnowledge() : targetKnowledge;
}

/**
 * Build the canonical input set that decides every in-scope capability's route.
 *
 * In scope: declared by a detected plugin AND (has a register entry OR is named by a
 * `pluginCmsFallback:*` key). Ordinary plugin rows are out of scope, so they never trigger the
 * freshness check. `targetKnowledge` may be a value or a loader function; it is only loaded when
 * at least one capability is in scope.
 */
function cmsFallbackResolutionInputs({
  detectedPlugins = [],
  profiles = [],
  targetKnowledge = null,
  registers = {},
  decisions = {},
} = {}) {
  const profileBySlug = new Map((profiles || []).map((profile) => [profile.plugin, profile]));
  const eligibleEntries = registers.cmsFallbackEligible || [];
  const requiresDevelopment = registers.requiresDevelopment || [];
  const noMigrationCapabilities = (registers.noMigrationNeeded && registers.noMigrationNeeded.capabilities)
    || registers.noMigrationCapabilities || [];
  const keys = cmsFallbackDecisionKeys(decisions);
  const keyedCapabilities = new Set(keys.map(capabilityOfKey).filter(Boolean));
  const registeredCapabilities = new Set(eligibleEntries.filter(Boolean).map((entry) => entry.capability));

  const declaredBy = new Map();
  for (const detected of detectedPlugins || []) {
    const slug = detected && detected.plugin;
    if (!slug) continue;
    const profile = profileBySlug.get(slug) || null;
    const capabilities = new Set([...(detected.capabilities || []), ...((profile && profile.capabilities) || [])]);
    for (const capability of capabilities) {
      if (!declaredBy.has(capability)) declaredBy.set(capability, []);
      declaredBy.get(capability).push({ slug, profile });
    }
  }

  const inScope = Array.from(declaredBy.keys())
    .filter((capability) => registeredCapabilities.has(capability) || keyedCapabilities.has(capability))
    .sort();

  let knowledge = null;
  if (inScope.length > 0) {
    try {
      knowledge = resolveTargetKnowledge(targetKnowledge);
    } catch (error) {
      knowledge = { knownRefs: new Set(), capabilityRefs: new Map(), manualStepsByRef: new Map(), loadError: error.message };
    }
  }
  const knownRefs = (knowledge && knowledge.knownRefs) || new Set();
  const capabilityRefs = (knowledge && knowledge.capabilityRefs) || new Map();
  const manualStepsByRef = (knowledge && knowledge.manualStepsByRef) || new Map();
  const loaded = Boolean(knowledge) && !knowledge.loadError;
  const refFacts = (refs) => Object.fromEntries([...refs].sort().map((ref) => [ref, {
    known: knownRefs.has(ref),
    manualSteps: manualStepsByRef.has(ref),
  }]));

  const capabilities = {};
  for (const capability of inScope) {
    const nativeRefs = [...(capabilityRefs.get(capability) || [])].sort();
    capabilities[capability] = {
      targetKnowledge: { loaded, nativeRefs: refFacts(nativeRefs) },
      profiles: declaredBy.get(capability)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(({ slug, profile }) => (profile ? {
          plugin: slug,
          status: 'present',
          capabilities: [...(profile.capabilities || [])].sort(),
          entities: (profile.entities || []).map((entity) => ({
            entity: entity.entity || null,
            route: entity.route || null,
            channel: entity.channel || null,
            capability: entity.capability || null,
            candidateTargetRefs: [...(entity.candidateTargetRefs || [])],
            refs: refFacts(entity.candidateTargetRefs || []),
          })).sort((a, b) => String(a.entity).localeCompare(String(b.entity))),
        } : { plugin: slug, status: 'profile-missing' })),
      requiresDevelopment: signedRegisterEntry(requiresDevelopment, capability, { requireSignature: false }),
      noMigrationNeeded: signedRegisterEntry(noMigrationCapabilities, capability),
      eligibility: signedRegisterEntry(eligibleEntries, capability, { requireSignature: false }),
      decision: decisions && decisions[decisionKey(capability)] !== undefined ? decisions[decisionKey(capability)] : null,
    };
  }

  // Every key whose capability is not in scope is carried raw, so writing, editing or removing
  // any such key changes the digest too.
  const otherDecisions = {};
  for (const key of keys) {
    if (!capabilities[capabilityOfKey(key)]) otherDecisions[key] = decisions[key];
  }

  return { version: DIGEST_VERSION, capabilities, otherDecisions };
}

function cmsFallbackInputsDigest(inputs) {
  return sha256(inputs);
}

// ---- project loading (router, write-time guard, reclassifier) ---------------------------

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadTargetKnowledgeSummary(targetKnowledgeRoot = DEFAULT_TARGET_KNOWLEDGE_ROOT) {
  try {
    const { knowledgeSummary } = require('../resources/rp-target-wix/lib/domain-knowledge.js');
    return knowledgeSummary(targetKnowledgeRoot);
  } catch (error) {
    return { knownRefs: new Set(), capabilityRefs: new Map(), manualStepsByRef: new Map(), loadError: error.message };
  }
}

function loadCmsFallbackRegisters(pluginsRoot = DEFAULT_PLUGINS_ROOT) {
  const knowledge = pluginKnowledge();
  return {
    cmsFallbackEligible: knowledge.loadCmsFallbackEligible(pluginsRoot).capabilities || [],
    requiresDevelopment: knowledge.loadRequiresDevelopment(pluginsRoot).capabilities || [],
    noMigrationNeeded: knowledge.loadNoMigrationNeeded(pluginsRoot),
  };
}

// The canonical artifacts a WordPress project carries: the promoted coverage copy the mapper
// reads, and the adapter's raw capture that holds the detection snapshot.
function projectPaths(projectDir) {
  return {
    coverage: path.join(projectDir, 'discovery', 'plugin-coverage.json'),
    rawCoverage: path.join(projectDir, 'data', 'wp-discovery', 'plugin-coverage.json'),
    inventory: path.join(projectDir, 'data', 'wp-discovery', 'plugin-inventory.json'),
    canonicalInventory: path.join(projectDir, 'discovery', 'plugin-inventory.json'),
    mappingPlan: path.join(projectDir, 'mapping', 'mapping-plan.json'),
    setupPlan: path.join(projectDir, 'setup', 'setup-plan.json'),
  };
}

function detectedPluginsOf(inventory) {
  return ((inventory && inventory.detected) || []).map((plugin) => ({
    plugin: plugin.plugin,
    capabilities: [...(plugin.capabilities || [])],
  }));
}

function computeCurrentDigest({ inventory, decisions = {}, pluginsRoot = DEFAULT_PLUGINS_ROOT, targetKnowledgeRoot = DEFAULT_TARGET_KNOWLEDGE_ROOT, targetKnowledge = null }) {
  const inputs = cmsFallbackResolutionInputs({
    detectedPlugins: detectedPluginsOf(inventory),
    profiles: pluginKnowledge().loadProfiles(pluginsRoot),
    targetKnowledge: targetKnowledge || (() => loadTargetKnowledgeSummary(targetKnowledgeRoot)),
    registers: loadCmsFallbackRegisters(pluginsRoot),
    decisions: decisions || {},
  });
  return { inputs, digest: cmsFallbackInputsDigest(inputs) };
}

function digestOf(artifact) {
  return artifact && artifact.inputs && typeof artifact.inputs.cmsFallbackDigest === 'string'
    ? artifact.inputs.cmsFallbackDigest
    : null;
}

/**
 * The router's freshness chain. Returns null when the project has no plugin coverage (nothing
 * to check), otherwise { digest, stale: null | 'coverage' | 'mapping' | 'setup' }.
 */
function checkCmsFallbackFreshness(projectDir, { decisions = {}, pluginsRoot, targetKnowledgeRoot } = {}) {
  const paths = projectPaths(projectDir);
  if (!fs.existsSync(paths.coverage)) return null;
  const coverage = readJsonOrNull(paths.coverage);
  const inventory = readJsonOrNull(paths.inventory) || readJsonOrNull(paths.canonicalInventory);
  if (!coverage || !inventory) return { digest: null, stale: 'coverage', missing: !inventory ? 'plugin-inventory' : 'plugin-coverage' };
  const { digest } = computeCurrentDigest({
    inventory,
    decisions,
    pluginsRoot: pluginsRoot || DEFAULT_PLUGINS_ROOT,
    targetKnowledgeRoot: targetKnowledgeRoot || DEFAULT_TARGET_KNOWLEDGE_ROOT,
  });
  if (digestOf(coverage) !== digest) return { digest, stale: 'coverage' };
  if (fs.existsSync(paths.mappingPlan) && digestOf(readJsonOrNull(paths.mappingPlan)) !== digest) {
    return { digest, stale: 'mapping' };
  }
  if (fs.existsSync(paths.setupPlan) && digestOf(readJsonOrNull(paths.setupPlan)) !== digest) {
    return { digest, stale: 'setup' };
  }
  return { digest, stale: null };
}

function readJsonStrict(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomicSync(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

// rp-mapper and rp-setup-discovery bind the plans they write to the coverage they were built
// from: mapping-plan.json copies discovery/plugin-coverage.json's digest, setup-plan.json copies
// the mapping plan's.
function stampPlanDigest(projectDir, plan) {
  const paths = projectPaths(projectDir);
  const [sourcePath, targetPath] = plan === 'mapping'
    ? [paths.coverage, paths.mappingPlan]
    : plan === 'setup'
      ? [paths.mappingPlan, paths.setupPlan]
      : [null, null];
  if (!sourcePath) throw new Error('stamp-plan requires --plan mapping|setup');
  if (!fs.existsSync(targetPath)) throw new Error(`${path.relative(projectDir, targetPath)} does not exist; write the plan first`);
  if (!fs.existsSync(sourcePath)) {
    // No plugin coverage in this project: nothing to bind the plan to.
    return { stamped: false, reason: `${path.relative(projectDir, sourcePath)} not present` };
  }
  const source = readJsonStrict(sourcePath);
  const digest = source && source.inputs && source.inputs.cmsFallbackDigest;
  if (typeof digest !== 'string') {
    throw new Error(`${path.relative(projectDir, sourcePath)} carries no inputs.cmsFallbackDigest; regenerate it before stamping`);
  }
  const target = readJsonStrict(targetPath);
  target.inputs = { ...(target.inputs || {}), cmsFallbackDigest: digest };
  writeJsonAtomicSync(targetPath, target);
  return { stamped: true, plan, cmsFallbackDigest: digest };
}

// ---- coverage rows -----------------------------------------------------------------------

function totalRecords(row) {
  return Object.values((row && row.recordCounts) || {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function isApprovedCmsFallbackRow(row) {
  return Boolean(row) && row.status === 'migration-planned' && row.via === 'cms'
    && Boolean(row.cmsFallback) && row.cmsFallback.functionalityRestored === false;
}

function isEligibleCmsFallbackRow(row) {
  return Boolean(row) && Boolean(row.cmsFallback) && typeof row.cmsFallback.proposalDigest === 'string';
}

// The proposal exactly as the coverage row shows it (pending: proposed refs; approved: the refs
// it was approved with). The writer reads it from here so nobody retypes it.
function proposalFromRow(row) {
  const fallback = (row && row.cmsFallback) || {};
  return {
    targetRefsByEntity: canonicalTargetRefsByEntity(fallback.proposedTargetRefsByEntity || fallback.targetRefsByEntity),
    featureLoss: typeof fallback.featureLoss === 'string' ? fallback.featureLoss : null,
  };
}

// ---- write-time guard -------------------------------------------------------------------

/**
 * Defence in depth behind the router: may the importer write CMS records for each eligible
 * capability? Allowed only when the coverage row is an approved CMS fallback whose approval
 * passes the shape check and matches the current register entry, AND the current resolution
 * digest equals the one carried by plugin-coverage, the mapping plan and the setup plan.
 */
//
// `refusals` lists the capabilities a write was actually refused for: those in `attempted` (the
// capabilities the caller's plan writes to CMS) when given, otherwise those whose coverage row
// still claims an approved CMS plan. A pending row with nothing planned is not a refusal.
function cmsFallbackWriteGuard(projectDir, { decisions = null, pluginsRoot, targetKnowledgeRoot, attempted = null } = {}) {
  const paths = projectPaths(projectDir);
  const root = pluginsRoot || DEFAULT_PLUGINS_ROOT;
  const coverage = readJsonOrNull(paths.coverage) || readJsonOrNull(paths.rawCoverage);
  const decisionsFile = decisions || readJsonOrNull(path.join(projectDir, 'orchestration', 'decisions.json')) || {};
  const rows = (coverage && coverage.capabilities) || [];
  const eligible = eligibilityByCapability(loadCmsFallbackRegisters(root).cmsFallbackEligible);

  const capabilities = new Set();
  for (const row of rows) {
    if (row && row.recognized && (eligible.has(row.capability) || isEligibleCmsFallbackRow(row))) capabilities.add(row.capability);
  }
  const attemptedSet = attempted ? new Set(attempted) : null;
  // Derived/unrecognized CMS rows (confidence: proposed, decided at the mapping review) are not
  // this gate's business; a RECOGNIZED capability written to CMS always is.
  if (attemptedSet) {
    for (const capability of attemptedSet) {
      if (eligible.has(capability) || rows.some((row) => row && row.recognized && row.capability === capability)) capabilities.add(capability);
    }
  }
  if (capabilities.size === 0) return { capabilities: {}, refusals: [] };

  const inventory = readJsonOrNull(paths.inventory) || readJsonOrNull(paths.canonicalInventory);
  const current = inventory
    ? computeCurrentDigest({ inventory, decisions: decisionsFile, pluginsRoot: root, targetKnowledgeRoot: targetKnowledgeRoot || DEFAULT_TARGET_KNOWLEDGE_ROOT }).digest
    : null;
  const chain = {
    coverage: digestOf(coverage),
    mappingPlan: digestOf(readJsonOrNull(paths.mappingPlan)),
    setupPlan: digestOf(readJsonOrNull(paths.setupPlan)),
  };
  const fresh = Boolean(current) && chain.coverage === current && chain.mappingPlan === current && chain.setupPlan === current;

  const result = {};
  const refusals = [];
  for (const capability of Array.from(capabilities).sort()) {
    const row = rows.find((candidate) => candidate.capability === capability && candidate.recognized) || null;
    const entry = eligible.get(capability) || null;
    const evaluation = evaluateCmsFallbackDecision({ capability, entry, decisions: decisionsFile });
    const entryDigest = entry ? cmsFallbackProposalDigest(entry) : null;
    let reason = null;
    if (!isApprovedCmsFallbackRow(row)) reason = 'coverage-row-not-approved-cms';
    else if (!entry) reason = 'eligibility-missing';
    else if (evaluation.state !== 'approved') reason = `decision-${evaluation.state}`;
    else if (row.cmsFallback.proposalDigest !== entryDigest) reason = 'coverage-proposal-stale';
    else if (!fresh) reason = 'resolution-inputs-changed';
    const allowed = reason === null;
    result[capability] = { allowed, reason, targetRefs: allowed ? [...(row.targetRefs || [])] : [] };
    const wasAttempted = attemptedSet ? attemptedSet.has(capability) : isApprovedCmsFallbackRow(row);
    if (!allowed && wasAttempted) {
      refusals.push({ capability, reason, recordCount: totalRecords(row), targetRefs: unionTargetRefs(proposalFromRow(row).targetRefsByEntity) });
    }
  }
  return { capabilities: result, refusals, digest: { current, ...chain } };
}

// ---- completion operator actions --------------------------------------------------------

const DEADLINE = 'before DNS change';

function refsText(refs) {
  return refs && refs.length ? refs.join(', ') : 'CMS collections';
}

/**
 * Operator actions for every eligible capability, derived from the current coverage rows, the
 * write-time guard's refusals, and the CMS writes recorded by the previous completion report.
 * Never deletes or rewrites CMS data; withdrawn data is handed to the Cutover Operator.
 */
function cmsFallbackOperatorActions({ coverage = null, refusals = [], previousWrites = [], writes = [] } = {}) {
  const rows = ((coverage && coverage.capabilities) || []).filter((row) => row && row.recognized && isEligibleCmsFallbackRow(row));
  const refused = new Map((refusals || []).map((refusal) => [refusal.capability, refusal]));
  const actions = [];

  for (const row of rows) {
    const capability = row.capability;
    const records = totalRecords(row);
    const proposal = proposalFromRow(row);
    if (refused.has(capability)) continue;
    if (isApprovedCmsFallbackRow(row)) {
      actions.push({
        code: 'plugin-cms-fallback-feature-absent',
        severity: 'medium',
        action: `${capability}: records were archived in Wix CMS (${refsText(row.targetRefs)}) with the merchant's approval; the plugin's feature is not restored. ${proposal.featureLoss || ''} Rebuild or replace that feature in Wix; a reconciled CMS collection does not resolve this item.`.replace(/\s+/g, ' ').trim(),
        deadlineReason: DEADLINE,
        entity: capability,
        affectedCount: records,
      });
      continue;
    }
    const declined = row.reason === 'cms-fallback-declined';
    actions.push({
      code: declined ? 'plugin-cms-fallback-declined' : 'plugin-cms-fallback-undecided',
      severity: records > 0 ? 'high' : 'low',
      action: declined
        ? `${capability}: the merchant declined archiving these records in CMS, so ${records} record(s) were not migrated. Settle the capability at the mapping review (another verdict) or accept that the data stays in the source.`
        : `${capability}: archiving these records in CMS is awaiting the merchant's decision (${row.reason || 'undecided'}), so ${records} record(s) were not migrated. Ask the merchant at the mapping review to approve or decline the CMS fallback.`,
      deadlineReason: DEADLINE,
      entity: capability,
      affectedCount: records,
    });
  }

  for (const refusal of refusals || []) {
    actions.push({
      code: 'plugin-cms-fallback-write-refused',
      severity: 'high',
      action: `Requires Import Operator: CMS writes for ${refusal.capability} were refused (${refusal.reason}); zero records were written. Rerun from the orchestration router so the coverage, mapping plan and setup plan are regenerated, then import again.`,
      deadlineReason: DEADLINE,
      entity: refusal.capability,
      affectedCount: Number.isFinite(refusal.recordCount) ? refusal.recordCount : 0,
    });
  }

  const currentlyApproved = new Set(rows.filter((row) => isApprovedCmsFallbackRow(row) && !refused.has(row.capability)).map((row) => row.capability));
  const writtenNow = new Set((writes || []).map((write) => write.capability));
  for (const write of previousWrites || []) {
    if (!write || !write.capability || !(write.count > 0)) continue;
    if (currentlyApproved.has(write.capability) || writtenNow.has(write.capability)) continue;
    actions.push({
      code: 'plugin-cms-fallback-withdrawn',
      severity: 'high',
      action: `${write.capability}: ${write.count} record(s) were written to CMS (${refsText(write.collections)}) under an approval that no longer applies. Nothing was deleted. Cutover Operator: keep or remove that CMS data by hand in Business Manager.`,
      deadlineReason: DEADLINE,
      entity: write.capability,
      affectedCount: write.count,
    });
  }
  return actions;
}

module.exports = {
  DECISION_PREFIX,
  DECISION_VALUES,
  DEFAULT_PLUGINS_ROOT,
  DEFAULT_TARGET_KNOWLEDGE_ROOT,
  canonicalize,
  decisionKey,
  isCmsFallbackDecisionKey,
  capabilityOfKey,
  canonicalTargetRefsByEntity,
  cmsFallbackProposalDigest,
  unionTargetRefs,
  isUsableEligibilityEntry,
  eligibilityByCapability,
  cmsFallbackDecisionShape,
  evaluateCmsFallbackDecision,
  cmsFallbackDecisionKeys,
  entitiesForCapability,
  entityKeysForCapability,
  cmsFallbackResolutionInputs,
  cmsFallbackInputsDigest,
  loadTargetKnowledgeSummary,
  loadCmsFallbackRegisters,
  projectPaths,
  detectedPluginsOf,
  computeCurrentDigest,
  checkCmsFallbackFreshness,
  stampPlanDigest,
  totalRecords,
  isApprovedCmsFallbackRow,
  isEligibleCmsFallbackRow,
  proposalFromRow,
  cmsFallbackWriteGuard,
  cmsFallbackOperatorActions,
};
