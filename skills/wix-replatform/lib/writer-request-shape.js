'use strict';

// The reviewed request shape of a mapping output's writer, from target knowledge. A mapping names
// only the Wix entity field (`targetPath`, e.g. `name` or `brand.name`); the toolkit owns the
// request-body key that wraps the record (`preferredWrite.requestInput`, "$" when the record is
// the body, or each item of `requestItems`). Only an output whose writeOperation is the entity's
// preferred writer, with a declared requestInput, has a known shape; any other output keeps its
// legacy `writeInput` binding.
const REF = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE) (\/[^\s?]*)$/;

function knowledge(ref) {
  if (typeof ref !== 'string' || !REF.test(ref)) return null;
  try { return require('./dependency-proofs').domain(ref); } catch { return null; }
}
function shape(targetRef, writeOperation) {
  const pw = knowledge(targetRef)?.preferredWrite;
  if (!pw || !writeOperation || pw.writerId !== writeOperation || typeof pw.requestInput !== 'string') return null;
  return { writerId: pw.writerId, requestInput: pw.requestInput, requestItems: pw.requestItems || null,
    requestFields: Array.isArray(pw.requestFields) ? pw.requestFields : null,
    // Record fields the writer reads and strips before the request (coupon `usageUnlimited`):
    // a mapping may write them, but no request body carries them.
    requestDirectives: Array.isArray(pw.requestDirectives) ? pw.requestDirectives : [] };
}
// The one reviewed endpoint of this operation, as method + path pattern; null when knowledge has
// no single plain endpoint for it (prose, several calls, or another host).
function endpoint(targetRef, writeOperation) {
  const k = knowledge(targetRef);
  if (!k || !writeOperation) return null;
  let text = k.preferredWrite?.writerId === writeOperation ? k.preferredWrite.endpoint : null;
  if (!text) {
    try { text = require('./dependency-proofs').operationContract(targetRef, writeOperation)?.contract?.endpoint || null; } catch { text = null; }
  }
  const m = typeof text === 'string' && text.trim().match(ENDPOINT);
  if (!m) return null;
  const pattern = m[2].split('/').map(s => /^\{[^}]+\}$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
  return { method: m[1], path: m[2], test: (method, url) => String(method).toUpperCase() === m[1] && new RegExp(`^${pattern}$`).test(String(url).split('?')[0]) };
}
const firstField = p => String(p).split(/[.[]/)[0];
const entityId = ref => String(ref || '').split('/')[1];
// The output's field path inside the record. A leading entity name or request key is accepted and
// dropped (`brand.name` → `name`); a legacy writeInput prefix is dropped the same way. A legacy
// writeInput deeper than the request key keeps its tail (`dataItem.data` + `x` → `data.x`).
function recordPath(o) {
  const s = shape(o?.targetRef, o?.writeOperation), p = o?.targetPath;
  if (typeof p !== 'string') return p;
  const prefixes = s ? [s.requestInput, entityId(o.targetRef)].filter(k => k && k !== '$' && !(s.requestFields || []).includes(k))
    : [o.writeInput].filter(k => typeof k === 'string' && k !== '$');
  const hit = prefixes.find(k => p.startsWith(`${k}.`));
  const own = hit ? p.slice(hit.length + 1) : p;
  const legacy = typeof o.writeInput === 'string' ? o.writeInput : '';
  const tail = s && s.requestInput !== '$' && legacy.startsWith(`${s.requestInput}.`) ? legacy.slice(s.requestInput.length + 1) : '';
  return tail && !own.startsWith(`${tail}.`) ? `${tail}.${own}` : own;
}
// Mapping-time refusal, phrased for the mapper with the allowed fields.
function outputErrors(o) {
  const s = shape(o?.targetRef, o?.writeOperation);
  if (!s?.requestFields || typeof o.targetPath !== 'string') return [];
  return s.requestFields.includes(firstField(recordPath(o))) ? [] : [`targetPath "${o.targetPath}" is not a field ${s.writerId} sends (it sends: ${s.requestFields.join(', ')}); map it to a field it sends, CMS, or exclude it`];
}
// The output's path in the request namespace the coverage, read-back and resolution gates use:
// the toolkit's request key plus the record path; legacy writeInput.targetPath when no shape is known.
function writePath(o) {
  const L = require('./source-location'), s = shape(o?.targetRef, o?.writeOperation);
  if (s) return s.requestInput === '$' ? L.canonicalize(recordPath(o)) : L.join(s.requestInput, recordPath(o));
  return typeof o.writeInput === 'string' && o.writeInput !== '$' ? L.join(o.writeInput, o.targetPath) : L.canonicalize(o.targetPath);
}
// The records one captured request body holds for a known shape.
function records(body, s) {
  const items = s.requestItems ? (Array.isArray(body?.[s.requestItems]) ? body[s.requestItems] : []) : [body];
  return items.map(item => s.requestInput === '$' ? item : item && typeof item === 'object' ? item[s.requestInput] : undefined);
}

// The items of a bulk writer's request when knowledge declares no request shape (only `bulk:
// true`, e.g. reviews): the body's one array of objects, each item one record as sent. Read by the
// example pass to find a record's fields in a captured request; shape() stays null, so no other
// gate or builder changes. Null when the body has no single item array.
function bulkItems(targetRef, writeOperation, body) {
  const pw = knowledge(targetRef)?.preferredWrite;
  if (!pw || pw.writerId !== writeOperation || pw.bulk !== true || typeof pw.requestInput === 'string' || !body || typeof body !== 'object') return null;
  const lists = Object.values(body).filter(v => Array.isArray(v) && v.length && v.every(item => item && typeof item === 'object' && !Array.isArray(item)));
  return lists.length === 1 ? lists[0] : null;
}

// A writer directive output: never in the request body.
function isDirective(o) {
  const s = shape(o?.targetRef, o?.writeOperation);
  return !!s && typeof o.targetPath === 'string' && s.requestDirectives.includes(firstField(recordPath(o)));
}

module.exports = { shape, endpoint, recordPath, isDirective, outputErrors, writePath, records, bulkItems };
