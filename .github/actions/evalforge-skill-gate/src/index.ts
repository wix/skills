import * as core from '@actions/core';
import { runSync } from './utils/sync-run';
import { runGate } from './utils/gate-run';
import { runCleanup } from './utils/cleanup-run';
import { runAnalyze } from './utils/analyze-run';

// Modes for the wix-app skill flows: the per-PR eval gate, its post-gate AI investigation,
// its PR-close cleanup, and merge-time scenario sync. See README.md for the full flow of each.
const modes: Record<string, () => Promise<void>> = {
  sync: runSync,
  gate: runGate,
  cleanup: runCleanup,
  analyze: runAnalyze,
};

const mode = core.getInput('mode') || 'sync';
const handler = modes[mode];
if (!handler) {
  core.setFailed(`Unknown mode: "${mode}". Valid: ${Object.keys(modes).join(', ')}.`);
} else {
  handler().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
}
