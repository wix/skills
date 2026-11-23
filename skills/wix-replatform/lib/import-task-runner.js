'use strict';

// The per-record import pass every store shares. Generated code supplies only the
// store-specific parts -- `build` (the reviewed pure mapping), `send` (the reviewed writer call)
// and, where the target can be searched, `reconcile` -- and this runner does the rest the same
// way for every store:
//
// - A decided builder hold (`{ status: 'held', holds }`) is deferred by the gate with its reasons
//   and never sent; it cannot crash the pass or make the batch's grants stale.
// - A same-entity tree (target knowledge `sameTaskReferenceFields`, e.g. a category's
//   `parentCategory.id`) runs one depth level at a time, parents first. The parent's source field
//   comes from the accepted mapping output for that target path, and its Wix id only from the
//   gate's same-task resolver, i.e. from this task's own landed crosswalk row. A child whose
//   parent did not land (missing, failed, held, on a cycle) still imports, without the parent
//   link, recorded as a finding and a cutover item. It is never held or refused for it.
// - An earlier attempt whose outcome is unknown (`started` with no terminal row, or
//   `succeeded_unverified`) is looked up first and adopted when exactly one match is found.
//   Otherwise it is created; when the lookup could not rule the earlier write out, the possible
//   duplicate is recorded as a finding and a cutover item. It is never parked.
// - Every attempted record leaves a terminal journal row. A refusal before any byte left is a
//   known non-write; an error after the request may have left is unresolved, never a failure, so
//   a resume reads it back instead of creating a duplicate.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readiness = require('./dependency-readiness');
const capability = require('./execution-capability');
const local = require('./local-state');
const planUpdate = require('./plan-update-pass');
const { builderHold } = require('./read-back-contract');
const { readEntityMappings } = require('./website-handoff');
const { depthLevels } = require('../resources/rp-target-wix/lib/same-entity-hierarchy');
const multiStep = require('./multi-step-attempt');

const UNKNOWN_OUTCOME = new Set(['started', 'succeeded_unverified']);

function at(record, dotted) { return String(dotted).split('.').reduce((value, key) => value?.[key], record); }
function setAt(body, dotted, value) {
  const keys = String(dotted).split('.'), last = keys.pop();
  let cursor = body;
  for (const key of keys) cursor = cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {});
  cursor[last] = value;
}
const noParent = value => value === undefined || value === null || value === '' || value === 0 || value === '0';

// Target stores whose records can be found again by what was sent. Each returns
// { targetId } when exactly one match exists, null only when none can exist, undefined when it
// cannot tell.
const RECONCILERS = {
  'cms/data-item': async (recordClient, payload) => {
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    const collectionId = payload?.collectionId;
    const sourceKey = payload?.dataItem?.data?.sourceKey;
    if (!collectionId || !sourceKey) return undefined;
    let matches = await writers.queryDataItemsBySourceKey(recordClient, collectionId, sourceKey);
    // Archive rows emitted before this fix called the same identity `parentKey` and
    // did not carry `sourceKey`. Reconcile those rows too, so the first fixed resume
    // adopts a landed item (or reports ambiguity) instead of adding another one.
    if (!matches.length && String(sourceKey).startsWith('archive:')) {
      matches = await writers.queryDataItemsBySourceKey(recordClient, collectionId, String(sourceKey).slice('archive:'.length), { sourceField: 'parentKey' });
    }
    if (matches.length !== 1) return matches.length === 0 ? null : undefined;
    const targetId = writers.dataItemId(matches[0]);
    return targetId ? { targetId } : undefined;
  },
  // Lost media-import reply: exact sourceUrl match among same-name files. Never null, because an
  // empty search cannot rule out a fresh import the index has not caught up with.
  'media/media-file': async (recordClient, payload) => {
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    return writers.findImportedMediaFile(recordClient, payload);
  },
  // A blog tag label is unique on a site: exactly one tag with the label is the one written.
  'blog/tag': async (recordClient, payload) => {
    const label = typeof payload?.label === 'string' ? payload.label : null;
    if (!label) return undefined;
    const hits = (await require('../resources/rp-target-wix/lib/wix-writers').listBlogTags(recordClient)).filter(tag => tag.label === label);
    return hits.length === 1 && hits[0].id ? { targetId: String(hits[0].id) } : hits.length ? undefined : null;
  },
  'stores/category': async (recordClient, payload) => {
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    const want = payload?.category || payload || {};
    const parent = want.parentCategory?.id || null;
    const named = (await writers.queryAllStoresCategories(recordClient)).filter(c => c.name === want.name);
    const hits = named.filter(c => (c.parentCategory?.id || null) === parent);
    if (hits.length === 1) return { targetId: hits[0].id };
    // Absence is proven only when no category has this name: a same-name category under another
    // parent may be this record written earlier without its link.
    return named.length ? undefined : null;
  },
};

// The one same-task parent field of this task's entity, and the source path the accepted mapping
// feeds it from. No mapped source path means the records are written flat (no parent is sent).
// Two mapped source fields cannot be ordered: the records are written flat and each record with a
// parent value is recorded as unlinked (`ambiguous` lists the candidates).
function hierarchyOf(task, binding, plan) {
  const fields = readiness.sameTaskReferenceFields(task.entityRefs).filter(field => field.ref === binding.ref);
  if (!fields.length) return null;
  const row = readEntityMappings(plan || {}).find(row => row.sourceEntity === binding.sourceEntity && (row.targetRef || binding.ref) === binding.ref);
  const mapped = [];
  for (const field of fields) for (const decision of row?.fieldMappings || []) for (const output of decision.outputs || []) {
    if (output.targetRef !== field.ref || ![output.targetPath, require('./writer-request-shape.js').recordPath(output), [output.writeInput, output.targetPath].filter(Boolean).join('.')].includes(field.template)) continue;
    const sourcePath = (output.sourcePaths || decision.sourcePaths || [])[0];
    if (sourcePath) mapped.push({ ...field, sourcePath });
  }
  const unique = [...new Map(mapped.map(field => [`${field.template}\u0000${field.sourcePath}`, field])).values()];
  if (unique.length > 1) return { ambiguous: unique };
  return unique[0] || null;
}

// CMS Data v2 has a server-assigned `dataItem.id`. Keep the source identity in the
// item itself so a lost reply can be reconciled by an exact query. This is applied
// centrally because CMS archive builders and CMS fallback builders are both generated
// independently and must share the same maybe-written rule.
function decorateCmsDataItemPayload(ref, payload, sourceKey) {
  if (ref !== 'cms/data-item' || !payload?.collectionId || !payload.dataItem || !payload.dataItem.data || typeof payload.dataItem.data !== 'object') return payload;
  return { ...payload, dataItem: { ...payload.dataItem, data: { ...payload.dataItem.data, sourceKey } } };
}

// The lookups handed to build: the gate's resolvers, plus `ref(ref, key, path)`, which picks the
// resolver from the task's own edge for that ref. Generated code never chooses a lookup mode: a
// per-record lookup on a task-complete edge stopped every product on 11-15 (REFERENCE_UNDECLARED).
// `contactByEmail(email, path)`: the contact a source email names (a review's author), found by the
// loop in the crm/contact producer task's own extracts, customers first, then guest rows; then
// looked up like any other ref. Undefined when no contact row has that email.
function lookupsFor(task, resolvers, { contactKeyByEmail = () => null } = {}) {
  const sameTask = new Set(readiness.sameTaskReferenceFields(task.entityRefs).map(field => field.ref));
  const ref = (target, key, concrete) => {
    if (sameTask.has(target)) return resolvers.resolveSameTaskReference(target, key, concrete);
    const edge = (task.dependencyEdges || []).find(row => row.ref === target);
    if (edge?.producer?.kind === 'setup-step') return resolvers.resolveSetupReference(target, key, concrete);
    if (edge?.mode === 'task-complete') return resolvers.resolveTaskReference(target, key, concrete);
    return resolvers.resolveReference(target, key, concrete);
  };
  const contactByEmail = (email, concrete) => { const key = contactKeyByEmail(email); return key ? ref('crm/contact', key, concrete) : undefined; };
  return { ...resolvers, ref, contactByEmail };
}

// Source email → crm/contact source key, from the producer task's bindings (main binding first,
// then derived guest rows). Built once per pass; nothing is read until a build asks.
const emailOf = row => String(row?.email || row?.contact?.email?.email || row?.contact?.emails?.items?.[0]?.email || row?.billing?.email || '').trim().toLowerCase();
function contactEmailIndex(projectDir, manifest, task) {
  let index = null;
  return email => {
    const wanted = String(email || '').trim().toLowerCase();
    if (!wanted) return null;
    if (!index) {
      index = new Map();
      const producer = (task.dependencyEdges || []).find(edge => edge.ref === 'crm/contact')?.producer;
      const source = (manifest?.tasks || []).find(row => row.id === producer?.taskId);
      const bindings = (source?.sourceBindings || []).filter(binding => binding.ref === 'crm/contact' && binding.role !== 'source-archive')
        .sort((a, b) => Number(Boolean(a.role)) - Number(Boolean(b.role)));
      for (const binding of bindings) {
        if (!fs.existsSync(path.join(projectDir, binding.extractPath))) continue;
        for (const row of readExtract(projectDir, binding.extractPath)) {
          const key = emailOf(row);
          if (key && !index.has(key)) index.set(key, `${binding.keyPrefix}${at(row, binding.keyField || 'id')}`);
        }
      }
    }
    return index.get(wanted) || null;
  };
}

// Several Wix calls per record, for the entities whose writes the toolkit already owns as
// composites. Generated code gives only `build`; the loop sends through the composite and its
// follow-up steps. Each composite reconciles on its own (marker, find-matching, derived id), so a
// retry never creates a duplicate. `build` may return `loopInput` next to the Wix body: data the
// steps need that is not part of the gated body (variant keys, stock, payment evidence).
//
// A step result: { base: { targetId, outcome, error, writeAttempted, unverified }, steps: { <stage>: 'done' | <failed outcome> }, findings }.
const STEP_DONE = 'done';
const orderSteps = require('./order-loop-steps');
const PRODUCT_STEPS = ['create', 'media', 'categories', 'stock'];
const primitiveDefaults = {
  importProducts: (...args) => require('../resources/rp-target-wix/lib/product-import').importProducts(...args),
  attachCategories: (client, rows) => require('../resources/rp-target-wix/lib/stores-category-attach').reconcileCategoryAttachment(client, rows),
  setStock: async (client, { targetId, stock }) => {
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    const target = await writers.getStoresProductForVerification(client, targetId);
    const rows = writers.registerImportInventoryScope(client, stock, target);
    return require('../resources/rp-target-wix/lib/stores-inventory').reconcileInventory(client, rows, { expectedCount: rows.length });
  },
  writeCustomization: (client, payload) => writeCustomization(client, payload),
  // The source's media read for the WordPress-family picture guard (authenticated, read-only).
  sourceMedia: async projectDir => {
    const env = await require('./config-env').readEnvFile(path.join(projectDir, 'config', 'source.wordpress.env'));
    for (const key of ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD']) if (!env[key] && process.env[key]) env[key] = process.env[key];
    const http = require('../resources/rp-source-wordpress/lib/wp-http');
    const headers = http.buildHeaders({ username: env.WP_USERNAME, applicationPassword: env.WP_APPLICATION_PASSWORD });
    return { baseUrl: env.WP_BASE_URL, request: (baseUrl, route, options) => http.fetchJson(baseUrl, route, { headers, ...options }) };
  },
  patchMedia: (client, payload) => require('../resources/rp-target-wix/lib/wix-writers').patchStoresProductMediaVerified(client, payload),
  importContacts: (...args) => require('../resources/rp-target-wix/lib/contact-import').importContacts(...args),
  importOrderHistory: (...args) => require('../resources/rp-target-wix/lib/order-history').importOrderHistory(...args),
  orderCrosswalk: options => require('../resources/rp-target-wix/lib/order-history').createProjectOrderCrosswalk(options),
  resolveOrderBuyer: (...args) => require('../resources/rp-target-wix/lib/order-buyer').resolveOrderBuyer(...args),
  memberCrosswalk: options => require('./member-crosswalk').createProjectMemberCrosswalk(options),
  orderCrosswalkKey: options => require('../resources/rp-target-wix/lib/order-history').orderCrosswalkKey(options),
  orderHistoryAttempt: (...args) => require('../resources/rp-target-wix/lib/order-history').orderHistoryAttempt(...args),
};
// A product's shared choices ("Any" attributes, routed to modifiers) are Stores customizations
// that must exist before the product. Build leaves each such modifier with a pending id
// (PENDING_CUSTOMIZATION + its position); the product composite writes the customization first and
// puts the written one in its place. Wix keeps one customization per name: the same name with the
// same choices is reused (409 -> lookup), never written twice; the same name with other choices
// takes the first free "<name> (n)" in order, so a rerun lands on the same group again.
const PENDING_CUSTOMIZATION = 'pending-customization:';
const MAX_CUSTOMIZATION_SUFFIX = 20;
async function writeCustomization(client, payload) {
  const writers = require('../resources/rp-target-wix/lib/wix-writers');
  const base = payload.customization.name;
  for (let n = 1; n <= MAX_CUSTOMIZATION_SUFFIX; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    try { return (await writers.createStoresCustomization(client, { customization: { ...payload.customization, name } }, { forProduct: true })).customization; }
    catch (error) { if (error?.code !== 'CUSTOMIZATION_NAME_CONFLICT') throw error; }
  }
  throw Object.assign(new Error(`customization "${base}": no free name up to (${MAX_CUSTOMIZATION_SUFFIX})`), { code: 'CUSTOMIZATION_NAME_CONFLICT' });
}
const isPendingModifier = modifier => typeof modifier?.id === 'string' && modifier.id.startsWith(PENDING_CUSTOMIZATION);
async function connectPendingModifiers(client, product, c) {
  if (!(product.modifiers || []).some(isPendingModifier)) return product;
  const { connectedModifierFromCustomization } = require('../resources/rp-target-wix/lib/wix-writers');
  const modifiers = [];
  for (const modifier of product.modifiers) {
    if (!isPendingModifier(modifier)) { modifiers.push(modifier); continue; }
    const written = await c.primitives.writeCustomization(client, { customization: { name: modifier.name, customizationType: 'MODIFIER', customizationRenderType: modifier.modifierRenderType,
      choicesSettings: { choices: (modifier.choicesSettings?.choices || []).map(choice => ({ choiceType: choice.choiceType || 'CHOICE_TEXT', name: choice.name })) } } });
    modifiers.push(connectedModifierFromCustomization(written, { mandatory: modifier.mandatory === true }));
  }
  return { ...product, modifiers };
}
const reportError = (row, fallback) => Object.assign(new Error(String(row?.error || fallback)), row?.uncertain ? { outcomeKnown: false } : {});
// importProducts' row: the body is the expectation, the slug is the marker, and each variant keeps
// the source key the order lookups use (`variantKeys`, or `<key>#default` for a single variant).
// `loopInput.seo` is the product's planProductSeo() plan: the SEO stage verifies seoData per field, so
// it leaves the expectation. `loopInput.selectionRoute` is routeRecord() of a routed product, and
// `loopInput.modifiers` its read-back expectation (selection-route.js modifierExpectation), which
// differs from the connected modifiers the body sends.
function productRow(key, record, keyField, product, { variantKeys, seo, selectionRoute, modifiers } = {}, sourceSystem, sourceEntity) {
  if (!product || typeof product !== 'object' || !product.slug) throw new Error('product build must return { product } with a slug');
  const variants = product.variantsInfo?.variants || [];
  const keys = variantKeys || (variants.length === 1 ? [`${key}#default`] : null);
  if (!Array.isArray(keys) || keys.length !== variants.length) throw new Error('product build must return loopInput.variantKeys, one per variant');
  const { variantsInfo, ...flat } = product;
  if (seo) delete flat.seoData;
  if (modifiers) flat.modifiers = modifiers;
  return { sourceKey: key, sourceId: String(at(record, keyField)), sourceSystem, sourceEntityType: sourceEntity, product, expected: JSON.parse(JSON.stringify(flat)),
    ...(seo ? { seo } : {}), ...(selectionRoute ? { selectionRoute } : {}),
    marker: { path: 'slug', value: product.slug },
    variantExpectations: variants.map((variant, index) => { const { inventoryItem, ...rest } = variant; return { sourceKey: keys[index], expected: JSON.parse(JSON.stringify(rest)) }; }) };
}
// WordPress-family product pictures: the source media record, not a URL in the body, proves the
// picture (lib/confirmed-pictures.js). The loop declares the source once, reads the media records
// for each batch, and writes a gallery only when every picture is confirmed. An unconfirmed
// gallery is left out of the create (the product still lands) and owed as the `media` step; a
// later pass confirms it again and patches it in.
const pictures = () => require('../resources/rp-target-wix/lib/wix-writers').confirmedPictures;
function sourcePlatformOf(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, 'orchestration', 'decisions.json'), 'utf8')).sourcePlatform?.value || null; } catch { return null; }
}
async function mediaGuardFor(c) {
  if (c.shared.mediaGuard) return c.shared.mediaGuard;
  const platform = sourcePlatformOf(c.projectDir);
  if (platform) pictures().declareMediaSource(platform);
  const active = pictures().declareMediaSource.requiresConfirmation();
  if (active) require('../resources/rp-target-wix/lib/wix-writers').assertProductMediaGuardActive();
  return (c.shared.mediaGuard = { active, source: null });
}
const urlItems = product => (product?.media?.itemsInfo?.items || []).filter(item => item && item.url);
function confirmGallery(product, ids, read, unreadable) {
  const items = product.media.itemsInfo.items;
  if (unreadable) return Object.freeze({ confirmed: false, pictures: [], reasons: [], reason: 'source-unreadable' });
  if (!read || !Array.isArray(ids) || ids.length !== items.length) return Object.freeze({ confirmed: false, pictures: [], reasons: [], reason: 'no-source-id' });
  return pictures().confirmPictures({ pictures: items.map((item, index) => ({ sourceId: ids[index], ...item })), read });
}

function orderCurrencyFacts(projectDir) {
  let storeCurrency = null, targetCurrency = null;
  try { const sourceRegional = require('./source-regional'); storeCurrency = sourceRegional.settingValue(sourceRegional.readSourceRegionalSync(projectDir), 'currency'); } catch { storeCurrency = null; }
  try {
    const verification = JSON.parse(fs.readFileSync(path.join(projectDir, 'setup', 'setup-verification.json'), 'utf8'));
    targetCurrency = (verification.requirements || []).find(row => row && row.regional)?.regional?.fields?.currency?.after || null;
  } catch { targetCurrency = null; }
  return { storeCurrency, targetCurrency };
}
// A task-wide hold (`{ reason, code, ... }`) only when the store or site currency is unknown or they
// differ; otherwise a per-order hold (`{ records: Map(key -> reason), ... }`) for the orders whose
// currency is not the site currency, so every site-currency order still imports.
function currencyHold(projectDir, records, keyOf) {
  if (!['woocommerce', 'wordpress'].includes(sourcePlatformOf(projectDir))) return null;
  const { storeCurrency, targetCurrency } = orderCurrencyFacts(projectDir);
  const { resolveOrderCurrency } = require('../resources/rp-source-wordpress/lib/store-currency');
  const scoped = require('../resources/rp-source-wordpress/lib/currency-gate').scopeOrderCurrencyHold({ settingsCurrency: storeCurrency, targetSiteCurrency: targetCurrency,
    orders: records.map(order => ({ key: keyOf(order), currency: resolveOrderCurrency(order, storeCurrency).currency })) });
  if (scoped.scope === 'task') {
    const gate = scoped.gate;
    if (!gate.halt) return null;
    const findings = gate.findings.map(f => f.code).join(', ') || gate.outcome;
    return { reason: `currency-gate:${gate.outcome}`, code: `order-currency-gate-${gate.outcome}`, severity: 'high',
      detail: { storeCurrency: gate.storeCurrency || 'unknown', siteCurrency: gate.targetCurrency || 'unknown', orderCurrencies: (gate.distinctOrderCurrencies || []).join(' ') || 'none' },
      action: `Every order of this task was held before any write: the order currency check found ${gate.outcome} (${findings}). Complete site setup (site locale) so the site currency is read and matches the store currency, confirm every order is in that currency, then rerun the order import. No order was written, so nothing needs to be removed.` };
  }
  if (!scoped.held.length) return null;
  const reason = 'currency-gate:order-not-site-currency';
  const counts = Object.entries(scoped.heldCounts).sort(([a], [b]) => a.localeCompare(b));
  const names = counts.map(([code]) => code).join('/');
  return { records: new Map(scoped.held.map(({ key, currency }) => [key, { reason, currency }])), reason, code: 'order-currency-not-site-currency', severity: 'high',
    detail: { siteCurrency: scoped.siteCurrency, heldCurrencies: counts.map(([code, n]) => `${code} ${n}`).join(', '), siteCurrencyOrders: scoped.importable },
    // Honest and exact: no option exists yet for a foreign-currency order, so the item names the
    // orders and where they stay, and asks for no re-run (a re-run would hold the same orders).
    action: `${scoped.held.length} orders in ${names} were not imported: the site currency is ${scoped.siteCurrency}, and importing orders in another currency is not supported yet. The ${scoped.importable} orders in ${scoped.siteCurrency} are imported as usual. The held orders are not in Wix; they remain in the source store and in the migration project's order extract (data/source-extract/order.ndjson). Nothing to do in Business Manager; a re-run holds the same orders.` };
}

// Each composite writes its own crosswalk row. `crosswalkKey` is the key that row carries, from the
// same function the writer uses, so the loop's skip and resume check finds what the composite wrote.
// Products and contacts publish under the row key the loop hands them (`sourceKey` = the binding key).
const orderCrosswalkOptions = (record, c) => ({ projectDir: c.projectDir, sourceSystem: c.sourceSystem, sourceEntityType: c.sourceEntity, sourceId: String(at(record, c.keyField)) });
// A recorded plan choice (fieldMappings[].choice, design v2 B1) by name: its value, or null.
function planChoice(plan, name) {
  for (const row of readEntityMappings(plan || {})) for (const decision of row?.fieldMappings || []) if (decision?.choice?.name === name) return decision.choice.value ?? null;
  return null;
}

const MEDIA_FILE_REFUSED = 'media-file-refused';
const MEDIA_FILE_REFUSED_ACTION = 'Wix refused to import these media files from their source URL (file types the Media Manager import does not take this way, for example SVG or ZIP). They are not on the new site; products and posts that use them were imported without them. If a file is needed, download it from the old site and upload it in Business Manager > Media Manager, then add it where it is used. Otherwise no action.';

// A media file Wix refused with a readable 4xx (not 408 or 429) on at least two runs on this site
// is not re-sent: Wix refuses the same file the same way (SVG, ZIP, video by URL). Its latest row
// must still be that refusal or the deferred row this rule wrote; anything else (an import, or a
// different failure) releases it. Returns key -> { httpStatus, refusedRuns }.
function mediaRefusedForGood(taskRows, latest, siteId) {
  const runs = new Map(), status = new Map();
  for (const row of taskRows) {
    const http = row?.failure?.httpStatus;
    if (row?.status !== 'failed_terminal' || row.failure?.errorCode !== MEDIA_FILE_REFUSED || (row.siteId && row.siteId !== siteId)
      || !Number.isInteger(http) || http < 400 || http >= 500 || http === 408 || http === 429) continue;
    if (!runs.has(row.sourceStableKey)) runs.set(row.sourceStableKey, new Set());
    runs.get(row.sourceStableKey).add(row.runId); status.set(row.sourceStableKey, http);
  }
  const out = new Map();
  for (const [key, ids] of runs) {
    const last = latest.get(key);
    const still = last?.status === 'failed_terminal' ? last.failure?.errorCode === MEDIA_FILE_REFUSED : last?.status === 'deferred' && last.deferral?.reason === MEDIA_FILE_REFUSED;
    if (ids.size >= 2 && still) out.set(key, { httpStatus: status.get(key), refusedRuns: ids.size });
  }
  return out;
}

// Contact values Wix refused, or a phone two people share (contact-import droppedValues): the
// contact imported without it; one grouped cutover item per kind.
const CONTACT_DROPPED_GAPS = Object.freeze({
  'email:refused-by-wix': { code: 'contact-email-refused', action: 'These contacts were imported without their email because Wix refused the source value as not a valid email address (for example it starts with a dot). Each contact is listed with its targetId. If you know the correct address, add it to the contact in Business Manager > Contacts; otherwise no action.' },
  'phone:refused-by-wix': { code: 'contact-phone-refused', action: 'These contacts were imported without their phone because Wix refused the source value as not a valid phone number. Each contact is listed with its targetId. If you know the correct number, add it to the contact in Business Manager > Contacts; otherwise no action.' },
  'phone:phone-shared-with-another-contact': { code: 'contact-phone-shared', action: 'These contacts share a phone number with a contact that was already on the site (another email). Wix would have merged them by phone, so the phone was left off these contacts to keep the two people separate. No action unless the phone should be on this contact instead; then move it in Business Manager > Contacts.' },
});

const COMPOSITES = {
  'stores/product': {
    operation: 'createStoresProduct', steps: PRODUCT_STEPS, crosswalkKey: (record, c) => c.key,
    // One media read per batch for every picture its products name (`loopInput.pictureSourceIds`).
    async prepareBatch(items, c) {
      const guard = await mediaGuardFor(c);
      if (!guard.active) return;
      const ids = items.flatMap(item => (item.loopInput?.pictureSourceIds || []));
      c.shared.mediaRead = null; c.shared.mediaUnreadable = false;
      if (!ids.length) return;
      // A source that cannot be read leaves the pictures out (owed as `media-source-unreadable`);
      // it never stops the products.
      try {
        guard.source ||= await c.primitives.sourceMedia(c.projectDir);
        c.shared.mediaRead = await pictures().readSourceMediaRecords({ ids, source: guard.source });
      } catch (error) { if (c.isInterruption?.(error)) throw error; c.shared.mediaUnreadable = true; }
    },
    async send(client, payload, record, c) {
      const { categoryIds = [] } = payload, input = c.loopInput || {}, steps = {};
      let product;
      try { product = await connectPendingModifiers(client, payload.product, c); }
      catch (error) { if (c.isInterruption(error)) throw error; return { base: { outcome: 'product-customization-failed', writeAttempted: false, error: Object.assign(error, { code: error.code || 'product-customization-failed' }) }, steps }; }
      product = JSON.parse(JSON.stringify(product || null));
      // The create already ran when only later steps are owed: the target has no gallery yet if
      // media is owed, so the body we verify against leaves it out, and the gallery is patched in.
      const resuming = c.done.create === STEP_DONE;
      let gallery = null;
      if (product && urlItems(product).length && c.shared.mediaGuard?.active && !c.done.media) {
        const confirmation = confirmGallery(product, input.pictureSourceIds, c.shared.mediaRead, c.shared.mediaUnreadable);
        if (!confirmation.confirmed) { delete product.media; steps.media = `media-${confirmation.reason}`; }
        else if (resuming) { delete product.media; gallery = confirmation.pictures; }
        else { product.media = { itemsInfo: { items: confirmation.pictures } }; steps.media = STEP_DONE; }
      } else if (product && resuming && !c.done.media && c.shared.mediaGuard?.active) delete product.media;
      let row;
      try { row = productRow(c.key, record, c.keyField, product, input, c.sourceSystem, c.sourceEntity); }
      catch (error) { return { base: { outcome: 'product-row-invalid', writeAttempted: false, error: Object.assign(error, { code: 'product-row-invalid' }) }, steps }; }
      const report = await c.primitives.importProducts(client, { projectDir: c.projectDir, siteId: c.siteId, rows: [row] });
      if (row.seo) (c.shared.seoResults ||= []).push(...(report.seo?.results || []));
      const result = report.rows?.[0] || {};
      if (!result.targetId) return { base: { outcome: result.identityConflict ? 'identity-conflict' : 'product-write-failed', error: reportError(result, 'product write failed') }, steps };
      if (result.verified !== true) return { base: { targetId: String(result.targetId), unverified: true, outcome: result.identityConflict ? 'identity-conflict' : 'product-not-verified', error: reportError(result, 'product could not be verified') }, steps };
      const targetId = String(result.targetId);
      steps.create = STEP_DONE;
      // Wix is still ingesting a sent image (write-verification mediaProcessing): the product is
      // created; its media step stays owed, so a later pass checks the gallery again.
      if (result.receipt?.mediaPending && !gallery) steps.media = 'media-pending';
      if (gallery) {
        let patched;
        try { patched = await c.primitives.patchMedia(client, { productId: targetId, items: gallery }); }
        catch (error) { if (c.isInterruption(error)) throw error; patched = { landed: false }; }
        steps.media = patched?.landed ? STEP_DONE : 'media-not-landed';
      } else if (!steps.media) steps.media = STEP_DONE;
      if (!categoryIds.length || c.done.categories) steps.categories = STEP_DONE;
      else {
        const attach = await c.primitives.attachCategories(client, [{ productId: targetId, categoryIds, sourceKey: c.key }]);
        const outcome = attach.rows?.[0]?.outcome || 'category-attach-failed';
        steps.categories = ['category-attach-written', 'category-attach-reconciled-existing'].includes(outcome) ? STEP_DONE : outcome;
      }
      if (!input.stock || c.done.stock) steps.stock = STEP_DONE;
      else {
        let stock;
        try { stock = await c.primitives.setStock(client, { targetId, stock: input.stock, key: c.key }); }
        catch (error) { if (c.isInterruption(error)) throw error; stock = { complete: false, status: 'failed' }; }
        steps.stock = stock.complete ? STEP_DONE : `stock-${stock.status || 'failed'}`;
      }
      return { base: { targetId, outcome: 'product-verified' }, steps };
    },
  },
  'crm/contact': {
    operation: 'bulkUpsertContacts', steps: ['upsert'], crosswalkKey: (record, c) => c.key,
    // One bulk call per batch: importContacts looks each contact up first and verifies after.
    async sendBatch(taskClient, items, c) {
      // A guest buyer whose email is a registered customer's is that customer's contact: the guest
      // row adopts it (one contact, two source keys) instead of being refused as a conflict.
      const rows = items.map(({ key, record, payload }) => ({ sourceKey: key, sourceId: String(at(record, c.keyField)), sourceSystem: c.sourceSystem, sourceEntityType: c.sourceEntity, contact: payload.contact, updateMember: false,
        ...(GUEST_ROLES.has(c.bindingRole) ? { shareExistingContact: true } : {}) }));
      const report = await c.primitives.importContacts(taskClient, { projectDir: c.projectDir, siteId: c.siteId, rows, evaluation: c.evaluation });
      const byKey = new Map((report.rows || []).map(row => [row.sourceKey, row]));
      return new Map(items.map(({ key }) => {
        const result = byKey.get(key) || {};
        // A row the composite refused before sending (a bad address shape) keeps its code and is a
        // known non-write: failed_retryable, requestSent false, never uncertain.
        if (!result.targetId && result.errorCode) return [key, { base: { outcome: result.errorCode, writeAttempted: false, error: Object.assign(new Error(String(result.error || result.errorCode)), { code: result.errorCode, requestSent: false }) }, steps: {} }];
        if (!result.targetId) return [key, { base: { outcome: result.identityConflict ? 'identity-conflict' : 'contact-write-failed', error: reportError(result, 'contact write failed') }, steps: {} }];
        if (result.verified !== true) return [key, { base: { targetId: String(result.targetId), unverified: true, outcome: result.identityConflict ? 'identity-conflict' : 'contact-not-verified', error: reportError(result, 'contact could not be verified') }, steps: {} }];
        const findings = [...(result.sharedWith ? [{ code: GUEST_ROLES.has(c.bindingRole) ? 'guest-buyer-shares-customer-contact' : 'customer-shares-guest-buyer-contact', sourceStableKey: result.sharedWith }] : []),
          // An existing Wix contact kept its own values (owner rule): the source values were not written.
          ...(result.keptExisting ? [{ code: 'contact-kept-existing-values' }] : []),
          ...(result.droppedValues || []).map(d => ({ code: 'contact-value-dropped', field: d.field, reason: d.reason }))];
        return [key, { base: { targetId: String(result.targetId), outcome: 'contact-verified' }, steps: { upsert: STEP_DONE }, ...(findings.length ? { findings } : {}) }];
      }));
    },
  },
  'ecom/order': {
    operation: 'importOrder', steps: ['order', 'payment', 'refund', 'invoice'],
    // createProjectOrderCrosswalk writes `<sourceSystem>:<sourceEntity>:<id>`, not the binding key.
    crosswalkKey: (record, c) => c.primitives.orderCrosswalkKey(orderCrosswalkOptions(record, c)),
    // The buyer is resolved inside the gate, after build: a member id only ever comes from the gate
    // (gatedMemberCrosswalk), and the result keeps resolveOrderBuyer's stamp. With no member import
    // task the order keeps the contact id build looked up and records `buyer-not-imported`.
    async prepare({ record, built, resolvers, input, c }) {
      const order = built && built.order;
      if (!order || typeof order !== 'object') return {};
      // A guest order's buyer is its guest buyer contact, through the gate with the same key the
      // contact task imported it under (guestBuyerContactId); a registered customer's comes from build.
      const guest = guestContactBinding(c);
      if (guest && !order.buyerInfo?.contactId) {
        const contactId = require('../resources/rp-target-wix/lib/order-buyer').guestBuyerContactId({ order: record, resolveReference: (ref, key, concrete) => lookupsFor(c.task, resolvers).ref(guest.ref, key, concrete), contactKeyPrefix: guest.keyPrefix });
        if (contactId) order.buyerInfo = { ...(order.buyerInfo || {}), contactId };
      }
      const source = input.buyer || {};
      const sourceCustomerId = source.sourceCustomerId !== undefined ? source.sourceCustomerId : (record.customer_id ?? null);
      const billingEmail = source.billingEmail !== undefined ? source.billingEmail : (order.buyerInfo?.email ?? record.billing?.email ?? null);
      const buyer = await c.primitives.resolveOrderBuyer({ sourceCustomerId, billingEmail, memberCrosswalk: memberLookup(c, resolvers) });
      // The member id goes on the gated body, so the grant covers it; send() takes it back off,
      // because importOrderHistory refuses a body that carries one and sets it from the buyer.
      if (buyer?.memberId) order.buyerInfo = { ...(order.buyerInfo || {}), memberId: buyer.memberId };
      return { buyer };
    },
    // Before any order write: the WooCommerce currency check over the whole order set (store
    // currency from the source's regional read, site currency from the site locale step, each
    // order's own currency). Orders in the site currency import; an order in another currency is held
    // on its own. Every order is held only when the store or site currency is unknown or they differ.
    prepareTask: ({ projectDir, records, keyOf }) => currencyHold(projectDir, records, keyOf),
    // Per order, after build: WooCommerce shipping lines the verified order reference mapping can
    // carry (orderShippingReadiness). An order it cannot carry waits with the named blocker, which
    // the dependency gate records as a reference gap; it is never sent without its shipping.
    // Several lines are a blocker only while the plan has no `order-shipping-lines` choice: with one
    // (combine, first, ...) build already wrote shippingInfo as the plan says, so the order goes
    // through and only the reference mapping is still checked.
    check: (record, body, c) => {
      if (!['woocommerce', 'wordpress'].includes(c.platform)) return null;
      const { orderShippingReadiness, selectOrderReferenceMapping } = require('./order-reference-readiness');
      const lines = record.shipping_lines;
      const subject = Array.isArray(lines) && lines.length > 1 && planChoice(c.plan, 'order-shipping-lines') != null ? { ...record, shipping_lines: [lines[0]] } : record;
      const shipping = orderShippingReadiness(subject, selectOrderReferenceMapping(), { logistics: body?.order?.shippingInfo?.logistics });
      return shipping.deferred ? { deferred: true, reason: shipping.reason, severity: shipping.severity } : null;
    },
    // importOrderHistory derives the order id from the source host and id, reads before it writes
    // and runs the payment, refund and invoice stages; orderHistoryAttempt is the shared
    // partial-failure rule (classifyMultiStepAttempt).
    async send(client, payload, record, c) {
      if (!c.sourceSiteHost) throw Object.assign(new Error('runRecordTask: orders need sourceSiteHost'), { requestSent: false, code: 'SOURCE_SITE_HOST_MISSING' });
      const result = await c.primitives.importOrderHistory(client, { order: orderSteps.bodyForImport(payload.order), sourceId: String(at(record, c.keyField)), sourceSiteHost: c.sourceSiteHost,
        evidence: (c.loopInput || {}).evidence, crosswalk: c.primitives.orderCrosswalk(orderCrosswalkOptions(record, c)),
        setupVerification: c.setupVerification, buyer: (c.loopInput || {}).buyer ?? null });
      // The per-order stage outcomes go back to the caller too: the completion report needs them
      // (collectOrderStageResiduals) to name an order whose payment, refund or invoice step failed.
      return { classified: c.primitives.orderHistoryAttempt(result, { sourceStableKey: c.key }), stageOutcomes: { sourceKey: c.key, outcomes: result.outcomes } };
    },
  },
};
// The contact task's guest buyer binding (role derived-guest-buyer-contact), when the order task
// depends on that contact task.
function guestContactBinding(c) {
  for (const edge of (c.task.dependencyEdges || []).filter(row => row.producer?.kind === 'import-task')) {
    const producer = (c.manifest?.tasks || []).find(row => row.id === edge.producer.taskId);
    const binding = (producer?.sourceBindings || []).find(row => row.role === GUEST_ROLE && row.ref === edge.ref);
    if (binding) return binding;
  }
  return null;
}
// The member lookup an order's buyer resolution uses: through the gate when a member import task
// produces members/member (its keyPrefix, and the login email its crosswalk row keeps), else none.
function memberLookup(c, resolvers) {
  const edge = (c.task.dependencyEdges || []).find(row => row.ref === 'members/member' && row.producer?.kind === 'import-task');
  const producer = edge && (c.manifest?.tasks || []).find(row => row.id === edge.producer.taskId);
  const binding = producer && (producer.sourceBindings || []).find(row => row.ref === 'members/member');
  if (!binding?.keyPrefix) return { get: async () => null };
  const members = c.primitives.memberCrosswalk({ projectDir: c.projectDir, sourceSystem: c.sourceSystem, sourceEntityType: binding.sourceEntity });
  return require('../resources/rp-target-wix/lib/order-buyer').gatedMemberCrosswalk({ resolveReference: resolvers.resolveReference, memberKeyPrefix: binding.keyPrefix,
    loginEmailFor: async id => (await members.get(id))?.loginEmail || null });
}
// The setup receipt the invoice writer checks (setup/extended-field-verification.json), read once
// per run; absent, the invoice stage refuses and the order records that as its outcome.
function readSetupVerification(projectDir) {
  const file = path.join(projectDir, 'setup', 'extended-field-verification.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
// Coupons and blog posts (design v2 K1): their fixed part lives in its own file; see there.
const couponPost = require('./import-composites-coupon-post');
Object.assign(COMPOSITES, couponPost.COMPOSITES);
Object.assign(primitiveDefaults, couponPost.primitives);
// Product reviews (design v2 K2).
const reviews = require('./import-composites-review');
Object.assign(COMPOSITES, reviews.COMPOSITES);
Object.assign(primitiveDefaults, reviews.primitives);
// Back-in-stock requests (design v2 K3).
const backInStock = require('./import-composites-back-in-stock');
Object.assign(COMPOSITES, backInStock.COMPOSITES);
Object.assign(primitiveDefaults, backInStock.primitives);
// WooCommerce tax rates: region, default groups and one mapping per group.
const taxRates = require('./import-composites-tax');
Object.assign(COMPOSITES, taxRates.COMPOSITES);
Object.assign(primitiveDefaults, taxRates.primitives);
// The steps a landed record still owes, from its latest journal row. A record whose create landed
// (crosswalk) but whose row is not a finished `imported` row resumes: the composite finds its
// target again and runs only the steps not done.
// Step outcomes a rerun of the same plan and source cannot change: the build gave no source media
// id for a picture, or the source has no media record for it. Resuming them each pass only re-reads
// the product, so a record that owes nothing else is done for the loop and keeps its cutover item.
// `resumeFinalSteps` (after the build or source is fixed) resumes them once more.
const FINAL_STEP_OUTCOMES = new Set(['media-no-source-id', 'media-no-source-record']);
function pendingSteps(composite, latestRow, { resumeFinalSteps = false } = {}) {
  if (!latestRow) return null;
  // A skip that still owes final steps carries them, so `resumeFinalSteps` can pick them up later.
  if (latestRow.status === 'skipped_already_imported' && !(resumeFinalSteps && latestRow.steps)) return null;
  if (!['imported', 'skipped_already_imported'].includes(latestRow.status)) return {};
  const steps = latestRow.steps;
  if (!steps || typeof steps !== 'object') return null;
  const owed = composite.steps.filter(stage => steps[stage] !== undefined && steps[stage] !== STEP_DONE);
  if (!owed.length) return null;
  if (!resumeFinalSteps && owed.every(stage => FINAL_STEP_OUTCOMES.has(steps[stage]))) return null;
  return Object.fromEntries(Object.entries(steps).filter(([, value]) => value === STEP_DONE));
}
const finalStepsOwed = (composite, latestRow) => {
  const steps = composite && latestRow?.steps;
  if (!steps || typeof steps !== 'object') return null;
  const owed = composite.steps.filter(stage => steps[stage] !== undefined && steps[stage] !== STEP_DONE);
  return owed.length && owed.every(stage => FINAL_STEP_OUTCOMES.has(steps[stage])) ? steps : null;
};

// Gated entities: the read-back gate's entity name per ref. The gate runs when the mapping has an
// entity decision for it (read-back-approval.gatedEntities), as completion decides. `gate: false`
// turns it off; an object `{ entity, run, options }` replaces the default (tests).
const GATED_ENTITIES = { 'stores/product': 'product', 'crm/contact': 'contact', 'ecom/order': 'order', 'members/member': 'member' };
// The gate is per plan row: several rows may write one entity (customers and guest contacts), each
// with its own read-back unit (lib/mapping-field-contract.js readBackKeys), found by the binding's source.
async function gateFor(projectDir, ref, option, sourceEntity = null) {
  if (option === false) return null;
  if (option && typeof option === 'object') return option;
  const entity = GATED_ENTITIES[ref];
  if (!entity) return null;
  const plan = await require('./read-back-state').readJson(projectDir, 'mapping/mapping-plan.json', {});
  const key = require('./mapping-field-contract').readBackKeyFor(plan || {}, entity, sourceEntity);
  return key && (await require('./read-back-approval').gatedEntities(projectDir)).includes(key) ? { entity: key } : null;
}
// Every lookup answers "not known": the gate's expected body is the record without gate-supplied
// ids, as the read-back inventory was built.
const NO_LOOKUPS = Object.freeze({ resolveReference: () => undefined, resolveTaskReference: () => undefined, resolveSetupReference: () => undefined, resolveSameTaskReference: () => undefined, ref: () => undefined });
// The read-back build's lookups answer a reference the way the import loop will, without the gate:
// - a path the dependency gate supplies (tag ids, media ids, categories) is never in the pure body
//   (read-back canary: builder-emitted-gate-supplied-field), so it stays unknown, as before;
// - a builder-owned reference (a product's brand.id, on a task-complete edge) is in the body the
//   canary requires and reads back. It resolves to the record the producer task landed on this site
//   (crosswalk). Not landed yet but present in the producer's source extract (the read-back
//   inventory is measured before the producer runs): a stand-in `<key>`, the same convention as the
//   plan examples, so the record is measured as written, not held. Absent from the producer's
//   source: undefined, so the builder holds the record, as the import loop will.
// When every lookup answered "not known", every branded product was held in the inventory and the
// gate never released it.
function readBackLookups({ projectDir, targetRef, siteId = null, manifest = null } = {}) {
  if (!projectDir || !targetRef) return NO_LOOKUPS;
  let tasks = manifest?.tasks;
  if (!tasks) { try { tasks = JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')).tasks; } catch { return NO_LOOKUPS; } }
  let crosswalk = null;
  const landed = key => {
    if (!siteId) return undefined;
    if (!crosswalk) {
      crosswalk = new Map();
      try {
        for (const line of fs.readFileSync(local.crosswalkPath(projectDir), 'utf8').split(/\r?\n/)) {
          if (!line.trim()) continue;
          const row = JSON.parse(line);
          if (row?.sourceStableKey) crosswalk.set(row.sourceStableKey, row);
        }
      } catch { /* nothing landed yet */ }
    }
    const row = crosswalk.get(key);
    return row && row.status === 'imported' && (!row.siteId || row.siteId === siteId) && row.targetId ? String(row.targetId) : undefined;
  };
  const sourceKeys = new Map();
  const inSource = (target, key) => {
    const binding = (tasks || []).flatMap(task => task?.sourceBindings || []).find(b => b?.ref === target && b.role !== 'source-archive' && typeof b.keyPrefix === 'string' && key.startsWith(b.keyPrefix));
    if (!binding?.extractPath) return false;
    if (!sourceKeys.has(binding.extractPath)) {
      let keys = new Set();
      try { keys = new Set(readExtract(projectDir, binding.extractPath).map(row => `${binding.keyPrefix}${at(row, binding.keyField || 'id')}`)); } catch { /* no extract: unknown */ }
      sourceKeys.set(binding.extractPath, keys);
    }
    return sourceKeys.get(binding.extractPath).has(key);
  };
  const resolve = (target, key, concrete) => {
    if (typeof key !== 'string' || !key || typeof concrete !== 'string') return undefined;
    if (readiness.gateSuppliedReferences([targetRef], concrete).length) return undefined;
    return landed(key) ?? (inSource(target, key) ? `<${key}>` : undefined);
  };
  return Object.freeze({ resolveReference: resolve, resolveTaskReference: resolve, resolveSetupReference: () => undefined, resolveSameTaskReference: () => undefined, ref: resolve });
}
// `context` ({ projectDir, targetRef, siteId }): the read-back lookups above. Without it every lookup
// is unknown (a builder generated before them).
async function pureBuild(build, record, context = null) {
  const built = await build(record, context ? (context.lookups ||= readBackLookups(context)) : NO_LOOKUPS);
  if (built && typeof built === 'object' && Object.hasOwn(built, 'loopInput')) { const { loopInput, ...rest } = built; return rest; }
  return built;
}
// The read-back gate over the loop's own batches: the gate decides order, canaries and samples;
// each batch it releases goes through processBatch (dependency gate, composite, journal).
// `ready` is the loop's own start check (probeReady): canaries come only from records it would start
// now. When none is ready the gate waits and `hold` journals every record as waiting on that
// dependency (deferred, picked again next pass): never not-attempted, never a gate stop.
async function gatedPass({ gate, projectDir, runId, siteId, targetRef = null, wix, sourceSiteHost, keyField, keyPrefix, records, build, processBatch: loopBatch, ready, hold }) {
  const run = gate.run || require('./read-back-gate').runGatedEntity;
  // The expected body resolves builder-owned references as the send will (readBackLookups).
  const readBack = { projectDir, targetRef, siteId };
  const forGate = outcome => outcome?.targetId ? { targetId: outcome.targetId, findings: outcome.findings } : outcome?.deferred ? { deferred: true, reason: outcome.reason } : {};
  // The records the gate released to the loop; a stopped gate leaves the rest unwritten.
  const reached = new Set();
  const processBatch = async batch => { for (const record of batch) reached.add(String(at(record, keyField))); return loopBatch(batch); };
  const result = await run({ projectDir, runId, siteId, wix, sourceSiteHost, entity: gate.entity, records,
    sourceIdOf: record => String(at(record, keyField)), sourceKeyOf: id => `${keyPrefix}${id}`,
    buildWrite: record => pureBuild(build, record, targetRef ? readBack : null),
    ...(require('./read-back-contract').domainOf(gate.entity) === 'product' ? { marker: (record, body) => ({ path: 'slug', value: (body?.product || body)?.slug }) } : {}),
    writeBatch: batch => processBatch(batch),
    write: async record => forGate((await processBatch([record]))[0]),
    ...(ready ? { ready } : {}),
    ...(gate.options || {}) });
  if (result?.status === 'waiting' && hold) await hold(records, result.waitingOn || []);
  // A stopped gate's cutover item is scoped to the records it never released: recorded on the
  // gate's own entry, so the read-back gate's stop action names and counts them.
  if (result?.status !== 'passed') {
    const unwritten = records.map(record => String(at(record, keyField))).filter(id => !reached.has(id));
    await require('./read-back-state').update(projectDir, state => {
      const entry = state.runs?.[runId]?.entities?.[gate.entity];
      if (entry) entry.unwritten = { count: unwritten.length, sourceIds: unwritten, sourceKeyPrefix: keyPrefix };
    });
  }
  return result;
}

// The plan's record rule for an entity (operator request: "skip customers who never ordered",
// "skip expired coupons"): the plan contract's `recordRule = { keepWhen, choice }`
// (lib/mapping-field-contract.js, operator-only). A record `keepsRecord` rejects is not imported:
// the loop journals it `skipped_out_of_scope` with `outOfScope.code: 'skipped-by-plan'`, and the
// completion report lists the entity's skips as one site-owner action. Generated code never filters
// records. A rule the contract refuses (not the operator's, or unreadable) skips nothing: the plan
// check reports it, and losing records is never the default.
function planRecordRule(plan, binding, ref) {
  const contract = require('./mapping-field-contract');
  const row = readEntityMappings(plan || {}).find(entry => entry.sourceEntity === binding.sourceEntity && (entry.targetRef || ref) === ref);
  const rule = row?.recordRule;
  if (!rule || typeof rule !== 'object' || contract.choiceErrors(rule.choice).length || rule.choice.decidedBy !== 'operator') return null;
  const Applicability = require('./output-applicability');
  if (!rule.keepWhen || Applicability.validate(rule.keepWhen, [...Applicability.locations(rule.keepWhen)]).length) return null;
  return { matches: record => !contract.keepsRecord(row, record), reason: rule.choice.reason, decidedBy: rule.choice.decidedBy,
    choice: rule.choice.name, readable: `only records where ${Applicability.readable(rule.keepWhen)} are kept` };
}

// Products with an SEO plan: this pass's SEO results plus the residuals still owed by products the
// pass did not reconcile (saved SEO state), as completion stageResiduals rows.
async function seoStageResiduals(projectDir, siteId, results) {
  const seo = require('../resources/rp-target-wix/lib/product-seo');
  const carried = seo.outstandingSeoResiduals(await seo.loadSeoState(projectDir, siteId), { exclude: results.map(r => r.sourceKey) });
  return seo.collectSeoStageResiduals([...results, ...carried]);
}

function readExtract(projectDir, extractPath) {
  return fs.readFileSync(path.join(projectDir, extractPath), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function failure(key, operation, { errorCode, outcome, message, httpStatus = null, targetEntityId = null, errorBody = null }) {
  return { sourceId: key, targetEntityId, operation, httpStatus, errorCode, scopeGroupName: null, outcome, message,
    ...(errorBody !== null && errorBody !== undefined ? { errorBody } : {}) };
}

function capturedErrorBody(error) {
  const body = error?.body !== undefined && error.body !== null ? error.body : error?.rawBody;
  if (body === undefined || body === null) return null;
  // Wix clients normally attach a parsed JSON body. Keep that structure so QA can classify the
  // rejection; raw text is retained when the response was not JSON. The attempt journal is the
  // durable per-record boundary, so do not replace this with a task-level summary string.
  if (typeof body === 'string') {
    const redacted = body
      .replace(/\b(password|passwd|secret|token|api[-_ ]?key|authorization|cookie)\b\s*([:=])\s*(?:(bearer)\s+)?([^\s,;"'<>]+)/gi,
        (_, name, separator, scheme) => `${name}${separator}${scheme ? ` ${scheme}` : ''} [REDACTED]`)
      .replace(/(["'])(password|passwd|secret|token|api[-_ ]?key|authorization|cookie)\1\s*:\s*(["'])(?:bearer\s+)?[^"']*\3/gi,
        (_, quote, name, valueQuote) => `${quote}${name}${quote}: ${valueQuote}[REDACTED]${valueQuote}`)
      .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
      .replace(/([?&](?:access_token|refresh_token|api_key|token|secret|password|authorization|cookie)=)[^&\s]+/gi, '$1[REDACTED]');
    return redacted.length > 4096 ? `${redacted.slice(0, 4096)}…[truncated]` : redacted;
  }
  try { return JSON.parse(JSON.stringify(body)); } catch { return String(body); }
}
function errorFields(error) {
  const value = error && typeof error === 'object' ? error : {};
  return {
    errorCode: value.errorCode || value.applicationErrorCode || value.code || null,
    message: String(value.errorMessage || value.message || error || 'write failed').slice(0, 300),
    httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus
      : (Number.isInteger(value.status) ? value.status : (Number.isInteger(value.statusCode) ? value.statusCode : null)),
  };
}
// After a request may have left: a 4xx other than 408/429 was rejected and not applied; a 429 was
// not applied; anything else (5xx, timeout, reset) may have landed and is unresolved.
function sentOutcome(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408) return { status: status === 429 ? 'failed_retryable' : 'failed_terminal', httpStatus: status };
  return { status: 'succeeded_unverified', httpStatus: Number.isInteger(status) ? status : null };
}

async function runRecordTaskUnlocked({
  taskBinding, wix, sourceEntity, records, sourceSystem, build, send, reconcile,
  operation, batchSize = 50, stopRequested = () => false, selectionMode = 'full', recordFilter = () => true, resumeFinalSteps = false,
  bindRecord, isInterruption = error => require('./wix-auth').isRunInterruption(error),
  composite: useComposite = true, primitives: primitiveOverrides = {}, sourceSiteHost = null, childExtracts = [], setupVerification, gate: gateOption, finishPass = true,
} = {}) {
  if (typeof build !== 'function') throw new Error('runRecordTask requires build');
  if (typeof sourceSystem !== 'string' || !sourceSystem) throw new Error('runRecordTask requires sourceSystem (the crosswalk source system)');
  if (!wix && typeof bindRecord !== 'function') throw new Error('runRecordTask requires wix (the task client) or bindRecord');
  const ctx = capability.requireKind(taskBinding, 'import-task');
  const { projectDir, runId, siteId, task, taskId } = ctx, dryRun = ctx.dryRun === true;
  // A source-archive binding runs only when named (the scaffold's archive task loops over its planned items).
  const bindings = (task.sourceBindings || []).filter(binding => (binding.role !== 'source-archive' || sourceEntity) && (!sourceEntity || binding.sourceEntity === sourceEntity));
  if (bindings.length !== 1) throw new Error(`runRecordTask: task ${taskId} needs exactly one source binding${sourceEntity ? ` for ${sourceEntity}` : ''} (found ${bindings.length}); pass sourceEntity`);
  const [binding] = bindings, ref = binding.ref, keyField = binding.keyField || 'id';
  // Products, contacts and orders go through the toolkit's composites unless the caller sends.
  // `composite` may name the composite's ref (a synthetic test entity uses the product composite).
  // An entity with a composite always runs through it (design v2 A5): there is no per-run choice,
  // so a caller-supplied send for it is refused before anything is read or sent.
  const compositeRef = typeof useComposite === 'string' ? useComposite : ref;
  // A caller send for it is the old hand-wired path: the task is held (below), never run through it.
  const handWired = Boolean(COMPOSITES[compositeRef] && typeof send === 'function');
  const composite = COMPOSITES[compositeRef] || null;
  if (!composite && typeof send !== 'function') throw new Error(`runRecordTask requires send for ${ref} (no toolkit composite)`);
  const primitives = { ...primitiveDefaults, ...primitiveOverrides };
  const op = operation || (typeof task.writeOperations?.[ref] === 'string' ? task.writeOperations[ref] : composite?.operation || 'create');
  const keyOf = record => `${binding.keyPrefix}${at(record, keyField)}`;
  const runSetupVerification = composite === COMPOSITES['ecom/order'] ? (setupVerification !== undefined ? setupVerification : readSetupVerification(projectDir)) : null;
  const bind = bindRecord || ((grant, key) => require('../resources/rp-target-wix/lib/wix-writers').bindRecordClient(wix, { readinessGrant: grant, sourceStableKey: key }));
  const findExisting = reconcile || RECONCILERS[ref];
  const journalOptions = dryRun ? { sample: true } : {};
  const row = (key, status, extra = {}) => ({ schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: key, writeSpecId: taskId, operation: op, targetEntityType: ref, status, runId, phase: 'import', ts: new Date().toISOString(), siteId, ...extra });
  // Each record's outcome in this pass, from its terminal row, for the read-back gate.
  const outcomes = new Map();
  const noteOutcome = value => {
    if (value.status === 'imported' || value.status === 'skipped_already_imported') outcomes.set(value.sourceStableKey, { targetId: String(value.targetId), findings: value.findings });
    else if (value.status === 'succeeded_unverified') outcomes.set(value.sourceStableKey, { uncertain: true });
    else if (value.status === 'deferred') outcomes.set(value.sourceStableKey, { deferred: true, reason: value.deferral?.reason || 'deferred' });
    else if (value.status !== 'started') outcomes.set(value.sourceStableKey, { deferred: true, reason: value.failure?.errorCode || value.status });
  };
  const journal = async value => { const written = await local.appendAttempt(projectDir, value, journalOptions); noteOutcome(value); return written; };
  const outcomesFor = slice => slice.map(record => ({ sourceId: String(at(record, keyField)), ...(outcomes.get(keyOf(record)) || { deferred: true, reason: recordFilter(keyOf(record)) ? 'not-attempted' : 'not-selected' }) }));
  const counts = { attempted: 0, imported: 0, alreadyPresent: 0, deferred: 0, failed: 0, unresolved: 0 };
  // Which plan rows wrote each record, so a later plan change updates only the changed fields.
  const planRowsDigest = dryRun ? null : planUpdate.rememberPlanRows(projectDir, planUpdate.entityPlanOf(ctx.plan, binding));
  // Per-record stage outcomes a composite hands back (orders: importOrderHistory's outcomes), for
  // the completion report's stageResiduals.
  const stageOutcomes = [];
  const defer = async (key, reason, extra = {}) => { counts.deferred += 1; await journal(row(key, 'deferred', { deferral: { reason, ...extra } })); };
  const landed = async (key, record, result, attemptId, findings, extra = {}) => {
    // A composite that publishes its own crosswalk (products, contacts, orders) is not doubled here.
    if (!dryRun && (!composite || composite.ownsCrosswalk === false)) await local.appendCrosswalkRow(projectDir, { schemaVersion: 1, sourceSystem, sourceEntityType: binding.sourceEntity, sourceId: String(at(record, keyField)), sourceStableKey: key,
      targetSystem: 'wix', targetEntityType: ref, targetId: String(result.targetId), status: 'imported', updatedAt: new Date().toISOString(),
      ...(result.revision !== undefined ? { targetRevision: String(result.revision) } : {}), ...(result.crosswalkExtra || {}) });
    counts.imported += 1;
    await journal(row(key, 'imported', { attemptId, targetId: String(result.targetId), findings, ...extra, ...(planRowsDigest ? { planRowsDigest } : {}) }));
    // A value the build changed on the way in (a name cut to Wix's limit) becomes a cutover task.
    if (!dryRun) for (const { code, action, operatorRole, severity, decisionId, ...detail } of loopInputs.get(key)?.findings || []) {
      if (typeof action === 'string' && action.trim()) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code, action, operatorRole, severity, detail: { targetId: String(result.targetId), ...(decisionId ? { decisionId } : {}), ...detail } });
    }
    // Held before, imported now: its cutover task is closed.
    if (latest.get(key)?.deferral?.reason === 'builder-held') await readiness.resolveTaskGap({ taskBinding, sourceStableKey: key, code: 'plan-value-held' });
    // A value the build changed on the way in (a name cut to Wix's limit) becomes a cutover task.
    if (!dryRun) for (const { code, action, operatorRole, severity, decisionId, ...detail } of loopInputs.get(key)?.findings || []) {
      if (typeof action === 'string' && action.trim()) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code, action, operatorRole, severity, detail: { targetId: String(result.targetId), ...(decisionId ? { decisionId } : {}), ...detail } });
    }
  };

  // A recorded loss on a landed record becomes a cutover item (completion report
  // `dependency-reference-gap`), so it is never only a line in the journal.
  const recordFindingGap = async (key, finding, targetId) => {
    const orderGap = orderSteps.findingGap(finding);
    if (orderGap) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: orderGap.code, action: orderGap.action, severity: orderGap.severity, detail: { targetId } });
    if (finding.code === 'same-task-parent-unlinked') await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: finding.reason,
      action: `These ${ref} records were imported without their parent link (${finding.reason}). Once each parent exists on the site, set it as the record's parent (${tree?.template || 'the parent field'}), then confirm the hierarchy in Business Manager.`,
      detail: { targetId, ...(finding.parentSourceKey ? { parentSourceKey: finding.parentSourceKey } : {}) } });
    const dropped = finding.code === 'contact-value-dropped' ? CONTACT_DROPPED_GAPS[`${finding.field}:${finding.reason}`] : null;
    if (dropped) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: dropped.code, severity: 'low', action: dropped.action, detail: { targetId, field: finding.field } });
    if (finding.code === 'unknown-outcome-recreated') await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: 'possible-duplicate-after-unknown-outcome',
      action: `An earlier create of each of these ${ref} records had no recorded outcome and could not be ruled out, so it was created again. Look for another ${ref} matching each source record on the site; if one exists, keep the listed targetId and delete the other.`,
      detail: { targetId, priorAttemptId: finding.priorAttemptId, lookup: finding.lookup } });
  };
  // One terminal row per composite record, through the shared partial-failure rule: a landed base
  // with a failed step is `imported` with a retryable finding and the steps it owes (resumed next
  // pass); a base that did not land is failed or unresolved, never a duplicate on retry.
  const journalStep = async (key, record, attemptId, findings, outcome) => {
    if (outcome.base?.unverified) {
      counts.unresolved += 1;
      const details = errorFields(outcome.base.error);
      await journal(row(key, 'succeeded_unverified', { attemptId, targetId: outcome.base.targetId, failure: failure(key, op, { errorCode: outcome.base.outcome, outcome: 'unresolved', message: details.message, targetEntityId: outcome.base.targetId }) }));
      return;
    }
    const classified = outcome.classified || multiStep.classifyMultiStepAttempt({ sourceStableKey: key, operation: op, base: outcome.base,
      subSteps: Object.entries(outcome.steps || {}).filter(([, value]) => value !== STEP_DONE).map(([stage, value]) => ({ stage, outcome: value, failed: true })) });
    const steps = outcome.classified ? Object.fromEntries([['order', STEP_DONE], ...classified.findings.filter(f => f.code === 'sub-step-failed').map(f => [f.stage, f.outcome])]) : outcome.steps;
    if (classified.status === 'imported') {
      // The row carries its steps: one not `done` is resumed on the next pass. Until then it is a
      // cutover item; a later pass that finishes the steps closes it.
      await landed(key, record, { targetId: classified.targetId }, attemptId, [...findings, ...classified.findings], steps ? { steps } : {});
      for (const finding of findings) await recordFindingGap(key, finding, classified.targetId);
      const owed = Object.entries(steps || {}).filter(([, value]) => value !== STEP_DONE);
      // Final outcomes only (FINAL_STEP_OUTCOMES): a rerun does not retry them, so the action says what does.
      const final = owed.length && owed.every(([, value]) => FINAL_STEP_OUTCOMES.has(value));
      if (owed.length) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: 'import-step-incomplete', severity: 'high',
        action: final
          ? `These ${ref} records are on the site without their pictures: a picture could not be matched to a source media record (media-no-source-id: the build gave no source media id; media-no-source-record: the source has no such media). A rerun skips them. Add the pictures in Business Manager, or have the Import Operator fix the build's loopInput.pictureSourceIds and rerun task ${taskId} with resumeFinalSteps, which adds only the pictures.`
          : `These ${ref} records are on the site, but a follow-up step did not finish (each record lists the step and its outcome). Rerun the import for task ${taskId}: it resumes only the missing steps and never creates the record again. If a step still fails, finish it in Business Manager (for a product: assign its categories or set its stock; for an order: record its payment or refund).`,
        detail: { targetId: classified.targetId, steps: owed.map(([stage, value]) => `${stage}=${value}`).join(' ') } });
      else if (resumed.has(key)) await readiness.resolveTaskGap({ taskBinding, sourceStableKey: key, code: 'import-step-incomplete' });
      return;
    }
    if (classified.status === 'succeeded_unverified') counts.unresolved += 1; else counts.failed += 1;
    await journal(row(key, classified.status, { attemptId, ...(classified.failure.requestSent === false ? { requestSent: false } : {}), failure: classified.failure }));
  };
  const journalThrown = async (key, attemptId, error) => {
    if (error && error.requestSent === false) {
      counts.failed += 1;
      await journal(row(key, 'failed_retryable', { attemptId, requestSent: false, failure: failure(key, op, { errorCode: error.code || 'refused-before-send', outcome: 'failed_retryable', message: 'refused before sending' }) }));
      return;
    }
    const outcome = sentOutcome(error), details = errorFields(error);
    if (outcome.status === 'succeeded_unverified') counts.unresolved += 1; else counts.failed += 1;
    await journal(row(key, outcome.status, { attemptId, failure: failure(key, op, { errorCode: details.errorCode, httpStatus: outcome.httpStatus ?? details.httpStatus,
      outcome: outcome.status === 'succeeded_unverified' ? 'unresolved' : outcome.status, message: details.message, errorBody: capturedErrorBody(error) }) }));
  };
  const all = records || readExtract(projectDir, binding.extractPath);
  // Held, not thrown: every selected record waits with a named reason, the task records one
  // structured cutover item, and the pass is left open so its dependents keep waiting.
  if (handWired) {
    const keys = all.map(keyOf).filter(key => recordFilter(key));
    for (const key of keys) await defer(key, 'composite-entity-hand-wired');
    if (keys.length && !dryRun) await readiness.recordTaskGap({ taskBinding, sourceStableKeys: keys, code: 'composite-entity-hand-wired', severity: 'high', written: false,
      action: `Task ${taskId} was not run: its generated code passed its own send for ${compositeRef}, which the import loop writes through its composite. Change the generated task to call runRecordTask with build only (no send), re-run import-contract-verify until codegenFindings is empty, then rerun task ${taskId}. Nothing of it was written.`,
      detail: { ref: compositeRef } });
    return { taskId, sourceEntity: binding.sourceEntity, status: 'held', counts };
  }
  // Child rows read from their own extract (WooCommerce variations) are joined to their parent
  // record before build: reading the source is the loop's job, not generated code's.
  require('./child-extracts').joinChildExtracts(projectDir, all, keyField, childExtracts);
  // The plan's record rule, applied once before any batch or gate: a skipped record is journaled
  // and never reaches the gate or the composite. A record already on the site stays as it is.
  const recordRule = planRecordRule(ctx.plan, binding, ref), planSkipped = new Set();
  if (recordRule) {
    counts.skippedByPlan = 0;
    const crosswalk = dryRun ? { bySource: {} } : await local.loadCrosswalk(projectDir);
    for (const record of all) {
      const key = keyOf(record);
      if (!recordFilter(key) || !recordRule.matches(record)) continue;
      const existing = crosswalk.bySource[composite?.crosswalkKey ? composite.crosswalkKey(record, { key, keyField, projectDir, sourceSystem, sourceEntity: binding.sourceEntity, primitives }) : key];
      if (existing && existing.status === 'imported' && (!existing.siteId || existing.siteId === siteId)) continue;
      planSkipped.add(key); counts.skippedByPlan += 1;
      await journal(row(key, 'skipped_out_of_scope', { outOfScope: { code: 'skipped-by-plan', reason: recordRule.reason, rule: recordRule.readable, choice: recordRule.choice, decidedBy: recordRule.decidedBy } }));
    }
  }
  const selected = key => recordFilter(key) && !planSkipped.has(key);
  // A builder hold (a plan valuePolicy hold-record, lib/plan-builder.js, or a hold the build step
  // decided) is a cutover task: the record is not on the site until its value or the plan changes.
  // One task for both paths: the dependency gate's builder-held deferral and the read-back gate's
  // inventory-held records.
  const recordHeldGap = (key, holds) => readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: 'plan-value-held', severity: 'high', written: false,
    action: `These ${ref} records were not imported: a plan rule held them (each record lists the plan row and hold code as decisionId:code). Check the source value. If it is right, change that row in mapping/mapping-plan.json (its valuePolicy or transform), get the mapping re-approved and resume task ${taskId} with --deferred-only; if the value is wrong, fix it in the source, re-extract and resume. If the owner accepts the loss, record it as an approved omission. Nothing is resent for records already imported.`,
    detail: { holds: (holds || []).join(' ') } });
  const loopInputs = new Map(), shared = {};
  const contactKeyByEmail = contactEmailIndex(projectDir, ctx.manifest, task);
  // Cutover items for one record, from a composite (coupons, posts).
  const recordGap = key => (code, { action, detail = {}, operatorRole, severity }) => readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code, action, detail, operatorRole, severity });
  const resolveGap = key => code => readiness.resolveTaskGap({ taskBinding, sourceStableKey: key, code });
  const mapped = hierarchyOf(task, binding, ctx.plan), tree = mapped && !mapped.ambiguous ? mapped : null;
  const { levels, unplaceable } = tree ? depthLevels(all, { idOf: record => at(record, keyField), parentIdOf: record => at(record, tree.sourcePath) }) : { levels: [all], unplaceable: [] };
  // Why a record is written without its parent link, decided before it is built.
  const unlinked = new Map();
  for (const record of unplaceable) unlinked.set(keyOf(record), 'same-task-parent-cycle');
  if (mapped?.ambiguous) for (const record of all) if (mapped.ambiguous.some(field => !noParent(at(record, field.sourcePath)))) unlinked.set(keyOf(record), 'same-task-parent-field-ambiguous');
  if (unplaceable.length) levels.push(unplaceable);
  const parentKeyOf = record => (tree && !noParent(at(record, tree.sourcePath)) ? `${binding.keyPrefix}${at(record, tree.sourcePath)}` : null);
  const unlinkedFinding = (key, record) => unlinked.has(key) ? [{ code: 'same-task-parent-unlinked', reason: unlinked.get(key), ...(parentKeyOf(record) ? { parentSourceKey: parentKeyOf(record) } : {}) }] : [];

  const taskRows = (await local.loadAttemptJournal(projectDir, journalOptions).catch(error => { if (error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING') return { rows: [] }; throw error; })).rows.filter(r => r.writeSpecId === taskId);
  const latest = local.foldAttemptsBySourceKey(taskRows);
  const refusedMedia = ref === 'media/media-file' ? mediaRefusedForGood(taskRows, latest, siteId) : new Map();
  let stopped = false;
  const resumed = new Map();
  // A composite's hold (the order currency check) is decided once, over every record: task-wide, or
  // per record (`records`: key -> { reason }), when only some records must wait.
  const platform = sourcePlatformOf(projectDir);
  const prepared = composite?.prepareTask ? composite.prepareTask({ projectDir, records: all, keyOf }) : null;
  const taskHold = prepared && !prepared.records ? prepared : null;
  const recordHold = prepared?.records ? prepared : null;
  // Orders: currency fill and coupon links (lib/order-loop-steps.js); findings travel with the record.
  const orderContext = composite && composite === COMPOSITES['ecom/order'] ? orderSteps.orderStepContext({ projectDir, orderRef: ref, siteId }) : null;
  const stepFindings = new Map();
  // A record's gated transform (build, composite prepare, order steps, check, same-task parent),
  // the one check the task uses to start a record. `probe` asks it for the read-back gate's canary
  // choice and keeps nothing: loop inputs and step findings stay local and a check records no gap.
  const transformFor = (record, { probe = false, orphaned = new Set() } = {}) => async resolvers => {
    const own = new Map(), inputs = probe ? { get: key => own.has(key) ? own.get(key) : loopInputs.get(key), set: (key, value) => own.set(key, value) } : loopInputs;
    const lookups = lookupsFor(task, resolvers, { contactKeyByEmail });
    let built = await build(record, lookups);
    if (built && typeof built === 'object' && Object.hasOwn(built, 'loopInput')) { const { loopInput, ...rest } = built; inputs.set(keyOf(record), loopInput); built = rest; }
    if (composite?.prepare && !builderHold(built)) {
      const input = inputs.get(keyOf(record)) || {};
      inputs.set(keyOf(record), { ...input, ...await composite.prepare({ record, built, resolvers, input, c: { task, manifest: ctx.manifest, projectDir, sourceSystem, primitives } }) });
    }
    let body = decorateCmsDataItemPayload(ref, built, keyOf(record));
    if (orderContext && !builderHold(body)) {
      body = orderSteps.fillCurrency(body, orderContext);
      if (body?.deferred) return body;
      const couponFindings = orderSteps.applyCouponStep(record, body, lookups, orderContext);
      if (!probe) stepFindings.set(keyOf(record), [...couponFindings, ...orderSteps.buyerFindings(inputs.get(keyOf(record))?.buyer)]);
    }
    // A check may also hand back `{ body }`: the body the gate checks and the composite sends
    // (the coupon check unwraps the specification and applies the voucher verdict).
    let checked = body;
    if (composite?.check && !builderHold(body)) {
      const key = keyOf(record);
      const hold = await composite.check(record, body, { projectDir, platform, plan: ctx.plan, shared, primitives, dryRun, key, recordGap: probe ? () => {} : recordGap(key), sourceEntity: binding.sourceEntity, manifestPath: binding.manifestPath, contactKeyByEmail, taskClient: wix });
      if (hold && Object.hasOwn(hold, 'body')) checked = hold.body; else if (hold) return hold;
    }
    const parentKey = parentKeyOf(record);
    if (builderHold(checked) || !parentKey || unlinked.has(keyOf(record)) || orphaned.has(keyOf(record))) return checked;
    const parentId = resolvers.resolveSameTaskReference(ref, parentKey, tree.template);
    if (parentId !== undefined) setAt(checked, tree.template, parentId);
    return checked;
  };
  // The records the task would start now: the dependency gate, then a child whose same-task parent
  // has not landed is gated again without the link (its parent's level already ran).
  const startable = async (records, evaluation, { probe = false } = {}) => {
    const byKey = new Map(records.map(record => [keyOf(record), record]));
    // One source read per batch for what the composite's per-record check needs (the coupon re-read).
    if (composite?.prepareChecks && !dryRun) await composite.prepareChecks(records, { projectDir, shared, primitives, sourceEntity: binding.sourceEntity, manifestPath: binding.manifestPath });
    const gateRecords = (list, orphaned) => readiness.gateBatch({ evaluation, probe, records: list.map(record => ({ sourceStableKey: keyOf(record), transform: transformFor(record, { probe, orphaned }) })) });
    const first = await gateRecords(records, new Set());
    const sends = first.send.map(item => ({ item, grant: first.grant }));
    const orphans = first.defer.filter(row => row.deferral?.dependencyState === 'same-task-parent-not-written');
    let second = { send: [], defer: [] };
    if (orphans.length) {
      if (!probe) for (const row of orphans) unlinked.set(row.sourceStableKey, 'same-task-parent-not-written');
      second = await gateRecords(orphans.map(row => byKey.get(row.sourceStableKey)), new Set(orphans.map(row => row.sourceStableKey)));
      sends.push(...second.send.map(item => ({ item, grant: second.grant })));
    }
    return { first, orphans, second, sends };
  };
  // The read-back gate's question before it writes a canary: which of these records would this pass
  // start now (the same checks processBatch runs, nothing written). A record already imported is
  // ready (the loop skips it with its target id). The others carry their wait reason.
  const probeReady = async records => {
    const ready = new Set(), waiting = new Map();
    const crosswalk = await local.loadCrosswalk(projectDir);
    const rest = [];
    for (const record of records) {
      const key = keyOf(record), existing = crosswalk.bySource[composite?.crosswalkKey ? composite.crosswalkKey(record, { key, keyField, projectDir, sourceSystem, sourceEntity: binding.sourceEntity, primitives }) : key];
      if (existing && existing.status === 'imported' && (!existing.siteId || existing.siteId === siteId)) ready.add(String(at(record, keyField))); else rest.push(record);
    }
    if (recordHold) for (let i = rest.length - 1; i >= 0; i -= 1) {
      const held = recordHold.records.get(keyOf(rest[i]));
      if (held) { waiting.set(String(at(rest[i], keyField)), held.reason); rest.splice(i, 1); }
    }
    if (!rest.length) return { ready, waiting };
    const wait = reason => { for (const record of rest) waiting.set(String(at(record, keyField)), reason); return { ready, waiting }; };
    if (taskHold) return wait(taskHold.reason);
    const evaluation = await readiness.evaluateTask({ taskBinding });
    if (!evaluation.ok) return wait(`dependency-not-ready:${[...new Set(evaluation.blocked.map(b => b.ref))].sort().join(',')}`.slice(0, 200));
    const { first, orphans, second, sends } = await startable(rest, evaluation, { probe: true });
    for (const { item } of sends) ready.add(item.sourceStableKey.slice(binding.keyPrefix.length));
    for (const row of [...first.defer.filter(row => !orphans.includes(row)), ...second.defer]) {
      const id = row.sourceStableKey.slice(binding.keyPrefix.length);
      if (!ready.has(id)) waiting.set(id, [row.deferral?.reason || 'dependency-deferred', row.deferral?.ref].filter(Boolean).join(':'));
    }
    return { ready, waiting };
  };
  const processBatch = async slice => {
    if (stopRequested()) { stopped = true; return outcomesFor(slice); }
    const crosswalk = dryRun ? { bySource: {} } : await local.loadCrosswalk(projectDir);
    const batch = [];
    for (const record of slice) {
      const key = keyOf(record);
      if (!selected(key)) continue;
      const existing = crosswalk.bySource[composite?.crosswalkKey ? composite.crosswalkKey(record, { key, keyField, projectDir, sourceSystem, sourceEntity: binding.sourceEntity, primitives }) : key];
      // A file Wix's media import refused on two runs is not sent again: one final deferred row.
      if (refusedMedia.has(key) && !(existing && existing.status === 'imported')) { await defer(key, MEDIA_FILE_REFUSED, { final: true, ...refusedMedia.get(key) }); continue; }
      if (existing && existing.status === 'imported' && (!existing.siteId || existing.siteId === siteId)) {
        // A composite record whose create landed but whose steps did not all finish resumes.
        const pending = composite ? pendingSteps(composite, latest.get(key), { resumeFinalSteps }) : null;
        // A skip that still owes final steps keeps them and their sub-step findings, so the read-back
        // gate's writer guard still drops the owed gallery from what it expects.
        if (!pending) { const owedSteps = finalStepsOwed(composite, latest.get(key)); counts.alreadyPresent += 1; await journal(row(key, 'skipped_already_imported', { targetId: existing.targetId, ...(owedSteps ? { steps: owedSteps, findings: (latest.get(key).findings || []).filter(f => f?.code === 'sub-step-failed') } : {}) })); continue; }
        resumed.set(key, pending);
      }
      batch.push(record);
    }
    if (recordHold) {
      const held = batch.filter(record => recordHold.records.has(keyOf(record)));
      for (const record of held) { const { reason, currency } = recordHold.records.get(keyOf(record)); await defer(keyOf(record), reason, { final: true, currency }); }
      if (held.length && !dryRun) await readiness.recordTaskGap({ taskBinding, sourceStableKeys: held.map(keyOf), code: recordHold.code, action: recordHold.action, detail: recordHold.detail, severity: recordHold.severity, written: false });
      for (const record of held) batch.splice(batch.indexOf(record), 1);
    }
    if (!batch.length) return outcomesFor(slice);
    if (taskHold) {
      for (const record of batch) await defer(keyOf(record), taskHold.reason);
      if (!dryRun) await readiness.recordTaskGap({ taskBinding, sourceStableKeys: batch.map(keyOf), code: taskHold.code, action: taskHold.action, detail: taskHold.detail, severity: taskHold.severity, written: false });
      return outcomesFor(slice);
    }
    // One evaluation per batch: the previous level's rows have just landed.
    const evaluation = await readiness.evaluateTask({ taskBinding });
    if (!evaluation.ok) {
      const reason = `dependency-not-ready:${[...new Set(evaluation.blocked.map(b => b.ref))].sort().join(',')}`.slice(0, 200);
      for (const record of batch) await defer(keyOf(record), reason);
      return outcomesFor(slice);
    }
    const byKey = new Map(batch.map(record => [keyOf(record), record]));
    const { first, orphans, second, sends } = await startable(batch, evaluation);
    const secondDefer = second.defer;
    let deferred = first.defer.length - orphans.length + second.defer.length;
    // A child whose parent has not landed (missing from the source, failed, held) is written
    // without the link in the same batch (startable). Its parent's level already ran.
    counts.deferred += deferred; // the gate journals its own deferrals
    if (!dryRun) for (const row of [...first.defer, ...secondDefer]) if (row.deferral?.reason === 'builder-held') await recordHeldGap(row.sourceStableKey, row.deferral.holds);
    for (const row of [...first.defer, ...(orphans.length ? secondDefer : [])]) if (!sends.some(send => send.item.sourceStableKey === row.sourceStableKey)) outcomes.set(row.sourceStableKey, { deferred: true, reason: row.deferral?.reason || 'dependency-deferred' });
    const batchItems = [];
    if (composite?.prepareBatch && sends.length && !dryRun) await composite.prepareBatch(sends.map(({ item }) => ({ key: item.sourceStableKey, loopInput: loopInputs.get(item.sourceStableKey) })),
      { projectDir, primitives, shared, isInterruption });
    for (const { item, grant } of sends) {
      if (stopRequested()) { stopped = true; break; }
      const key = item.sourceStableKey, record = byKey.get(key);
      const payload = decorateCmsDataItemPayload(ref, item.payload, key);
      // Bind before any started row: a refused binding sends nothing and leaves no orphan row.
      let recordClient;
      try { recordClient = bind(grant, key); }
      catch (error) { if (error?.code !== 'DEPENDENCY_READINESS_REQUIRED') throw error; await defer(key, 'readiness-grant-refused'); continue; }
      const findings = [...unlinkedFinding(key, record), ...(stepFindings.get(key) || [])];
      const prior = latest.get(key);
      if (prior && UNKNOWN_OUTCOME.has(prior.status) && !dryRun && !composite) {
        // Look it up; adopt exactly one match. Anything else creates: the record is never parked.
        let found;
        try { found = findExisting ? await findExisting(recordClient, payload, record) : undefined; } catch (error) { if (isInterruption(error)) throw error; found = undefined; }
        if (found && found.targetId) {
          await landed(key, record, found, prior.attemptId, [...findings, { code: 'adopted-after-read-back' }]);
          for (const finding of findings) await recordFindingGap(key, finding, String(found.targetId));
          continue;
        }
        if (found === null) {
          // The read proved the earlier request never landed: close it, then create.
          await journal(row(key, 'failed_retryable', { attemptId: prior.attemptId, requestSent: false, failure: failure(key, op, { errorCode: 'not-found-on-read-back', outcome: 'failed_retryable', message: 'read-back found no target; the earlier request did not land' }) }));
        } else if (ref === 'cms/data-item') {
          // A CMS write may have landed even when the read failed or found several
          // candidates. Never create another item on an inconclusive reconciliation.
          counts.unresolved += 1;
          await journal(row(key, 'succeeded_unverified', { attemptId: prior.attemptId, failure: failure(key, op, {
            errorCode: 'cms-source-key-reconciliation-inconclusive', outcome: 'unresolved',
            message: 'CMS source-key read-back was inconclusive; no item was re-sent',
          }) }));
          continue;
        } else {
          findings.push({ code: 'unknown-outcome-recreated', priorAttemptId: prior.attemptId, lookup: findExisting ? 'inconclusive' : 'no-reader' });
        }
      }
      const started = await journal(row(key, 'started'));
      counts.attempted += 1;
      if (dryRun) { await defer(key, 'dry-run-would-send'); continue; }
      const stepContext = { key, keyField, projectDir, siteId, sourceSystem, sourceEntity: binding.sourceEntity, sourceSiteHost, primitives, isInterruption, evaluation, setupVerification: runSetupVerification, shared,
        loopInput: loopInputs.get(key), done: resumed.get(key) || {}, runId, recordGap: recordGap(key), resolveGap: resolveGap(key), existingTargetId: crosswalk.bySource[key]?.targetId || null,
        grant, taskClient: wix, // The source record already on a target id, read fresh (an earlier record of this batch may own it).
        targetOwner: async id => (dryRun ? null : (await local.loadCrosswalk(projectDir)).byTarget?.[id]?.sourceStableKey || null) };
      if (composite?.sendBatch) { batchItems.push({ key, record, payload, started, findings }); continue; }
      if (composite) {
        try {
          const outcome = await composite.send(recordClient, payload, record, stepContext);
          if (outcome?.stageOutcomes) stageOutcomes.push(outcome.stageOutcomes);
          // Not written yet and nothing to undo (a post waiting for its media): a deferred row, resumed next pass.
          if (outcome?.deferred) await defer(key, outcome.deferred);
          else await journalStep(key, record, started.attemptId, [...findings, ...(outcome?.findings || [])], outcome);
        }
        catch (error) { if (isInterruption(error)) throw error; await journalThrown(key, started.attemptId, error); }
        continue;
      }
      try {
        const result = await send(recordClient, payload, record);
        if (!result || typeof result.targetId !== 'string' || !result.targetId) {
          counts.unresolved += 1;
          const details = errorFields(result?.error || result);
          await journal(row(key, 'succeeded_unverified', { attemptId: started.attemptId, failure: failure(key, op, {
            errorCode: details.errorCode || 'no-target-id', outcome: 'unresolved', httpStatus: details.httpStatus,
            message: details.message !== 'write failed' ? details.message : (details.errorCode || 'write returned no target id'),
          }) }));
          continue;
        }
        await landed(key, record, result, started.attemptId, [...findings, ...(result.findings || [])]);
        for (const finding of findings) await recordFindingGap(key, finding, String(result.targetId));
      } catch (error) {
        if (isInterruption(error)) throw error;
        if (error && error.requestSent === false) {
          counts.failed += 1;
          await journal(row(key, 'failed_retryable', { attemptId: started.attemptId, requestSent: false, failure: failure(key, op, { errorCode: error.code || 'refused-before-send', outcome: 'failed_retryable', message: 'refused before sending' }) }));
          continue;
        }
        const outcome = sentOutcome(error);
        if (outcome.status === 'succeeded_unverified') counts.unresolved += 1; else counts.failed += 1;
        const details = errorFields(error);
        // A file Wix's media import refuses (live slice 11-17: SVG and ZIP, an HTML 400; run
        // 09895795: SVG, ZIP, MOV, MP4) is a file it cannot take by URL: one grouped cutover item,
        // and the products and posts that use it are written without it (dependencyFailureActions omit).
        const mediaRefused = ref === 'media/media-file' && outcome.status === 'failed_terminal';
        if (mediaRefused && !dryRun) await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: MEDIA_FILE_REFUSED, severity: 'low', action: MEDIA_FILE_REFUSED_ACTION,
          detail: { httpStatus: outcome.httpStatus ?? details.httpStatus, ...(record?.mime_type ? { mimeType: String(record.mime_type) } : {}) } });
        await journal(row(key, outcome.status, { attemptId: started.attemptId, failure: failure(key, op, {
          errorCode: details.errorCode || (mediaRefused ? MEDIA_FILE_REFUSED : null), httpStatus: outcome.httpStatus ?? details.httpStatus,
          outcome: outcome.status === 'succeeded_unverified' ? 'unresolved' : outcome.status, message: details.message,
          errorBody: capturedErrorBody(error),
        }) }));
      }
    }
    if (batchItems.length) {
      let results;
      try { results = await composite.sendBatch(wix, batchItems, { keyField, projectDir, siteId, sourceSystem, sourceEntity: binding.sourceEntity, bindingRole: binding.role, primitives, isInterruption, evaluation }); }
      catch (error) { if (isInterruption(error)) throw error; for (const item of batchItems) await journalThrown(item.key, item.started.attemptId, error); results = null; }
      // The composite's own findings travel with the record, as on the per-record path.
      if (results) for (const item of batchItems) { const outcome = results.get(item.key) || { base: { outcome: 'no-result', error: new Error('composite returned no result') } }; await journalStep(item.key, item.record, item.started.attemptId, [...item.findings, ...(outcome.findings || [])], outcome); }
    }
    return outcomesFor(slice);
  };
  // A gated entity (products, contacts, orders, members with a read-back inventory) runs inside the
  // read-back gate: canaries first, then the rest in stable source order with sampling. The gate
  // calls back into processBatch, so generated code never calls it.
  const gatePlan = !dryRun && !tree ? await gateFor(projectDir, ref, gateOption, binding.sourceEntity) : null;
  let gateResult = null;
  if (gatePlan) {
    gateResult = await gatedPass({ gate: gatePlan, projectDir, runId, siteId, targetRef: ref, wix, sourceSiteHost, keyField, keyPrefix: binding.keyPrefix,
      records: all.filter(record => selected(keyOf(record))), build, processBatch, ready: probeReady,
      hold: async (waitingRecords, waitingOn) => { for (const record of waitingRecords) await defer(keyOf(record), 'canary-waiting-on-dependency', { waitingOn }); } });
    // The gate never releases a record the inventory holds (a decided builder hold), so the loop
    // never builds it. Journal each selected one as the ungated path does: deferred `builder-held`
    // with its holds and its cutover task, never "not attempted". A record
    // already on this site keeps its row.
    if (!stopRequested()) {
      const inventory = await require('./read-back-state').readJson(projectDir, `execution/read-back-inventory/${gatePlan.entity}.json`, null);
      const heldById = new Map((inventory?.records || []).filter(r => Array.isArray(r.held) && r.held.length).map(r => [String(r.sourceId), r.held]));
      const crosswalk = heldById.size ? await local.loadCrosswalk(projectDir).catch(() => ({ bySource: {} })) : { bySource: {} };
      for (const record of all) {
        const key = keyOf(record), holds = heldById.get(String(at(record, keyField))), existing = crosswalk.bySource[key];
        if (!holds || !selected(key) || (existing?.status === 'imported' && (!existing.siteId || existing.siteId === siteId))) continue;
        await defer(key, 'builder-held', { holds });
        await recordHeldGap(key, holds);
      }
    }
    if (stopRequested()) stopped = true;
  } else {
    for (const level of levels) {
      for (let offset = 0; offset < level.length && !stopped; offset += batchSize) await processBatch(level.slice(offset, offset + batchSize));
      if (stopped) break;
    }
  }
  // A stopped gate left records unwritten: the pass is not finished, so dependents keep waiting.
  // A waiting gate (no ready canary yet) is not a stop: its records are deferred and the pass is
  // incomplete, but it is not finished either, so dependents keep waiting.
  const gateStopped = gateResult && !['passed', 'waiting'].includes(gateResult.status);
  const gateWaiting = gateResult?.status === 'waiting';
  if (!stopped && !gateStopped && !gateWaiting && finishPass) await readiness.finishTaskPass({ taskBinding, selection: { mode: selectionMode } });
  const status = stopped || gateStopped ? 'stopped' : counts.failed || counts.unresolved || counts.deferred ? 'incomplete' : 'complete';
  // Always for products: a pass that sends none (a rerun where every product is already imported)
  // still owes the residuals saved by earlier passes.
  const stageResiduals = composite === COMPOSITES['stores/product'] && !dryRun ? await seoStageResiduals(projectDir, siteId, shared.seoResults || []) : null;
  return { taskId, sourceEntity: binding.sourceEntity, status, counts, ...(stageResiduals ? { stageResiduals } : {}), ...(composite === COMPOSITES['ecom/order'] ? { orderHistory: stageOutcomes } : {}), ...(gateResult ? { gate: { entity: gatePlan.entity, status: gateResult.status, stopReason: gateResult.stopReason || null } } : {}) };
}

// A direct task command may call the runner without the generated run-import entrypoint. Keep the
// same project-wide exclusion in that case; run-import's outer lock is re-entrant in this process.
async function runRecordTask(options = {}) {
  const ctx = capability.requireKind(options.taskBinding, 'import-task');
  return local.withStateLock(ctx.projectDir, async () => {
    const result = await withGuestBuyers(ctx, options);
    // Records skipped as already imported get the plan's later changes in the same run, so a plan
    // change after import is never left unapplied silently (plan-update cutover rows otherwise).
    if (result.status === 'stopped' || ctx.dryRun === true || !result.counts?.alreadyPresent || options.planUpdate === false) return result;
    // The task's main binding (guest-contact and same-task-parent bindings are not plan-updated).
    const main = (ctx.task.sourceBindings || []).filter(binding => binding.role !== 'source-archive' && !GUEST_ROLES.has(binding.role));
    const sourceEntity = options.sourceEntity || main[0]?.sourceEntity;
    const update = await planUpdate.runPlanUpdatePassUnlocked(updateOptions({ ...options, sourceEntity }));
    return { ...result, planUpdate: { status: update.status, counts: update.counts, changedFields: update.changedFields || [] } };
  }, { script: 'import-task-runner.js', reentrant: true });
}

// Guest buyer contacts: the contact task's derived binding (role `derived-guest-buyer-contact`,
// rows from order-buyer.js guestBuyerContactRows, each carrying its finished `contact` body). The
// loop imports them after the customers, through the same contact composite, in the same task pass,
// so orders find a guest's contact like a customer's. Generated code builds customers only.
//
// Guest review contacts (design v2 K2, H37): role `derived-guest-review-contact`, one row per
// reviewer email with no customer (review-import.js guestReviewContactRows writes `contact`; an
// extract row with only `email` and `name` gets the same body here). Same pass, after the guest
// buyers, so a review finds its author like a customer. The site is muted before any import.
const GUEST_ROLE = 'derived-guest-buyer-contact', GUEST_REVIEW_ROLE = 'derived-guest-review-contact';
const GUEST_ROLES = new Set([GUEST_ROLE, GUEST_REVIEW_ROLE]);
const guestBuild = row => ({ contact: row.contact });
function guestReviewBuild(row) {
  if (row.contact) return { contact: row.contact };
  const { rows } = require('../resources/rp-target-wix/lib/review-import').guestReviewContactRows([{ sourceStableKey: String(row.id), reviewerEmail: row.email, reviewerName: row.name }]);
  if (!rows.length) return { status: 'held', holds: [{ decisionId: 'review-author', code: 'guest-review-email-missing' }] };
  return { contact: { ...rows[0].contact, ...(row.externalId ? { externalId: String(row.externalId) } : {}) } };
}
// Same-task parents (design v2 K, live slice #811): records a task writes besides its main entity
// that the main records reference by a declared sameTaskReferenceFields path (a post's blog tags:
// the manifest puts blog/tag in the post task). The loop writes them first, in the same pass, built
// from the plan's entity for that source (no plan entity: the source name as the label), so each
// main record finds them as same-task references. Generated code builds the main entity only.
// `send` per ref; tests pass `primitives.sameTaskParents` for a synthetic ref.
const SAME_TASK_PARENTS = {
  'blog/tag': {
    async send(client, payload) {
      const writers = require('../resources/rp-target-wix/lib/wix-writers');
      try {
        const tag = await writers.createBlogTag(client, payload);
        return tag?.id ? { targetId: String(tag.id) } : null;
      } catch (error) {
        // ALREADY_EXISTS: the label is already a tag on the site (an earlier pass, or the site's
        // own); adopt it only when exactly one tag has it.
        if (error?.status !== 409 && !/ALREADY_EXISTS/.test(String(error?.code || error?.message || ''))) throw error;
        const found = await RECONCILERS['blog/tag'](client, payload);
        if (found?.targetId) return { ...found, findings: [{ code: 'adopted-existing-tag' }] };
        throw error;
      }
    },
    build: row => (typeof row.name === 'string' && row.name.trim() ? { label: row.name.trim() } : { status: 'held', holds: [{ decisionId: 'tag-label', code: 'tag-label-missing' }] }),
  },
};
function sameTaskParentBuild(projectDir, binding, fallback) {
  let entity = null;
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping', 'mapping-plan.json'), 'utf8'));
    entity = [...(plan.entities || []), ...readEntityMappings(plan)].find(row => row.sourceEntity === binding.sourceEntity && (row.targetRef || binding.ref) === binding.ref && (row.fieldMappings || []).length) || null;
  } catch { entity = null; }
  return entity ? require('./plan-builder').buildFromPlan(entity, {}) : fallback;
}
async function withSameTaskParents(ctx, options, main, parents) {
  const passes = [];
  for (const parent of parents) {
    if (!fs.existsSync(path.join(ctx.projectDir, parent.binding.extractPath))) continue;
    const result = await runRecordTaskUnlocked({ ...options, sourceEntity: parent.binding.sourceEntity, build: sameTaskParentBuild(ctx.projectDir, parent.binding, parent.handler.build || SAME_TASK_PARENTS['blog/tag'].build),
      send: parent.handler.send, composite: false, records: undefined, recordFilter: undefined, childExtracts: [], gate: false, finishPass: false });
    passes.push([parent.binding, result]);
    if (result.status === 'stopped') return { ...result, sameTaskParents: passes.map(([binding, r]) => ({ sourceEntity: binding.sourceEntity, status: r.status, counts: r.counts })) };
  }
  const own = await runRecordTaskUnlocked({ ...options, sourceEntity: main.sourceEntity, finishPass: false });
  const stopped = own.status === 'stopped';
  if (!stopped && options.finishPass !== false) await readiness.finishTaskPass({ taskBinding: options.taskBinding, selection: { mode: options.selectionMode || 'full' } });
  const counts = Object.fromEntries(Object.keys(own.counts).map(key => [key, own.counts[key] + passes.reduce((sum, [, r]) => sum + (r.counts[key] || 0), 0)]));
  const status = stopped ? 'stopped' : counts.failed || counts.unresolved || counts.deferred ? 'incomplete' : 'complete';
  return { ...own, status, counts, sameTaskParents: passes.map(([binding, r]) => ({ sourceEntity: binding.sourceEntity, status: r.status, counts: r.counts })) };
}
async function withGuestBuyers(ctx, options) {
  const bindings = (ctx.task.sourceBindings || []).filter(binding => binding.role !== 'source-archive');
  const derived = bindings.filter(binding => GUEST_ROLES.has(binding.role));
  const main = bindings.filter(binding => !GUEST_ROLES.has(binding.role));
  if (main.length > 1 && typeof options.send !== 'function') {
    const own = main.find(binding => binding.sourceEntity === options.sourceEntity) || (options.sourceEntity ? null : main[0]);
    const sameTask = new Set(readiness.sameTaskReferenceFields(ctx.task.entityRefs).map(field => field.ref));
    const table = { ...SAME_TASK_PARENTS, ...(options.primitives?.sameTaskParents || {}) };
    const parents = own ? main.filter(binding => binding !== own && binding.ref !== own.ref && sameTask.has(binding.ref) && table[binding.ref]).map(binding => ({ binding, handler: table[binding.ref] })) : [];
    if (parents.length) return withSameTaskParents(ctx, options, own, parents);
  }
  const compositeRef = typeof options.composite === 'string' ? options.composite : main[0]?.ref;
  const contactTask = compositeRef === 'crm/contact' && typeof options.send !== 'function' && options.composite !== false;
  if (!derived.length || !contactTask || main.length !== 1 || (options.sourceEntity && options.sourceEntity !== main[0].sourceEntity)) return runRecordTaskUnlocked(options);
  const customers = await runRecordTaskUnlocked({ ...options, sourceEntity: main[0].sourceEntity, finishPass: false });
  const passes = [];
  for (const guest of derived) {
    if (customers.status === 'stopped' || passes.some(([, result]) => result.status === 'stopped')) break;
    if (!fs.existsSync(path.join(ctx.projectDir, guest.extractPath))) continue;
    passes.push([guest, await runRecordTaskUnlocked({ ...options, sourceEntity: guest.sourceEntity, build: guest.role === GUEST_REVIEW_ROLE ? guestReviewBuild : guestBuild, records: undefined, childExtracts: [], gate: false, finishPass: false })]);
  }
  const stopped = customers.status === 'stopped' || passes.some(([, result]) => result.status === 'stopped');
  if (!stopped) await readiness.finishTaskPass({ taskBinding: options.taskBinding, selection: { mode: options.selectionMode || 'full' } });
  const counts = Object.fromEntries(Object.keys(customers.counts).map(key => [key, customers.counts[key] + passes.reduce((sum, [, result]) => sum + (result.counts[key] || 0), 0)]));
  const status = stopped ? 'stopped' : counts.failed || counts.unresolved || counts.deferred ? 'incomplete' : 'complete';
  const summary = role => { const pass = passes.find(([guest]) => guest.role === role); return pass ? { sourceEntity: pass[0].sourceEntity, status: pass[1].status, counts: pass[1].counts } : { skipped: true }; };
  return { ...customers, status, counts, guestBuyerContacts: summary(GUEST_ROLE),
    ...(derived.some(binding => binding.role !== GUEST_ROLE) ? { guestReviewContacts: summary(GUEST_REVIEW_ROLE) } : {}) };
}

// The update pass after a plan change (lib/plan-update-pass.js), under the same project lock:
// records this task already imported get only the fields whose plan rows changed.
const UPDATE_OPTIONS = ['taskBinding', 'wix', 'bindRecord', 'sourceEntity', 'records', 'build', 'update', 'baselinePlan', 'batchSize', 'stopRequested', 'isInterruption'];
const updateOptions = options => Object.fromEntries(UPDATE_OPTIONS.filter(key => options[key] !== undefined).map(key => [key, options[key]]));
async function runPlanUpdatePass(options = {}) {
  const ctx = capability.requireKind(options.taskBinding, 'import-task');
  return local.withStateLock(ctx.projectDir, () => planUpdate.runPlanUpdatePassUnlocked(updateOptions(options)), { script: 'import-task-runner.js', reentrant: true });
}

module.exports = { runRecordTask, runPlanUpdatePass, RECONCILERS, SAME_TASK_PARENTS, COMPOSITES, GATED_ENTITIES, hierarchyOf, lookupsFor, contactEmailIndex, pendingSteps, gatedPass, gateFor, pureBuild, readBackLookups, PENDING_CUSTOMIZATION, writeCustomization };
