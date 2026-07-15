import { describe, expect, it } from 'vitest';
import { remoteScenarioFiltersForGate, coveringScenarioNames, selectScenariosToSync } from '../src/utils/gate';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '../src/utils/schema';

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

describe('remoteScenarioFiltersForGate', () => {
  it('requests changed scenario names, deleted base scenario names, and this PR draft tag', () => {
    const filters = remoteScenarioFiltersForGate({
      changedHead: new Map([
        ['blog/changed', scenario('blog/changed')],
        ['stores/changed', scenario('stores/changed')],
      ]),
      head: new Map([
        ['blog/changed', scenario('blog/changed')],
        ['stores/changed', scenario('stores/changed')],
        ['blog/unchanged', scenario('blog/unchanged')],
      ]),
      base: new Map([
        ['blog/changed', scenario('blog/changed')],
        ['blog/deleted', scenario('blog/deleted')],
        ['blog/unchanged', scenario('blog/unchanged')],
      ]),
      draftTag: 'draft:wix/skills#42',
    });

    expect(filters).toEqual({
      names: ['blog/changed', 'blog/deleted', 'stores/changed'],
      tags: ['draft:wix/skills#42'],
    });
  });
});

describe('coveringScenarioNames', () => {
  it('flattens and de-duplicates covering scenario names across changed docs', () => {
    const coveredBy = new Map<string, string[]>([
      ['skills/wix-manage/references/blog/a.md', ['blog/one', 'blog/two']],
      ['skills/wix-manage/references/blog/b.md', ['blog/two', 'blog/three']],
    ]);
    expect([...coveringScenarioNames(coveredBy)].sort()).toEqual(['blog/one', 'blog/three', 'blog/two']);
  });

  it('returns empty set when no docs changed', () => {
    expect(coveringScenarioNames(new Map()).size).toBe(0);
  });
});

describe('selectScenariosToSync', () => {
  const head = new Map<string, LoadedScenario>([
    ['blog/changed', scenario('blog/changed')],
    ['blog/covers-doc', scenario('blog/covers-doc')],
    ['blog/untouched', scenario('blog/untouched')],
  ]);

  it('includes scenarios whose YAML changed', () => {
    const out = selectScenariosToSync({
      head,
      changedEvalPaths: new Set(['yaml/wix-manage-evals/blog/changed.yml']),
      docCoveringNames: new Set(),
    });
    expect([...out.keys()]).toEqual(['blog/changed']);
  });

  it('includes scenarios that cover a changed doc even when their YAML is untouched', () => {
    const out = selectScenariosToSync({
      head,
      changedEvalPaths: new Set(),
      docCoveringNames: new Set(['blog/covers-doc']),
    });
    expect([...out.keys()]).toEqual(['blog/covers-doc']);
  });

  it('unions changed-YAML and doc-covering scenarios without duplicates', () => {
    const out = selectScenariosToSync({
      head,
      changedEvalPaths: new Set(['yaml/wix-manage-evals/blog/changed.yml']),
      docCoveringNames: new Set(['blog/changed', 'blog/covers-doc']),
    });
    expect([...out.keys()].sort()).toEqual(['blog/changed', 'blog/covers-doc']);
  });

  it('excludes untouched, uncovered scenarios', () => {
    const out = selectScenariosToSync({
      head,
      changedEvalPaths: new Set(),
      docCoveringNames: new Set(),
    });
    expect(out.size).toBe(0);
  });
});
