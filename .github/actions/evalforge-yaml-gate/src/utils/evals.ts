import { loadScenarios, type LoadedScenario, type LoadError } from '@wix/evalforge-core';
import { EVALS_GLOB } from './paths';

export type { LoadedScenario, LoadError };

export function loadEvals(workspaceRoot: string): {
  scenarios: Map<string, LoadedScenario>;
  errors: LoadError[];
} {
  return loadScenarios(workspaceRoot, EVALS_GLOB);
}
