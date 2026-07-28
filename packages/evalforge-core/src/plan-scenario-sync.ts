import type { Scenario } from './schema';
import type { RemoteScenario, ScenarioBody } from './evalforge';
import { withManagedTags, repoTagFor } from './evalforge';
import { toEvalForgeBody } from './evalforge-mapper';

export type ScenarioSyncAction =
  | { kind: 'CREATE'; name: string; body: ScenarioBody; tags: string[] }
  | { kind: 'UPDATE'; id: string; name: string; body: ScenarioBody; tags: string[] }
  | { kind: 'DELETE'; id: string; name: string };
export type ScenarioSyncSkip = { name: string; id: string; reason: 'unmanaged' };

export function planScenarioSync(input: {
  local: Scenario[];
  remote: RemoteScenario[];
  repo: string;
}): { actions: ScenarioSyncAction[]; skipped: ScenarioSyncSkip[] } {
  const { local, remote, repo } = input;
  const managedTag = repoTagFor(repo);
  const remoteByName = new Map(remote.map(remoteScenario => [remoteScenario.name, remoteScenario]));
  const localNames = new Set(local.map(scenario => scenario.name));
  const actions: ScenarioSyncAction[] = [];
  const skipped: ScenarioSyncSkip[] = [];

  for (const scenario of local) {
    const tags = withManagedTags(scenario.tags, repo);
    const body = toEvalForgeBody(scenario);
    const match = remoteByName.get(scenario.name);
    if (match) {
      actions.push({ kind: 'UPDATE', id: match.id, name: scenario.name, body, tags });
    } else {
      actions.push({ kind: 'CREATE', name: scenario.name, body, tags });
    }
  }

  for (const remoteScenario of remote) {
    if (localNames.has(remoteScenario.name)) continue;
    if (remoteScenario.tags.includes(managedTag)) {
      actions.push({ kind: 'DELETE', id: remoteScenario.id, name: remoteScenario.name });
    } else {
      skipped.push({ id: remoteScenario.id, name: remoteScenario.name, reason: 'unmanaged' });
    }
  }

  return { actions, skipped };
}
