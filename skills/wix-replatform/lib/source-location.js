'use strict';
// One lossless representation of a location inside a source (or target) record.
//
// Segments: {key:<string>} an own object member, {each:true} every array element, and
// {each:true, where:{path:[{key}...], equals:<string|number>}} the array elements whose
// relative discriminator equals a scalar. The canonical string encoding is:
//   bare identifier keys  /^[A-Za-z_$][\w$-]*$/  joined by '.'   e.g. a.b[].c
//   every other key       ["<JSON string>"]                       e.g. schema["@graph"][]["@type"]
//   every element         []
//   selected elements     [<relative path>=<JSON scalar>]         e.g. meta_data[key="_x"].value
// Legacy dotted paths of the old exact grammar are already canonical and keep their meaning.
// A legacy numeric index [3] parses as every element (the read-back write-path normalization).
// A key containing '.', '[', ']', '@', Unicode or the empty key is always quoted, so the
// literal key "part.name" can never collide with the nested path part.name.

const ENCODING = 'replatform-location/1';
const IDENT = /^[A-Za-z_$][\w$-]*/;
const IDENT_FULL = /^[A-Za-z_$][\w$-]*$/;

function fail(message) {
  throw Object.assign(new Error(message), { code: 'source_location_invalid' });
}
function readJsonString(text, i) {
  if (text[i] !== '"') return null;
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') j += 2;
    else if (text[j] === '"') break;
    else j += 1;
  }
  if (j >= text.length) fail('unterminated quoted key');
  let value;
  try { value = JSON.parse(text.slice(i, j + 1)); } catch { fail('invalid quoted key'); }
  return { value, end: j + 1 };
}
function readScalar(text, i) {
  const quoted = readJsonString(text, i);
  if (quoted) return quoted;
  const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
  if (!m) fail('selector value must be a JSON string or number');
  return { value: Number(m[0]), end: i + m[0].length };
}
// Parse a key-only relative path used inside a selector: ident or ["json"] then .ident / ["json"].
function readRelative(text, i) {
  const path = [];
  for (;;) {
    if (path.length && text[i] === '.') {
      const m = IDENT.exec(text.slice(i + 1));
      if (!m) fail('expected identifier after "."');
      path.push({ key: m[0] }); i += 1 + m[0].length; continue;
    }
    if (!path.length) {
      const m = IDENT.exec(text.slice(i));
      if (m) { path.push({ key: m[0] }); i += m[0].length; continue; }
    }
    if (text[i] === '[' && text[i + 1] === '"') {
      const q = readJsonString(text, i + 1);
      if (text[q.end] !== ']') fail('expected "]" after quoted key');
      path.push({ key: q.value }); i = q.end + 1; continue;
    }
    break;
  }
  if (!path.length) fail('selector needs a relative key path');
  return { path, end: i };
}
function parse(text) {
  if (typeof text !== 'string' || !text.length) fail('location must be a non-empty string');
  const segments = [];
  let i = 0;
  const first = IDENT.exec(text);
  if (first) { segments.push({ key: first[0] }); i = first[0].length; }
  while (i < text.length) {
    const c = text[i];
    if (c === '.') {
      if (!segments.length) fail('location cannot start with "."');
      const m = IDENT.exec(text.slice(i + 1));
      if (!m) fail(`expected identifier after "." at ${i}`);
      segments.push({ key: m[0] }); i += 1 + m[0].length;
    } else if (c === '[') {
      if (text[i + 1] === ']') { segments.push({ each: true }); i += 2; continue; }
      if (text[i + 1] === '"') {
        const q = readJsonString(text, i + 1);
        if (text[q.end] !== ']') fail('expected "]" after quoted key');
        segments.push({ key: q.value }); i = q.end + 1; continue;
      }
      const digits = /^\d+\]/.exec(text.slice(i + 1));
      if (digits) { segments.push({ each: true }); i += 1 + digits[0].length; continue; }
      const rel = readRelative(text, i + 1);
      if (text[rel.end] !== '=') fail('selector needs "="');
      const val = readScalar(text, rel.end + 1);
      if (text[val.end] !== ']') fail('selector needs closing "]"');
      segments.push({ each: true, where: { path: rel.path, equals: val.value } });
      i = val.end + 1;
    } else fail(`unexpected character at ${i}`);
  }
  return segments;
}
function formatKey(key, first) {
  if (typeof key !== 'string') fail('key must be a string');
  return IDENT_FULL.test(key) ? (first ? key : `.${key}`) : `[${JSON.stringify(key)}]`;
}
function formatScalar(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
  fail('selector value must be a string or finite number');
}
function format(segments) {
  if (!Array.isArray(segments) || !segments.length) fail('location needs segments');
  return segments.map((s, i) => {
    if (s && Object.hasOwn(s, 'key')) return formatKey(s.key, i === 0);
    if (s && s.each === true && !s.where) return '[]';
    if (s && s.each === true && s.where) return `[${s.where.path.map((p, j) => formatKey(p.key, j === 0)).join('')}=${formatScalar(s.where.equals)}]`;
    return fail('malformed segment');
  }).join('');
}
// Parsing is pure and the same locations repeat for every record, so the canonical text and the
// (read-only) segments used by valuesAt are computed once per distinct string. Errors are not cached.
const canonicalCache = new Map(), segmentCache = new Map();
function remember(cache, key, value) { if (cache.size >= 50000) cache.clear(); cache.set(key, value); return value; }
const canonicalize = text => (typeof text === 'string' && canonicalCache.get(text)) || remember(canonicalCache, text, format(parse(text)));
const segmentsOf = text => segmentCache.get(text) || remember(segmentCache, text, parse(text));
function isCanonical(text) {
  try { return canonicalize(text) === text; } catch { return false; }
}
// Strict exact location: canonical and without legacy numeric indexes.
const isExact = text => isCanonical(text);
const segEqual = (a, b) => format([a]) === format([b]) && Boolean(a.key !== undefined) === Boolean(b.key !== undefined);
function isPrefix(prefix, location, { strict = false } = {}) {
  const p = typeof prefix === 'string' ? parse(prefix) : prefix, l = typeof location === 'string' ? parse(location) : location;
  if (p.length > l.length || (strict && p.length === l.length)) return false;
  return p.every((s, i) => segEqual(s, l[i]));
}
// isPrefix for untrusted input: an unparseable location is never within another.
function within(prefix, location, { strict = false } = {}) {
  try { return isPrefix(prefix, location, { strict }); } catch { return false; }
}
function join(...parts) {
  return format(parts.flatMap(p => typeof p === 'string' ? parse(p) : p));
}
// The unselected form: every selector segment becomes [].
const base = location => format(parse(location).map(s => s.where ? { each: true } : s));
function ownGet(v, key) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, key) ? v[key] : undefined;
}
function relativeValue(element, path) {
  let v = element;
  for (const s of path) v = ownGet(v, s.key);
  return v;
}
const scalar = v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
function valuesAt(value, location) {
  const segments = typeof location === 'string' ? segmentsOf(location) : location;
  let values = [value];
  for (const s of segments) {
    if (s.key !== undefined) values = values.map(v => ownGet(v, s.key));
    else values = values.flatMap(v => Array.isArray(v) ? v.filter(e => !s.where || relativeValue(e, s.where.path) === s.where.equals) : []);
  }
  return values;
}
const populated = v => v !== undefined && v !== null && v !== '' && typeof v !== 'function' &&
  !(typeof v === 'object' && Object.keys(v).length === 0);
// A selector template from a dynamic coverage entry, e.g.
//   {path:'meta_data[].value', selector:{keyPath:'meta_data[].key'}}
// array = meta_data[], key = key, value = value. Anything else fails closed.
function template(entry) {
  const path = parse(entry?.path), keyPath = parse(entry?.selector?.keyPath);
  let last = -1;
  for (let i = 0; i < Math.min(path.length, keyPath.length); i += 1) {
    if (!segEqual(path[i], keyPath[i])) break;
    if (path[i].each && !path[i].where) last = i;
  }
  if (last < 0) fail('selector keyPath must share the dynamic array with its path');
  const value = path.slice(last + 1), key = keyPath.slice(last + 1);
  if (value.length !== 1 || value[0].key === undefined || !key.length || key.some(s => s.key === undefined)) fail('unsupported selector template');
  if (path.slice(0, last + 1).some(s => s.where)) fail('unsupported nested selector template');
  return { array: format(path.slice(0, last + 1)), arraySegments: path.slice(0, last + 1), key, value: value[0].key, path: format(path), keyPath: format(keyPath) };
}
function selected(t, keyValue, rest = []) {
  return format([...t.arraySegments.slice(0, -1), { each: true, where: { path: t.key, equals: keyValue } }, { key: t.value }, ...rest]);
}
// Populated leaf locations of one record. Elements of a templated array whose discriminator is a
// scalar have their value subtree qualified by that key; other elements stay at the base path.
function leafLocations(record, { templates = [] } = {}, out = new Set()) {
  const byArray = new Map(templates.map(t => [t.array, t]));
  function walk(v, segs) {
    if (!populated(v)) return;
    if (Array.isArray(v)) {
      const each = [...segs, { each: true }], t = byArray.get(format(each));
      for (const item of v) {
        const k = t ? relativeValue(item, t.key) : undefined;
        if (t && scalar(k) && item && typeof item === 'object' && !Array.isArray(item)) {
          for (const [name, child] of Object.entries(item)) {
            walk(child, name === t.value ? [...segs, { each: true, where: { path: t.key, equals: k } }, { key: name }] : [...each, { key: name }]);
          }
        } else walk(item, each);
      }
    } else if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) walk(child, [...segs, { key: k }]);
    } else if (segs.length) out.add(format(segs));
  }
  walk(record, []);
  return out;
}
// Human-readable form for reviews: the canonical string is already plain text; selectors are
// spelled out so a reviewer sees which metadata key a row belongs to.
function readable(location) {
  return parse(location).map((s, i) => {
    if (s.key !== undefined) return formatKey(s.key, i === 0);
    if (!s.where) return '[]';
    return `[where ${s.where.path.map((p, j) => formatKey(p.key, j === 0)).join('')} = ${formatScalar(s.where.equals)}]`;
  }).join('');
}
module.exports = { ENCODING, parse, format, canonicalize, isCanonical, isExact, isPrefix, within, join, base, valuesAt, populated,
  template, selected, leafLocations, readable, scalar };
