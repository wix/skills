import type { LoadedScenario } from './evals';
import type { Scenario } from './schema';
import { toEvalForgeBody } from './evalforge-mapper';
import { withManagedTags, type RemoteScenario, type ScenarioBody } from './evalforge';

export type CreateAction = { kind: 'CREATE'; name: string; body: ScenarioBody; tags: string[] };
export type UpdateAction = { kind: 'UPDATE'; id: string; name: string; body: ScenarioBody; tags: string[] };
export type DeleteAction = { kind: 'DELETE'; id: string; name: string };
export type DeferDeleteAction = { kind: 'DEFER_DELETE'; id: string; name: string };
export type SyncAction = CreateAction | UpdateAction | DeleteAction | DeferDeleteAction;

export type SyncError = {
  kind: 'FOREIGN_DRAFT';
  name: string;
  foreignTags: string[];
  path?: string;
};

export function toScenarioBody(s: Scenario): ScenarioBody {
  return toEvalForgeBody(s);
}

function foreignDraftTags(tags: string[], myTag: string): string[] {
  return tags.filter(t => t.startsWith('draft:') && t !== myTag);
}

export function diffSyncPlan(input: {
  // Scenarios this PR's net diff actually touched — get CREATE/UPDATE actions.
  changedHead: Map<string, LoadedScenario>;
  // All scenarios in the PR's head YAMLs — used to detect real removals vs. unchanged.
  // A scenario can be in `head` but not in `changedHead` (unchanged by this PR's net diff,
  // e.g. user reverted it). Treating that as a removal would wrongly DELETE it.
  head: Map<string, LoadedScenario>;
  base: Map<string, LoadedScenario>;
  remote: RemoteScenario[];
  draftTag: string;
  // `owner/repo` the scenarios are authored from — stamped as a managed code-origin tag.
  repo: string;
}): { actions: SyncAction[]; errors: SyncError[] } {
  const { changedHead, head, base, remote, draftTag, repo } = input;
  const remoteByName = new Map(remote.map(r => [r.name, r]));
  const actions: SyncAction[] = [];
  const errors: SyncError[] = [];

  for (const [name, ls] of changedHead) {
    const r = remoteByName.get(name);
    if (!r) {
      actions.push({ kind: 'CREATE', name, body: toScenarioBody(ls.scenario), tags: withManagedTags([draftTag], repo) });
      continue;
    }
    const foreign = foreignDraftTags(r.tags, draftTag);
    if (foreign.length > 0) {
      errors.push({ kind: 'FOREIGN_DRAFT', name, foreignTags: foreign, path: ls.path });
      continue;
    }
    actions.push({ kind: 'UPDATE', id: r.id, name, body: toScenarioBody(ls.scenario), tags: withManagedTags([draftTag], repo) });
  }

  for (const [name, ls] of base) {
    if (head.has(name)) continue;
    const r = remoteByName.get(name);
    if (!r) continue;
    if (r.tags.includes(draftTag)) {
      actions.push({ kind: 'DELETE', id: r.id, name });
      continue;
    }
    const foreign = foreignDraftTags(r.tags, draftTag);
    if (foreign.length > 0) {
      errors.push({ kind: 'FOREIGN_DRAFT', name, foreignTags: foreign, path: ls.path });
    } else {
      actions.push({ kind: 'DEFER_DELETE', id: r.id, name });
    }
  }

  return { actions, errors };
}
