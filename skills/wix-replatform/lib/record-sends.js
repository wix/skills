'use strict';

// Design v2 (G): the fixed send for each target the loop writes with one reviewed writer call and
// no toolkit composite. The import scaffold (lib/codegen-scaffold.js) wires these into the handler
// it generates, so no entity with suggestions needs a hand-written handler. Each send takes the
// body the plan built (lib/plan-builder.js) and returns { targetId, findings? } for runRecordTask;
// a reconcile (when present) finds the record an unknown outcome may have written: { targetId }
// when exactly one matches, null when none does, undefined when it cannot tell.
//
// Only the call and the id are fixed here. Which fields go where stays in the plan.

const writers = () => require('../resources/rp-target-wix/lib/wix-writers');
const idOf = (row) => (row && row.id ? String(row.id) : undefined);
const unwrap = (payload, key) => (payload && payload[key] && typeof payload[key] === 'object' ? payload[key] : payload);
const mediaArgs = (body = {}) => ({ sourceUrl: body.url ?? body.sourceUrl, displayName: body.displayName, mimeType: body.mimeType, mediaType: body.mediaType,
  wpId: body.externalInfo && body.externalInfo.externalId != null ? body.externalInfo.externalId : body.wpId });
const one = (matches, id = idOf) => (matches.length === 1 ? { targetId: id(matches[0]) } : matches.length === 0 ? null : undefined);

const SENDS = {
  'blog/category': {
    send: async (client, payload) => ({ targetId: idOf(await writers().createBlogCategory(client, unwrap(payload, 'category'))) }),
  },
  'blog/tag': {
    send: async (client, payload) => ({ targetId: idOf(await writers().createBlogTag(client, unwrap(payload, 'tag'))) }),
    reconcile: async (client, payload) => {
      const label = unwrap(payload, 'tag').label;
      return label ? one((await writers().listBlogTags(client)).filter((t) => t.label === label)) : undefined;
    },
  },
  'stores/category': {
    send: async (client, payload) => ({ targetId: idOf(await writers().createStoresCategory(client, unwrap(payload, 'category'))) }),
  },
  'stores/product-tag': {
    send: async (client, payload) => {
      const name = unwrap(payload, 'tag').name;
      return { targetId: idOf((await client.send(writers().buildCreateStoresProductTagRequest(name))).tag) };
    },
  },
  'stores/brand': {
    // The writer reuses a brand with the same exact name (Wix brand names are unique).
    send: async (client, payload) => {
      const result = await writers().createStoresBrand(client, { brand: unwrap(payload, 'brand') });
      return { targetId: idOf(result.brand), ...(result.outcome === 'reused' ? { findings: [{ code: 'brand-reused-by-name' }] } : {}) };
    },
  },
  'tax/tax-group': {
    send: async (client, payload) => ({ targetId: idOf(await writers().createTaxGroup(client, unwrap(payload, 'taxGroup'))) }),
    reconcile: async (client, payload) => {
      const name = unwrap(payload, 'taxGroup').name;
      if (!name) return undefined;
      return one((await writers().queryTaxGroups(client, { filter: { name }, cursorPaging: { limit: 100 } })).filter((g) => g.name === name));
    },
  },
  // The plan builds the Import File body (url, displayName, mimeType, mediaType, externalInfo);
  // the writer takes its own argument names and encodes the URL.
  'media/media-file': {
    send: async (client, payload) => ({ targetId: idOf(await writers().importMedia(client, mediaArgs(payload))) }),
    reconcile: async (client, payload) => writers().findImportedMediaFile(client, mediaArgs(payload)),
  },
};

// Shipping zones: each zone is a delivery region on the site's default delivery profile
// (ensureDeliveryRegion reuses a region that already covers the same destinations, so the home
// country never collides). Its methods are written after the loop by the toolkit's shipping-option
// stage (estimates, verified create, recovery, operator actions), with the regions the loop wrote.
// A session keeps the regions of this run for that stage.
const PASS_MODES = new Set(['unfiltered', 'missing-only', 'unresolved-only', 'failed-only']);
// zoneId -> a record client under that zone's readiness grant, for the zones the gate admits.
// Zones are the ones this run wrote (regionIdByZone) and the ones an earlier run wrote (the
// zones' crosswalk rows). A zone the gate does not admit gets no client: its option writes stay refused.
async function zoneGrantClients(ctx, { projectDir, regionIdByZone }) {
  const binding = (ctx.task.sourceBindings || []).find((row) => row.ref === 'ecom/delivery-profile' && row.role !== 'source-archive');
  if (!binding || typeof binding.keyPrefix !== 'string') return null;
  const keyOf = (zoneId) => `${binding.keyPrefix}${zoneId}`;
  const zoneIds = new Set(Object.keys(regionIdByZone || {}));
  const bySource = (await require('./local-state.js').loadCrosswalk(projectDir)).bySource || {};
  for (const [key, row] of Object.entries(bySource)) {
    if (row && row.targetEntityType === 'ecom/delivery-profile' && row.targetId && key.startsWith(binding.keyPrefix)) zoneIds.add(key.slice(binding.keyPrefix.length));
  }
  if (!zoneIds.size) return null;
  const readiness = require('./dependency-readiness.js');
  const evaluation = await readiness.evaluateTask({ taskBinding: ctx.taskBinding });
  if (!evaluation.ok) return null;
  const batch = await readiness.gateBatch({ evaluation, records: [...zoneIds].map((zoneId) => ({ sourceStableKey: keyOf(zoneId), payload: {} })) });
  const admitted = new Set((batch.send || []).map((row) => row.sourceStableKey));
  const clients = new Map();
  return (zoneId) => {
    const key = keyOf(zoneId);
    if (!admitted.has(key)) return null;
    if (!clients.has(key)) clients.set(key, writers().bindRecordClient(ctx.wix, { readinessGrant: batch.grant, sourceStableKey: key }));
    return clients.get(key);
  };
}
SENDS['ecom/delivery-profile'] = {
  session() {
    const regionIdByZone = {};
    return {
      async send(client, payload, record) {
        const result = await writers().ensureDeliveryRegion(client, unwrap(payload, 'deliveryRegion'));
        if (result.action === 'collision-unresolved' || !result.deliveryRegionId) {
          throw Object.assign(new Error(`the delivery region for zone "${record && record.name}" collides with an existing region and could not be resolved`),
            { code: 'DESTINATIONS_COLLISION', status: 409, outcomeKnown: true, findings: result.findings || [] });
        }
        if (record && record.id !== undefined) regionIdByZone[String(record.id)] = String(result.deliveryRegionId);
        return { targetId: String(result.deliveryRegionId), findings: [...(result.findings || []), { code: `delivery-region-${result.action}` }] };
      },
      // After the loop: the zones' shipping methods. Zones from earlier runs keep their region
      // through the crosswalk (the stage reads it). Not in a dry run, nor after a stop.
      async after(ctx, result, { projectDir, sourceSystem }) {
        const { runId, dryRun } = require('./execution-capability.js').requireKind(ctx.taskBinding, 'import-task');
        if (dryRun || (typeof ctx.stopRequested === 'function' && ctx.stopRequested())) return result;
        const { runShippingOptionStage } = require('../resources/rp-target-wix/lib/shipping-option-stage.js');
        // H34: a zone's options are written under that zone's own readiness grant; the task client
        // alone carries none, so the import client refuses every option write.
        const zoneClient = await zoneGrantClients(ctx, { projectDir, regionIdByZone });
        const stage = await runShippingOptionStage(ctx.wix, { projectDir, regionIdByZone, sourceSystem, runId, phase: 'import', zoneClient,
          passMode: PASS_MODES.has(ctx.passMode) ? ctx.passMode : 'unfiltered' });
        return { ...result, shippingOptions: { results: stage.results, selection: stage.selection }, completionFragment: stage.fragment };
      },
    };
  },
};

// The fixed send for a target, as { send, reconcile?, after? } for one task run; null when the
// toolkit has none (a composite sends, or the entity keeps generated code).
function sendFor(targetRef) {
  if (!Object.hasOwn(SENDS, targetRef)) return null;
  const entry = SENDS[targetRef];
  return typeof entry.session === 'function' ? entry.session() : entry;
}

module.exports = { SENDS, sendFor };
