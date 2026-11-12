'use strict';

// rp-target-wix — NDJSON record-stream I/O for migration data files.
//
// Every migration writes the same shape of intermediate data: a long stream of per-entity
// records that a later stage scans, batches and cursors through. That is a line-delimited
// format, not a single JSON document, so it is built once here rather than re-derived by
// codegen per project.
//
// WHY NDJSON over a JSON array (`{ entity, records: [...] }`):
//   - scan: counting or filtering never parses the whole file, and never holds it in memory
//   - batch: a bulk endpoint's page is `readBatches(file, 100)` — no slicing a giant array.
//     Use `readBatchesByLimits` when the endpoint caps several dimensions at once (Wix bulk
//     product create caps products, variants AND options per request).
//   - cursor: resume from record N is a byte offset or a line skip, not a full re-parse
//   - append: a producer can emit records as it finds them; a crash leaves a valid prefix
//   - a single malformed record is one bad line, not an unparseable file
//
// USE IT FOR record streams (`data/source-extract/<entity>.ndjson`, crosswalks, audit logs).
// Do NOT use it for single documents — a manifest, mapping plan, decisions or completion
// report is one object and stays `.json`. Line-delimiting a document buys nothing and makes
// it unreadable.
//
// Dependency-free and streaming, like the source adapters' transport modules. Codegen
// vendors a copy into the project (e.g. `src/lib/ndjson.js`) and imports from it.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const EXT = '.ndjson';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// One record per line. JSON.stringify escapes embedded newlines, so a record can never
// break the line framing.
function encodeRecord(record) {
  if (record === undefined) throw new Error('ndjson: cannot encode undefined');
  const line = JSON.stringify(record);
  if (line === undefined) throw new Error('ndjson: record is not JSON-serialisable');
  return `${line}\n`;
}

// --- writing ---------------------------------------------------------------

// Streaming write of a whole stream. Accepts arrays, generators and async generators, so a
// reader can hand over records as it produces them without materialising them all.
async function writeRecords(filePath, records) {
  ensureDir(filePath);
  const out = fs.createWriteStream(filePath, { flags: 'w' });
  let count = 0;
  try {
    for await (const record of records) {
      count += 1;
      if (!out.write(encodeRecord(record))) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
  }
  return count;
}

// Incremental appender for producers that emit over time (crosswalk, audit log). `flush`
// is per-record and O(1) — the whole point of not rewriting a JSON array each time.
function createAppender(filePath) {
  ensureDir(filePath);
  let count = 0;
  return {
    file: filePath,
    append(record) {
      fs.appendFileSync(filePath, encodeRecord(record));
      count += 1;
      return record;
    },
    appendAll(records) {
      let buffer = '';
      for (const record of records) buffer += encodeRecord(record);
      if (buffer) fs.appendFileSync(filePath, buffer);
      count += records.length;
      return records.length;
    },
    written: () => count,
  };
}

// --- reading ---------------------------------------------------------------

// Streams records without loading the file. readline handles \n, \r\n and the chunk-boundary
// case that a naive split('\n') gets wrong.
//
// A blank line is skipped (a trailing newline is normal). A malformed line throws, naming the
// line number — silently dropping records would corrupt a migration invisibly.
async function* readRecords(filePath, { skipMalformed = false, onMalformed = null } = {}) {
  if (!fs.existsSync(filePath)) return;
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      if (line.trim() === '') continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        const detail = `${filePath}:${lineNumber} is not valid JSON (${err.message})`;
        if (onMalformed) onMalformed({ file: filePath, line: lineNumber, raw: line, error: err.message });
        if (skipMalformed) continue;
        throw new Error(`ndjson: ${detail}. Refusing to continue — a dropped record is invisible data loss.`);
      }
      yield record;
    }
  } finally {
    rl.close();
    input.destroy();
  }
}

// The batching primitive bulk endpoints consume. `size` is a record count; when a target
// caps something else too (Wix bulk product create allows 100 products AND 1000 variants
// per request) use readBatchesBy instead.
async function* readBatches(filePath, size = 100, options = {}) {
  if (!Number.isInteger(size) || size < 1) throw new Error('ndjson: batch size must be a positive integer');
  let batch = [];
  for await (const record of readRecords(filePath, options)) {
    batch.push(record);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

// Batch against SEVERAL simultaneous caps. Real bulk endpoints rarely have just one: Wix
// bulk product create allows 100 products AND 1000 variants AND 100 options AND 100
// modifiers AND 100 infoSections per request, and exceeding any single one rejects the whole
// batch. Batching on record count alone silently produces requests that 428.
//
//   readBatchesByLimits(file, {
//     limits: { records: 100, variants: 1000, options: 100 },
//     cost: (p) => ({ variants: p.variants.length, options: p.options.length }),
//   })
//
// `records` is implicit and always counted. Any dimension absent from `limits` is ignored,
// so a cost function may report more than the caller caps.
//
// A single record that alone exceeds a cap is still emitted, in a batch of one, with
// `oversized` reported through `onOversized`. Dropping it would be silent data loss and
// splitting it is impossible — the caller has to decide (skip it, or fail loudly).
async function* readBatchesByLimits(filePath, { limits = {}, cost = () => ({}), onOversized = null, ...options } = {}) {
  const caps = { records: 100, ...limits };
  for (const [dim, cap] of Object.entries(caps)) {
    if (!(Number.isFinite(cap) && cap >= 1)) throw new Error(`ndjson: limit "${dim}" must be a number >= 1 (got ${cap})`);
  }

  let batch = [];
  let running = {};
  const costOf = (record) => {
    const c = cost(record) || {};
    return { ...c, records: 1 };
  };
  const wouldExceed = (c) => Object.keys(caps).some((dim) => (running[dim] || 0) + (c[dim] || 0) > caps[dim]);
  const aloneExceeds = (c) => Object.keys(caps).some((dim) => (c[dim] || 0) > caps[dim]);

  for await (const record of readRecords(filePath, options)) {
    const c = costOf(record);
    if (batch.length && wouldExceed(c)) {
      yield batch;
      batch = [];
      running = {};
    }
    if (aloneExceeds(c) && onOversized) {
      const over = Object.keys(caps).filter((dim) => (c[dim] || 0) > caps[dim]);
      onOversized({ record, cost: c, exceeded: over, caps });
    }
    batch.push(record);
    for (const dim of Object.keys(c)) running[dim] = (running[dim] || 0) + c[dim];
  }
  if (batch.length) yield batch;
}

// Single-dimension convenience wrapper over readBatchesByLimits, kept because plenty of
// endpoints really do have just one cap.
async function* readBatchesBy(filePath, { maxCount = 100, maxCost = Infinity, cost = () => 1, ...options } = {}) {
  const limits = { records: maxCount };
  if (Number.isFinite(maxCost)) limits.cost = maxCost;
  yield* readBatchesByLimits(filePath, { ...options, limits, cost: (r) => ({ cost: cost(r) }) });
}

// Cursor: skip `offset` records, take at most `limit`. Used for resume — no need to parse
// what has already been processed into objects.
async function* readSlice(filePath, { offset = 0, limit = Infinity, ...options } = {}) {
  let index = 0;
  let taken = 0;
  for await (const record of readRecords(filePath, options)) {
    if (index++ < offset) continue;
    if (taken++ >= limit) return;
    yield record;
  }
}

// Cheap count — parses nothing, just counts non-empty lines.
async function countRecords(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of rl) if (line.trim() !== '') count += 1;
  } finally {
    rl.close();
    input.destroy();
  }
  return count;
}

// Escape hatch for small streams that genuinely need to be in memory at once (a 6-record
// category list). Named so that using it on a large stream is an obvious mistake.
async function readAllRecords(filePath, options = {}) {
  const out = [];
  for await (const record of readRecords(filePath, options)) out.push(record);
  return out;
}

// --- migration of existing projects ---------------------------------------

// Converts a legacy `{ entity, recordCount, records: [...] }` document to NDJSON. Kept so a
// project generated before this format change can be moved forward without re-extracting.
async function convertLegacyJsonFile(jsonPath, ndjsonPath, { recordsKey = 'records' } = {}) {
  const parsed = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
  const records = Array.isArray(parsed) ? parsed : parsed[recordsKey];
  if (!Array.isArray(records)) {
    throw new Error(`ndjson: ${jsonPath} has no array at "${recordsKey}" to convert`);
  }
  const count = await writeRecords(ndjsonPath, records);
  return { from: jsonPath, to: ndjsonPath, count };
}

module.exports = {
  EXT,
  encodeRecord,
  writeRecords,
  createAppender,
  readRecords,
  readBatches,
  readBatchesBy,
  readBatchesByLimits,
  readSlice,
  countRecords,
  readAllRecords,
  convertLegacyJsonFile,
};
