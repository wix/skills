import { isLlmJudge, type Scenario } from './schema';
import type { LoadedScenario } from './load-scenarios';

export type QualityBar = {
  minAssertions: number;
  requireLlmJudge: boolean;
};

export const DEFAULT_QUALITY_BAR: QualityBar = {
  minAssertions: 3,
  requireLlmJudge: true,
};

export type BarCheck = { ok: boolean; reasons: string[] };

export type GuardViolation =
  | { kind: 'UNCOVERED_TAG'; tag: string }
  | { kind: 'WEAK_TAG'; tag: string; scenarios: string[] }
  | { kind: 'WEAK_TOUCHED_SCENARIO'; name: string; path: string; reasons: string[] };

export type GuardWarning = {
  kind: 'WEAK_UNTOUCHED_SCENARIO';
  name: string;
  path: string;
  /** The derived tags it carries — why it is in scope for this PR. */
  tags: string[];
  reasons: string[];
};

/** Does this scenario verify enough to be worth running? */
export function meetsQualityBar(scenario: Scenario, bar: QualityBar = DEFAULT_QUALITY_BAR): BarCheck {
  const reasons: string[] = [];
  if (scenario.assertions.length < bar.minAssertions) {
    reasons.push(
      `has ${scenario.assertions.length} assertion${scenario.assertions.length === 1 ? '' : 's'} `
      + `(needs at least ${bar.minAssertions})`,
    );
  }
  if (bar.requireLlmJudge && !scenario.assertions.some(isLlmJudge)) {
    reasons.push('has no llm_judge assertion');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Runs on local YAML alone, so a coverage failure costs no EvalForge call.
 *
 * A tag counts as covered only by a scenario that meets the bar — a one-assertion scenario
 * would run, pass, and verify nothing. Untouched shortfalls warn rather than block, so a PR is
 * never held hostage to a weak scenario someone else wrote.
 */
export function guardScenarios(input: {
  /** Reference-derived tags. Broad impact contributes none. */
  tags: string[];
  scenarios: Map<string, LoadedScenario>;
  touchedScenarioPaths: Set<string>;
  bar?: QualityBar;
}): { violations: GuardViolation[]; warnings: GuardWarning[] } {
  const bar = input.bar ?? DEFAULT_QUALITY_BAR;
  const allScenarios = [...input.scenarios.values()];
  const violations: GuardViolation[] = [];
  const weakUntouched = new Map<string, GuardWarning>();

  for (const tag of input.tags) {
    const carrying = allScenarios.filter(loaded => loaded.scenario.tags.includes(tag));

    if (carrying.length === 0) {
      violations.push({ kind: 'UNCOVERED_TAG', tag });
      continue;
    }

    const meeting = carrying.filter(loaded => meetsQualityBar(loaded.scenario, bar).ok);
    if (meeting.length === 0) {
      violations.push({
        kind: 'WEAK_TAG',
        tag,
        scenarios: carrying.map(loaded => loaded.scenario.name).sort(),
      });
      continue;
    }

    // Covered — surface weak siblings without blocking.
    for (const loaded of carrying) {
      if (input.touchedScenarioPaths.has(loaded.path)) continue;
      const check = meetsQualityBar(loaded.scenario, bar);
      if (check.ok) continue;

      const existing = weakUntouched.get(loaded.scenario.name);
      if (existing) {
        existing.tags.push(tag);
        continue;
      }
      weakUntouched.set(loaded.scenario.name, {
        kind: 'WEAK_UNTOUCHED_SCENARIO',
        name: loaded.scenario.name,
        path: loaded.path,
        tags: [tag],
        reasons: check.reasons,
      });
    }
  }

  // No weakening: a touched scenario must meet the bar even if a strong sibling covers its tag.
  for (const loaded of allScenarios) {
    if (!input.touchedScenarioPaths.has(loaded.path)) continue;
    const check = meetsQualityBar(loaded.scenario, bar);
    if (check.ok) continue;
    violations.push({
      kind: 'WEAK_TOUCHED_SCENARIO',
      name: loaded.scenario.name,
      path: loaded.path,
      reasons: check.reasons,
    });
  }

  return {
    violations,
    warnings: [...weakUntouched.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}
