import * as core from '@actions/core';
import { runSync } from './utils/sync-run';

// Modes for the wix-app skill flows. CODEAI-889 adds the PR eval gate
// (author check -> skill version -> tags -> quality guard -> run -> comment -> cleanup)
// alongside `sync`.
const modes: Record<string, () => Promise<void>> = {
  sync: runSync,
};

const mode = core.getInput('mode') || 'sync';
const handler = modes[mode];
if (!handler) {
  core.setFailed(`Unknown mode: "${mode}". Valid: ${Object.keys(modes).join(', ')}.`);
} else {
  handler().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
}
