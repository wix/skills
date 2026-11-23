'use strict';

// The fixed plan interpreter (design v2, P1).
//
// `buildFromPlan(entityPlan, { hooks })` returns `build(record, lookups)`, the one function
// runRecordTask needs. It builds the Wix body from the plan's own fieldMappings rows, so codegen no
// longer hand-writes the value logic for known fields:
//
//   identity / source-field  copy the source value (one `[]` level maps element by element)
//   constant                 write `value`
//   lookup                   the value map: `cases`, then `unknown` (hold / omit / write-as-is)
//   affix                    `prefix` + base result + `suffix` (the base is any other kind)
//   helper                   a fixed toolkit helper by name (HELPERS below), or a suggestion
//                            helper named `<resources path>#<export>` returning {record, findings, hold}
//
// Every row's valuePolicy applies first (missing / null / empty / zero → hold-record, omit, or go
// on), and output `appliesWhen` conditions pick the rows that apply to this record. Excluded,
// unresolved and deferred rows write nothing; rows for another target (the CMS source archive)
// belong to their own task. A hold becomes the builder hold the loop already knows
// ({ status: 'held', holds: [{ decisionId, code }] }): the gate journals it as a `builder-held`
// deferral and the runner turns it into a cutover task.
//
// Only `expression` and `instruction` rows, and helpers this file does not know, need AI-written
// code: one named hook per row (`hooks[rowId]`). A hook on a row the interpreter can build is
// refused, so a run cannot quietly re-invent a known field. References come from the loop's
// lookups (`lookups.ref(ref, key, path)`, import-task-runner lookupsFor); the ref is read from
// target knowledge (gateSuppliedReferences), never chosen here.

const path = require('node:path');
const { decodeHtmlEntities } = require('./link-census.js');
const wixBuild = require('../resources/rp-target-wix/lib/wix-build.js');
const { foldSelectionOptionsNote } = require('../resources/rp-target-wix/lib/selection-route.js');
const applicability = require('./output-applicability.js');

const RESOURCES = path.join(__dirname, '..', 'resources');
const SILENT = new Set(['excluded', 'unresolved', 'deferred-field']);
const HOLD_ACTIONS = new Set(['hold-record', 'return-to-mapping']);
const OMIT_ACTION = /^(omit|no-|not-applicable$|skip)/;
// The writer body each composite reads (import-task-runner COMPOSITES), when the plan names none.
const ENVELOPES = { 'crm/contact': 'contact', 'stores/product': 'product', 'ecom/order': 'order' };

function fail(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }

// --- paths ----------------------------------------------------------------------------------
// Template paths use `a.b[].c`; concrete paths `a.b[0].c`.
function get(obj, template) {
  if (obj === undefined || obj === null) return undefined;
  const at = template.indexOf('[]');
  if (at < 0) return template.split('.').reduce((v, k) => (v !== null && typeof v === 'object' ? v[k] : undefined), obj);
  const list = at === 0 ? obj : get(obj, template.slice(0, at));
  if (!Array.isArray(list)) return undefined;
  const rest = template.slice(at + 2).replace(/^\./, '');
  return rest ? list.map(el => get(el, rest)) : list;
}
function tokens(concrete) { return concrete.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean); }
function set(obj, concrete, value) {
  const keys = tokens(concrete);
  let node = obj;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) { node[key] = value; return; }
    if (node[key] === undefined || node[key] === null || typeof node[key] !== 'object') node[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    node = node[key];
  });
}
function readConcrete(obj, concrete) { return tokens(concrete).reduce((v, k) => (v !== null && typeof v === 'object' ? v[k] : undefined), obj); }
const depth = p => (p.match(/\[\]/g) || []).length;
const fill = (template, index) => template.replace('[]', `[${index}]`);
const flat = v => (Array.isArray(v) ? v.flat(Infinity) : [v]);

// --- value states and policy ----------------------------------------------------------------
function stateOf(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) { const inner = value.map(stateOf); return inner.includes('present') ? 'present' : inner.includes('zero') ? 'zero' : 'empty'; }
  if (typeof value === 'string' && !value.trim()) return 'empty';
  if (typeof value === 'object' && !Object.keys(value).length) return 'empty';
  if (value === 0 || (typeof value === 'string' && /^0+(\.0+)?$/.test(value.trim()))) return 'zero';
  return 'present';
}
const RANK = ['missing', 'null', 'empty', 'zero', 'present'];
function combinedState(values) { return values.map(stateOf).reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'missing'); }
// What the row's valuePolicy says for this state: go on, omit the row, or hold the record.
function policyFor(row, state, fallbackCode) {
  if (state === 'present') return { go: true };
  const rule = row.valuePolicy?.[state], action = rule?.action;
  if (!action) return { go: true };
  if (HOLD_ACTIONS.has(action)) return { hold: { decisionId: row.id, code: rule.code || fallbackCode || (action === 'return-to-mapping' ? 'MAPPING_DECISION_REQUIRED' : `${row.id}-${state}`) } };
  if (OMIT_ACTION.test(action)) return { omit: true };
  return { go: true };
}

// --- conditions (output appliesWhen) -------------------------------------------------------
// One evaluator for the contract's grammar: every leaf op the mapping gate accepts
// (lib/output-applicability.js) is evaluated by that module, so the gate and the builder agree
// on what a plan's appliesWhen means. `not` is kept for plans written before the grammar closed.
function applies(cond, record, ctx) {
  if (!cond) return true;
  switch (cond.op) {
    case 'all': return (cond.of || []).every(c => applies(c, record, ctx));
    case 'any': return (cond.of || []).some(c => applies(c, record, ctx));
    case 'not': return !applies(cond.of?.[0] || cond.condition, record, ctx);
    default: break;
  }
  if (!applicability.OPS.includes(cond.op)) throw fail('PLAN_BUILDER_CONDITION_UNKNOWN', `appliesWhen op ${cond.op} is not known`);
  return applicability.evaluate(cond, record, ctx);
}

// --- fixed helpers ---------------------------------------------------------------------------
// Each takes (record, ctx) and returns { values?: {targetPath: value}, canonical?: true,
// hold?: {code}, findings?, loopInput? }. `canonical` helpers fill the Stores product canonical
// record (wix-build) that the product composer turns into the Catalog V3 body; the Wix shape of a
// product (options, variants, inventory, media) is toolkit knowledge, not an operator choice.
const blank = v => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const text = v => (blank(v) ? undefined : decodeHtmlEntities(String(v)).trim() || undefined);
const argPath = (ctx, name, fallback) => (typeof ctx.args?.[name] === 'string' ? ctx.args[name].split(' ')[0] : fallback);
const relative = (template, base) => template.slice(base.length).replace(/^\./, '');
function variantStock(src, args) {
  const tracked = get(src, args.tracked || 'manage_stock');
  if (tracked === true) {
    const q = blank(get(src, args.quantity || 'stock_quantity')) ? 0 : Number(get(src, args.quantity || 'stock_quantity'));
    const [low, high] = Array.isArray(args.clamp) ? args.clamp : [0, Infinity];
    return { inventoryTracked: true, inventoryQuantity: Number.isInteger(q) ? Math.min(Math.max(q, low), high) : low };
  }
  // WooCommerce stock_status vocabulary: instock / onbackorder are in stock, outofstock is not.
  return { inventoryTracked: false, inStock: get(src, args.status || 'stock_status') !== 'outofstock' };
}
function variantPrice(src, args) {
  const price = get(src, args.price || 'regular_price'), sale = get(src, args.discountedPrice || 'sale_price');
  return { price, ...(!blank(sale) && String(sale) !== '0' ? { discountedPrice: sale } : {}) };
}
const HELPERS = {
  'wix-build.buildProduct': {
    canonical: true,
    run(record, ctx) {
      const value = get(record, ctx.source);
      const name = ctx.args?.decodeEntities === false ? (blank(value) ? undefined : String(value).trim()) : text(value);
      if (!name) return { hold: { code: `${ctx.row.id}-invalid` }, invalid: true };
      ctx.canonical.name = name;
      return { canonicalField: 'name' };
    },
  },
  'wix-build.composeProductDescription': {
    canonical: true,
    run(record, ctx) {
      const order = Array.isArray(ctx.args?.order) ? ctx.args.order : ctx.row.sourcePaths;
      const [first, second] = order.length > 1 ? order : [undefined, order[0]];
      const long = get(record, second), short = first ? get(record, first) : undefined;
      if (!blank(long)) ctx.canonical.description = long;
      if (!blank(short)) ctx.canonical.shortDescription = short;
      ctx.descriptionRow = ctx.row;
      return {};
    },
  },
  'wix-build.toWixSlug': {
    canonical: true,
    run(record, ctx) {
      const raw = get(record, ctx.row.sourcePaths[0]);
      let slug;
      if (!blank(raw)) { try { slug = decodeURIComponent(String(raw)); } catch { slug = String(raw); } }
      if (!slug && typeof ctx.args?.fallback === 'string') slug = ctx.args.fallback.replace(/<([^>]+)>/g, (_, key) => String(get(record, key)));
      if (slug) ctx.canonical.slug = slug;
      return { canonicalField: 'slug' };
    },
  },
  'wix-build.buildMedia': {
    canonical: true,
    run(record, ctx) {
      const url = argPath(ctx, 'url', 'images[].src'), base = url.slice(0, url.indexOf('[]') + 2);
      const list = get(record, base.slice(0, -2)) || [];
      const alt = argPath(ctx, 'altText'), name = argPath(ctx, 'displayName');
      const kept = list.filter(i => i && !blank(get(i, relative(url, base))));
      ctx.canonical.images = kept.map(i => ({
        url: get(i, relative(url, base)),
        altText: alt ? text(get(i, relative(alt, base))) : undefined,
        displayName: name ? text(get(i, relative(name, base))) : undefined,
      }));
      // The loop's picture guard confirms each gallery item against its source media record: one
      // source media id per kept item, in order (`arguments.sourceId`, default the item's `id`).
      const id = relative(argPath(ctx, 'sourceId', `${base}.id`), base);
      return kept.length ? { loopInput: { pictureSourceIds: kept.map(i => (blank(get(i, id)) ? null : get(i, id))) } } : {};
    },
  },
  'wix-build.buildVariantPrice': {
    canonical: true,
    run(record, ctx) {
      const args = { price: argPath(ctx, 'price', 'regular_price'), discountedPrice: argPath(ctx, 'discountedPrice', 'sale_price') };
      if (blank(get(record, args.price))) return { hold: { code: 'product-price-missing' }, invalid: true };
      ctx.canonical.optionNames = [];
      ctx.canonical.variants = [{ ...(ctx.canonical.variants?.[0] || {}), choices: [], ...variantPrice(record, args) }];
      return {};
    },
  },
  'stores-inventory.inventoryForVariant': {
    canonical: true,
    run(record, ctx) {
      ctx.canonical.variants = [{ ...(ctx.canonical.variants?.[0] || { choices: [] }), ...variantStock(record, ctx.args || {}) }];
      return {};
    },
  },
  // Variable products: one variant per child row, options in first-seen order. A child with no
  // attribute ("Any") is no Wix variant: it holds (the C1 suggestion routes it to modifiers).
  'wix-build.buildOptions+buildVariants': {
    canonical: true,
    run(record, ctx) {
      const choicesPath = argPath(ctx, 'choices', '_variations[].attributes[]');
      const listPath = choicesPath.slice(0, choicesPath.indexOf('[]'));
      const attrPath = relative(choicesPath, `${listPath}[]`).replace(/\[\]$/, '');
      const children = get(record, listPath) || [];
      if (children.some(child => !(get(child, attrPath) || []).length)) return { hold: { code: 'product-variation-any-attribute' }, invalid: true };
      const priceArgs = { price: relative(argPath(ctx, 'price', `${listPath}[].regular_price`), `${listPath}[]`), discountedPrice: relative(argPath(ctx, 'discountedPrice', `${listPath}[].sale_price`), `${listPath}[]`) };
      if (children.some(child => blank(get(child, priceArgs.price)))) return { hold: { code: 'product-variation-price-missing' }, invalid: true };
      const names = [];
      for (const child of children) for (const a of get(child, attrPath)) { const n = text(a.name); if (!names.includes(n)) names.push(n); }
      ctx.canonical.optionNames = names;
      ctx.canonical.variants = children.map(child => ({
        choices: get(child, attrPath).map(a => ({ optionName: text(a.name), choiceName: text(a.option) })),
        ...variantPrice(child, priceArgs),
        ...(blank(child.sku) ? {} : { sku: String(child.sku) }),
        ...(blank(child.weight) ? {} : { weight: Number(child.weight) }),
        ...variantStock(child, {}),
      }));
      return { loopInput: { variantKeys: children.map(child => `${ctx.keyPrefixes.variation}${child.id}`) } };
    },
  },
  // Generic values, per output: the first populated of `arguments.paths` (else the output's own
  // sourcePaths, in order), entity-decoded and trimmed; `number` and `money` (2-decimal string)
  // on top. A value that is not a number holds through the row's invalid policy.
  'value.text': { run: (record, ctx) => valuesPer(record, ctx, v => v) },
  'value.number': { run: (record, ctx) => valuesPer(record, ctx, v => (Number.isFinite(Number(v)) ? Number(v) : INVALID)) },
  'value.money': { run: (record, ctx) => valuesPer(record, ctx, v => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : INVALID)) },
  // References: the target ref is target knowledge (gateSuppliedReferences); the source key is
  // `<entityRef>:<id>`. A value the loop cannot resolve is left out; the gate records why.
  // A parent in the same entity (a category's parent): the loop writes it after the parent lands
  // (import-task-runner hierarchyOf, from this row's output), so the builder writes nothing.
  'same-entity-hierarchy': { loopOwned: true },
  'dependency-gate.resolveReference': { reference: true },
  'stores-category-attach': { reference: true },
};
const INVALID = Symbol('invalid');
function valuesPer(record, ctx, convert) {
  const values = {};
  for (const o of ctx.outputs) {
    const paths = Array.isArray(ctx.args?.paths) ? ctx.args.paths : (o.sourcePaths || ctx.row.sourcePaths);
    if (depth(o.targetPath) === 1 && paths.length === 1 && depth(paths[0]) === 1) {
      (get(record, paths[0]) || []).forEach((raw, i) => { const v = text(raw); if (v !== undefined) values[fill(o.targetPath, i)] = convert(v); });
      continue;
    }
    const v = paths.map(p => text(get(record, p))).find(x => x !== undefined);
    if (v !== undefined) values[o.targetPath] = convert(v);
  }
  if (Object.values(values).includes(INVALID)) return { hold: {} };
  return { values };
}
function helperFor(row, transform) {
  const name = String(transform.name || '');
  if (name.includes('#')) {
    const [file, exported] = name.split('#');
    let mod;
    try { mod = require(path.resolve(RESOURCES, file)); } catch { return null; }
    if (typeof mod[exported] !== 'function') return null;
    return { module: true, run: (record, ctx) => mod[exported](record, { choices: ctx.choices, lookups: ctx.lookups, args: ctx.args, keyPrefixes: ctx.keyPrefixes }) };
  }
  return HELPERS[name.replace(/\(.*$/s, '').trim()] || null;
}

// --- row plans -------------------------------------------------------------------------------
const DIRECT = new Set(['identity', 'source-field', 'constant', 'lookup']);
// An `expression` row whose `builder` names a suggestion helper (`<path>#<export>`) runs that
// helper: a target rule copied verbatim (assertKnownMappings) keeps its prose and its executable.
function effective(row, t) {
  if (t?.kind !== 'expression' || typeof row.builder !== 'string' || !row.builder.includes('#')) return t;
  const helper = { kind: 'helper', name: row.builder, arguments: t.arguments || {} };
  return helperFor(row, helper) ? helper : t;
}
// Why a transform needs a hook, or null when the interpreter builds it.
function hookReason(row, t) {
  t = effective(row, t);
  if (!t || typeof t !== 'object') return 'no transform';
  if (t.kind === 'affix') return t.base ? hookReason(row, t.base) : null;
  if (t.kind === 'expression' || t.kind === 'instruction') return t.kind;
  if (t.kind === 'helper') {
    const helper = helperFor(row, t);
    if (!helper) return `helper ${t.name} is not a toolkit helper`;
    if (helper.reference && !row.referencePolicy && !t.arguments?.entityRef) return 'reference helper without entityRef';
    return null;
  }
  if (DIRECT.has(t.kind)) {
    if (row.outputs.some(o => depth(o.targetPath) > 1)) return 'nested arrays';
    return null;
  }
  return `unknown kind ${t.kind}`;
}
// Follow-up steps the entity's composite runs from loopInput.evidence (import-task-runner
// COMPOSITES: importOrderHistory writes the payments and refunds). A row for one of these refs
// builds evidence, never body fields.
// Findings that become a cutover task on the landed record (the runner records each one with an
// `action` as a task gap; completion-report lists it as an operatorAction).
const FINDING_ACTIONS = {
  'product-name-truncated': { severity: 'low', operatorRole: 'Cutover Operator',
    action: 'Wix allows 80 characters in a product name, so these product names were cut to 80 (after the plan\'s changes, such as a name prefix). In Business Manager, open each product and shorten its name; the full name is in fullName.' },
};
const STEP_REFS = { 'ecom/order': ['ecom/order-payment', 'ecom/order-refund', 'ecom/order-transaction'] };
const forThis = (o, targetRef) => !o.targetRef || o.targetRef === targetRef || (STEP_REFS[targetRef] || []).includes(o.targetRef);
const stepRow = (row, targetRef) => row.outputs.every(o => o.targetRef && (STEP_REFS[targetRef] || []).includes(o.targetRef));
function activeRow(row, targetRef) {
  if (!row || SILENT.has(row.disposition) || !Array.isArray(row.outputs) || !row.outputs.length) return false;
  return row.outputs.some(o => forThis(o, targetRef));
}

// Which rows the interpreter builds and which need a hook. The after-codegen dry run and the end
// report read this; a run's measure is how few hooks it needs.
function planBuilderCoverage(entityPlan, { hooks = {} } = {}) {
  const interpreted = [], hooked = [], missing = [], refused = [], skipped = [];
  for (const row of entityPlan.fieldMappings || []) {
    if (!activeRow(row, entityPlan.targetRef)) { skipped.push(row?.id); continue; }
    const reason = hookReason(row, row.transform);
    if (reason === null) { (hooks[row.id] ? refused : interpreted).push(row.id); continue; }
    (hooks[row.id] ? hooked : missing).push({ id: row.id, reason });
  }
  return { interpreted, hooked, missing, refused, skipped };
}

// --- the builder ---------------------------------------------------------------------------
function buildFromPlan(entityPlan, { hooks = {}, choices = {}, keyPrefixes = {} } = {}) {
  if (!entityPlan || !Array.isArray(entityPlan.fieldMappings)) throw fail('PLAN_BUILDER_ENTITY_INVALID', 'buildFromPlan needs a plan entity with fieldMappings');
  const targetRef = entityPlan.targetRef;
  const coverage = planBuilderCoverage(entityPlan, { hooks });
  if (coverage.missing.length) throw fail('PLAN_BUILDER_HOOK_MISSING', `plan rows need a hook: ${coverage.missing.map(m => `${m.id} (${m.reason})`).join('; ')}`, { rows: coverage.missing });
  if (coverage.refused.length) throw fail('PLAN_BUILDER_HOOK_NOT_ALLOWED', `the toolkit builds these rows from the plan, so a hook would bypass it: ${coverage.refused.join(', ')}. To change one, change its plan row (affix, constant, source-field, lookup, excluded), or make it an \`instruction\` row, which takes a hook`, { rows: coverage.refused });
  const unknownHooks = Object.keys(hooks).filter(id => !coverage.hooked.some(h => h.id === id));
  if (unknownHooks.length) throw fail('PLAN_BUILDER_HOOK_UNKNOWN', `hooks for rows not in this entity's plan: ${unknownHooks.join(', ')}`, { rows: unknownHooks });
  const shape = require('./writer-request-shape.js').shape(targetRef, entityPlan.preferredWrite?.writerId);
  const envelope = entityPlan.preferredWrite?.requestInput || ENVELOPES[targetRef] || shape?.requestInput || null;
  // Source stable keys are `<source entity>:<id>`; a variant is keyed by its own variation row.
  const prefixes = { variation: 'product-variation:', 'stores/product-variant': 'product-variation:', ...keyPrefixes };
  const rows = entityPlan.fieldMappings.filter(row => activeRow(row, targetRef));
  // Choices recorded on the plan's rows (B1 `choice`, suggestion `choices[]`) fill in what the
  // caller does not pass. The caller's values win: a row's `choice.value` may be the report's
  // wording ("on-hold=PENDING") rather than the value a helper reads.
  const planChoices = applicability.planChoiceValues(entityPlan);
  Object.assign(planChoices, choices);
  const refs = concrete => require('./dependency-readiness.js').gateSuppliedReferences([targetRef], concrete);
  const auxiliary = concrete => refs(concrete).some(r => r.kind === 'auxiliary');
  const isProduct = targetRef === 'stores/product';

  return async function build(record, lookups = {}) {
    const holds = [], findings = [], loopInput = {}, canonical = {}, body = {}, top = {}, affixed = new Set(), composeOptions = {}, post = [], placeholders = new Set();
    let pricedByHook = null;
    const ctxBase = { canonical, lookups, choices: planChoices, keyPrefixes: prefixes };
    const hold = (row, code) => holds.push({ decisionId: row.id, code });
    // A template path (`a[].b`) writes the same value on every element the body already has
    // (a simple product's one variant), or on the first one.
    const write = (concrete, value) => {
      if (value === undefined) return;
      if (concrete.includes('[]')) { const all = concretePaths(body, concrete); for (const p of all.length ? all : [concrete.replace(/\[\]/g, '[0]')]) write(p, value); return; }
      set(auxiliary(concrete) ? top : body, concrete, value);
    };
    const outputsOf = row => row.outputs.filter(o => forThis(o, targetRef) && applies(o.appliesWhen, record, { choices: planChoices }));
    const sourcesOf = (row, outputs) => [...new Set(outputs.flatMap(o => o.sourcePaths || []).concat(outputs.some(o => o.sourcePaths) ? [] : row.sourcePaths || []))];
    // A helper or hook said the value is invalid: the invalid policy decides.
    const invalid = (row, code) => { const step = policyFor(row, 'invalid', code); if (step.hold) holds.push(step.hold); };

    // One transform's values per output, for the direct kinds.
    const direct = (row, t, outputs) => {
      const out = [];
      for (const o of outputs) {
        if (t.kind === 'constant') { out.push([o.targetPath, t.value]); continue; }
        const src = t.kind === 'source-field' ? t.sourcePath : (o.sourcePaths || row.sourcePaths)[0];
        const raw = get(record, src);
        const mapOne = value => {
          if (t.kind !== 'lookup') return { value };
          if (value !== undefined && value !== null && Object.hasOwn(t.cases, String(value))) return { value: t.cases[String(value)] };
          const rule = t.unknown || row.valuePolicy?.unknown || {};
          if (HOLD_ACTIONS.has(rule.action)) return { hold: rule.code || `${row.id}-unknown` };
          if (rule.action === 'write-as-is') return { value };
          return {};
        };
        if (depth(o.targetPath) === 1 && depth(src) === 1 && Array.isArray(raw)) {
          raw.forEach((value, i) => { const r = mapOne(value); if (r.hold) hold(row, r.hold); else out.push([fill(o.targetPath, i), r.value]); });
        } else if (depth(o.targetPath) === 1) {
          const r = mapOne(raw); if (r.hold) { hold(row, r.hold); continue; }
          const list = readConcrete(body, o.targetPath.slice(0, o.targetPath.indexOf('[]')));
          const count = Array.isArray(list) && list.length ? list.length : 1;
          for (let i = 0; i < count; i += 1) out.push([fill(o.targetPath, i), r.value]);
        } else {
          const r = mapOne(raw); if (r.hold) hold(row, r.hold); else out.push([o.targetPath, r.value]);
        }
      }
      return out;
    };
    let canonicalBody = null;
    // Reference outputs only: other outputs of the row (an app id, a preset) come from other rows.
    const reference = (row, t, outputs) => {
      const policy = row.referencePolicy || {};
      const entityRef = t.arguments?.entityRef || policy.entityRef;
      for (const o of outputs) {
        const input = (o.sourcePaths || [policy.input || t.arguments?.input || row.sourcePaths[0]])[0];
        const ids = get(record, input);
        const list = Array.isArray(ids) ? ids : [ids];
        const compact = depth(o.targetPath) === 1 && /many/.test(String(policy.cardinality || 'many')) && !/per line/.test(String(policy.cardinality || ''));
        let n = 0;
        list.forEach((id, i) => {
          if (blank(id) || id === 0) return;
          const concrete = depth(o.targetPath) ? fill(o.targetPath, compact ? n : i) : o.targetPath;
          const found = refs(concrete)[0];
          if (!found) return;
          const resolve = typeof lookups.ref === 'function' ? lookups.ref : lookups.resolveReference;
          const value = typeof resolve === 'function' ? resolve(found.ref, `${prefixes[found.ref] || prefixes[entityRef] || `${entityRef}:`}${id}`, concrete) : undefined;
          if (value === undefined || value === null) return;
          write(concrete, value); n += 1;
        });
      }
    };
    // Hooks and suggestion helpers may return a plain value (one output) or a result object.
    const RESULT_KEYS = ['hold', 'values', 'record', 'value', 'findings', 'loopInput', 'canonicalField', 'status'];
    const applyResult = (row, result, outputs) => {
      if (result === undefined) return;
      if (typeof result !== 'object' || result === null || Array.isArray(result) || !RESULT_KEYS.some(k => Object.hasOwn(result, k))) {
        if (Object.keys(result || {}).length === 0 && result && typeof result === 'object' && !Array.isArray(result)) return;
        if (outputs.length !== 1) throw fail('PLAN_BUILDER_HOOK_RESULT', `${row.id}: a hook or helper for several outputs returns { values: { <targetPath>: value } }`);
        write(outputs[0].targetPath, result === null ? undefined : result);
        return;
      }
      if (result.findings) findings.push(...result.findings.map(f => ({ decisionId: row.id, ...f })));
      if (result.loopInput) Object.assign(loopInput, result.loopInput);
      if (result.hold) { invalid(row, result.hold.code); return; }
      if (result.status === 'held' && Array.isArray(result.holds)) { for (const h of result.holds) invalid(row, h.code); return; }
      if (result.record && typeof result.record === 'object') { merge(body, result.record); return; }
      if (result.values) { for (const [p, v] of Object.entries(result.values)) write(p, v); return; }
      if (Object.hasOwn(result, 'value')) for (const o of outputs) write(o.targetPath, result.value);
    };
    // Runs one row's transform (or its base, for affix) in the given phase.
    const runRow = async (row, t, outputs, phase) => {
      t = effective(row, t);
      if (t.kind === 'affix') {
        // Over a product canonical field (name, slug), the affix applies before the composer, so
        // Wix's caps (an 80-character name) see the changed value.
        const field = await runRow(row, t.base || { kind: 'identity' }, outputs, phase);
        if (phase === 'canonical' && typeof field === 'string' && typeof canonical[field] === 'string') {
          canonical[field] = `${t.prefix || ''}${canonical[field]}${t.suffix || ''}`;
          affixed.add(row.id);
        }
        return;
      }
      const hookName = hookReason(row, t) ? row.id : null;
      if (hookName) {
        if (phase !== 'body') return;
        applyResult(row, await hooks[hookName](record, { row, lookups, choices, outputs, body }), outputs);
        return;
      }
      if (t.kind === 'helper') {
        const helper = helperFor(row, t);
        // On a product, a suggestion helper runs before the composer: it may add to the canonical
        // record (`canonical`) and to buildProduct's options (`composeOptions`, e.g. connected
        // modifiers or an SEO plan); its body fragment applies after the composer.
        if (helper.loopOwned) return;
        const early = helper.canonical || (helper.module && isProduct);
        if (Boolean(early) !== (phase === 'canonical')) return;
        if (helper.reference) return reference(row, t, outputs);
        const ctx = { ...ctxBase, row, args: t.arguments, outputs, source: (outputs[0]?.sourcePaths || row.sourcePaths)[0] };
        const result = await helper.run(record, ctx);
        if (helper.module && isProduct && result && typeof result === 'object' && !Array.isArray(result)) {
          const { canonical: part, composeOptions: options, ...rest } = result;
          if (part) merge(canonical, part, { byIndex: true });
          if (options) Object.assign(composeOptions, options);
          if (result.hold || result.status === 'held') { applyResult(row, rest, outputs); return; }
          const { canonicalField, ...after } = rest;
          if (part || options) { if (Object.keys(after).length) post.push(() => applyResult(row, after, outputs)); return canonicalField; }
          post.push(() => applyResult(row, result, outputs));
          return;
        }
        if (ctx.descriptionRow) ctxBase.descriptionRow = ctx.descriptionRow;
        applyResult(row, result, outputs);
        return result?.canonicalField;
      }
      if (phase !== 'body') return;
      for (const [p, v] of direct(row, t, outputs)) write(p, v);
    };

    const live = [];
    for (const row of rows) {
      const outputs = outputsOf(row);
      if (!outputs.length) continue;
      const step = policyFor(row, combinedState(sourcesOf(row, outputs).map(p => get(record, p))));
      if (step.hold) { holds.push(step.hold); continue; }
      if (step.omit) continue;
      live.push({ row, outputs });
    }
    // 1. Product canonical helpers, then the fixed Catalog V3 composer.
    if (isProduct) {
      for (const { row, outputs } of live) await runRow(row, row.transform, outputs, 'canonical');
      // An operator instruction on a variant price (raise 10%, round) is a hook, which runs after
      // the composer. The composer gets a placeholder price; it is removed, and the hook must
      // write the price, or the record holds (never a 0.00 price).
      for (const { row, outputs } of live) {
        if (!hookReason(row, row.transform) || !outputs.some(o => /^variantsInfo\.variants\[\]\.price\./.test(o.targetPath))) continue;
        pricedByHook ||= row;
        canonical.variants = canonical.variants?.length ? canonical.variants : [{ choices: [] }];
        canonical.variants.forEach((v, i) => { if (blank(v.price)) { v.price = 0; placeholders.add(i); } });
      }
      if (!holds.length && canonical.name) {
        canonical.sourceId = record[entityPlan.primaryKey || 'id'];
        canonical.optionNames ||= [];
        foldSelectionOptionsNote(canonical);
        try { canonicalBody = wixBuild.buildProduct(canonical, { ...composeOptions, findings }); }
        catch (error) {
          if (/caps plainDescription/.test(error.message) && ctxBase.descriptionRow) invalid(ctxBase.descriptionRow, 'product-description-too-long');
          else if (/produced no variant/.test(error.message)) holds.push({ decisionId: rows.find(r => /variant|price/.test(r.id))?.id || rows[0].id, code: 'product-no-variant' });
          else throw error;
        }
        if (canonicalBody) Object.assign(body, canonicalBody);
        // Wix's caps apply after the plan's transforms (an operator prefix counts toward the 80);
        // a cut value is a change the merchant should see, so its finding names the cutover step.
        for (const f of findings) if (FINDING_ACTIONS[f.code] && !f.action) Object.assign(f, FINDING_ACTIONS[f.code]);
        for (const i of placeholders) if (body.variantsInfo?.variants?.[i]) delete body.variantsInfo.variants[i].price;
      }
      for (const apply of post) apply();
      // The product composite keys each variant to its source variation (order lines look it up):
      // a variants row that gave each canonical variant its source id but no keys gets them here,
      // in body order (buildProduct keeps the canonical variant order).
      const built = body.variantsInfo?.variants || [], from = canonical.variants || [];
      if (canonicalBody && !loopInput.variantKeys && built.length === from.length
        && from.every(v => !blank(v?.sourceId) && String(v.sourceId) !== String(canonical.sourceId))) loopInput.variantKeys = from.map(v => `${prefixes.variation}${v.sourceId}`);
    }
    // 2. Every other row writes its outputs; hooks run here. A follow-up step row (payments,
    // refunds) hands its evidence to the composite instead, through its `arguments.evidence`
    // helper when it names one, honoring the plan's choices.
    for (const { row, outputs } of live) {
      if (!stepRow(row, targetRef)) { await runRow(row, row.transform, outputs, 'body'); continue; }
      const t = effective(row, row.transform);
      const named = t?.kind === 'helper' && typeof t.arguments?.evidence === 'string' && t.arguments.evidence.includes('#') ? helperFor(row, { name: t.arguments.evidence }) : null;
      const result = named ? await named.run(record, { ...ctxBase, row, args: t.arguments, outputs })
        : hookReason(row, t) ? await hooks[row.id](record, { row, lookups, choices: ctxBase.choices, outputs, body })
          : await helperFor(row, t)?.run(record, { ...ctxBase, row, args: t.arguments, outputs });
      if (result?.findings) findings.push(...result.findings.map(f => ({ decisionId: row.id, ...f })));
      if (result?.hold || result?.status === 'held') { applyResult(row, { hold: result.hold, status: result.status, holds: result.holds }, outputs); continue; }
      if (result?.evidence) loopInput.evidence = merge(loopInput.evidence || {}, result.evidence);
    }
    // 3. Operator affixes over what their base wrote.
    for (const { row, outputs } of live) {
      if (row.transform?.kind !== 'affix' || affixed.has(row.id)) continue;
      for (const o of outputs) for (const concrete of concretePaths(body, o.targetPath)) {
        const value = readConcrete(body, concrete);
        if (typeof value === 'string' && value) set(body, concrete, `${row.transform.prefix || ''}${value}${row.transform.suffix || ''}`);
      }
    }
    for (const i of placeholders) if (canonicalBody && blank(readConcrete(body, `variantsInfo.variants[${i}].price.actualPrice.amount`))) holds.push({ decisionId: pricedByHook.id, code: `${pricedByHook.id}-not-built` });
    if (holds.length) return { status: 'held', holds: dedupe(holds) };
    const payload = { ...(envelope ? { [envelope]: body } : body), ...top };
    if (findings.length) loopInput.findings = findings;
    return Object.keys(loopInput).length ? { ...payload, loopInput } : payload;
  };
}
function concretePaths(body, template) {
  const at = template.indexOf('[]');
  if (at < 0) return [template];
  const list = readConcrete(body, template.slice(0, at));
  if (!Array.isArray(list)) return [];
  return list.flatMap((_, i) => concretePaths(body, fill(template, i)));
}
// `byIndex` (the product canonical record): two arrays of plain objects merge element by element,
// so the price, SKU, weight and stock rows each add to the same variants[0].
const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(target, source, { byIndex = false } = {}) {
  for (const [k, v] of Object.entries(source)) {
    if (byIndex && Array.isArray(v) && Array.isArray(target[k]) && v.every(plainObject) && target[k].every(plainObject)) {
      v.forEach((item, i) => { target[k][i] = plainObject(target[k][i]) ? merge(target[k][i], item, { byIndex }) : item; });
    } else if (plainObject(v) && plainObject(target[k])) merge(target[k], v, { byIndex });
    else if (v !== undefined) target[k] = v;
  }
  return target;
}
function dedupe(holds) {
  const seen = new Set();
  return holds.filter(h => { const k = `${h.decisionId}:${h.code}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { buildFromPlan, planBuilderCoverage, HELPERS, stateOf, applies };
