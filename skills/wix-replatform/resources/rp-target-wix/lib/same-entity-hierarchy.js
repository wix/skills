'use strict';

// Same-task parent -> child entities (product categories, nested blog categories) land in one
// pass. The parent is written by the same task, so no dependency edge can wait for
// it (a task is never its own producer), and building every record before the first write
// holds every child as `parent-not-imported`. Instead the task runs one depth level at a time:
// level n+1 is built -- and its parent resolved from the crosswalk -- only after level n is
// written. Same depth-ascending rule as `wix-build.js` buildCategory, for a streamed importer.

// Splits records into depth levels, keeping input order inside a level. A record whose parent is
// not in the source set is a root here; its builder decides whether that parent is resolvable.
// A record on a parent cycle (or deeper than `maxDepth`) is never placed in a level: it is
// returned in `unplaceable` for the caller to hold.
function depthLevels(records, { idOf, parentIdOf, maxDepth = 50 } = {}) {
  if (typeof idOf !== 'function' || typeof parentIdOf !== 'function') throw new Error('depthLevels requires idOf and parentIdOf');
  const key = (value) => (value === null || value === undefined || value === '' || value === 0 || value === '0' ? null : String(value));
  const byId = new Map(records.map((record) => [key(idOf(record)), record]));
  const depth = new Map();
  const depthOf = (record) => {
    const id = key(idOf(record));
    if (depth.has(id)) return depth.get(id);
    const chain = [];
    const seen = new Set();
    let cursor = record;
    let base = 0;
    while (cursor) {
      const cursorId = key(idOf(cursor));
      if (depth.has(cursorId)) { base = depth.get(cursorId); break; }
      if (seen.has(cursorId) || chain.length > maxDepth) { base = null; break; }
      seen.add(cursorId);
      chain.push(cursorId);
      const parentId = key(parentIdOf(cursor));
      cursor = parentId === null ? null : byId.get(parentId);
      if (!cursor) { base = -1; break; }
    }
    // Walk back down the chain: the topmost record sits one below `base`.
    for (let index = chain.length - 1, level = base === null ? null : base + 1; index >= 0; index -= 1) {
      depth.set(chain[index], level);
      if (level !== null) level += 1;
    }
    return depth.get(id);
  };
  const levels = [];
  const unplaceable = [];
  for (const record of records) {
    const level = depthOf(record);
    if (level === null || level > maxDepth) { unplaceable.push(record); continue; }
    (levels[level] ||= []).push(record);
  }
  return { levels: levels.map((level) => level || []), unplaceable };
}

// Runs `runLevel(records, depth)` once per level, in order, awaiting each before building the
// next. `runLevel` is the task's ordinary build-gate-write pass over those records.
async function runByDepthLevel(records, { idOf, parentIdOf, runLevel, maxDepth } = {}) {
  if (typeof runLevel !== 'function') throw new Error('runByDepthLevel requires runLevel');
  const { levels, unplaceable } = depthLevels(records, { idOf, parentIdOf, maxDepth });
  const results = [];
  for (let level = 0; level < levels.length; level += 1) {
    if (levels[level].length) results.push(await runLevel(levels[level], level));
  }
  return { results, unplaceable };
}

module.exports = { depthLevels, runByDepthLevel };
