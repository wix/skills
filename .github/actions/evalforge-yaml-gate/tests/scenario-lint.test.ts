import { describe, expect, it } from 'vitest';
import { lintScenario, lintChangedScenarios, MIN_SCORE_FLOOR } from '../src/utils/scenario-lint';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '@wix/evalforge-core';

const goodScenario = (overrides: Partial<Scenario> = {}): LoadedScenario => ({
  path: 'yaml/wix-manage-evals/blog/create-post.yml',
  scenario: {
    name: 'blog/create-post',
    description: 'creates a blog post',
    triggerPrompt: 'Create a blog post titled "Summer Sale" with the body "20% off everything".',
    tags: ['blog'],
    maxTokens: 25000,
    assertions: [
      { tool: 'ReadFullDocsArticle', params: { articleUrl: 'https://dev.wix.com/docs/api-reference/blog/skills/create-post' } },
      { type: 'llm_judge', minScore: 7, prompt: 'Pass if the post was created with the given title. Fail if the title differs or no post exists.' },
      { type: 'llm_judge', minScore: 7, prompt: 'Rate the tool-call path. Fail (score below 7) on wasted calls or recovered errors.' },
    ],
    ...overrides,
  } as Scenario,
});

const ruleIds = (loaded: LoadedScenario) => lintScenario(loaded).map(v => v.rule);

describe('lintScenario', () => {
  it('passes a well-formed scenario', () => {
    expect(lintScenario(goodScenario())).toEqual([]);
  });

  it('flags fewer than three assertions', () => {
    const s = goodScenario();
    s.scenario.assertions = s.scenario.assertions.slice(0, 2);
    expect(ruleIds(s)).toContain('three-assertions');
  });

  it('flags a missing doc-URL tool-call assertion', () => {
    const s = goodScenario();
    s.scenario.assertions = [
      { tool: 'SomeTool', params: { other: 'x' } },
      s.scenario.assertions[1],
      s.scenario.assertions[2],
    ];
    expect(ruleIds(s)).toContain('coverage-assertion');
  });

  it('flags fewer than two llm_judge assertions', () => {
    const s = goodScenario();
    s.scenario.assertions = [
      s.scenario.assertions[0],
      s.scenario.assertions[1],
      { type: 'cost', maxCostUsd: 1 },
    ];
    expect(ruleIds(s)).toContain('two-llm-judges');
  });

  it('flags a numeric judge with minScore below the floor', () => {
    const s = goodScenario();
    (s.scenario.assertions[1] as { minScore?: number }).minScore = MIN_SCORE_FLOOR - 1;
    expect(ruleIds(s)).toContain('min-score-floor');
  });

  it('flags a numeric judge with no minScore at all', () => {
    const s = goodScenario();
    delete (s.scenario.assertions[1] as { minScore?: number }).minScore;
    expect(ruleIds(s)).toContain('min-score-floor');
  });

  it('does not require minScore for boolean-scoring judges', () => {
    const s = goodScenario();
    const judge = s.scenario.assertions[1] as { minScore?: number; scoringMode?: string };
    delete judge.minScore;
    judge.scoringMode = 'boolean';
    expect(ruleIds(s)).not.toContain('min-score-floor');
  });

  it('flags a judge prompt without fail criteria', () => {
    const s = goodScenario();
    (s.scenario.assertions[1] as { prompt: string }).prompt = 'Pass if the post was created with the given title.';
    expect(ruleIds(s)).toContain('judge-fail-criteria');
  });

  it('flags a question-shaped triggerPrompt', () => {
    const s = goodScenario({ triggerPrompt: 'How do I create a blog post on Wix?' });
    expect(ruleIds(s)).toContain('task-shaped-prompt');
  });

  it('flags a missing top-level maxTokens', () => {
    const s = goodScenario();
    delete (s.scenario as { maxTokens?: number }).maxTokens;
    expect(ruleIds(s)).toContain('max-tokens');
  });
});

describe('lintChangedScenarios', () => {
  it('lints only scenarios whose YAML path changed in the PR', () => {
    const bad = goodScenario({ triggerPrompt: 'How do I create a blog post?' });
    const legacyBad = goodScenario({ name: 'blog/legacy' });
    legacyBad.path = 'yaml/wix-manage-evals/blog/legacy.yml';
    legacyBad.scenario.triggerPrompt = 'How do I do the legacy thing on Wix?';
    const scenarios = new Map([
      ['blog/create-post', bad],
      ['blog/legacy', legacyBad],
    ]);
    const violations = lintChangedScenarios(scenarios, new Set(['yaml/wix-manage-evals/blog/create-post.yml']));
    expect(violations.map(v => v.name)).toEqual(['blog/create-post']);
  });
});
