import { describe, expect, it } from 'vitest';
import { remoteScenarioFiltersForGate } from '../src/utils/gate';
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
