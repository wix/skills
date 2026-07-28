import type { Scenario } from './schema';
import type { LoadedScenario } from './load-scenarios';
import { withManagedTags, uniqueRemoteScenarios, DRAFT_PREFIX, type RemoteScenario, type ScenarioBody } from './evalforge';
import { toEvalForgeBody } from './evalforge-mapper';

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

export function toScenarioBody(scenario: Scenario): ScenarioBody {
  return toEvalForgeBody(scenario);
}

/**
 * Chooses the tags a PR-draft CREATE/UPDATE writes. The two strategies are not
 * interchangeable:
 *
 * - `draftOnlyTags` replaces the scenario's semantic tags with the draft tag. Correct only
 *   when the gate selects scenarios by explicit id and a promote step restores the real
 *   tags on merge (wix-manage).
 * - `semanticPlusDraftTags` keeps them. Required whenever the gate *queries by tag*: strip
 *   `dashboard-page` off the scenario and the query looking for it returns nothing, so the
 *   gate runs zero scenarios and reports green. Needs no promote step.
 */
export type PrTagStrategy = (scenario: Scenario, draftTag: string) => string[];

export const draftOnlyTags: PrTagStrategy = (_scenario, draftTag) => [draftTag];

export const semanticPlusDraftTags: PrTagStrategy = (scenario, draftTag) => [...scenario.tags, draftTag];

function foreignDraftTags(tags: string[], myDraftTag: string): string[] {
  return tags.filter(tag => tag.startsWith(DRAFT_PREFIX) && tag !== myDraftTag);
}

export function diffSyncPlan(input: {
  /** Scenarios this PR's net diff actually touched — these get CREATE/UPDATE actions. */
  changedHead: Map<string, LoadedScenario>;
  /**
   * All scenarios in the PR's head YAMLs — used to tell a real removal from an unchanged
   * scenario. A scenario can be in `head` but not `changedHead` (the author reverted it);
   * treating that as a removal would wrongly DELETE it.
   */
  head: Map<string, LoadedScenario>;
  base: Map<string, LoadedScenario>;
  remote: RemoteScenario[];
  draftTag: string;
  /** `owner/repo` the scenarios are authored from — stamped as a managed code-origin tag. */
  repo: string;
  tagStrategy?: PrTagStrategy;
}): { actions: SyncAction[]; errors: SyncError[] } {
  const { changedHead, head, base, remote, draftTag, repo } = input;
  const tagStrategy = input.tagStrategy ?? draftOnlyTags;
  const remoteByName = new Map(remote.map(entry => [entry.name, entry]));
  const actions: SyncAction[] = [];
  const errors: SyncError[] = [];

  for (const [name, localScenario] of changedHead) {
    const tags = withManagedTags(tagStrategy(localScenario.scenario, draftTag), repo);
    const match = remoteByName.get(name);
    if (!match) {
      actions.push({ kind: 'CREATE', name, body: toScenarioBody(localScenario.scenario), tags });
      continue;
    }
    const foreign = foreignDraftTags(match.tags, draftTag);
    if (foreign.length > 0) {
      errors.push({ kind: 'FOREIGN_DRAFT', name, foreignTags: foreign, path: localScenario.path });
      continue;
    }
    actions.push({ kind: 'UPDATE', id: match.id, name, body: toScenarioBody(localScenario.scenario), tags });
  }

  for (const [name, baseScenario] of base) {
    if (head.has(name)) continue;
    const match = remoteByName.get(name);
    if (!match) continue;
    if (match.tags.includes(draftTag)) {
      actions.push({ kind: 'DELETE', id: match.id, name });
      continue;
    }
    const foreign = foreignDraftTags(match.tags, draftTag);
    if (foreign.length > 0) {
      errors.push({ kind: 'FOREIGN_DRAFT', name, foreignTags: foreign, path: baseScenario.path });
    } else {
      actions.push({ kind: 'DEFER_DELETE', id: match.id, name });
    }
  }

  return { actions, errors };
}

export type RemoteScenarioFilters = {
  names: string[];
  tags: string[];
  /** Broad impact: the whole suite is in play, so fetch every scenario instead of filtering. */
  all: boolean;
};

/** The smallest remote scenario lookup that can both sync and select for this PR. */
export function remoteScenarioFiltersForGate(input: {
  changedHead: Map<string, LoadedScenario>;
  head: Map<string, LoadedScenario>;
  base: Map<string, LoadedScenario>;
  draftTag: string;
  /** Semantic tags the gate will select by (wix-app); omitted by the id-selected wix-manage gate. */
  extraTags?: string[];
  all?: boolean;
}): RemoteScenarioFilters {
  const names = new Set<string>(input.changedHead.keys());
  for (const [name] of input.base) {
    if (!input.head.has(name)) names.add(name);
  }
  const tags = [input.draftTag, ...(input.extraTags ?? []).filter(tag => tag !== input.draftTag)];
  return { names: [...names].sort(), tags, all: input.all ?? false };
}

export type ScenarioQueryClient = {
  listTestScenarios(projectId: string, names?: string[]): Promise<RemoteScenario[]>;
  listTestScenariosByTag(projectId: string, tag: string): Promise<RemoteScenario[]>;
};

export async function listRemoteScenariosForGate(
  client: ScenarioQueryClient,
  projectId: string,
  filters: RemoteScenarioFilters,
): Promise<RemoteScenario[]> {
  if (filters.all) {
    return uniqueRemoteScenarios(await client.listTestScenarios(projectId));
  }
  const [byName, byTag] = await Promise.all([
    filters.names.length > 0 ? client.listTestScenarios(projectId, filters.names) : Promise.resolve([]),
    Promise.all(filters.tags.map(tag => client.listTestScenariosByTag(projectId, tag))),
  ]);
  return uniqueRemoteScenarios([byName, ...byTag].flat());
}

function isForeignDraftTag(tag: string, myDraftTag: string): boolean {
  return tag.startsWith(DRAFT_PREFIX) && tag !== myDraftTag;
}

/**
 * Drops draft tags belonging to PRs that are no longer open, so an abandoned PR's lock
 * cannot block this one forever. Lookups are memoized per tag.
 */
export async function stripInactiveForeignDraftTags(
  remote: RemoteScenario[],
  myDraftTag: string,
  isDraftTagActive: (tag: string) => Promise<boolean>,
): Promise<RemoteScenario[]> {
  const cachedStates = new Map<string, Promise<boolean>>();
  const getState = (tag: string): Promise<boolean> => {
    let state = cachedStates.get(tag);
    if (!state) {
      state = isDraftTagActive(tag);
      cachedStates.set(tag, state);
    }
    return state;
  };

  const normalized: RemoteScenario[] = [];
  for (const scenario of remote) {
    const tags: string[] = [];
    let changed = false;
    for (const tag of scenario.tags) {
      if (!isForeignDraftTag(tag, myDraftTag) || await getState(tag)) {
        tags.push(tag);
        continue;
      }
      changed = true;
    }
    normalized.push(changed ? { ...scenario, tags } : scenario);
  }
  return normalized;
}
