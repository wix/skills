import type { LoadedScenario } from './load-scenarios';
import { withManagedTags, type RemoteScenario, type ScenarioBody } from './evalforge';
import { toScenarioBody } from './plan-pr-scenario-sync';

export type CleanupRestoreAction = {
  kind: 'RESTORE';
  id: string;
  name: string;
  body: ScenarioBody;
  tags: string[];
};
export type CleanupDeleteAction = { kind: 'DELETE'; id: string; name: string };
export type CleanupAction = CleanupRestoreAction | CleanupDeleteAction;

/**
 * Decides what to do with each of this PR's draft-tagged scenarios once the PR closes.
 * A name present in the base SHA's YAML pre-existed the PR, so it is RESTOREd to that
 * pre-PR state; anything else was a PR-only draft and is DELETEd. Pure.
 */
export function planCleanup(
  remote: RemoteScenario[],
  baseScenarios: Map<string, LoadedScenario>,
  draftTag: string,
  repo: string,
): CleanupAction[] {
  const actions: CleanupAction[] = [];
  for (const scenario of remote) {
    if (!scenario.tags.includes(draftTag)) continue;
    const baseScenario = baseScenarios.get(scenario.name);
    actions.push(baseScenario
      ? {
          kind: 'RESTORE',
          id: scenario.id,
          name: scenario.name,
          body: toScenarioBody(baseScenario.scenario),
          tags: withManagedTags(baseScenario.scenario.tags, repo),
        }
      : { kind: 'DELETE', id: scenario.id, name: scenario.name });
  }
  return actions;
}
