import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { glob } from 'glob';
import { parseScenario, type Scenario } from './schema';

export type LoadedScenario = { path: string; scenario: Scenario };
export type LoadError = { path: string; message: string };

export function loadScenarios(root: string, globPattern: string): {
  scenarios: Map<string, LoadedScenario>;
  errors: LoadError[];
} {
  const found = glob.sync(globPattern, {
    cwd: root,
    nodir: true,
    // .action-src/** is the wix-manage two-checkout convention (a nested checkout of the
    // action's own source), not a generic default — exclude it so its fixtures/tests aren't
    // picked up as scenarios.
    ignore: ['**/node_modules/**', '**/dist/**', '.action-src/**'],
    posix: true,
  });

  const scenarios = new Map<string, LoadedScenario>();
  const errors: LoadError[] = [];

  for (const rel of found.sort()) {
    let parsed: Scenario;
    try {
      parsed = parseScenario(readFileSync(posix.join(root, rel), 'utf8'));
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
