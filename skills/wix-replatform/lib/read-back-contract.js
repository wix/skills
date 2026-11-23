'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  hashArtifact
} = require('./artifact-freshness');
const state = require('./read-back-state');
const {
  GUID
} = require('./operator-identity');
const DOMAINS = {
  order: 'ecom',
  member: 'members',
  contact: 'crm',
  product: 'stores'
};
const L = require('./source-location');
const INVENTORY_SCHEMA_VERSION = 2;
// One shared location grammar (lib/source-location.js). Legacy [n] indexes normalize to [].
const canonical = p => L.canonicalize(String(p));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const populated = L.populated;
const { assertContactAddressShape } = require('./contact-address-contract.js');
const compareKeys = (a, b) => Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
// A read-back unit key: the gated entity (`contact`), or `<entity>.<plan row>` when several plan
// rows write that entity (lib/mapping-field-contract.js readBackKeys). Returns the gated entity.
function entityKey(key) {
  const parts = require('./mapping-field-contract').splitReadBackKey(key);
  if (!parts || !Object.hasOwn(DOMAINS, parts.entity)) throw new Error('Unsupported read-back entity');
  return parts.entity;
}
// The gated entity of a unit key, or null when the key is not a read-back unit.
function domainOf(key) {
  try { return entityKey(key); } catch { return null; }
}
function domainPath(entity) {
  const domain = entityKey(entity);
  return path.join(__dirname, '../resources/rp-target-wix/domains', DOMAINS[domain], 'entities', `${domain}.json`);
}
// Wix-owned paths are never compared with the sent body: the entity's readBackProjection.serverOwned
// rows, plus every path its fieldContracts[].readback marks "server-assigned".
function serverOwnedPaths(d) {
  const rows = (d.readBackProjection?.serverOwned || []).map(row => typeof row === 'string' ? { path: row, reason: 'server-owned' } : row);
  for (const contract of d.fieldContracts || []) for (const [p, mark] of Object.entries(contract.readback || {}))
    if (mark === 'server-assigned' && !rows.some(row => row.path === p)) rows.push({ path: p, reason: 'server-assigned (target knowledge readback)' });
  return rows;
}
function domainContract(entity) {
  const file = domainPath(entity);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    intendedFields: d.intendedFields,
    readBackProjection: d.readBackProjection && { ...d.readBackProjection, serverOwned: serverOwnedPaths(d) },
    domainDigest: hashArtifact(path.dirname(file), path.basename(file))
  };
}
function decisionFileName(projectDir, entity) {
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch { /* legacy fallback */ }
  const preferred = plan?.fieldContractVersion === 1
    ? require('./mapping-field-contract').entityDecisionFileName(plan, entity)
    : `${entity}.json`;
  // Exact plans are source-named. Keep reading an existing target-named projection
  // from older exact fixtures/runs until the mapper rewrites it.
  const legacy = `${entity}.json`;
  return fs.existsSync(path.join(projectDir, 'mapping/entity-decisions', preferred)) || !fs.existsSync(path.join(projectDir, 'mapping/entity-decisions', legacy))
    ? preferred
    : legacy;
}
function bindingPaths(entity, plan, projectDir = null) {
  entityKey(entity);
  const decision = plan?.fieldContractVersion === 1
    ? projectDir ? decisionFileName(projectDir, entity) : require('./mapping-field-contract').entityDecisionFileName(plan, entity)
    : `${entity}.json`;
  return ['mapping/mapping-plan.json', `mapping/entity-decisions/${decision}`, 'mapping/mapping-resolution.json', `execution/read-back-inventory/${entity}.json`];
}
function bindings(projectDir, entity) {
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch { /* the missing plan is reported by its own binding */ }
  return Object.fromEntries(bindingPaths(entity, plan, projectDir).map(p => {
    const hash = hashArtifact(projectDir, p);
    if (!hash) throw new Error(`read-back binding missing: ${p}`);
    return [p, hash];
  }));
}
function leafPaths(value, { templates = [] } = {}) {
  return L.leafLocations(value, { templates });
}
const valuesAt = (value, location) => L.valuesAt(value, location);
function planEntity(plan, entity) {
  return require('./mapping-field-contract').readBackRow(plan || {}, entity);
}
// Selector templates come only from the reviewed coverage's dynamic entries. Two different
// templates for one array are ambiguous and fail closed.
function selectorTemplates(plan, entity) {
  const row = planEntity(plan, entity), byArray = new Map();
  for (const item of row?.discoveryCoverage?.paths || []) {
    if (!item || typeof item !== 'object' || item.dynamic !== true) continue;
    const t = L.template(item), prior = byArray.get(t.array);
    if (prior && (prior.keyPath !== t.keyPath || prior.value !== t.value)) throw Object.assign(new Error(`Ambiguous selector templates for ${t.array}`), { code: 'selector_template_ambiguous' });
    byArray.set(t.array, t);
  }
  return [...byArray.values()].sort((a, b) => compareKeys(a.path, b.path));
}
// Draft helper (read-only): every inventoried location under a selected metadata value that no
// decision claims, grouped per selected value into an UNRESOLVED stub. It never excludes,
// approves or writes; the mapper decides each stub and keeps every leaf as an exact location.
function draftSelectorDescendantStubs(plan, entity, inv) {
  const fields = require('./mapping-field-contract'), row = planEntity(plan, entity);
  const claimed = new Set((row?.fieldMappings || []).flatMap(d => { try { return fields.decisionLocations(d); } catch { return []; } }));
  const groups = new Map();
  for (const p of Object.keys(inv?.sourcePaths || {}).sort(compareKeys)) {
    if (claimed.has(p)) continue;
    const segs = L.parse(p), at = segs.findIndex(s => s.where);
    if (at < 0 || at + 1 >= segs.length) continue;
    const root = L.format(segs.slice(0, at + 2));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }
  return [...groups.entries()].map(([root, sourcePaths]) => ({
    id: `selector-descendants-${fields.digest(root).slice(0, 12)}`,
    disposition: 'unresolved',
    sourcePaths,
    evidence: [{ kind: 'read-back-inventory', ref: `execution/read-back-inventory/${entity}.json` }],
    reason: `Populated locations under ${L.readable(root)} were inventoried but no decision claims them; decide each exactly.`,
    suggestedDecisionRefs: (row?.fieldMappings || []).filter(d => { try { return fields.decisionLocations(d).includes(root); } catch { return false; } }).map(d => d.id).sort(),
    inventoryCounts: Object.fromEntries(sourcePaths.map(p => [p, inv.sourcePaths[p]])),
    draft: true
  }));
}
// The pre-approval builder is a pure record -> request-body function. It is prepared from
// draft decisions before approval, so it must not reach a Wix client, capability, executor,
// network or process API. This is a deterministic static refusal, not a sandbox.
const IMPURE_BUILDER = [
  [/\brequire\s*\(\s*['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)['"]/, 'network or process module'],
  [/\bimport\b[^;]*['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)['"]/, 'network or process module'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/, 'network call'],
  [/wix-writers|createWixClient|wix-client|wix-http|dependency-gate|dependency-readiness|execution-capabilit|import-executor|run-import|issueCapability|withCapability|gateBatch|executeCanaries|ReadBackGate|writeFile|appendFile|\bprocess\.env\b/, 'Wix client, capability, executor or write wiring']
];
function assertPureBuilder(sourceText) {
  for (const [pattern, what] of IMPURE_BUILDER) if (pattern.test(sourceText)) throw Object.assign(new Error(`builder is not pure: it references ${what}`), { code: 'builder_not_pure' });
  return true;
}
const templateKey = templates => templates.map(t => ({ path: t.path, keyPath: t.keyPath }));
// Declared output applicability: the exact predicates an inventory was measured
// under. A change to any of them makes that inventory stale.
// A gate-supplied row carries a marker, so an inventory measured before that exemption is stale.
const applicabilityKey = (rows, entity = null) => rows.filter(r => r.appliesWhen !== undefined)
  .map(r => [String(r.canonicalField), canonical(r.writePath), r.appliesWhen, ...(suppliedElsewhere(entity, rows, r) ? ['supplied-elsewhere'] : [])]).sort((a, b) => compareKeys(a[0], b[0]));
function assertApplicabilityShape(rows) {
  const A = require('./output-applicability');
  for (const r of rows) if (r.appliesWhen !== undefined) {
    const errors = A.validate(r.appliesWhen, [...A.locations(r.appliesWhen)]);
    if (errors.length) throw Object.assign(new Error(`Invalid output applicability ${r.canonicalField}: ${errors.join('; ')}`), { code: 'applies_when_invalid' });
  }
}
// One record: which outputs the builder must write (applicable and fed by a populated source)
// and which it must not write (every row at that write path declares appliesWhen and none
// applies). Rows without appliesWhen keep the former rule: always applicable. Outputs sharing a
// write path are judged together; writer-guard paths are excluded by the caller.
// Source-archive rows (`cms/data-item`, the entity's ImportArchive_* collection) are written by the
// archive step, never by the entity's builder: they are outside the builder's output
// applicability, in the inventory and in the canary alike.
const archiveRow = row => row?.targetRef === 'cms/data-item';
// A reference the dependency gate fills in (order buyer, line-item product/variant, product
// tag ids) or a reviewed post-create step writes (Stores category membership) is never the pure
// builder's output. The test is the one verifyGrant uses (dependency-readiness
// gateSuppliedReferences over target knowledge), so the canary and the send-time check cannot drift.
const suppliedCache = new WeakMap();
function suppliedElsewhere(unit, rows, row) {
  const entity = domainOf(unit);
  if (!entity) return false;
  if (!suppliedCache.has(rows)) suppliedCache.set(rows, new Map());
  const cache = suppliedCache.get(rows), key = entity + '\0' + row.writePath;
  if (!cache.has(key)) {
    const p = String(row.writePath), relative = p.startsWith(entity + '.') ? p.slice(entity.length + 1) : p;
    cache.set(key, require('./dependency-readiness').gateSuppliedReferences([`${DOMAINS[entity]}/${entity}`], relative).length > 0);
  }
  return cache.get(key);
}
// An output another toolkit stage writes, never the pure builder's body, read from target knowledge:
// - a row for an entity written inside this entity's task (knowledge `writtenInTaskOf`: an order's
//   payments and refunds, which the order composite's stages write after the order exists);
// - a path written only together with a gate-filled reference (knowledge `referenceCompanionFields`:
//   a line's catalogReference.appId comes with its catalogItemId, which the gate fills).
// Neither is demanded of nor refused in the builder's output.
const ownedCache = new WeakMap();
function ownedElsewhere(unit, rows, row) {
  const entity = domainOf(unit);
  if (!entity) return false;
  if (!ownedCache.has(rows)) ownedCache.set(rows, new Map());
  const cache = ownedCache.get(rows), key = entity + '\0' + row.targetRef + '\0' + row.writePath;
  if (!cache.has(key)) {
    const host = `${DOMAINS[entity]}/${entity}`;
    let owned = Boolean(row.targetRef && row.targetRef !== host && require('./target-import-support').writtenInTaskOf(row.targetRef) === host);
    if (!owned) {
      const p = String(row.writePath), relative = canonical(p.startsWith(entity + '.') ? p.slice(entity.length + 1) : p);
      const companions = JSON.parse(fs.readFileSync(domainPath(entity), 'utf8')).referenceCompanionFields || {};
      const { pathMatches } = require('./dependency-readiness');
      owned = Object.entries(companions).some(([ref, templates]) => !ref.startsWith('_') && Array.isArray(templates) && templates.some(t => t === relative || pathMatches(t, relative)));
    }
    cache.set(key, owned);
  }
  return cache.get(key);
}
function outputApplicability(rows, record, expected, { guarded = [], declaredOnly = false, entity = null, choices = {} } = {}) {
  const A = require('./output-applicability'), groups = new Map(), states = [], missing = [], unexpected = [], supplied = [], emittedSupplied = [], owned = [];
  for (const row of rows) {
    if (guarded.includes(row.writePath) || archiveRow(row)) continue;
    if (ownedElsewhere(entity, rows, row)) { owned.push(row); continue; }
    if (suppliedElsewhere(entity, rows, row)) {
      supplied.push(row);
      if (valuesAt(expected, row.writePath).some(populated)) emittedSupplied.push(row);
      continue;
    }
    if (!groups.has(row.writePath)) groups.set(row.writePath, []);
    groups.get(row.writePath).push(row);
  }
  for (const [writePath, group] of groups) {
    const at = group.map(row => ({ row, declared: row.appliesWhen !== undefined,
      applies: row.appliesWhen === undefined || A.evaluate(row.appliesWhen, record, { choices }),
      fed: (row.sourcePaths || []).some(p => valuesAt(record, p).some(populated)) }));
    const emitted = valuesAt(expected, writePath).some(populated);
    const required = at.filter(s => s.applies && s.fed && (!declaredOnly || s.declared));
    if (!emitted && required.length) missing.push(...required.map(s => s.row));
    if (emitted && at.every(s => s.declared && !s.applies)) unexpected.push(...at.map(s => s.row));
    for (const s of at) states.push({ ...s, emitted });
  }
  return { states, missing, unexpected, suppliedElsewhere: supplied, emittedSupplied, ownedElsewhere: owned };
}
// A decided hold: the generated pure builder returns `{ status: 'held', holds: [{ decisionId,
// code }] }` for a record it will not write. Returns the sorted `decisionId:code` reasons, or
// null for a writable body. A hold without a reason per entry is refused.
// With `decisionIds`, each hold must name one of those decisions.
function builderHold(body, decisionIds = null) {
  if (!body || typeof body !== 'object' || body.status !== 'held' && !(Array.isArray(body.holds) && body.holds.length)) return null;
  const named = v => typeof v === 'string' && v.trim() !== '';
  const reasons = (Array.isArray(body.holds) ? body.holds : []).map(h => named(h?.decisionId) && named(h?.code) ? `${h.decisionId}:${h.code}` : null);
  if (body.status !== 'held' || !reasons.length || reasons.includes(null)) throw Object.assign(new Error('Builder hold requires status held and a decisionId and code per hold'), { code: 'builder_hold_invalid' });
  if (decisionIds && body.holds.some(h => !decisionIds.has(h.decisionId))) throw Object.assign(new Error('Builder hold names a decision that is not in the current plan for this entity'), { code: 'builder_hold_unknown_decision' });
  return [...new Set(reasons)].sort(compareKeys);
}
// Hold codes the toolkit has retired (target knowledge `retiredHoldCodes`): a shipped route now writes
// these records, so a builder that still holds one is stale generated code, never a decision. The
// inventory refuses it before import.
let retiredCache = null;
function retiredHoldCodes() { return retiredCache ||= require('../resources/rp-target-wix/lib/domain-knowledge.js').retiredHoldCodes(); }
function retiredHolds(body) {
  return (Array.isArray(body?.holds) ? body.holds : []).filter(h => Object.hasOwn(retiredHoldCodes(), h?.code)).map(h => h.code);
}
// The entity's canonical decision IDs in the current exact plan. A plan without fieldContractVersion
// 1 has none, so it cannot hold a record.
function planDecisionIds(plan, entity) {
  return new Set(plan?.fieldContractVersion === 1 ? (planEntity(plan, entity)?.fieldMappings || []).map(d => d.id).filter(Boolean) : []);
}
// A canary must represent a write the importer can actually attempt. Held rows are
// deliberately retained in source coverage and reporting, but they are outside the
// writable output universe and cannot prove the entity's write contract.
function canaryEligible(row) {
  return Boolean(row && !Object.hasOwn(row, 'held') && Array.isArray(row.writePaths) && row.writePaths.length);
}
const HELD_START = entity => `<!-- read-back-held:${entity}:start -->`, HELD_END = entity => `<!-- read-back-held:${entity}:end -->`;
// The held set the approver reviews: one section per entity in both mapping review files, rewritten
// by every inventory (removed when nothing is held). The inventory digest binds the same set.
function writeHeldReview(projectDir, entity, held, inventorySha256) {
  const start = HELD_START(entity), end = HELD_END(entity);
  const block = held ? [start, `## Held records: ${entity}`, '',
    `${held.count} ${entity} records are held by the builder and not written. Each record and its reasons: \`execution/read-back-inventory/${entity}.json\` (\`records[].held\`, sha256 \`${inventorySha256}\`). Approval of this mapping covers this held set.`, '',
    '| Decision:code | Records |', '| --- | --- |', ...Object.entries(held.reasons).map(([r, n]) => `| ${r} | ${n} |`), end].join('\n') : '';
  for (const name of ['mapping-summary.md', 'mapping-plan.md']) {
    const file = path.join(projectDir, 'mapping/review', name);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!block && !text.includes(start)) continue;
    if (text.includes(start) && text.includes(end)) text = text.slice(0, text.indexOf(start)).trimEnd() + text.slice(text.indexOf(end) + end.length);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.writing`, `${text.trimEnd()}${block ? `\n\n${block}` : ''}\n`);
    fs.renameSync(`${file}.writing`, file);
  }
}
// The held set dependency readiness may treat as settled: the current inventory's
// per-record holds, valid against the current plan (the checks below), named by this inventory's
// sha256 in the reviewed held block, and bound -- inventory and plan digests -- by the current
// identified mapping approval. A missing inventory holds nothing; any other mismatch is not
// current, so no hold is honored.
async function approvedHeldRecords(projectDir, entity, plan) {
  entityKey(entity);
  const file = `execution/read-back-inventory/${entity}.json`, notCurrent = { ok: false, reason: 'held-set-not-current', held: new Map() };
  let inv;
  try { inv = JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); } catch (e) { return e.code === 'ENOENT' ? { ok: true, held: new Map() } : notCurrent; }
  if (!inv || inv.entity !== entity || !Array.isArray(inv.records) || inv.schemaVersion !== INVENTORY_SCHEMA_VERSION || inv.locationEncoding !== L.ENCODING) return notCurrent;
  if (inv.builder && (!inv.builder.path || hashArtifact(projectDir, inv.builder.path) !== inv.builder.sha256)) return notCurrent;
  const ids = [...planDecisionIds(plan, entity)], held = new Map(), recount = Object.create(null);
  for (const r of inv.records) if (r.held !== undefined) {
    if (!Array.isArray(r.held) || !r.held.length || r.held.some(reason => typeof reason !== 'string' || !ids.some(id => reason.startsWith(`${id}:`)))) return notCurrent;
    held.set(String(r.sourceId), [...r.held]);
    for (const reason of r.held) recount[reason] = (recount[reason] || 0) + 1;
  }
  if (!held.size) return inv.heldRecords ? notCurrent : { ok: true, held };
  const summary = { count: held.size, reasons: Object.fromEntries(Object.keys(recount).sort(compareKeys).map(r => [r, recount[r]])) };
  if (digest(summary) !== digest(inv.heldRecords ?? null)) return notCurrent;
  const inventorySha256 = hashArtifact(projectDir, file);
  let review = '';
  try { review = fs.readFileSync(path.join(projectDir, 'mapping/review/mapping-summary.md'), 'utf8'); } catch {}
  const start = review.indexOf(HELD_START(entity)), end = review.indexOf(HELD_END(entity));
  if (start < 0 || end < start || !review.slice(start, end).includes(`sha256 \`${inventorySha256}\``)) return notCurrent;
  let approval = null, request = null;
  try { approval = (await state.readJson(projectDir, 'orchestration/approvals.json', {})).mapping; } catch { return notCurrent; }
  if (await oneClickHeldApproval(projectDir, approval, file, inv)) return { ok: true, held, inventorySha256 };
  try { request = await require('./user-actions').readUserAction(projectDir, approval?.requestId || ''); } catch { return notCurrent; }
  if (!validApproval(approval, { [file]: inventorySha256, 'mapping/mapping-plan.json': hashArtifact(projectDir, 'mapping/mapping-plan.json') }, request)) return notCurrent;
  return { ok: true, held, inventorySha256 };
}
// Human-approved policy (2026-11-01): in a run the user chose as 1-click (automationMode one_click,
// source user), the agent-decided mapping approval counts for the held set; 1-click asks no
// mid-run questions, so it has no identified request. It binds the held set through what it pins
// instead: if it names inventories it must name this one and the plan (a toolkit-recorded approval
// names none; see below), its census reference must be current (that
// reconciliation pins the mapping-plan digest), the inventory must pin its builder (checked above)
// and its recorded extract must be unchanged. The held summary and reviewed held block were
// checked above. Normal mode and an inferred one_click still need the identified user approval.
// Omission approvals are unaffected.
async function oneClickHeldApproval(projectDir, approval, file, inv) {
  try {
    if (approval?.status !== 'approved' || approval.decidedBy !== 'agent') return false;
    if (!require('./orchestration-decisions').isExplicitUserOneClick(await state.readJson(projectDir, 'orchestration/decisions.json', {}) || {})) return false;
    const refs = (approval.artifactRefs || []).map(r => typeof r === 'string' ? r : r?.path);
    // The toolkit records the one-click approval itself (stage entry, `auto-approve` with no refs):
    // it names no inventory, and inventories the toolkit builds at codegen exist only after it. Its
    // census reference pins the plan (checked below), and the inventory pins its current builder
    // (checked by the caller) and its unchanged extract (here), so that held set is honored (Elad,
    // 11-21). An approval that names inventories still binds by name: it must name this one and the plan.
    const namesInventories = refs.some(r => typeof r === 'string' && r.startsWith('execution/read-back-inventory/'));
    if (namesInventories && (!refs.includes(file) || !refs.includes('mapping/mapping-plan.json'))) return false;
    if (!inv.builder || !inv.extract?.path) return false;
    if (await require('./extract-ledger').fileDigest(projectDir, inv.extract.path) !== inv.extract.sha256) return false;
    for (const child of inv.extract.children || []) if (await require('./extract-ledger').fileDigest(projectDir, child.path).catch(() => null) !== child.sha256) return false;
    return await require('./census-reconciliation').mappingApprovalBound(projectDir, approval);
  } catch { return false; }
}
const idsDigestOf = value => require('./mapping-field-contract').digest(value);
const idsDigest = ids => require('./mapping-field-contract').digest([...new Set(ids)].sort());
// The generated reader feeds its existing extract stream once. Values are not written to the inventory.
async function inventory(projectDir, entity, records, {
  sourceKey = r => r.id,
  buildWrite = r => r,
  rows = [],
  templates = [],
  builder = null,
  extract = null,
  inputs = null
} = {}) {
  entityKey(entity);
  assertApplicabilityShape(rows);
  const declared = applicabilityKey(rows, entity), applicability = declared.length ? Object.create(null) : null;
  for (const r of rows) if (applicability && r.appliesWhen !== undefined) applicability[r.canonicalField] = { writePath: canonical(r.writePath), applicable: 0, notApplicable: 0, missing: 0, unexpected: 0 };
  const preparationStarted = performance.now();
  const planJson = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
  const decisionIds = planDecisionIds(planJson, entity);
  const choices = require('./output-applicability').planChoiceValues(planEntity(planJson, entity));
  const sourcePaths = Object.create(null),
    writePaths = Object.create(null),
    members = new Map(),
    perRecord = [],
    heldReasons = Object.create(null),
    retired = new Map(),
    seen = new Set();
  let heldCount = 0;
  for await (const record of records) {
    const id = sourceKey(record);
    if (id === undefined || id === null || String(id) === '' || seen.has(String(id))) throw new Error('Read-back inventory requires unique stable source keys');
    seen.add(String(id));
    const body = await buildWrite(record);
    if (domainOf(entity) === 'contact') assertContactAddressShape(body?.contact || body, 'generated contact builder');
    const source = leafPaths(record, { templates }),
      held = builderHold(body, decisionIds);
    for (const p of source) {
      sourcePaths[p] = (sourcePaths[p] || 0) + 1;
      if (!members.has(p)) members.set(p, []);
      members.get(p).push(String(id));
    }
    // A held record stays in source coverage but is never written: it is outside output
    // applicability and the canary universe, and is listed with its reasons.
    if (held) for (const code of retiredHolds(body)) retired.set(code, [...(retired.get(code) || []), String(id)]);
    if (held) {
      heldCount += 1;
      for (const r of held) heldReasons[r] = (heldReasons[r] || 0) + 1;
      perRecord.push({ sourceId: String(id), writePaths: [], held });
      continue;
    }
    const sent = leafPaths(body);
    // A non-applicable output is outside this record's coverage unless the builder emits it
    // (then the gate refuses that canary, and validation reports it first).
    const judged = applicability ? outputApplicability(rows, record, body, { entity, choices }) : null;
    const applies = row => !judged || judged.states.find(s => s.row === row)?.applies !== false;
    const fields = [...new Set(rows.filter(row => applies(row) && (row.sourcePaths || []).some(p => valuesAt(record, p).some(populated)) || sent.has(canonical(row.writePath))).map(row => canonical(row.writePath)))].sort(compareKeys);
    if (judged) for (const s of judged.states) {
      const count = applicability[s.row.canonicalField];
      if (!count) continue;
      count[s.applies ? 'applicable' : 'notApplicable'] += 1;
      if (judged.missing.includes(s.row)) count.missing += 1;
      if (judged.unexpected.includes(s.row)) count.unexpected += 1;
    }
    for (const p of fields) writePaths[p] = (writePaths[p] || 0) + 1;
    perRecord.push({
      sourceId: String(id),
      writePaths: fields
    });
  }
  // Refused before anything is written: the inventory file and held review stay as they were.
  if (retired.size) {
    const detail = [...retired].map(([code, ids]) => `${code} (${ids.length}: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', ...' : ''}). ${retiredHoldCodes()[code].remediation}`).join(' ');
    throw Object.assign(new Error(`Builder holds a retired hold code for ${entity}: ${detail}`), { code: 'builder_hold_retired', retired: Object.fromEntries(retired), remediation: Object.fromEntries([...retired.keys()].map(code => [code, retiredHoldCodes()[code].remediation])) });
  }
  perRecord.sort((a, b) => compareKeys(a.sourceId, b.sourceId));
  // Per-location complete membership digest: lets omission review bind each location's
  // measured record set without writing source values or a second source scan.
  const sourceIdsDigests = Object.create(null);
  for (const p of Object.keys(sourcePaths).sort(compareKeys)) sourceIdsDigests[p] = idsDigest(members.get(p));
  const result = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    locationEncoding: L.ENCODING,
    entity,
    selectorTemplates: templateKey(templates),
    builder,
    ...(extract ? { extract } : {}),
    // The CLI options that are not paths, so the gate can rebuild a stale inventory the same way.
    ...(inputs && Object.keys(inputs).length ? { inputs } : {}),
    sourcePaths,
    sourceIdsDigests,
    writePaths,
    records: perRecord,
    // Present only when a row declares appliesWhen, so an inventory without one is unchanged.
    ...(applicability ? { applicabilityDigest: idsDigestOf(declared), outputApplicability: applicability } : {}),
    ...(heldCount ? { heldRecords: { count: heldCount, reasons: Object.fromEntries(Object.keys(heldReasons).sort(compareKeys).map(r => [r, heldReasons[r]])) } } : {})
  };
  await state.atomic(projectDir, `execution/read-back-inventory/${entity}.json`, result);
  writeHeldReview(projectDir, entity, result.heldRecords, hashArtifact(projectDir, `execution/read-back-inventory/${entity}.json`));
  Object.defineProperty(result, 'preparationMs', {
    value: performance.now() - preparationStarted
  });
  return result;
}
// `exclude`: records that cannot be canaries now (their own parent record is final for this run,
// so the gate would only defer them); they are never selected and are dropped from `existing`.
function cover(inv, {
  ceiling = 10,
  existing = [],
  exclude = []
} = {}) {
  if (!Number.isInteger(ceiling) || ceiling < 10 || ceiling > 30) throw new Error('Canary ceiling must be a recorded user integer from 10 to 30');
  // An array or a Set; a Set keeps a large exclusion (a retry selection, records not ready) linear.
  const excluded = exclude instanceof Set ? exclude : new Set(exclude);
  const records = [...inv.records].sort((a, b) => compareKeys(a.sourceId, b.sourceId));
  const eligible = records.filter(canaryEligible),
    // Do not let a stale or hand-carried held row add a path that no writable row can cover.
    universe = [...new Set(eligible.flatMap(r => r.writePaths))].sort(compareKeys),
    left = new Set(universe),
    selected = [],
    coveredBy = {};
  const add = r => {
    selected.push(r.sourceId);
    for (const p of r.writePaths) if (left.delete(p)) coveredBy[p] = r.sourceId;
  };
  for (const id of existing.filter(id => !excluded.has(id))) {
    const row = records.find(r => r.sourceId === id);
    if (!row) throw new Error('A previously written canary is missing from the inventory');
    if (!canaryEligible(row)) continue;
    add(row);
  }
  while (left.size) {
    const candidates = eligible.filter(r => !selected.includes(r.sourceId) && !excluded.has(r.sourceId)).map(r => ({
      row: r,
      gain: r.writePaths.filter(p => left.has(p)).length
    })).sort((a, b) => b.gain - a.gain || compareKeys(a.row.sourceId, b.row.sourceId));
    if (!candidates[0]?.gain) break;
    add(candidates[0].row);
  }
  return {
    universeDigest: digest({
      universe,
      records
    }),
    ceiling,
    canarySourceIds: selected,
    coveredBy,
    requiredCount: selected.length,
    uncoveredPaths: selected.length > ceiling ? universe.filter(p => !selected.slice(0, ceiling).some(id => records.find(r => r.sourceId === id).writePaths.includes(p))) : [...left],
    status: selected.length > ceiling || left.size ? 'coverage-exceeds-ceiling' : 'covered'
  };
}
function mappingRows(plan, entity) {
  const raw = plan.entityMappings || plan.entityDecisions || plan.mappings || plan.entities || [];
  const entities = Array.isArray(raw) ? raw : Object.entries(raw).map(([key, v]) => ({
    sourceEntity: key,
    ...v
  }));
  const entry = require('./mapping-field-contract').readBackRow(entities, entity);
  const rows = entry?.fieldMappings || entry?.fields || entry?.mappingRows || [];
  if (plan.fieldContractVersion !== 1) return rows;
  // Derive the approved verification projection from canonical outputs. Never
  // trust a separately authored flat table or infer a remote read path.
  return entry ? require('./mapping-field-contract').projectEntity(entry).verificationMappings || [] : [];
}
function validApproval(approval, current, request) {
  return approval?.status === 'approved' && approval.decidedBy === 'user' && GUID.test(approval.approvedBy?.userId || '') && Boolean(approval.approvedBy?.displayName?.trim()) && approval.requestId === request?.requestId && ['pending', 'answered'].includes(request?.status) && Object.entries(current).every(([p, h]) => approval.bindingDigests?.[p] === h && request.artifactRefs?.some(r => r.path === p && String(r.sha256).replace(/^sha256:/, '') === h));
}
async function validate(projectDir, entity, {
  decision,
  plan,
  inv,
  approval,
  request
} = {}) {
  entityKey(entity);
  plan ||= await state.readJson(projectDir, 'mapping/mapping-plan.json');
  const decisionFile = decisionFileName(projectDir, entity);
  decision ||= await state.readJson(projectDir, `mapping/entity-decisions/${decisionFile}`);
  inv ||= await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`);
  approval ||= (await state.readJson(projectDir, 'orchestration/approvals.json', {})).mapping;
  if (!request && approval?.requestId) {
    try {
      request = await require('./user-actions').readUserAction(projectDir, approval.requestId);
    } catch {/* invalid approval */}
  }
  const errors = [],
    contract = domainContract(entity),
    copied = decision.readBackContract;
  // The contract is the checked-in domain contract. An exact plan need not copy it (the toolkit
  // runs this check at codegen, after the plan is approved); a copy must still be current.
  if (!copied && plan?.fieldContractVersion !== 1 || copied && (copied.domainDigest !== contract.domainDigest || digest(copied.intendedFields) !== digest(contract.intendedFields) || digest(copied.readBackProjection) !== digest(contract.readBackProjection))) errors.push('read-back domain contract stale or missing');
  if (!inv || inv.entity !== entity || !Array.isArray(inv.records)) errors.push('read-back inventory missing; check not run');
  // Fail closed on an inventory written under another location encoding or selector set,
  // or by a builder that has since changed: its paths/counts no longer mean the same thing.
  else if (inv.schemaVersion !== INVENTORY_SCHEMA_VERSION || inv.locationEncoding !== L.ENCODING) errors.push('read-back inventory stale (location encoding); rerun inventory');
  else {
    let templates = null;
    try { templates = templateKey(selectorTemplates(plan, entity)); } catch (e) { errors.push(e.message); }
    if (templates && digest(templates) !== digest(inv.selectorTemplates || [])) errors.push('read-back inventory stale (selector templates changed); rerun inventory');
    if (inv.builder && (!inv.builder.path || hashArtifact(projectDir, inv.builder.path) !== inv.builder.sha256)) errors.push('read-back inventory stale (builder changed or missing); rerun inventory');
    // The extract the inventory measured must still be the toolkit-recorded version, with no lost fields.
    // The CLI inventory (it pins a builder) always records its extract; one without is not trusted.
    if (inv.builder && !inv.extract) errors.push('read-back inventory has no recorded source extract; rerun inventory');
    // The inventory describes one extract version; a different file needs a fresh inventory, which
    // re-reads and records it (repairing a changed or stripped extract without blocking).
    if (inv.extract) {
      const current = await require('./extract-ledger').fileDigest(projectDir, inv.extract.path).catch(() => null);
      if (current !== inv.extract.sha256) errors.push(`source_extract_changed_since_inventory:${inv.extract.path}: rerun inventory`);
      for (const child of inv.extract.children || []) {
        const now = await require('./extract-ledger').fileDigest(projectDir, child.path).catch(() => null);
        if (now !== child.sha256) errors.push(`source_extract_changed_since_inventory:${child.path}: rerun inventory`);
      }
    }
  }
  const loc = p => {
    try { return canonical(p); } catch { errors.push(`Unparseable location: ${JSON.stringify(p)}`); return null; }
  };
  const rows = mappingRows(plan, entity).map(r => ({ ...r, sourcePaths: Array.isArray(r.sourcePaths) ? r.sourcePaths.map(loc) : r.sourcePaths })),
    dispositions = decision.fieldDispositions || [];
  // Output applicability: a closed predicate over the decision's own locations,
  // bound to the inventory it was measured under, and every record honored by the builder.
  const declaredRows = rows.filter(r => r.appliesWhen !== undefined);
  if (declaredRows.length) {
    const A = require('./output-applicability'), fields = require('./mapping-field-contract'), entry = planEntity(plan, entity);
    for (const r of declaredRows) {
      const d = plan.fieldContractVersion === 1 ? (entry?.fieldMappings || []).find(x => x.id === r.decisionRef) : null;
      let own = [];
      try { own = d ? fields.decisionLocations(d) : []; } catch { /* reported by the mapping contract */ }
      if (!d) errors.push(`Invalid output applicability ${r.canonicalField || r.id}: appliesWhen requires a fieldContractVersion 1 decision`);
      else for (const m of A.validate(r.appliesWhen, own)) errors.push(`Invalid output applicability ${r.canonicalField}: ${m}`);
    }
  }
  if (inv && Array.isArray(inv.records) && (declaredRows.length || inv.applicabilityDigest !== undefined)) {
    if (inv.applicabilityDigest !== idsDigestOf(applicabilityKey(rows, entity))) errors.push('read-back inventory stale (output applicability changed); rerun inventory');
    else for (const [field, c] of Object.entries(inv.outputApplicability || {}).sort(([a], [b]) => compareKeys(a, b))) {
      if (c.missing) errors.push(`Builder omits an applicable output: ${field} at ${c.writePath} (${c.missing} records)`);
      if (c.unexpected) errors.push(`Builder emits a non-applicable output: ${field} at ${c.writePath} (${c.unexpected} records)`);
    }
  }
  // Held records (0213 A.2.2): each hold names a decision of this entity in the current plan, and
  // the summary matches the per-record reasons the approval binds.
  let heldRecords = null;
  if (inv && Array.isArray(inv.records)) {
    const ids = planDecisionIds(plan, entity), recount = Object.create(null), unknown = new Map();
    let count = 0;
    for (const r of inv.records) if (r.held !== undefined) {
      count += 1;
      for (const reason of Array.isArray(r.held) ? r.held : [null]) {
        recount[reason] = (recount[reason] || 0) + 1;
        if (typeof reason !== 'string' || ![...ids].some(id => reason.startsWith(`${id}:`))) {
          const id = typeof reason === 'string' ? reason.split(':')[0] : String(reason);
          unknown.set(id, (unknown.get(id) || 0) + 1);
        }
      }
    }
    for (const [id, n] of [...unknown].sort(([a], [b]) => compareKeys(a, b))) errors.push(`Builder hold names an unknown ${entity} decision: ${id} (${n} records); fix the builder, rerun inventory`);
    const summary = count ? { count, reasons: Object.fromEntries(Object.keys(recount).sort(compareKeys).map(r => [r, recount[r]])) } : undefined;
    if (digest(summary ?? null) !== digest(inv.heldRecords ?? null)) errors.push('read-back inventory held summary does not match its records; rerun inventory');
    if (count) heldRecords = { ...summary, sourceIds: `execution/read-back-inventory/${entity}.json records[].held` };
  }
  const gate = await state.load(projectDir),
    history = [...gate.observedLosses, ...Object.values(gate.runs).flatMap(run => Object.values(run.entities || {}).flatMap(e => [...(e.attemptedPaths || []), ...(e.settlements || []).filter(s => s.status !== 'passed')]))];
  const inventoried = Object.keys(inv?.sourcePaths || {});
  const requirements = [...inventoried.map(p => ({
    kind: 'source',
    path: loc(p)
  })), ...(contract.intendedFields || []).filter(f => f.sourcePaths.some(p => inventoried.some(k => L.isPrefix(p, k)))).map(f => ({
    kind: 'intended',
    path: loc(f.targetPath),
    requiredSubpaths: f.requiredSubpaths || [],
    sourcePaths: f.sourcePaths
  }))].filter(r => r.path !== null);
  // Source locations the plan drops on purpose (excluded decisions that record their choice).
  // An intended field fed only by such locations is not expected (design v2: checks follow the plan).
  const planRow = plan.fieldContractVersion === 1 ? planEntity(plan, entity) : null;
  const droppedOnPurpose = (planRow?.fieldMappings || []).filter(d => require('./mapping-field-contract').deliberateDrop(d)).flatMap(d => d.sourcePaths || []).map(loc).filter(Boolean);
  const droppedByPlan = requirement => {
    const fed = inventoried.map(loc).filter(k => k && requirement.sourcePaths.some(p => L.isPrefix(p, k)));
    return fed.length > 0 && fed.every(k => droppedOnPurpose.some(d => L.within(d, k)));
  };
  // An intended item list ([]) is covered by rows writing the list itself or fields inside each item.
  const coversIntended = (writePath, p) => L.within(p, writePath) && (p.endsWith('[]') || L.within(writePath, p));
  const samePath = (x, p) => L.within(p, x) && L.within(x, p);
  const historyHas = (h, p) => [...(h.sourcePaths || []), h.writePath, h.intendedTargetPath].some(x => {
    try { return x !== undefined && x !== null && canonical(x) === p; } catch { return x === p; }
  });
  let current;
  try {
    current = bindings(projectDir, entity);
  } catch (e) {
    errors.push(e.message);
  }
  const declarationGaps = new Set();
  const archived = rows.filter(archiveRow).flatMap(r => Array.isArray(r.sourcePaths) ? r.sourcePaths.filter(Boolean) : []);
  const archivedAncestor = p => { let general; try { general = L.base(p); } catch { return false; } return archived.some(a => L.within(a, general)); };
  const omissionMode=require('./mapping-omission-approval').mode(await state.readJson(projectDir,'orchestration/decisions.json',{}));
  for (const requirement of requirements) {
    const matches = dispositions.filter(d => {
      try { return canonical(d.path || d.sourcePath || d.targetPath) === requirement.path && (!d.kind || d.kind === requirement.kind); } catch { return false; }
    });
    // No disposition for the intended item list itself: the item-field dispositions inside it
    // answer for it together, all from one write operation and at most one per item field.
    const inside = requirement.kind === 'intended' && !matches.length ? dispositions.filter(d => d.kind === 'intended' && coversIntended(d.path || d.targetPath, requirement.path)) : [];
    if (requirement.kind === 'intended' && !matches.length && !inside.length && droppedByPlan(requirement)) continue;
    // A selector-qualified leaf (meta_data[key="x"].value[].name) under a location the source
    // archive keeps whole (meta_data[].value) is kept by the archive step: covered, not missing.
    if (requirement.kind === 'source' && !matches.length && archivedAncestor(requirement.path)) continue;
    if (!inside.length && matches.length !== 1) {
      errors.push(`Disposition missing or duplicate: ${requirement.kind}:${requirement.path}`);
      continue;
    }
    if (inside.length) {
      if (new Set(inside.map(d => d.writeOperation)).size > 1) errors.push(`Ambiguous intended item fields: ${requirement.path} (more than one write operation)`);
      const seen = new Set();
      for (const d of inside) {
        const p = canonical(d.path || d.targetPath);
        if (seen.has(p)) errors.push(`Disposition missing or duplicate: intended:${p}`);
        seen.add(p);
      }
    }
    const covering = [];
    for (const d of inside.length ? inside : matches) {
      if (d.status === 'mapped') {
        const refs = plan.fieldContractVersion === 1 ? d.mappingRefs : [d.mappingRef];
        const mapped = Array.isArray(refs) ? refs.map(ref => ref === undefined || ref === null ? null : rows.find((r, i) =>
          (plan.fieldContractVersion === 1 ? r.canonicalField === ref : r.id !== undefined && r.id === ref) || plan.fieldContractVersion !== 1 &&
          (r.mappingRef !== undefined && r.mappingRef === ref || String(i) === String(ref)))) : [];
        // Declaration gaps are the toolkit's plan shape, not a lost field (Elad 11-21): a source
        // location an exact decision reads only as a condition (no output names it), or a covering
        // output with no read path or reason. They are reported (declarationGaps), never errors.
        if (!mapped.length && plan.fieldContractVersion === 1 && requirement.kind === 'source' && Array.isArray(refs) && d.decisionRefs?.length) declarationGaps.add(`condition-only source location: ${requirement.path}`);
        else if (!mapped.length || mapped.some(row => !row ||
          (requirement.kind === 'source' ? !row.sourcePaths?.includes(requirement.path) : !coversIntended(row.writePath, requirement.path) || plan.fieldContractVersion===1 && row.writeOperation!==d.writeOperation))) errors.push(`Mapping does not cover ${requirement.path}`);
        else {
          for (const row of mapped) if (!row.readPath && !row.unverifiableReason && !archiveRow(row)) declarationGaps.add(`output without a read path: ${row.canonicalField || row.id || row.writePath}`);
          covering.push(...mapped);
        }
      } else if (d.status === 'deferred') {
        if (!require('./mapping-recovery').permitsDisposition(projectDir, plan, planEntity(plan, entity), d)) errors.push(`Invalid recoverable deferral: ${requirement.path}`);
        if (history.some(h => (!h.entity || h.entity === entity) && historyHas(h, requirement.path))) errors.push(`Attempted or observed-loss path cannot become a deferred field: ${requirement.path}`);
      } else if (d.status === 'notMigrated') {
        if (history.some(h => (!h.entity || h.entity === entity) && historyHas(h, requirement.path))) errors.push(`Attempted or observed-loss path cannot be omitted: ${requirement.path}`);
        // Design v2: a drop the plan records (an excluded decision with its choice) is its own
        // authorization in every mode; it becomes a cutover action. Any other omission needs the
        // identified interactive approval.
        const entry = plan.fieldContractVersion === 1 ? planEntity(plan, entity) : null;
        const recorded = entry && d.decisionRefs?.length && d.decisionRefs.every(id => require('./mapping-field-contract').deliberateDrop((entry.fieldMappings || []).find(x => x.id === id)));
        if (!recorded && (!current || !validApproval(approval, current, request) || omissionMode==='one_click' || approval?.omissionApprovalContext?.automationMode!=='interactive' || request?.omissionApprovalContext?.automationMode!=='interactive')) errors.push(`Identified exact-binding approval missing: ${requirement.path}`);
      } else errors.push(`Unknown disposition: ${requirement.path}`);
    }
    // The item fields the target contract requires (product images: url). Answered field by field,
    // each needs its own disposition, and must be written whenever any field of the item is.
    for (const sub of requirement.requiredSubpaths || []) {
      const need = canonical(`${requirement.path}.${sub}`);
      if (inside.length) {
        const own = inside.filter(d => samePath(d.path || d.targetPath, need));
        if (!own.length) errors.push(`Disposition missing or duplicate: intended:${need}`);
        else if (inside.some(d => d.status === 'mapped') && own[0].status !== 'mapped') errors.push(`Mapping does not cover ${need}`);
      } else if (covering.length && !covering.some(row => L.within(row.writePath, need) || L.within(need, row.writePath))) errors.push(`Mapping does not cover ${need}`);
    }
  }
  if (plan.fieldContractVersion === 1) {
    const writes = new Map();
    for (const row of rows) {
      const key = canonical(row.writePath), binding = JSON.stringify([row.targetRef,row.writeOperation]);
      if (writes.has(key) && writes.get(key) !== binding) errors.push(`Ambiguous read-back operation: ${key}`);
      writes.set(key,binding);
    }
  }
  if (plan.fieldContractVersion===1 && require('./mapping-omission-approval').candidates(plan).length) {
    try {require('./mapping-omission-approval').assertAuthorized(projectDir,plan);} catch(e) {errors.push(e.message);}
  }
  const serverOwned = contract.readBackProjection?.serverOwned || [];
  for (const f of contract.intendedFields || []) if (serverOwned.some(p => (typeof p === 'string' ? p : p.path) === f.targetPath)) errors.push(`Intended field cannot be server-owned: ${f.targetPath}`);
  // A source-archive row is verified by the archive step (its journal and crosswalk), not by this read-back.
  for (const r of rows) {
    if (!r.writePath) errors.push('Mapping row missing read-back declaration');
    else if (!r.sourcePaths?.length) declarationGaps.add(`output without its own source locations: ${r.canonicalField || r.id || r.writePath}`);
    else if (!r.readPath && !r.unverifiableReason && !archiveRow(r)) declarationGaps.add(`output without a read path: ${r.canonicalField || r.id || r.writePath}`);
  }
  return {
    valid: !errors.length,
    fieldContractVersion:plan.fieldContractVersion,
    errors,
    contract,
    rows,
    // The plan's choices, for conditions that read them (output-applicability facts).
    choices: require('./output-applicability').planChoiceValues(planEntity(plan, entity)),
    inventory: inv,
    decision,
    approval,
    bindingDigests: current,
    heldRecords,
    declarationGaps: [...declarationGaps].sort(compareKeys)
  };
}
module.exports = {
  DOMAINS,
  retiredHoldCodes,
  approvedHeldRecords,
  entityKey,
  domainOf,
  canonical,
  digest,
  populated,
  compareKeys,
  domainPath,
  domainContract,
  bindingPaths,
  decisionFileName,
  bindings,
  leafPaths,
  valuesAt,
  selectorTemplates,
  draftSelectorDescendantStubs,
  assertPureBuilder,
  templateKey,
  applicabilityKey,
  outputApplicability,
  builderHold,
  planDecisionIds,
  canaryEligible,
  INVENTORY_SCHEMA_VERSION,
  inventory,
  cover,
  mappingRows,
  validApproval,
  validate
};
