'use strict';

// The field-mapping example pass as toolkit code. Codegen used to write three
// files for it every run (scripts/examples-adapter.cjs, run-field-mapping-examples.js and
// write-example-results.js; 3-4 fix rounds per run). The toolkit now ships them:
//
//   createExampleExecute({ projectDir, plan })  the `execute` adapter runFieldMappingExamples calls:
//       builds the record with the importer's own build (the project's scaffold handler, else
//       buildFromPlan with the entity's hooks) and sends it through the writer the plan's reviewed
//       operation names, on the runner's isolated capture client
//   runProjectExamplePass({ projectDir })        one call: the pass, the "Field mapping examples"
//       section in execution/review/import-plan.md, and the captureRef for artifact-freshness
//
// Modules come from the project's vendored src/ (what the importer runs), else from the toolkit.
// No configuration, credentials or live sinks are loaded; ids the dependency gate resolves at
// import time are placeholders. An entity this adapter cannot send still fails its rows with
// returnTo codegen: the fix is a toolkit change, or for one run an override in
// src/import/example-overrides.js, which is reported as a toolkit gap.

const fs = require('node:fs');
const path = require('node:path');

const TOOLKIT_ROOT = path.resolve(__dirname, '..');

function loader(projectDir) {
  // A vendored copy wins: the pass must exercise the code the importer runs.
  return (rel) => {
    const vendored = path.join(projectDir, 'src', rel);
    return require(fs.existsSync(vendored) ? vendored : path.join(TOOLKIT_ROOT, rel));
  };
}
const unwrap = (payload, key) => (payload && payload[key] && typeof payload[key] === 'object' ? payload[key] : payload);
const choicesOf = (row) => Object.fromEntries((row.choices || []).filter((c) => c && typeof c.name === 'string' && Object.hasOwn(c, 'value')).map((c) => [c.name, c.value]));
const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]/g, '-');

function createExampleExecute({ projectDir, plan, sourceSiteHost = null }) {
  const src = loader(projectDir);
  const { buildFromPlan, applies } = src('lib/plan-builder.js');
  const writers = src('resources/rp-target-wix/lib/wix-writers.js');
  const sourceArchive = src('resources/rp-target-wix/lib/source-archive.js');
  const shipping = src('resources/rp-target-wix/lib/shipping-build.js');
  const orderSteps = src('lib/order-loop-steps.js');
  const { importOrderHistory } = src('resources/rp-target-wix/lib/order-history.js');
  const { SENDS } = src('lib/record-sends.js');

  // Absent file: none. A file that exists but fails to load (even a missing nested require) throws.
  const optional = (file) => (fs.existsSync(file) ? require(file) : null);
  const hooksFor = (entity) => (optional(path.join(projectDir, 'src/import/hooks', `${safeName(entity)}.js`)) || {}).HOOKS || {};
  // The project's own handler for the entity, when it has one: its buildFor is the importer's build.
  const handlerFor = (entity) => optional(path.join(projectDir, 'src/import/handlers', `import-${safeName(entity)}.js`));
  const builders = new Map();
  const buildOf = (entity) => {
    if (!builders.has(entity.sourceEntity)) {
      const handler = handlerFor(entity.sourceEntity);
      let build = null;
      if (handler && typeof handler.buildFor === 'function') build = handler.buildFor.length >= 2 || Array.isArray(handler.SOURCES) ? handler.buildFor(plan, entity.sourceEntity) : handler.buildFor(plan);
      builders.set(entity.sourceEntity, build || buildFromPlan(entity, { hooks: hooksFor(entity.sourceEntity), choices: choicesOf(entity) }));
    }
    return builders.get(entity.sourceEntity);
  };
  // Stand-ins for the ids the dependency gate resolves at import time.
  const ref = (target, key) => `example-${String(target).replace(/\W+/g, '-')}-${String(key).replace(/\W+/g, '-')}`;
  // contactByEmail: the runtime's own email index (the crm/contact producer task's extracts,
  // customers first, then derived guest rows) for the task that binds the entity, so a review
  // author resolves exactly when the import would find it. No manifest or no matching row: undefined.
  const manifest = (() => { try { return src('lib/execution-manifest.js').withDerivedKeyPrefixes(JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'))); } catch { return null; } })();
  const emailIndexes = new Map();
  const contactKeyByEmail = (sourceEntity) => {
    if (!emailIndexes.has(sourceEntity)) {
      const emailIndex = src('lib/import-task-runner.js').contactEmailIndex || require('./import-task-runner.js').contactEmailIndex;
      const task = (manifest?.tasks || []).find((t) => (t.sourceBindings || []).some((b) => b.sourceEntity === sourceEntity && b.role !== 'source-archive'));
      emailIndexes.set(sourceEntity, task ? emailIndex(projectDir, manifest, task) : () => null);
    }
    return emailIndexes.get(sourceEntity);
  };
  const lookupsOf = (entity) => ({ ref, contactByEmail: (email) => { const key = contactKeyByEmail(entity.sourceEntity)(email); return key ? ref('crm/contact', key) : undefined; } });

  // Writers the plan's reviewed operation names, for targets a toolkit composite sends (no fixed
  // record send). Anything else: the toolkit's record send for the target, then the writer itself.
  const SEND = {
    createStoresProduct: (wix, p) => writers.createStoresProduct(wix, p.product),
    bulkUpsertContacts: (wix, p) => writers.bulkUpsertContacts(wix, [p.contact]),
    importOrder: (wix, p) => writers.importOrder(wix, p.order),
    buildCreateStoresProductTagRequest: (wix, p) => wix.send(writers.buildCreateStoresProductTagRequest(p.tag ? p.tag.name : p.name)),
    createCoupon: (wix, p) => { const { loopInput, ...spec } = p.coupon || p; return writers.createCoupon(wix, spec); },
    ensureDeliveryRegion: (wix, p) => (p.deliveryRegion ? writers.ensureDeliveryRegion(wix, p.deliveryRegion) : undefined),
    // A record the plan does not apply the customization to builds an empty body: nothing to send.
    createStoresCustomization: async (wix, p) => { const c = p.customization || p; if (c && c.name) await writers.createStoresCustomization(wix, { customization: c }); },
    importMedia: (wix, p) => writers.importMedia(wix, { sourceUrl: p.url ?? p.sourceUrl, displayName: p.displayName, mimeType: p.mimeType, mediaType: p.mediaType, wpId: p.externalInfo && p.externalInfo.externalId }),
    createForm: (wix, p, record) => {
      const fields = (record.properties && record.properties.form && record.properties.form.fields) || [];
      const sourceFieldTargets = Object.fromEntries(fields.filter((f) => f && f.name && f.basetype !== 'submit').map((f) => [f.name, String(f.name).replace(/[^A-Za-z0-9_]/g, '_')]));
      return writers.createForm(wix, { form: unwrap(p, 'form'), sourceFieldTargets, sourceFormId: record.id ?? record.ID });
    },
    // A tax rate's region and default groups are found or created by its composite at import time
    // (lib/import-composites-tax.js); the example send stands in their ids.
    createManualTaxMapping: (wix, p) => { const m = unwrap(p, 'manualTaxMapping'); return writers.createManualTaxMapping(wix, { ...m, taxRegionId: m.taxRegionId || 'example-tax-region', taxGroupId: m.taxGroupId || 'example-default-tax-group' }); },
    // The bulk review writer takes records ({ review, sourceStableKey }), not a bare review.
    createStoresReviews: (wix, p, record) => writers.createStoresReviews(wix, { records: [{ review: unwrap(p, 'review'), sourceStableKey: String(record.id ?? record.ID ?? 'example') }] }),
    // The post composite converts the HTML (read-only, answered below) and creates the draft; the
    // publish stage's page and image fetches are not run.
    createDraftPost: async (wix, p, record, loopInput) => {
      const draft = unwrap(p, 'draftPost');
      const html = String((loopInput || {}).contentHtml || '');
      const richContent = html.trim() ? await writers.convertHtmlToRichContent(wix, html) : null;
      const { heroImage, seoSlug, slug, ...fields } = draft;
      return wix.send(writers.buildCreateBuildDraftPostRequest({ ...fields, ...((seoSlug || slug) ? { seoSlug: seoSlug || slug } : {}), memberId: draft.memberId || 'example-blog-owner-member', ...(richContent ? { richContent } : {}) }));
    },
  };
  const HISTORY_OPS = new Set(['writeOrderPayment', 'ensureOrderPaymentAndRefund']);
  const SKIP = new Set(['insertDataItem', 'createShippingOptionVerified', ...HISTORY_OPS]);
  async function sendOperation(wix, op, entity, built, input, loopInput) {
    if (SEND[op]) return SEND[op](wix, built, input, loopInput);
    const fixed = SENDS[entity.targetRef];
    if (fixed && typeof fixed.send === 'function') return fixed.send(wix, built, input);
    if (typeof writers[op] === 'function') return writers[op](wix, built);
    throw Object.assign(new Error(`the example pass has no send for ${op} (${entity.sourceEntity})`), { code: 'example_send_missing' });
  }

  // The few read-only answers the reviewed writers ask for before they write, as a fresh site. A
  // writer whose reviewed endpoint is two calls is named on the request carrying its fields.
  const EXAMPLE_PROFILE = { id: 'example-delivery-profile', default: true, revision: '1', deliveryRegions: [] };
  const WRITER_REQUESTS = [
    ['writeOrderPayment', 'POST', /\/ecom\/v1\/payments\/orders\/[^/]+\/add-payment$/],
    ['ensureOrderPaymentAndRefund', 'POST', /\/ecom\/v1\/order-billing\/refund-payments$/],
    ['ensureDeliveryRegion', 'POST', /\/ecom\/v1\/delivery-profiles\/[^/]+\/delivery-region$/],
    ['ensureDeliveryRegion', 'PATCH', /\/ecom\/v1\/delivery-profiles\/[^/]+\/delivery-region\/[^/]+$/],
  ];
  const withReadAnswers = (wix) => Object.freeze({ dryRun: true, send: async (request) => {
    const url = String((request && request.url) || '').split('?')[0];
    const method = String(request.method).toUpperCase();
    if (/\/ecom\/v1\/delivery-profiles\/query$/.test(url)) return { deliveryProfiles: [EXAMPLE_PROFILE] };
    if ((request.readOnly === true || method === 'GET') && /\/contacts\/v5\/contacts\/find-matching/.test(url)) return { contacts: [] };
    // The HTML-to-Ricos converter is stateless and read-only: one paragraph per HTML block.
    if (method === 'POST' && /\/ricos\/v1\/ricos-document\/convert\/to-ricos$/.test(url)) {
      const blocks = String((request.body || {}).html || '').split(/<\/(?:p|div|h[1-6]|li|blockquote|pre|figure|table|tr)>/i).map((b) => b.replace(/<[^>]*>/g, '').trim()).filter(Boolean);
      return { document: { nodes: blocks.map((text, i) => ({ type: 'PARAGRAPH', id: `n${i}`, nodes: [{ type: 'TEXT', id: '', nodes: [], textData: { text, decorations: [] } }], paragraphData: {} })) } };
    }
    const writer = WRITER_REQUESTS.find(([, m, pattern]) => method === m && pattern.test(url));
    return wix.send(writer && !request.operation ? { ...request, operation: writer[0] } : request);
  } });
  const memoryCrosswalk = () => {
    const orders = new Map(), invoices = new Map();
    return { get: async (id) => orders.get(String(id)) || null, set: async (id, orderId) => { orders.set(String(id), orderId); }, getInvoiceFile: async (id) => invoices.get(String(id)) || null, setInvoiceFile: async (id, fileId) => { invoices.set(String(id), fileId); } };
  };
  // The order id is namespaced by the source host; a project with no recorded source URL gets a
  // stand-in (prepared requests only, nothing is written).
  const host = sourceSiteHost || (() => { try { return new URL(JSON.parse(fs.readFileSync(path.join(projectDir, 'source-schema.json'), 'utf8')).sourceUrl).host; } catch { return null; } })() || 'source.example.invalid';
  const nativeKey = (record, entity) => String(record[entity.primaryKey || 'id']);

  async function sendArchive(wix, entity, input) {
    const planned = sourceArchive.planSourceArchive({
      plan: { ...plan, entities: [entity] },
      readRecords: () => [input],
      identity: (row, record) => ({ sourceKey: nativeKey(record, row), wixId: null, name: String(record.name || record.title || record.number || record.email || record.code || record.slug || nativeKey(record, row)) }),
    });
    const findings = [];
    for (const archived of planned.entities) {
      for (const item of sourceArchive.archiveWriteBatches(archived.items).flat()) await writers.insertDataItem(wix, archived.collectionId, item);
      if (archived.recordsArchived === false) for (const n of archived.notKept || []) findings.push({ code: n.reasonCode, path: n.path });
    }
    return findings;
  }
  async function sendShippingOptions(wix, input, regionId) {
    const resolved = src('resources/rp-source-wordpress/wix-map/shipping-zone.builder.js').zoneShippingOptions(input);
    for (const option of (resolved && resolved.values && resolved.values.shippingOptions) || []) {
      await writers.createShippingOptionVerified(wix, shipping.buildShippingOptionInput(option.classified, { deliveryRegionId: regionId, rates: option.rates }));
    }
  }

  async function execute({ sourceEntityRef, decisionId, input, wix: isolated }) {
    const wix = withReadAnswers(isolated);
    const entity = (plan.entities || []).find((row) => row.sourceEntity === sourceEntityRef);
    const decision = (entity.fieldMappings || []).find((row) => row.id === decisionId);
    const ops = [...new Set((decision.outputs || []).map((output) => output.writeOperation))];
    // An archive-only entity (cms/data-item) has nothing to build: the archive planner is its build.
    if (entity.targetRef === 'cms/data-item') return { findings: await sendArchive(wix, entity, input) };
    const built = await buildOf(entity)(input, lookupsOf(entity));
    if (built && (built.status === 'held' || built.deferred)) return { findings: (built.holds || [{ code: built.reason || 'deferred' }]).map((hold) => ({ code: hold.code || hold.reason || 'held' })) };
    const { loopInput, ...body } = built || {};
    const findings = [...(Array.isArray(body.findings) ? body.findings : []), ...((loopInput && Array.isArray(loopInput.findings)) ? loopInput.findings : [])];
    if (ops.length && !decision.outputs.some((output) => applies(output.appliesWhen, input))) return { findings };
    if (ops.includes('insertDataItem')) findings.push(...await sendArchive(wix, entity, input));
    if (ops.some((op) => HISTORY_OPS.has(op))) {
      const history = await importOrderHistory(wix, { order: orderSteps.bodyForImport(body.order), sourceId: nativeKey(input, entity), sourceSiteHost: host,
        evidence: (loopInput || {}).evidence, crosswalk: memoryCrosswalk(), setupVerification: null, buyer: (loopInput || {}).buyer ?? null });
      const outcome = history && history.outcomes && history.outcomes.payment;
      if (typeof outcome === 'string' && /^payment-not-written/.test(outcome)) findings.push({ code: outcome });
    }
    if (ops.includes('createShippingOptionVerified')) await sendShippingOptions(wix, input, 'example-delivery-region');
    const historySent = ops.some((op) => HISTORY_OPS.has(op));
    for (const op of ops.filter((o) => !SKIP.has(o) && !(o === 'importOrder' && historySent))) await sendOperation(wix, op, entity, body, input, loopInput);
    // The built body, so the pass can tell a value the builder wrote from one a fixed writer added.
    return { findings, built: body };
  }
  // One write operation's example send on a built body (tests: every suggested operation has one).
  // Operations in `sentElsewhere` run through their own path above (archive, shipping, history).
  execute.send = (wix, op, targetRef, body, input = {}, loopInput = null) => sendOperation(withReadAnswers(wix), op, { sourceEntity: 'example', targetRef }, body, input, loopInput);
  execute.sentElsewhere = SKIP;
  return execute;
}

// The whole pass for a project: run it on the pinned plan, write the results section into the
// import plan, return the summary (captureRef goes to `artifact-freshness.js write --example-capture`).
async function runProjectExamplePass({ projectDir, mappingPlanDigest = null, executeOverride = null, sampleCap } = {}) {
  const { runFieldMappingExamples, renderExampleResults } = require('./field-mapping-examples.js');
  const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(projectDir, rel), 'utf8'));
  const plan = readJson('mapping/mapping-plan.json');
  let pinned = mappingPlanDigest;
  if (!pinned) { try { pinned = readJson('execution/execution-manifest.json').mappingPlanDigest || null; } catch { pinned = null; } }
  if (!pinned) throw Object.assign(new Error('no pinned mapping digest: execution/execution-manifest.json has no mappingPlanDigest (pass --digest)'), { code: 'EXAMPLE_PASS_NO_PIN' });
  const execute = createExampleExecute({ projectDir, plan });
  const overrides = executeOverride || loadOverrides(projectDir);
  // Shared rule: every in-run override is one toolkit gap (step, file, why) in the pass result,
  // the import-plan section and execution/toolkit-gaps.json (completion report); never an operator task.
  const toolkitGaps = Object.entries(overrides).map(([entity, o]) => ({ code: 'toolkit_gap', step: `field-mapping-examples:${entity}`, file: OVERRIDES_PATH, why: o.why }));
  const messages = new Map();
  const traced = async (args) => {
    const own = Object.hasOwn(overrides, args.sourceEntityRef) ? overrides[args.sourceEntityRef].execute : null;
    try { return await (own ? own(args, execute) : execute(args)); } catch (error) {
      const key = `${args.sourceEntityRef}/${args.decisionId}`;
      if (!messages.has(key)) messages.set(key, `${error.code ? `${error.code}: ` : ''}${String(error.message).split('\n')[0].slice(0, 300)}`);
      throw error;
    }
  };
  const result = await runFieldMappingExamples({ projectDir, plan, mappingPlanDigest: pinned, execute: traced, toolkitGaps, ...(sampleCap ? { sampleCap } : {}) });
  // The run's toolkit-gap file (lib/toolkit-gaps.js) feeds the completion report's toolkitGaps;
  // this pass rewrites its own rows every time, so a removed override stops being reported.
  require('./toolkit-gaps.js').recordToolkitGaps(projectDir, 'example-pass', toolkitGaps);
  const planFile = path.join(projectDir, 'execution/review/import-plan.md');
  const text = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : '';
  const at = text.indexOf('\n## Field mapping examples');
  const base = (at === -1 ? text : text.slice(0, at)).replace(/\s*$/, '\n');
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, `${base}\n${renderExampleResults(result)}`);
  const counts = {};
  for (const row of result.rows) counts[row.status] = (counts[row.status] || 0) + 1;
  const groups = new Map();
  for (const row of result.rows.filter((r) => r.status === 'failed')) {
    const key = `${row.sourceEntityRef}/${row.decisionId}`;
    const g = groups.get(key) || { entity: row.sourceEntityRef, decisionId: row.decisionId, returnTo: row.returnTo || 'codegen', rows: 0, reason: row.reason, error: messages.get(key) || null, exampleIds: [] };
    g.rows += 1;
    if (g.exampleIds.length < 3) g.exampleIds.push(row.exampleId);
    groups.set(key, g);
  }
  return { passId: result.passId, ok: result.ok, captureRef: result.captureRef, resultRef: `state/attempts/field-mapping-examples/${result.passId}.result.json`,
    counts, mappingQuestions: result.mappingQuestions, failures: [...groups.values()], importPlan: 'execution/review/import-plan.md',
    toolkitGaps };
}

// The per-run override: src/import/example-overrides.js exports
// { [sourceEntity]: { why, execute(args, toolkitExecute) } } for any toolkit-side gap in the pass.
// Absent file: no overrides. A file that fails to load, or an entry without a function and a
// reason, throws: an override is never dropped silently.
const OVERRIDES_PATH = 'src/import/example-overrides.js';
function loadOverrides(projectDir) {
  const file = path.join(projectDir, OVERRIDES_PATH);
  if (!fs.existsSync(file)) return {};
  let loaded;
  try { loaded = require(file); } catch (error) {
    throw Object.assign(new Error(`${OVERRIDES_PATH} failed to load: ${String(error.message).split('\n')[0]}`), { code: 'EXAMPLE_OVERRIDE_INVALID', cause: error });
  }
  const out = {};
  for (const [entity, o] of Object.entries(loaded || {})) {
    if (!o || typeof o.execute !== 'function' || typeof o.why !== 'string' || !o.why.trim()) {
      throw Object.assign(new Error(`${OVERRIDES_PATH}: ${entity} must be { why: '<the toolkit gap>', execute(args, toolkitExecute) }`), { code: 'EXAMPLE_OVERRIDE_INVALID' });
    }
    out[entity] = { why: o.why.trim(), execute: o.execute };
  }
  return out;
}

module.exports = { createExampleExecute, runProjectExamplePass, loadOverrides, OVERRIDES_PATH };
