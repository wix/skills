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
//   {op:'all', of:[...]}  /  {op:'any', of:[...]}  non-empty
// Over an array location the comparison is existential: equals/in/populated hold when any value
// at the location holds; notEquals/notPopulated are their exact negations. Strict equality,
// no coercion ("1" is not 1, false is not "false").
const L = require('./source-location');

const LEAF = { equals: ['value'], notEquals: ['value'], in: ['values'], populated: [], notPopulated: [] };
const GROUP = ['all', 'any'];
const OPS = [...Object.keys(LEAF), ...GROUP];
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
    const keys = GROUP.includes(p.op) ? ['op', 'of'] : ['op', 'location', ...LEAF[p.op]];
    const extra = Object.keys(p).filter(k => !keys.includes(k));
    if (extra.length) errors.push(`${at} (${p.op}) has unsupported keys ${extra.join(', ')}`);
    for (const k of keys) if (!Object.hasOwn(p, k)) errors.push(`${at} (${p.op}) needs ${k}`);
    if (GROUP.includes(p.op)) {
      if (depth >= MAX_DEPTH) { errors.push(`${at} nests deeper than ${MAX_DEPTH}`); return; }
      if (!Array.isArray(p.of) || !p.of.length) { errors.push(`${at} (${p.op}) needs a non-empty of[]`); return; }
      p.of.forEach((c, i) => walk(c, depth + 1, `${at}.of[${i}]`));
      return;
    }
    if (typeof p.location !== 'string' || !L.isCanonical(p.location)) errors.push(`${at} location ${JSON.stringify(p.location)} is not a canonical location`);
    else if (!own.has(p.location)) errors.push(`${at} location ${p.location} is not one of the decision's source locations`);
    if (LEAF[p.op].includes('value') && Object.hasOwn(p, 'value') && !scalar(p.value)) errors.push(`${at} value must be a string, finite number or boolean`);
    if (p.op === 'in' && Object.hasOwn(p, 'values') && (!Array.isArray(p.values) || !p.values.length || p.values.some(v => !scalar(v)) || new Set(p.values.map(v => JSON.stringify(v))).size !== p.values.length)) errors.push(`${at} values must be a non-empty list of distinct scalars`);
  }
  walk(pred, 0, 'appliesWhen');
  return errors;
}
// Locations a (valid) predicate reads.
function locations(pred, out = new Set()) {
  if (pred && GROUP.includes(pred.op)) for (const c of pred.of || []) locations(c, out);
  else if (pred?.location) out.add(pred.location);
  return out;
}
function evaluate(pred, record) {
  switch (pred.op) {
    case 'all': return pred.of.every(c => evaluate(c, record));
    case 'any': return pred.of.some(c => evaluate(c, record));
    default: {
      const values = L.valuesAt(record, pred.location);
      if (pred.op === 'equals') return values.some(v => v === pred.value);
      if (pred.op === 'notEquals') return !values.some(v => v === pred.value);
      if (pred.op === 'in') return values.some(v => pred.values.includes(v));
      if (pred.op === 'populated') return values.some(L.populated);
      if (pred.op === 'notPopulated') return !values.some(L.populated);
    }
  }
  throw Object.assign(new Error(`unknown appliesWhen op ${pred?.op}`), { code: 'applies_when_invalid' });
}
// Plain text for the mapping review; no prose is authored by the mapper.
function readable(pred) {
  const v = x => JSON.stringify(x);
  switch (pred.op) {
    case 'all': case 'any': return `(${pred.of.map(readable).join(pred.op === 'all' ? ' and ' : ' or ')})`;
    case 'equals': return `${L.readable(pred.location)} = ${v(pred.value)}`;
    case 'notEquals': return `${L.readable(pred.location)} != ${v(pred.value)}`;
    case 'in': return `${L.readable(pred.location)} in [${pred.values.map(v).join(', ')}]`;
    case 'populated': return `${L.readable(pred.location)} is populated`;
    default: return `${L.readable(pred.location)} is not populated`;
  }
}
module.exports = { OPS, validate, locations, evaluate, readable };
