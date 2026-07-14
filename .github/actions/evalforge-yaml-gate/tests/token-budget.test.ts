import { describe, it, expect } from 'vitest';
import type { LoadedScenario } from '../src/utils/evals';
import type { ScenarioComparison } from '../src/utils/eval-pipeline';
import { findTokenBudgetViolations, formatTokenBudgetFailureMessage } from '../src/utils/token-budget';

function loadedScenario(name: string, maxTokens?: number): LoadedScenario {
  return {
    path: `yaml/wix-manage-evals/${name}.yml`,
    scenario: {
      name,
      description: 'description',
      triggerPrompt: 'Do the scenario task',
      tags: ['stores'],
      maxTokens,
      assertions: [{ tool: 'ReadFullDocsArticle' }],
    },
  };
}

function comparison(name: string, prTokens: number, prodTokens = 1000): ScenarioComparison {
  return {
    scenarioId: `id-${name}`,
    scenarioName: name,
    required: true,
    reason: 'reason',
    with: {
      runId: `pr-${name}`,
      name: 'PR run',
      passed: 1,
      failed: 0,
      totalCostUsd: 0.1,
      totalTokens: prTokens,
      durationMs: 1000,
      assertions: [],
    },
    without: {
      runId: `prod-${name}`,
      name: 'prod run',
      passed: 1,
      failed: 0,
      totalCostUsd: 0.1,
      totalTokens: prodTokens,
      durationMs: 1000,
      assertions: [],
    },
    pairwiseJudgement: {
      winner: 'tie',
      confidence: 'high',
      reasoning: 'same',
    },
  };
}

describe('token budgets', () => {
  it('passes when no budget is configured', () => {
    const scenarios = new Map([['stores/no-budget', loadedScenario('stores/no-budget')]]);
    expect(findTokenBudgetViolations([comparison('stores/no-budget', 50_000)], scenarios)).toEqual([]);
  });

  it('passes when PR tokens equal the configured max', () => {
    const scenarios = new Map([['stores/equal', loadedScenario('stores/equal', 25_000)]]);
    expect(findTokenBudgetViolations([comparison('stores/equal', 25_000)], scenarios)).toEqual([]);
  });

  it('fails when PR tokens exceed the configured max and includes the scenario name', () => {
    const scenarios = new Map([['stores/over-budget', loadedScenario('stores/over-budget', 25_000)]]);
    const violations = findTokenBudgetViolations([comparison('stores/over-budget', 31_420)], scenarios);

    expect(violations).toMatchObject([{
      scenarioName: 'stores/over-budget',
      maxTokens: 25_000,
      prTokens: 31_420,
    }]);
    expect(formatTokenBudgetFailureMessage(violations))
      .toBe('Token budget exceeded for stores/over-budget: PR used 31,420 tokens, max is 25,000');
  });

  it('includes all scenario names in the multi-failure message', () => {
    const scenarios = new Map([
      ['ecommerce/ecom-load-context', loadedScenario('ecommerce/ecom-load-context', 25_000)],
      ['stores/create-product', loadedScenario('stores/create-product', 12_000)],
    ]);
    const violations = findTokenBudgetViolations([
      comparison('ecommerce/ecom-load-context', 31_420),
      comparison('stores/create-product', 12_001),
    ], scenarios);

    expect(formatTokenBudgetFailureMessage(violations))
      .toBe('Token budget exceeded for 2 scenarios: ecommerce/ecom-load-context, stores/create-product');
  });

  it('reports prod tokens but does not use them to determine failure', () => {
    const scenarios = new Map([['stores/prod-over', loadedScenario('stores/prod-over', 25_000)]]);
    const violations = findTokenBudgetViolations([comparison('stores/prod-over', 20_000, 40_000)], scenarios);

    expect(violations).toEqual([]);
  });
});
