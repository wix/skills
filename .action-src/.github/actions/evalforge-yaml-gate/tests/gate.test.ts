import { describe, expect, it } from 'vitest';
import { scenarioIdsToRun, scenariosToRun } from '../src/utils/gate';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '@wix/evalforge-core';

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

// remoteScenarioFiltersForGate and stripInactiveForeignDraftTags now live in
// @wix/evalforge-core and are covered by its tests/plan-pr-scenario-sync.test.ts.
// What stays here is wix-manage's own doc-coverage selection.

describe('scenariosToRun', () => {
  const head = new Map<string, LoadedScenario>([
    ['blog/changed', scenario('blog/changed')],
    ['blog/unchanged', scenario('blog/unchanged')],
    ['marketing/social', scenario('marketing/social')],
  ]);

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
