export type ScenarioOutcome = {
  scenarioId: string;
  scenarioName: string;
  totalAssertions: number;
  failed: number;
  errors: number;
  failingAssertionNames?: string[];
};

export type ImpactClass =
  | 'fixed'
  | 'newly-broken'
  | 'still-passing'
  | 'still-failing'
  | 'unattributed';

export type ScenarioImpact = {
  scenarioId: string;
  scenarioName: string;
  impact: ImpactClass;
  /**
   * Whether the PR arm passed this scenario. Absent when the PR arm measured nothing at all: a
   * `false` there would state the PR failed a scenario that was never scored.
   */
  prPassed?: boolean;
  failingAssertionNames?: string[];
};

export type ChangeImpact = {
  scenarios: ScenarioImpact[];
  fixed: number;
  newlyBroken: number;
  stillPassing: number;
  stillFailing: number;
  unattributed: number;
  /** `fixed - newlyBroken` — the necessity signal. */
  netEffect: number;
  /** True when at least one scenario was actually classified against a measured base outcome. */
  attributionAvailable: boolean;
};

/** Zero assertions is not a pass: nothing was verified. Errors count as failures. */
export function scenarioPassed(outcome: ScenarioOutcome): boolean {
  return outcome.totalAssertions > 0 && outcome.failed === 0 && outcome.errors === 0;
}

function classifyOne(prPassed: boolean, basePassed: boolean): ImpactClass {
  if (prPassed) return basePassed ? 'still-passing' : 'fixed';
  return basePassed ? 'newly-broken' : 'still-failing';
}

export function classifyChangeImpact(
  prOutcomes: ScenarioOutcome[],
  baseOutcomes: ScenarioOutcome[] | undefined,
  /**
   * Ids the gate requested for this run, with their names. A requested scenario that produced no
   * scored iteration (every row `partial`, or none at all) is absent from `prOutcomes` — without
   * this list that absence is silent, so the comment reads as "not selected" instead of
   * "not measured". Each one absent from `prOutcomes` is appended below as `unattributed`.
   */
  expectedScenarios?: Array<{ id: string; name: string }>,
): ChangeImpact {
  const baseById = new Map((baseOutcomes ?? []).map(outcome => [outcome.scenarioId, outcome]));
  // Authoritative names come from the repo YAML the gate requested, keyed by id — the same source
  // `unmeasured` below already uses. A measured row can still carry an empty wire `scenarioName`
  // (see `toResultRow`'s default), and this is the only chance to replace it before it reaches the
  // comment as a nameless blocking table row.
  const expectedNameById = new Map((expectedScenarios ?? []).map(scenario => [scenario.id, scenario.name]));

  const measured: ScenarioImpact[] = prOutcomes.map(prOutcome => {
    const prMeasuredNothing = prOutcome.totalAssertions === 0;
    const baseOutcome = baseById.get(prOutcome.scenarioId);

    return {
      scenarioId: prOutcome.scenarioId,
      scenarioName: expectedNameById.get(prOutcome.scenarioId) || prOutcome.scenarioName || prOutcome.scenarioId,
      // A base or PR scenario with zero assertions was not measured, so it is not evidence the
      // scenario was broken (base) or that this change broke it (PR) — scoring either as a
      // failure would manufacture a false `fixed` or `newly-broken` for a scenario nothing
      // actually verified (e.g. every assertion SKIPPED, so scenarioPassed is false but nothing
      // failed either).
      impact: prMeasuredNothing || baseOutcome === undefined || baseOutcome.totalAssertions === 0
        ? 'unattributed'
        : classifyOne(scenarioPassed(prOutcome), scenarioPassed(baseOutcome)),
      // Absent, not `false`, when the PR arm scored nothing — same reasoning as the unmeasured
      // scenarios below: a `false` here would state the PR failed a scenario nothing verified.
      ...(prMeasuredNothing ? {} : { prPassed: scenarioPassed(prOutcome) }),
      ...(prOutcome.failingAssertionNames === undefined
        ? {}
        : { failingAssertionNames: [...prOutcome.failingAssertionNames] }),
    };
  });

  const measuredIds = new Set(prOutcomes.map(outcome => outcome.scenarioId));
  // Deduped: a caller that requested the same id twice would otherwise get the same scenario
  // listed twice in the comment and counted twice in `unattributed`.
  const appendedIds = new Set<string>();
  const unmeasured: ScenarioImpact[] = [];
  for (const expected of expectedScenarios ?? []) {
    if (measuredIds.has(expected.id) || appendedIds.has(expected.id)) continue;
    appendedIds.add(expected.id);
    // No `prPassed`: nothing was measured, so neither value is a true statement about this run.
    unmeasured.push({ scenarioId: expected.id, scenarioName: expected.name, impact: 'unattributed' });
  }

  const scenarios = [...measured, ...unmeasured];

  const countOf = (impact: ImpactClass): number =>
    scenarios.filter(scenario => scenario.impact === impact).length;

  const fixed = countOf('fixed');
  const newlyBroken = countOf('newly-broken');

  return {
    scenarios,
    fixed,
    newlyBroken,
    stillPassing: countOf('still-passing'),
    stillFailing: countOf('still-failing'),
    unattributed: countOf('unattributed'),
    netEffect: fixed - newlyBroken,
    attributionAvailable: scenarios.some(scenario => scenario.impact !== 'unattributed'),
  };
}
