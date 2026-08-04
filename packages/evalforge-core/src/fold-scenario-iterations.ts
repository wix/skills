import type { EvalRunResultRow } from './evalforge';
import type { ScenarioOutcome } from './classify-change-impact';

const NOT_PASSED = new Set(['FAILED', 'ERROR']);

/**
 * One outcome per scenario, from that scenario's iterations. `partial` rows are reconstructed
 * at cancel and never scored, so they are dropped before scoring — a scenario with nothing left
 * is omitted, which the classifier reads as unattributed rather than as a failure.
 */
export function foldScenarioIterations(rows: EvalRunResultRow[]): ScenarioOutcome[] {
  const byScenario = new Map<string, EvalRunResultRow[]>();
  for (const scoredRow of rows.filter(candidate => !candidate.partial)) {
    const existing = byScenario.get(scoredRow.scenarioId);
    if (existing === undefined) byScenario.set(scoredRow.scenarioId, [scoredRow]);
    else existing.push(scoredRow);
  }

  const outcomes: ScenarioOutcome[] = [];

  for (const [scenarioId, iterations] of byScenario) {
    const failingNames = [...new Set(
      iterations.flatMap(iteration => iteration.assertions
        .filter(assertion => NOT_PASSED.has(assertion.status))
        .map(assertion => assertion.assertionName)),
    )];
    const errors = iterations.reduce(
      (total, iteration) => total + iteration.assertions.filter(assertion => assertion.status === 'ERROR').length,
      0,
    );
    const sumOf = (field: 'passed' | 'failed'): number =>
      iterations.reduce((total, iteration) => total + iteration[field], 0);

    outcomes.push({
      scenarioId,
      scenarioName: iterations[0].scenarioName,
      totalAssertions: sumOf('passed') + sumOf('failed'),
      failed: sumOf('failed'),
      errors,
      ...(failingNames.length === 0 ? {} : { failingAssertionNames: failingNames }),
    });
  }

  return outcomes;
}
