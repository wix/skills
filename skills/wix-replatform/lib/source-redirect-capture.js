'use strict';

// Persist one source redirect capture (wp-redirect-sources.extractRedirectSources output) into
// state/url-preservation/: append changed rules to source-redirects.ndjson, tombstone rules a
// COMPLETE capture no longer has, write source-redirect-coverage.json, and plan imported
// destinations when source domains are already declared. One implementation for both callers:
// discovery's automatic capture and `url-redirects.js sources` (operator export path).

const state = require('./url-preservation-state.js');
const importedTargets = require('./imported-redirect-targets.js');

function captureIsComplete(coverage) {
  const providers = (coverage && coverage.providers) || [];
  return providers.length > 0 && providers.every((row) => ['extracted', 'confirmed_empty'].includes(row.status));
}

async function recordSourceRedirectCapture({ projectDir, result, runId = null }) {
  const capturedRules = result.rules.slice();
  const rows = result.rules.slice();
  const existing = await state.loadSourceRedirects(projectDir);
  const complete = captureIsComplete(result.coverage);
  if (complete) {
    const present = new Set(rows.map((rule) => rule.ruleKey));
    for (const prior of existing.latest) {
      if (present.has(prior.ruleKey) || prior.disabledReason === 'removed_from_complete_capture') continue;
      rows.push({ ...prior, enabled: false, disabledReason: 'removed_from_complete_capture',
        extractedAt: result.coverage.generatedAt });
    }
  }
  let appended = 0;
  for (const rule of rows) {
    const prior = existing.byKey[rule.ruleKey];
    const same = prior && JSON.stringify({ ...prior, extractedAt: null }) === JSON.stringify({ ...rule, extractedAt: null });
    if (!same) { await state.appendSourceRedirectRow(projectDir, rule); appended += 1; }
  }
  await state.writeStateJson(projectDir, 'sourceRedirectCoverage', result.coverage);
  const sourceDomains = await state.loadStateJson(projectDir, 'sourceDomains');
  if (sourceDomains) {
    await importedTargets.planImportedRedirectTargets({ projectDir,
      runId: runId || result.coverage.generatedAt,
      captureRevision: result.coverage.generatedAt,
      rules: importedTargets.adaptSourceRedirects(capturedRules, {
        captureRevision: result.coverage.generatedAt, sourceDomains,
      }), fullCapture: complete });
  }
  return {
    rules: capturedRules.length,
    appended,
    complete,
    coverage: result.coverage.providers.map((p) => ({ provider: p.provider, status: p.status, ruleCount: p.ruleCount })),
  };
}

module.exports = { recordSourceRedirectCapture, captureIsComplete };
