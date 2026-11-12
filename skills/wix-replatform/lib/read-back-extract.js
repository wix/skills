'use strict';

// Extracts are read once; only the current record is buffered, never the whole array.
const fs = require('node:fs');
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
function fail(code) {
  return Object.assign(new Error(code), {
    code
  });
}
function parseRecord(text, maxRecordBytes) {
  if (Buffer.byteLength(text) > maxRecordBytes) throw fail('extract_record_too_large');
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    throw fail('extract_json_invalid');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw fail('extract_record_invalid');
  return record;
}
async function* readExtract(file, {
  format = 'auto',
  maxRecordBytes = MAX_RECORD_BYTES
} = {}) {
  if (!['auto', 'json', 'ndjson'].includes(format) || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1) throw fail('extract_options_invalid');
  const stream = fs.createReadStream(file, {
    encoding: 'utf8',
    highWaterMark: 64 * 1024
  });
  let selected = format === 'auto' ? null : format;
  let buffer = '',
    depth = 0,
    quoted = false,
    escaped = false,
    opened = false,
    closed = false,
    expect = 'first',
    recordBytes = 0;
  try {
    for await (let chunk of stream) {
      if (!opened && !buffer && chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      if (!selected) {
        const first = chunk.search(/\S/);
        if (first < 0) continue;
        selected = chunk[first] === '[' ? 'json' : 'ndjson';
      }
      if (selected === 'ndjson') {
        // Bound every partial line before reading the next chunk.
        let start = 0;
        for (let i = 0; i < chunk.length; i += 1) {
          if (chunk[i] !== '\n') continue;
          buffer += chunk.slice(start, i);
          if (buffer.trim()) yield parseRecord(buffer, maxRecordBytes);
          buffer = '';
          start = i + 1;
        }
        buffer += chunk.slice(start);
        if (Buffer.byteLength(buffer) > maxRecordBytes) throw fail('extract_record_too_large');
        continue;
      }
      for (const ch of chunk) {
        if (closed) {
          if (/\S/.test(ch)) throw fail('extract_json_trailing_data');
          continue;
        }
        if (!opened) {
          if (/\s/.test(ch)) continue;
          if (ch !== '[') throw fail('extract_json_array_required');
          opened = true;
          continue;
        }
        if (!buffer) {
          if (/\s/.test(ch)) continue;
          if (ch === ']') {
            if (expect === 'value') throw fail('extract_json_invalid');
            closed = true;
            continue;
          }
          if (expect === 'comma') {
            if (ch !== ',') throw fail('extract_json_invalid');
            expect = 'value';
            continue;
          }
          if (ch !== '{') throw fail('extract_record_invalid');
          buffer = '{';
          depth = 1;
          quoted = false;
          escaped = false;
          recordBytes = 1;
          continue;
        }
        buffer += ch;
        recordBytes += Buffer.byteLength(ch);
        if (recordBytes > maxRecordBytes) throw fail('extract_record_too_large');
        if (quoted) {
          if (escaped) escaped = false;else if (ch === '\\') escaped = true;else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;else if (ch === '{' || ch === '[') depth += 1;else if (ch === '}' || ch === ']') depth -= 1;
        if (depth === 0) {
          yield parseRecord(buffer, maxRecordBytes);
          buffer = '';
          expect = 'comma';
        }
        if (depth < 0) throw fail('extract_json_invalid');
      }
    }
    if (selected === 'json' && (!opened || !closed || buffer)) throw fail('extract_json_incomplete');
    if (selected === 'ndjson' && buffer.trim()) yield parseRecord(buffer, maxRecordBytes);
    // Empty NDJSON is a valid empty extract; empty JSON is never a valid array.
    if (format === 'json' && !opened) throw fail('extract_json_incomplete');
  } finally {
    stream.destroy();
  }
}
module.exports = {
  MAX_RECORD_BYTES,
  readExtract
};
