export type ScenarioOutcome = {
  scenarioId: string;
  scenarioName: string;
  totalAssertions: number;
  failed: number;
  errors: number;
  failingAssertionNames: string[];
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
  prPassed: boolean;
  failingAssertionNames: string[];
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
): ChangeImpact {
  const baseById = new Map((baseOutcomes ?? []).map(outcome => [outcome.scenarioId, outcome]));

  const scenarios: ScenarioImpact[] = prOutcomes.map(prOutcome => {
    const prPassed = scenarioPassed(prOutcome);
    const baseOutcome = baseById.get(prOutcome.scenarioId);

    return {
      scenarioId: prOutcome.scenarioId,
      scenarioName: prOutcome.scenarioName,
      // A base scenario with zero assertions was not measured, so it is not evidence the
      // scenario was broken — scoring it as a base failure would manufacture a false `fixed`.
      impact: baseOutcome === undefined || baseOutcome.totalAssertions === 0
        ? 'unattributed'
        : classifyOne(prPassed, scenarioPassed(baseOutcome)),
      prPassed,
      failingAssertionNames: [...prOutcome.failingAssertionNames],
    };
  });

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
