import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { glob } from 'glob';
import { parseScenario, type Scenario } from './schema';
import { EVALS_GLOB } from './paths';

export type LoadedScenario = { path: string; scenario: Scenario };
export type LoadError = { path: string; message: string };

export function loadEvals(workspaceRoot: string): {
  scenarios: Map<string, LoadedScenario>;
  errors: LoadError[];
} {
  const found = glob.sync(EVALS_GLOB, {
    cwd: workspaceRoot,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '.action-src/**'],
    posix: true,
  });

  const scenarios = new Map<string, LoadedScenario>();
  const errors: LoadError[] = [];

  for (const rel of found.sort()) {
    let parsed: Scenario;
    try {
      const raw = readFileSync(posix.join(workspaceRoot, rel), 'utf8');
      parsed = parseScenario(raw);
    } catch (e) {
      errors.push({ path: rel, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const existing = scenarios.get(parsed.name);
    if (existing) {
      errors.push({
        path: rel,
        message: `duplicate name "${parsed.name}" — also declared at ${existing.path}`,
      });
      continue;
    }
    scenarios.set(parsed.name, { path: rel, scenario: parsed });
  }

  return { scenarios, errors };
}
