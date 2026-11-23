'use strict';

// Toolkit gaps the run worked around in-run (every override slot and listed patch): each use
// is one row here (what step, which file, why). The completion report lists them
// under toolkitGaps. A gap is never a cutover or operator task: the run used the override and
// every check ran after it; the fix belongs in the toolkit.
//
// Each producer owns its own rows (`source`) and rewrites them every time it runs, so an override
// that is removed stops being reported.

const fs = require('node:fs');
const path = require('node:path');

const GAPS_PATH = 'execution/toolkit-gaps.json';

function readToolkitGaps(projectDir) {
  let document;
  try { document = JSON.parse(fs.readFileSync(path.join(projectDir, GAPS_PATH), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return document && document.schemaVersion === 1 && Array.isArray(document.gaps) ? document.gaps : [];
}

// Replaces `source`'s rows with `gaps` ({ step, file, why, kind }); kind is 'override' (an
// override slot) or 'patch' (a listed patch to a toolkit-written file).
function recordToolkitGaps(projectDir, source, gaps) {
  const kept = readToolkitGaps(projectDir).filter((row) => row.source !== source);
  const rows = gaps.map(({ step, file, why, kind = 'override' }) => ({ code: 'toolkit_gap', kind, source, step, file, why: typeof why === 'string' && why.trim() ? why.trim() : null }));
  if (!kept.length && !rows.length && !fs.existsSync(path.join(projectDir, GAPS_PATH))) return [];
  const file = path.join(projectDir, GAPS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, gaps: [...kept, ...rows] }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return rows;
}

module.exports = { GAPS_PATH, readToolkitGaps, recordToolkitGaps };
