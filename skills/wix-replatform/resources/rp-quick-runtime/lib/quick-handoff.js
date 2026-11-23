'use strict';

// A quick import ends by writing the same post-execution handoff a full run writes, so the work that
// follows (a front-end copy) can see what the import put on the site. The handoff is best effort: a
// failure to write it never fails or changes the import.

// Records when the run's last write finished. The handoff is generated after it.
function stampLastWrite(summary) {
  summary.lastWriteAt = new Date().toISOString();
}

// What the run left on the site: the names of its products, in source order.
function onSiteProducts(rows, isOnSite, nameOf) {
  return { products: rows.filter((row) => isOnSite(row)).map((row) => ({ name: nameOf(row) })), productsRecorded: true };
}

// Call after `execution/completion-report.json` is on disk. A live run with something to hand off writes the
// handoff; a failure is `summary.handoffWarning` (printed by the command), never an error.
async function finish(projectDir, summary, { dryRun = false } = {}) {
  if (dryRun || summary.status === 'no-data') return;
  try {
    const result = await require('../../../lib/website-handoff.js').generatePostExecutionHandoff(projectDir, { appendLog: false });
    if (!result.ok) summary.handoffWarning = `migration-handoff.json not written: ${result.reason}`;
  } catch (error) {
    summary.handoffWarning = `migration-handoff.json not written: ${error.message}`;
  }
}

module.exports = { stampLastWrite, onSiteProducts, finish };
