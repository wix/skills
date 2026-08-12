import type { EvalRunResultRow } from './evalforge';
import type { ScenarioOutcome } from './classify-change-impact';

const NOT_PASSED = new Set(['FAILED', 'ERROR']);

/**
 * `assertionName` is not a unique key: a real run can carry two distinct assertions sharing one
 * name (e.g. two `skill_was_called` checks against different reference files, distinguished only
 * by `assertionId`). Deduping the failing set on identity — `assertionId` where the wire sent one,
 * the name otherwise — keeps two such failures from collapsing into a single, silently-dropped
 * entry. Ambiguity is checked against every assertion in the scenario, not just the failing ones:
 * a name shared with a *passing* sibling is exactly as unidentifiable to the reader as one shared
 * with another failure, so both get the identity suffix that lets the reader tell which is which.
 */
function dedupeFailingAssertionNames(iterations: EvalRunResultRow[]): string[] {
  const identitiesByName = new Map<string, Set<string>>();
  for (const iteration of iterations) {
    for (const assertion of iteration.assertions) {
      const identities = identitiesByName.get(assertion.assertionName) ?? new Set<string>();
      identities.add(assertion.assertionId ?? assertion.assertionName);
      identitiesByName.set(assertion.assertionName, identities);
    }
  }

  const firstSeenByIdentity = new Map<string, string>(); // identity → assertionName
  for (const iteration of iterations) {
    for (const assertion of iteration.assertions) {
      if (!NOT_PASSED.has(assertion.status)) continue;
      const identity = assertion.assertionId ?? assertion.assertionName;
      if (!firstSeenByIdentity.has(identity)) firstSeenByIdentity.set(identity, assertion.assertionName);
    }
  }

  return [...firstSeenByIdentity.entries()].map(([identity, name]) => {
    const ambiguous = (identitiesByName.get(name)?.size ?? 1) > 1;
    return ambiguous ? `${name} [${identity}]` : name;
  });
}

/**
 * One outcome per scenario, from that scenario's iterations. `partial` rows are reconstructed
 * at cancel and never scored, so they are dropped before scoring — a scenario with nothing left
 * is omitted, which the classifier reads as unattributed rather than as a failure. A row with an
 * empty `scenarioId` is unidentifiable rather than unscored, but the same reasoning applies: it is
 * dropped rather than folded into a synthetic `''`-keyed outcome that would blame a scenario that
 * does not exist.
 */
export function foldScenarioIterations(rows: EvalRunResultRow[]): ScenarioOutcome[] {
  const byScenario = new Map<string, EvalRunResultRow[]>();
  for (const scoredRow of rows.filter(candidate => !candidate.partial && candidate.scenarioId !== '')) {
    const existing = byScenario.get(scoredRow.scenarioId);
    if (existing === undefined) byScenario.set(scoredRow.scenarioId, [scoredRow]);
    else existing.push(scoredRow);
  }

  const outcomes: ScenarioOutcome[] = [];

  for (const [scenarioId, iterations] of byScenario) {
    const failingNames = dedupeFailingAssertionNames(iterations);
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
