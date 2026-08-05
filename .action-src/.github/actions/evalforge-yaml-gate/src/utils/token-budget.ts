import type { LoadedScenario } from './evals';
import type { ScenarioComparison } from './eval-pipeline';

export type TokenBudgetViolation = {
  scenarioName: string;
  maxTokens: number;
  prTokens: number;
  prodTokens: number;
  prRunId?: string;
  prRunName?: string;
};

export function findTokenBudgetViolations(
  comparisons: ScenarioComparison[],
  scenarios: Map<string, LoadedScenario>,
): TokenBudgetViolation[] {
  const violations: TokenBudgetViolation[] = [];

  for (const comparison of comparisons) {
    const maxTokens = scenarios.get(comparison.scenarioName)?.scenario.maxTokens;
    if (maxTokens === undefined || comparison.with.totalTokens <= maxTokens) continue;

    violations.push({
      scenarioName: comparison.scenarioName,
      maxTokens,
      prTokens: comparison.with.totalTokens,
      prodTokens: comparison.without.totalTokens,
      prRunId: comparison.with.runId,
      prRunName: comparison.with.name,
    });
  }

  return violations;
}

export function formatTokenBudgetFailureMessage(violations: TokenBudgetViolation[]): string {
  if (violations.length === 1) {
    const v = violations[0];
    return `Token budget exceeded for ${v.scenarioName}: PR used ${formatTokenCount(v.prTokens)} tokens, max is ${formatTokenCount(v.maxTokens)}`;
  }

  return `Token budget exceeded for ${violations.length} scenarios: ${violations.map(v => v.scenarioName).join(', ')}`;
}

export function formatTokenCount(tokens: number): string {
  return Math.round(tokens).toLocaleString('en-US');
}
