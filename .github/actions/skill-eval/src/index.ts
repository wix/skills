import * as core from '@actions/core';
import { runEval } from './utils/eval';
import { runCleanup } from './utils/cleanup';

const mode = core.getInput('mode') || 'eval';
if (mode === 'cleanup') {
  runCleanup().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
} else {
  runEval().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
}
