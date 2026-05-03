import * as core from '@actions/core';
import { runEval } from './utils/eval';

runEval().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
