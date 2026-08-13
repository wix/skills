import { describe, expect, it } from 'vitest';
import { scenarioIdsToRun, scenariosToRun, toAttemptOutcomes } from '../src/utils/gate';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '@wix/evalforge-core';
import type { ScenarioComparison } from '../src/utils/eval-pipeline';

const scenario = (name: string): LoadedScenario => ({
  path: `yaml/wix-manage-evals/${name}.yml`,
  scenario: {
    name,
    description: '',
    triggerPrompt: '0123456789',
    tags: ['blog'],
    assertions: [{ tool: 'T', params: { url: `https://x.com/${name}` } }],
  } satisfies Scenario,
});

const head = new Map<string, LoadedScenario>([
  ['blog/changed', scenario('blog/changed')],
  ['blog/unchanged', scenario('blog/unchanged')],
  ['marketing/social', scenario('marketing/social')],
]);

// remoteScenarioFiltersForGate and stripInactiveForeignDraftTags now live in
// @wix/evalforge-core and are covered by its tests/plan-pr-scenario-sync.test.ts.
// What stays here is wix-manage's own doc-coverage selection.

describe('scenariosToRun', () => {
  it('includes scenarios whose own YAML changed in this PR (existing behavior)', () => {
    const out = scenariosToRun({
      headScenarios: head,
      changedEvalPaths: new Set(['yaml/wix-manage-evals/blog/changed.yml']),
      coveredBy: new Map(),
    });
    expect([...out.keys()]).toEqual(['blog/changed']);
  });

  it('also includes scenarios covering a changed doc, even when their YAML is unchanged', () => {
    const out = scenariosToRun({
      headScenarios: head,
      changedEvalPaths: new Set(),
      coveredBy: new Map([['skills/wix-manage/references/marketing/social.md', ['marketing/social']]]),
    });
    expect([...out.keys()]).toEqual(['marketing/social']);
  });

  it('unions changed + doc-covered scenarios without duplicates', () => {
    const out = scenariosToRun({
      headScenarios: head,
      changedEvalPaths: new Set(['yaml/wix-manage-evals/blog/changed.yml']),
      coveredBy: new Map([
        ['skills/wix-manage/references/marketing/social.md', ['marketing/social']],
        ['skills/wix-manage/references/blog/changed.md', ['blog/changed']],
      ]),
    });
    expect([...out.keys()].sort()).toEqual(['blog/changed', 'marketing/social']);
  });

  it('ignores covering names with no loaded head scenario', () => {
    const out = scenariosToRun({
      headScenarios: head,
      changedEvalPaths: new Set(),
      coveredBy: new Map([['skills/wix-manage/references/x/y.md', ['does/not-exist']]]),
    });
    expect(out.size).toBe(0);
  });
});

describe('scenarioIdsToRun', () => {
  it('maps selected scenario names to EvalForge IDs in run order', () => {
    const selected = new Map<string, LoadedScenario>([
      ['blog/changed', scenario('blog/changed')],
      ['marketing/social', scenario('marketing/social')],
    ]);
    const ids = scenarioIdsToRun(selected, new Map([
      ['marketing/social', 'id-social'],
      ['blog/changed', 'id-changed'],
    ]));
    expect(ids).toEqual(['id-changed', 'id-social']);
  });

  it('fails clearly when a selected scenario has no remote ID', () => {
    const selected = new Map<string, LoadedScenario>([
      ['blog/changed', scenario('blog/changed')],
    ]);
    expect(() => scenarioIdsToRun(selected, new Map())).toThrow('Missing EvalForge scenario IDs for: blog/changed');
  });
});

const comparison = (over: Partial<ScenarioComparison>): ScenarioComparison => ({
  scenarioId: 'id-1',
  scenarioName: 'blog/changed',
  required: true,
  reason: '',
  with: { passed: 3, failed: 0, totalCostUsd: 0, totalTokens: 1000, durationMs: 1, assertions: [] },
  without: { passed: 3, failed: 0, totalCostUsd: 0, totalTokens: 1000, durationMs: 1, assertions: [] },
  ...over,
});

describe('toAttemptOutcomes', () => {
  const headWithBudget = new Map<string, LoadedScenario>([['blog/changed', (() => {
    const s = scenario('blog/changed');
    s.scenario.maxTokens = 500;
    return s;
  })()]]);

  it('marks a clean scenario as passed', () => {
    const out = toAttemptOutcomes([comparison({})], head);
    expect(out).toEqual([{ scenarioId: 'id-1', scenarioName: 'blog/changed', failed: false, reasons: [] }]);
  });

  it('marks both-runs-failed-judge as an llm-judge failure', () => {
    const failedRun = { passed: 0, failed: 1, totalCostUsd: 0, totalTokens: 100, durationMs: 1, assertions: [{ name: 'j', type: 'llm_judge', status: 'failed' }] };
    const out = toAttemptOutcomes([comparison({ with: failedRun, without: failedRun })], head);
    expect(out[0].failed).toBe(true);
    expect(out[0].reasons).toContain('llm-judge');
  });

  it('marks a token-budget violation', () => {
    const out = toAttemptOutcomes([comparison({})], headWithBudget); // totalTokens 1000 > maxTokens 500
    expect(out[0].failed).toBe(true);
    expect(out[0].reasons).toContain('token-budget');
  });
});
