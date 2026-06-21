import * as core from '@actions/core';
import { getErrorMessage } from './utils/reporting';
import { runEval, runCleanup } from './utils/orchestration';

const mode = core.getInput('mode');
if (mode === 'cleanup') {
  runCleanup().catch(err => core.setFailed(getErrorMessage(err)));
} else if (mode === 'eval') {
  runEval().catch(err => core.setFailed(getErrorMessage(err)));
} else {
  core.setFailed(`Unknown mode: "${mode}". Valid modes are "eval" and "cleanup".`);
}
