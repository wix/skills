import type { LoadedScenario } from './load-scenarios';

export type ScenarioSelection = {
  /** EvalForge ids to run, in selection order. */
  ids: string[];
  /** Names actually running. */
  selected: string[];
  /** Names cut by the cap — reported in the comment, never dropped silently. */
  dropped: string[];
  /** Names selected locally with no known EvalForge id — a sync gap worth surfacing. */
  missingIds: string[];
};

/**
 * Builds the run's scenario set.
 *
 * `nameToId` is the union of the sync plan's own results (CREATE returns the new id, UPDATE
 * already has it) and the remote tag query, so the gate never depends on read-after-write
 * consistency: a slow tag index cannot silently shrink the run.
 *
 * The cap prioritises scenarios this PR touched. Sorting purely alphabetically would let a
 * capped run drop the author's own new scenario in favour of an unrelated one.
 */
export function selectScenarios(input: {
  broadImpact: boolean;
  tags: string[];
  localScenarios: Map<string, LoadedScenario>;
  nameToId: Map<string, string>;
  touchedScenarioPaths: Set<string>;
  maxScenarios: number;
}): ScenarioSelection {
  const derivedTags = new Set(input.tags);

  const candidates = [...input.localScenarios.values()].filter(loaded =>
    input.broadImpact
    || input.touchedScenarioPaths.has(loaded.path)
    || loaded.scenario.tags.some(tag => derivedTags.has(tag)),
  );

  const ordered = candidates.sort((left, right) => {
    const leftTouched = input.touchedScenarioPaths.has(left.path) ? 0 : 1;
    const rightTouched = input.touchedScenarioPaths.has(right.path) ? 0 : 1;
    if (leftTouched !== rightTouched) return leftTouched - rightTouched;
    return left.scenario.name.localeCompare(right.scenario.name);
  });

  const missingIds: string[] = [];
  const resolvable: Array<{ name: string; id: string }> = [];
  for (const loaded of ordered) {
    const id = input.nameToId.get(loaded.scenario.name);
    if (id) resolvable.push({ name: loaded.scenario.name, id });
    else missingIds.push(loaded.scenario.name);
  }

  const running = resolvable.slice(0, Math.max(0, input.maxScenarios));
  const cut = resolvable.slice(running.length);

  return {
    ids: running.map(entry => entry.id),
    selected: running.map(entry => entry.name),
    dropped: cut.map(entry => entry.name).sort(),
    missingIds: missingIds.sort(),
  };
}
