'use strict';

// Parsed artifacts are immutable and reused only while their on-disk identity is unchanged.
// Resolve symlinks and include ctime so atomic replacement and same-size edits invalidate.
const fs = require('node:fs');
const path = require('node:path');
const cache = new Map();
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function readJson(file, fallback) {
  const requested = path.resolve(file);
  let resolved, stat;
  try { resolved = fs.realpathSync(requested); stat = fs.statSync(resolved, { bigint: true }); }
  catch (error) { cache.delete(requested); if (error.code === 'ENOENT') return fallback; throw error; }
  const signature = [resolved, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  const previous = cache.get(requested);
  if (previous?.signature === signature) return previous.value;
  // Never retain a stale success after a malformed rewrite.
  cache.delete(requested);
  const value = freeze(JSON.parse(fs.readFileSync(resolved, 'utf8')));
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  cache.set(requested, { signature, value });
  return value;
}
module.exports = { readJson };
