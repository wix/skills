'use strict';

// A WooCommerce tax rate runs inside the shared loop (import-task-runner.js
// runRecordTask). Generated code gives only build(record, lookups) (wix-map/tax.builder.js):
//   { manualTaxMapping: { taxRate, taxName?, taxGroupId? },
//     loopInput: { region: { country, subdivision? }, defaultGroups?: true, shipping?: boolean } }
// A custom-class rate carries its own tax group (lookups.ref('tax/tax-group', ...)); a standard
// rate carries none and says `defaultGroups`. This file is the fixed part, per record:
//   - region: find the Wix tax region for (country, subdivision) with Query Tax Regions, else create
//     it. Its appId (the site's manual tax calculator) is read live once per run (List Tax
//     Calculators); it differs per site, so setup cannot carry it. A region is created only right
//     before its first mapping, so the dashboard never shows a location without a rate;
//   - groups: a standard rate goes on the default groups Products, Additional fees and, when the
//     source rate says shipping yes, Shipping and delivery (List Default Tax Groups, read once per
//     run); never Form payments. A custom-class rate goes on its own group;
//   - mappings: one Manual Tax Mapping per group, matched first on Wix's duplicate key (tax-build
//     manualTaxMappingDedupeKey), so a rerun writes nothing new and a 409 is adopted.
//   - prices with tax: the source's woocommerce_prices_include_tax goes on each region this
//     creates (taxIncludedInPrice) and, once per pass, on the site's tax settings when they differ;
// A site whose Products (or, for a shipping-yes rate, shipping) group has another name (another
// language), or with no single manual calculator, gets one cutover item per rate and nothing is
// written for it.
// The loop writes the crosswalk (`ownsCrosswalk: false`): the rate's target id is its first mapping.

const fs = require('node:fs');
const path = require('node:path');
const writers = () => require('../resources/rp-target-wix/lib/wix-writers');
const tax = () => require('../resources/rp-target-wix/lib/tax-build');

const SHIPPING_GROUP = 'Shipping and delivery';
const DEFAULT_GROUPS_ACTION = 'These standard tax rates were not imported: the site\'s default tax groups Products or Shipping and delivery could not be found by name (maybe the site is in another language). In the dashboard go to Tax, select each listed location (or add it with +Add Location), and enter the listed rate on the groups for products, additional fees and, only when the rate says shipping yes, shipping and delivery. Leave Form payments without a rate.';
const CALCULATOR_ACTION = 'These tax rates were not imported: the site has no single Wix manual tax calculator (it may use automatic tax). In the dashboard go to Tax: keep automatic tax and confirm it covers these locations, or switch to manual tax and enter each listed rate for its location.';

// Read once per task pass (`shared`), on the task's own client; reads carry no write grant. A failed
// read is not cached, so the next record reads again.
function once(shared, name, read) {
  shared.tax ||= {};
  if (!shared.tax[name]) shared.tax[name] = Promise.resolve().then(read).catch((error) => { delete shared.tax[name]; throw error; });
  return shared.tax[name];
}
const regionKey = ({ country, subdivision }) => tax().taxRegionDedupeKey({ country, subdivision: subdivision || null });

// The source's "prices entered with tax" (wc/v3/settings/tax woocommerce_prices_include_tax, read by
// the source extract into store-settings-tax.ndjson): true, false, or null when it was not read.
const SETTINGS_EXTRACT = path.join('data', 'source-extract', 'store-settings-tax.ndjson');
function sourcePricesIncludeTax(projectDir) {
  let text;
  try { text = fs.readFileSync(path.join(projectDir, SETTINGS_EXTRACT), 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row?.id !== 'woocommerce_prices_include_tax') continue;
    const value = String(row.value ?? row.default ?? '').trim().toLowerCase();
    return value === 'yes' ? true : value === 'no' ? false : null;
  }
  return null;
}
// Once per pass: the site's tax settings follow the source (shared by every Wix app on the site).
// Unknown source value: nothing is written. Written on the record's own client (a companion write).
async function syncTaxSettings(client, included, c) {
  if (included === null) return null;
  return once(c.shared, 'settings', async () => {
    const current = await c.primitives.getTaxSettings(c.taskClient || client);
    if (Boolean(current?.taxIncludedInItemPrices) === included) return { written: false };
    await c.primitives.upsertTaxSettings(client, { taxIncludedInItemPrices: included });
    return { written: true };
  });
}

async function ensureRegion(client, region, c) {
  // One page of regions (100): a store's tax locations fit; a site with more is an accepted limit.
  const list = await once(c.shared, 'regions', () => c.primitives.queryTaxRegions(c.taskClient || client));
  const wanted = regionKey(region);
  const found = list.filter((r) => regionKey({ country: r.country, subdivision: r.subdivision && r.subdivision !== '*' ? r.subdivision : null }) === wanted);
  if (found.length) return { id: found[0].id, created: false };
  const appId = await once(c.shared, 'appId', () => c.primitives.resolveManualTaxCalculatorAppId(c.taskClient || client));
  const included = await once(c.shared, 'pricesIncludeTax', () => sourcePricesIncludeTax(c.projectDir));
  const created = await c.primitives.createTaxRegion(client, tax().buildTaxRegionInput(region, { appId, taxIncludedInPrice: included === true }));
  if (!created?.id) throw Object.assign(new Error('create tax region returned no id'), { outcomeKnown: false });
  list.push(created);
  return { id: created.id, created: true };
}

// A standard rate goes on the store's default groups, by name (Elad 11-21, money policy): Products,
// Additional fees (when the site has it), and Shipping and delivery only when the source rate says
// shipping yes. Never Form payments or any other app's group (live 11-21: a Stores-only site lists
// Form payments, Products, Shipping and delivery and Additional fees). Products, and the shipping
// group for a shipping-yes rate, must be found by name; a site in another language where they
// cannot be found turns the rate into a cutover item instead of a guess.
const STANDARD_GROUPS = Object.freeze({ products: 'Products', shipping: SHIPPING_GROUP, fees: 'Additional fees' });
const groupsUnmatched = () => Object.assign(new Error('the site default tax groups cannot be matched'), { code: 'tax-default-groups-unmatched' });
async function groupIds(client, payload, input, c) {
  const own = payload.taxGroupId;
  if (!input.defaultGroups) return own ? [own] : [];
  const defaults = (await once(c.shared, 'defaultGroups', () => c.primitives.listDefaultTaxGroups(c.taskClient || client))).filter((g) => g?.id);
  const named = (name) => defaults.filter((g) => String(g.name || '').trim() === name);
  const products = named(STANDARD_GROUPS.products), shipping = named(STANDARD_GROUPS.shipping), fees = named(STANDARD_GROUPS.fees);
  if (products.length !== 1 || fees.length > 1) throw groupsUnmatched();
  if (input.shipping !== false && shipping.length !== 1) throw groupsUnmatched();
  return [products[0], ...(input.shipping !== false ? shipping : []), ...fees].map((g) => g.id);
}

// The region's mappings, read once per region (Query Manual Tax Mappings filtered by taxRegionId,
// as in the Wix docs example); a region holds one mapping per group, well under one page.
const regionMappings = (client, regionId, c) => once(c.shared, `mappings:${regionId}`, () => c.primitives.queryManualTaxMappings(c.taskClient || client, regionId));
async function writeMapping(client, mapping, c) {
  const key = tax().manualTaxMappingDedupeKey(mapping);
  const existing = await regionMappings(client, mapping.taxRegionId, c);
  const match = existing.find((m) => tax().manualTaxMappingDedupeKey(m) === key);
  if (match) return { id: match.id, reused: true };
  try {
    const created = await c.primitives.createManualTaxMapping(client, mapping);
    if (!created?.id) throw Object.assign(new Error('create manual tax mapping returned no id'), { outcomeKnown: false });
    existing.push(created);
    return { id: created.id, reused: false };
  } catch (error) {
    if (c.isInterruption?.(error)) throw error;
    // A duplicate (409) means it already exists: read again and adopt it.
    if (error?.status !== 409 && !/ALREADY_EXISTS/.test(String(error?.code || error?.message || ''))) throw error;
    delete c.shared.tax[`mappings:${mapping.taxRegionId}`];
    const again = (await regionMappings(client, mapping.taxRegionId, c)).find((m) => tax().manualTaxMappingDedupeKey(m) === key);
    if (!again) throw error;
    return { id: again.id, reused: true };
  }
}

const taxRate = {
  operation: 'createManualTaxMapping', steps: [], ownsCrosswalk: false,
  async send(client, payload, record, c) {
    const input = c.loopInput || {};
    const body = payload?.manualTaxMapping || payload || {};
    if (!input.region?.country) throw Object.assign(new Error('the tax rate build gave no region (loopInput.region)'), { requestSent: false, code: 'tax-region-missing' });
    let ids;
    try { ids = await groupIds(client, body, input, c); }
    catch (error) {
      if (c.isInterruption?.(error)) throw error;
      if (error?.code !== 'tax-default-groups-unmatched') throw error;
      await c.recordGap('tax-default-groups-unmatched', { operatorRole: 'Cutover Operator', severity: 'high', action: DEFAULT_GROUPS_ACTION, detail: { region: input.region, rate: body.taxRate } });
      return { deferred: 'tax-default-groups-unmatched' };
    }
    if (!ids.length) throw Object.assign(new Error('the tax rate has no tax group to write to'), { requestSent: false, code: 'tax-group-missing' });
    let region;
    try { region = await ensureRegion(client, input.region, c); }
    catch (error) {
      if (c.isInterruption?.(error)) throw error;
      if (!/resolveManualTaxCalculatorAppId/.test(String(error?.message))) throw error;
      await c.recordGap('tax-calculator-not-manual', { operatorRole: 'Cutover Operator', severity: 'high', action: CALCULATOR_ACTION, detail: { region: input.region, rate: body.taxRate } });
      return { deferred: 'tax-calculator-not-manual' };
    }
    await syncTaxSettings(client, await once(c.shared, 'pricesIncludeTax', () => sourcePricesIncludeTax(c.projectDir)), c);
    const written = [];
    for (const taxGroupId of ids) {
      const mapping = { ...body, taxGroupId, taxRegionId: region.id };
      written.push(await writeMapping(client, mapping, c));
    }
    return {
      base: { targetId: String(written[0].id), outcome: written.every((w) => w.reused) ? 'tax-rate-reused' : 'tax-rate-written' },
      steps: {},
      findings: [{ code: 'tax-rate-mappings', taxRegionId: String(region.id), regionCreated: region.created, mappingIds: written.map((w) => String(w.id)) }],
    };
  },
};

const primitives = {
  queryTaxRegions: (client) => writers().queryTaxRegions(client, { cursorPaging: { limit: 100 } }),
  resolveManualTaxCalculatorAppId: (client) => writers().resolveManualTaxCalculatorAppId(client),
  createTaxRegion: (client, taxRegion) => writers().createTaxRegion(client, taxRegion),
  listDefaultTaxGroups: (client) => writers().listDefaultTaxGroups(client),
  queryManualTaxMappings: (client, taxRegionId) => writers().queryManualTaxMappings(client, { filter: { taxRegionId }, cursorPaging: { limit: 100 } }),
  createManualTaxMapping: (client, mapping) => writers().createManualTaxMapping(client, mapping),
  getTaxSettings: (client) => writers().getTaxSettings(client),
  upsertTaxSettings: (client, taxSettings) => writers().upsertTaxSettings(client, taxSettings),
};

module.exports = { COMPOSITES: { 'tax/manual-tax-mapping': taxRate }, primitives, SHIPPING_GROUP, sourcePricesIncludeTax };
