import * as core from '@actions/core';
import { runGate } from './utils/gate';
import { runPromote } from './utils/promote';
import { runCleanup } from './utils/cleanup';

const modes: Record<string, () => Promise<void>> = {
  eval: runGate,
  promote: runPromote,
  cleanup: runCleanup,
};

const mode = core.getInput('mode') || 'eval';
const handler = modes[mode];
if (!handler) {
  core.setFailed(`Unknown mode: "${mode}". Valid: ${Object.keys(modes).join(', ')}.`);
} else {
  handler().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
}
