'use strict';
// One meaning of "mapping digest": the canonical digest of the parsed mapping plan
// (mapping-field-contract digest). Every pin named mappingPlanDigest is written with it.
// Pins written before this rule hold the raw file SHA-256; readers still accept that.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLAN = 'mapping/mapping-plan.json';

// Readiness checks the pin every batch; parse and hash once per file version.
const cache = new Map();
function digests(projectDir) {
  const file = path.join(projectDir, PLAN);
  let stamp;
  try { const stat = fs.statSync(file); stamp = `${stat.size}:${stat.mtimeMs}:${stat.ino}`; } catch { return null; }
  const prior = cache.get(file);
  if (prior?.stamp === stamp) return prior.value;
  const text = fs.readFileSync(file, 'utf8');
  let canonical = null;
  try { canonical = require('./mapping-field-contract').digest(JSON.parse(text)); } catch {}
  const value = { canonical, raw: crypto.createHash('sha256').update(text).digest('hex') };
  cache.set(file, { stamp, value });
  return value;
}
function current(projectDir) {
  return digests(projectDir)?.canonical || null;
}
function matches(projectDir, pinned) {
  if (typeof pinned !== 'string' || !pinned) return false;
  const d = digests(projectDir);
  const value = pinned.replace(/^sha256:/, '');
  return Boolean(d) && (value === d.canonical || value === d.raw);
}
module.exports = { PLAN, current, matches };
