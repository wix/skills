import * as core from '@actions/core';
import { runEval } from './utils/eval';
import { runCleanup } from './utils/cleanup';
import { runPromotion } from './utils/promotion';

const modes: Record<string, () => Promise<void>> = {
  eval: runEval,
  cleanup: runCleanup,
  promote: runPromotion,
};

const mode = core.getInput('mode') || 'eval';
const handler = modes[mode];
if (!handler) {
  core.setFailed(`Unknown mode: "${mode}". Valid modes: ${Object.keys(modes).join(', ')}.`);
} else {
  handler().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
}
