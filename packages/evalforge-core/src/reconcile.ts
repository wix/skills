import type { Scenario } from './schema';
import type { RemoteScenario, ScenarioBody } from './evalforge';
import { withManagedTags, repoTagFor } from './evalforge';
import { toEvalForgeBody } from './evalforge-mapper';

export type ReconcileAction =
  | { kind: 'CREATE'; name: string; body: ScenarioBody; tags: string[] }
  | { kind: 'UPDATE'; id: string; name: string; body: ScenarioBody; tags: string[] }
  | { kind: 'DELETE'; id: string; name: string };
export type ReconcileSkip = { name: string; id: string; reason: 'unmanaged' };

export function reconcile(input: {
  local: { name: string; scenario: Scenario }[];
  remote: RemoteScenario[];
  repo: string;
}): { actions: ReconcileAction[]; skipped: ReconcileSkip[] } {
  const { local, remote, repo } = input;
  const managedTag = repoTagFor(repo);
  const remoteByName = new Map(remote.map(r => [r.name, r]));
  const localNames = new Set(local.map(l => l.name));
  const actions: ReconcileAction[] = [];
  const skipped: ReconcileSkip[] = [];

  for (const { scenario } of local) {
    const tags = withManagedTags(scenario.tags, repo);
    const body = toEvalForgeBody(scenario);
    const match = remoteByName.get(scenario.name);
    if (match) actions.push({ kind: 'UPDATE', id: match.id, name: scenario.name, body, tags });
    else actions.push({ kind: 'CREATE', name: scenario.name, body, tags });
  }

  for (const r of remote) {
    if (localNames.has(r.name)) continue;
    if (r.tags.includes(managedTag)) actions.push({ kind: 'DELETE', id: r.id, name: r.name });
    else skipped.push({ id: r.id, name: r.name, reason: 'unmanaged' });
  }

  return { actions, skipped };
}
