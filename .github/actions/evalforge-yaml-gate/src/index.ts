import * as core from '@actions/core';
import { runGate } from './utils/gate';
import { runPromote } from './utils/promote';
import { runCleanup } from './utils/cleanup';
import { runCreateVersion } from './utils/create-version';

const modes: Record<string, () => Promise<void>> = {
  'create-version': runCreateVersion,
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
