import type { LoadedScenario } from './load-scenarios';

/**
 * Cap on scenarios per gate run. Every wix-app scenario is a live agent build, so this bounds real
 * money and wall-clock, not test runtime. Single home for the default — see DEFAULT_REFERENCE_DIR.
 */
export const DEFAULT_MAX_SCENARIOS = 25;

/** Default number of times each scenario runs in each arm. Single home for the default — see DEFAULT_MAX_SCENARIOS. */
export const DEFAULT_RUNS_PER_SCENARIO = 1;

/** Default base-arm grace period, in seconds. Single home for the default — see DEFAULT_MAX_SCENARIOS. */
export const DEFAULT_BASE_ARM_GRACE_SECONDS = 60;

export type ScenarioSelection = {
  ids: string[];
  selected: string[];
  /** Cut by the cap. Reported in the comment, never dropped silently. */
  dropped: string[];
  /** Selected locally but absent from EvalForge — a sync gap worth surfacing. */
  missingIds: string[];
};

/**
 * Builds the run's scenario set. Callers pass `nameToId` as the union of the sync plan's own
 * results and the tag query, so a slow tag index cannot silently shrink the run.
 *
 * Touched scenarios sort first: a purely alphabetical cap could drop the author's own new
 * scenario for an unrelated one.
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
