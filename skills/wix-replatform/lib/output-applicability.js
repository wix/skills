'use strict';
// Machine-checkable output applicability (`outputs[].appliesWhen`).
//
// A predicate over the decision's own canonical source locations (lib/source-location.js),
// evaluated against the source record. It states when an output is written at all; it never
// computes the written value. Grammar (closed: every node has exactly these keys):
//   {op:'equals',      location, value}        value: string | finite number | boolean
//   {op:'notEquals',   location, value}
//   {op:'in',          location, values:[...]}  non-empty, distinct scalars
//   {op:'populated',   location}
//   {op:'notPopulated',location}
//   {op:'before',      location, value}        value: an ISO date-time; strictly earlier
//   {op:'after',       location, value}        strictly later (no timezone = UTC; unparseable = false)
//   {op:'fact',       name, values:[...]}      a named source-pack fact (see FACTS below) returns one
//                                              of `values`; non-empty, distinct, each a value the fact declares
//   {op:'all', of:[...]}  /  {op:'any', of:[...]}  non-empty
// Over an array location the comparison is existential: equals/in/populated hold when any value
// at the location holds; notEquals/notPopulated are their exact negations. Strict equality,
// no coercion ("1" is not 1, false is not "false").
const L = require('./source-location');

// --- fact registry -------------------------------------------------------------------------
// A fact is a small pure function of the source record, shipped by the source pack in
// resources/rp-source-wordpress/wix-map/facts.js (entry shape documented there). The builder
// requires that same file and calls the same `evaluate`, so a condition and a written value
// cannot disagree. The registry is loaded once; `useFacts` swaps it (tests, other source packs).
let FACTS = require('../resources/rp-source-wordpress/wix-map/facts.js').FACTS;
const factOf = name => (typeof name === 'string' && Object.hasOwn(FACTS, name) ? FACTS[name] : null);
function useFacts(registry) { const prev = FACTS; FACTS = registry; return () => { FACTS = prev; }; }

const LEAF = { equals: ['value'], notEquals: ['value'], in: ['values'], populated: [], notPopulated: [], before: ['value'], after: ['value'] };
// A date-time as epoch ms; a value with no timezone designator is read as UTC (WooCommerce *_gmt).
const instant = v => typeof v !== 'string' || !v.trim() ? NaN : Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(v.trim()) || !/T\d/.test(v) ? v.trim() : `${v.trim()}Z`);
const GROUP = ['all', 'any'];
const OPS = [...Object.keys(LEAF), 'fact', ...GROUP];
const MAX_DEPTH = 4, MAX_NODES = 32;
const scalar = v => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// Returns error strings; empty when the predicate is valid and every location it names is one of
// `allowed` (the decision's canonical locations).
function validate(pred, allowed) {
  const errors = [], own = new Set(allowed || []);
  let nodes = 0;
  function walk(p, depth, at) {
    nodes += 1;
    if (nodes > MAX_NODES) { if (nodes === MAX_NODES + 1) errors.push(`more than ${MAX_NODES} nodes`); return; }
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`${at} must be an object`); return; }
    if (!OPS.includes(p.op)) { errors.push(`${at} has unknown op ${JSON.stringify(p.op)}`); return; }
    const keys = GROUP.includes(p.op) ? ['op', 'of'] : p.op === 'fact' ? ['op', 'name', 'values'] : ['op', 'location', ...LEAF[p.op]];
    const extra = Object.keys(p).filter(k => !keys.includes(k));
    if (extra.length) errors.push(`${at} (${p.op}) has unsupported keys ${extra.join(', ')}`);
    for (const k of keys) if (!Object.hasOwn(p, k)) errors.push(`${at} (${p.op}) needs ${k}`);
    if (GROUP.includes(p.op)) {
      if (depth >= MAX_DEPTH) { errors.push(`${at} nests deeper than ${MAX_DEPTH}`); return; }
      if (!Array.isArray(p.of) || !p.of.length) { errors.push(`${at} (${p.op}) needs a non-empty of[]`); return; }
      p.of.forEach((c, i) => walk(c, depth + 1, `${at}.of[${i}]`));
      return;
    }
    if (p.op === 'fact') {
      const f = factOf(p.name);
      if (!f) { errors.push(`${at} fact ${JSON.stringify(p.name)} is not a known fact (${Object.keys(FACTS).join(', ') || 'none registered'})`); return; }
      for (const r of f.reads) if (!own.has(r)) errors.push(`${at} fact ${p.name} reads ${r}, which is not one of the decision's source locations`);
      if (Object.hasOwn(p, 'values')) {
        if (!Array.isArray(p.values) || !p.values.length || p.values.some(v => !scalar(v)) || new Set(p.values.map(v => JSON.stringify(v))).size !== p.values.length) errors.push(`${at} values must be a non-empty list of distinct scalars`);
        else for (const v of p.values) if (!f.values.includes(v)) errors.push(`${at} fact ${p.name} cannot return ${JSON.stringify(v)} (it returns ${f.values.map(x => JSON.stringify(x)).join(', ')})`);
      }
      return;
    }
    if (typeof p.location !== 'string' || !L.isCanonical(p.location)) errors.push(`${at} location ${JSON.stringify(p.location)} is not a canonical location`);
    else if (!own.has(p.location)) errors.push(`${at} location ${p.location} is not one of the decision's source locations`);
    if (['before', 'after'].includes(p.op)) { if (Object.hasOwn(p, 'value') && !Number.isFinite(instant(p.value))) errors.push(`${at} value must be an ISO date-time`); }
    else if (LEAF[p.op].includes('value') && Object.hasOwn(p, 'value') && !scalar(p.value)) errors.push(`${at} value must be a string, finite number or boolean`);
    if (p.op === 'in' && Object.hasOwn(p, 'values') && (!Array.isArray(p.values) || !p.values.length || p.values.some(v => !scalar(v)) || new Set(p.values.map(v => JSON.stringify(v))).size !== p.values.length)) errors.push(`${at} values must be a non-empty list of distinct scalars`);
  }
  walk(pred, 0, 'appliesWhen');
  return errors;
}
// Locations a (valid) predicate reads.
function locations(pred, out = new Set()) {
  if (pred && GROUP.includes(pred.op)) for (const c of pred.of || []) locations(c, out);
  else if (pred?.op === 'fact') for (const r of factOf(pred.name)?.reads || []) out.add(r);
  else if (pred?.location) out.add(pred.location);
  return out;
}
// `ctx` is the plan context a fact may read: `{ choices }`, the plan's recorded choices by name, in
// the shape the builder receives (see planChoiceValues). Every gate passes the same one.
function evaluate(pred, record, ctx = {}) {
  switch (pred.op) {
    case 'all': return pred.of.every(c => evaluate(c, record, ctx));
    case 'any': return pred.of.some(c => evaluate(c, record, ctx));
    case 'fact': {
      const f = factOf(pred.name);
      if (!f) throw Object.assign(new Error(`unknown appliesWhen fact ${pred.name}`), { code: 'applies_when_invalid' });
      return pred.values.includes(f.evaluate(record, ctx));
    }
    default: {
      const values = L.valuesAt(record, pred.location);
      if (pred.op === 'equals') return values.some(v => v === pred.value);
      if (pred.op === 'notEquals') return !values.some(v => v === pred.value);
      if (pred.op === 'in') return values.some(v => pred.values.includes(v));
      if (pred.op === 'populated') return values.some(L.populated);
      if (pred.op === 'notPopulated') return !values.some(L.populated);
      if (pred.op === 'before' || pred.op === 'after') { const at = instant(pred.value); return values.some(v => { const t = instant(v); return Number.isFinite(t) && (pred.op === 'before' ? t < at : t > at); }); }
    }
  }
  throw Object.assign(new Error(`unknown appliesWhen op ${pred?.op}`), { code: 'applies_when_invalid' });
}
// The plan's choices by name, exactly as the plan builder hands them to a builder: choices recorded
// on the entity's field rows (`choice`, `choices[]`), then the entity's own `choices[]`. A caller that
// gets a plan entity builds the evaluation context with `{ choices: planChoiceValues(entity) }`.
function planChoiceValues(entity) {
  const out = {};
  const take = c => { if (c && typeof c.name === 'string' && Object.hasOwn(c, 'value')) out[c.name] = c.value; };
  for (const row of entity?.fieldMappings || []) for (const c of [row?.choice, ...(Array.isArray(row?.choices) ? row.choices : [])]) take(c);
  for (const c of Array.isArray(entity?.choices) ? entity.choices : []) take(c);
  return out;
}
// Plain text for the mapping review; no prose is authored by the mapper.
function readable(pred) {
  const v = x => JSON.stringify(x);
  switch (pred.op) {
    case 'all': case 'any': return `(${pred.of.map(readable).join(pred.op === 'all' ? ' and ' : ' or ')})`;
    case 'fact': return `${pred.name} is ${pred.values.map(v).join(' or ')} (reads ${[...locations(pred)].map(L.readable).join(', ') || 'the record'})`;
    case 'equals': return `${L.readable(pred.location)} = ${v(pred.value)}`;
    case 'notEquals': return `${L.readable(pred.location)} != ${v(pred.value)}`;
    case 'in': return `${L.readable(pred.location)} in [${pred.values.map(v).join(', ')}]`;
    case 'populated': return `${L.readable(pred.location)} is populated`;
    case 'before': return `${L.readable(pred.location)} before ${v(pred.value)}`;
    case 'after': return `${L.readable(pred.location)} after ${v(pred.value)}`;
    default: return `${L.readable(pred.location)} is not populated`;
  }
}
module.exports = { OPS, validate, locations, evaluate, readable, useFacts, planChoiceValues };
