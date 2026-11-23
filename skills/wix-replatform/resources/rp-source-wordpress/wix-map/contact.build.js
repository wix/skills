'use strict';

// Sample builders for the WooCommerce customer -> Wix contact suggestions (contact.json).
//
// Each exported row helper takes one WooCommerce customer (GET /wc/v3/customers shape) and a
// context `{ choices }`, and returns `{ record, findings, hold }`:
//   - record: the part of the Contacts V5 `contact` body this row writes (nothing for "omit")
//   - findings: per-record notes for the report
//   - hold: `{ code }` when the record must be held, else null
// `buildContact` merges every row. Codegen copies or calls these as the per-entity build step; the
// fixed loop (importContacts) does the lookups, writes, retries and logging. An operator change
// (a prefix, a dropped field, another choice) goes into the plan row, never into this file.

const { decodeHtmlEntities } = require('../../../lib/link-census.js');
const suggestions = require('./contact.json');

// Choices in the plan's own shape (B1): a row's `choice`, plus entity `choices[]` for the rest.
// Every choice of a suggestion file (or plan entity): rows' `choice` first, then entity `choices[]`.
function suggestionChoices(map) { return [...(map.fieldMappings || []).filter((r) => r.choice).map((r) => ({ decisionId: r.id, ...r.choice })), ...(map.choices || [])]; }
const ALL_CHOICES = Object.freeze(suggestionChoices(suggestions));
const DEFAULT_CHOICES = Object.freeze(Object.fromEntries(ALL_CHOICES.map((c) => [c.name, c.default])));

function text(value) {
  if (value === undefined || value === null) return null;
  const out = decodeHtmlEntities(String(value)).trim();
  return out.length ? out : null;
}
function firstOf(record, paths) {
  for (const p of paths) {
    const value = text(p.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), record));
    if (value !== null) return value;
  }
  return null;
}
function choicesOf(ctx) { return { ...DEFAULT_CHOICES, ...((ctx && ctx.choices) || {}) }; }
// A finding with a cutover task carries it (action, operatorRole, severity), so the loop records it
// on the landed record (recordTaskGap) and it reaches the completion report in a real run.
const withTask = (f) => (f && FINDING_ACTIONS[f.code] && !f.action ? { ...f, operatorRole: 'Cutover Operator', ...FINDING_ACTIONS[f.code] } : f);
const result = (record = {}, findings = [], hold = null) => ({ record, findings: findings.map(withTask), hold });

// Simple address check only: Contacts rejects an address without "@" and a dot after it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactName(customer) {
  const first = firstOf(customer, ['first_name', 'billing.first_name', 'shipping.first_name']);
  const last = firstOf(customer, ['last_name', 'billing.last_name', 'shipping.last_name']);
  if (first === null && last === null) return result();
  return result({ name: { ...(first !== null ? { first } : {}), ...(last !== null ? { last } : {}) } });
}

function contactEmail(customer) {
  const email = text(customer.email);
  if (email === null) return result();
  if (!EMAIL.test(email)) return result({}, [{ code: 'contact-email-invalid' }], { code: 'contact-email-invalid' });
  return result({ email: { email } });
}

function contactPhone(customer) {
  const phone = firstOf(customer, ['billing.phone', 'shipping.phone']);
  return phone === null ? result() : result({ phone: { phone } });
}

// Contacts V5 company is an object ({ name, jobTitle }); a string makes Wix refuse the whole bulk
// batch with "Expected an object" (T-findings 19, live).
function contactCompany(customer) {
  const company = firstOf(customer, ['billing.company', 'shipping.company']);
  return company === null ? result() : result({ company: { name: company.slice(0, 100) } });
}

// ISO 3166-2 needs the country prefix ("US" + "CO" -> "US-CO"). A state that already carries one
// is kept; WooCommerce's prefixed form without the hyphen ("JP" + "JP13") gets it ("JP-13"); a
// state without a country cannot be qualified and is left out with a finding.
function subdivision(country, state, findings, part) {
  if (state === null) return null;
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(state)) return state;
  if (country !== null && state.toUpperCase().startsWith(country) && /^[A-Z0-9]{1,3}$/i.test(state.slice(country.length)) && state.length > country.length + 1) return `${country}-${state.slice(country.length).toUpperCase()}`;
  if (country !== null && /^[A-Z0-9]{1,3}$/i.test(state)) return `${country}-${state.toUpperCase()}`;
  findings.push({ code: 'contact-address-state-not-iso', part });
  return null;
}

function addressItem(source, tag, findings) {
  if (!source || typeof source !== 'object') return null;
  const country = text(source.country);
  const address = {
    addressLine: text(source.address_1),
    addressLine2: text(source.address_2),
    city: text(source.city),
    postalCode: text(source.postcode),
    country: country ? country.toUpperCase() : null,
    subdivision: subdivision(country ? country.toUpperCase() : null, text(source.state), findings, tag),
  };
  const kept = Object.fromEntries(Object.entries(address).filter(([, v]) => v !== null));
  // A country alone is not an address (WooCommerce prefills it on empty forms).
  if (!Object.keys(kept).some((k) => k !== 'country')) return null;
  return { tag, address: kept };
}

function contactAddresses(customer, ctx) {
  const choices = choicesOf(ctx);
  const findings = [];
  const items = [addressItem(customer.billing, 'BILLING', findings), addressItem(customer.shipping, 'SHIPPING', findings)].filter(Boolean);
  if (items.length === 2 && choices['contact-same-address-once'] === 'once'
    && JSON.stringify(items[0].address) === JSON.stringify(items[1].address)) items.pop();
  return result(items.length ? { addresses: items } : {}, findings);
}

const ROW_HELPERS = {
  'contact-name': contactName,
  'contact-email': contactEmail,
  'contact-phone': contactPhone,
  'contact-company': contactCompany,
  'contact-addresses': contactAddresses,
};

function deepMerge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object') deepMerge(into[k], v);
    else into[k] = v;
  }
  return into;
}

// The whole contact body from the suggested rows. `rows` lets a plan drop or replace a row.
function buildContact(customer, ctx = {}, rows = Object.keys(ROW_HELPERS)) {
  const contact = {}, findings = [];
  let hold = null;
  for (const id of rows) {
    const out = ROW_HELPERS[id](customer, ctx);
    deepMerge(contact, out.record);
    findings.push(...out.findings);
    hold = hold || out.hold;
  }
  if (!hold && !contact.email && !contact.phone && !contact.name) hold = { code: 'contact-without-identity' };
  return { contact, findings, hold };
}

// Cutover rule (Elad 11-15): every issue becomes a structured operatorAction in the existing
// completion report (lib/completion-report.js normalizeOperatorAction). Shared by the contact and
// order builders. Per-record findings and holds are grouped by code with the affected source ids;
// each choice marked forElad becomes one site-owner review action naming the value used; fields
// kept only in the source archive become one action naming them.
function buildCutoverActions({ entity, step, results = [], findingActions = {}, holdActions = {}, choiceList = [], usedChoices = {},
  archivedFields = [], artifactRefs = ['mapping/mapping-plan.json'] } = {}) {
  const group = (pick) => {
    const byCode = new Map();
    for (const row of results) for (const code of pick(row)) {
      if (!byCode.has(code)) byCode.set(code, new Set());
      byCode.get(code).add(String(row.sourceId));
    }
    return byCode;
  };
  const actions = [];
  for (const [code, ids] of group((r) => (r.findings || []).map((f) => f && f.code).filter((c) => findingActions[c]))) {
    actions.push({
      actionId: `wix-map-${entity}:${code}`, code, entity, role: 'cutover-operator',
      severity: findingActions[code].severity, action: findingActions[code].action,
      deadlineReason: 'Fix before cutover while the WooCommerce store can still be read.',
      affectedCount: ids.size, affectedIds: [...ids].sort(), artifactRefs,
      resolutionEvidence: `The ${step} re-run shows no such finding, or the operator accepts the listed records as they are.`,
    });
  }
  for (const [code, ids] of group((r) => (r.hold && r.hold.code ? [r.hold.code] : []))) {
    const known = holdActions[code] || { severity: 'high', action: `These ${entity} records were held (${code}) and are not in Wix.` };
    actions.push({
      actionId: `wix-map-${entity}-held:${code}`, code: `held:${code}`, entity, role: 'import-operator',
      severity: known.severity, action: known.action,
      deadlineReason: 'Held records are missing from Wix until fixed; the source must still be readable to re-run them.',
      affectedCount: ids.size, affectedIds: [...ids].sort(), artifactRefs, prerequisites: ['the original migration folder and source access'],
      importOperatorPrompt: `In the migration folder, open mapping/mapping-plan.json and the ${step} journal. For the ${entity} records ${[...ids].sort().join(', ')} held with ${code}: ${known.action} Change the plan row or choice that covers it (never the toolkit), then re-run the ${step} for these records only and confirm they are imported.`,
      resolutionEvidence: `The ${step} journal shows each listed record imported, or the site owner accepts it as not migrated.`,
    });
  }
  for (const c of choiceList.filter((x) => x.forElad)) {
    const used = usedChoices[c.name];
    const isDefault = JSON.stringify(used) === JSON.stringify(c.default);
    actions.push({
      actionId: `wix-map-${entity}-choice:${c.name}`, code: 'wix-map-choice-applied', entity, role: 'site-owner', severity: 'low',
      action: `Confirm the ${entity} choice "${c.question}" Used: ${JSON.stringify(used)}${isDefault ? ' (suggested default)' : ' (changed in the plan)'}. ${c.reason}`,
      deadlineReason: `A different answer means re-running the ${step} before cutover.`,
      affectedCount: results.length, artifactRefs,
      resolutionEvidence: `The site owner confirms the choice, or the plan choice is changed and the ${step} re-run.`,
    });
  }
  if (archivedFields.length) {
    actions.push({
      actionId: `wix-map-${entity}:fields-archived`, code: 'wix-map-fields-archived', entity, role: 'site-owner', severity: 'low',
      action: `These ${entity} fields have no Wix field and are kept only in the private source-archive CMS collection: ${archivedFields.join(', ')}. Nothing to do unless one of them should be shown on the site.`,
      deadlineReason: 'A field that should be visible needs a plan change and a re-run before cutover.',
      affectedCount: results.length, artifactRefs,
      resolutionEvidence: 'The site owner accepts the list, or the plan maps the field and the step is re-run.',
    });
  }
  return actions;
}

const FINDING_ACTIONS = Object.freeze({
  'contact-address-state-not-iso': { severity: 'low', action: 'These contacts have a state/region that could not be turned into an ISO code, so it was left off the address. The value is in the source archive; add it in Business Manager > Contacts if needed.' },
});
const HOLD_ACTIONS = Object.freeze({
  'contact-email-invalid': { severity: 'medium', action: 'These customers have an email Wix will not accept. Fix the address (or drop the email row for them) in the plan and re-run.' },
  'contact-without-identity': { severity: 'medium', action: 'These customers have no name, email or phone, so there is nothing to make a contact from. Accept them as not migrated, or map another field.' },
});

function cutoverActions({ results = [], choices = {}, archivedFields = [], artifactRefs } = {}) {
  return buildCutoverActions({ entity: 'contact', step: 'contact step', results, findingActions: FINDING_ACTIONS, holdActions: HOLD_ACTIONS,
    choiceList: ALL_CHOICES, usedChoices: choicesOf({ choices }), archivedFields, artifactRefs });
}

module.exports = { ALL_CHOICES, suggestionChoices, DEFAULT_CHOICES, ROW_HELPERS, buildContact, subdivision, buildCutoverActions, FINDING_ACTIONS, HOLD_ACTIONS, cutoverActions, contactName, contactEmail, contactPhone, contactCompany, contactAddresses };
