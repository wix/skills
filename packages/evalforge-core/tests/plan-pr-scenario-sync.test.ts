import { describe, it, expect, vi } from 'vitest';
import {
  diffSyncPlan, draftOnlyTags, semanticPlusDraftTags,
  remoteScenarioFiltersForGate, listRemoteScenariosForGate, stripInactiveForeignDraftTags,
} from '../src/plan-pr-scenario-sync';
import type { Scenario } from '../src/schema';
import type { RemoteScenario } from '../src/evalforge';

const scenario = (name: string, tags = ['blog']): Scenario => ({
  name, description: '', triggerPrompt: '0123456789', tags,
  assertions: [{ tool: 'T', params: { url: `https://x.com/${name}` } }],
});
const loaded = (name: string, tags?: string[]) => ({ path: `${name}.yml`, scenario: scenario(name, tags) });
const remoteScenario = (id: string, name: string, tags: string[] = []): RemoteScenario => ({ id, name, tags });

const DRAFT_TAG = 'draft:wix/skills#42';
const REPO = 'wix/skills';
const MANAGED = ['created-via-code', 'repo:wix/skills'];

describe('diffSyncPlan — wix-manage contract (default tag strategy)', () => {
  it('plans CREATE for a new YAML not in remote, tagged draft-only', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', loaded('blog/a')]]),
      head: new Map([['blog/a', loaded('blog/a')]]),
      base: new Map(),
      remote: [],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'CREATE', name: 'blog/a', tags: [DRAFT_TAG, ...MANAGED] });
    expect(plan.errors).toEqual([]);
  });

  it('plans UPDATE for a scenario present in remote without a foreign draft tag', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', loaded('blog/a')]]),
      head: new Map([['blog/a', loaded('blog/a')]]),
      base: new Map([['blog/a', loaded('blog/a')]]),
      remote: [remoteScenario('id-1', 'blog/a', [DRAFT_TAG])],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions[0]).toMatchObject({ kind: 'UPDATE', id: 'id-1', tags: [DRAFT_TAG, ...MANAGED] });
  });

  it('plans DELETE when a PR-only draft scenario is removed', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', loaded('blog/a')]]),
      remote: [remoteScenario('id-1', 'blog/a', [DRAFT_TAG])],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([{ kind: 'DELETE', id: 'id-1', name: 'blog/a' }]);
  });

  it('plans DEFER_DELETE when a pre-existing scenario is removed', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', loaded('blog/a')]]),
      remote: [remoteScenario('id-1', 'blog/a', MANAGED)],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([{ kind: 'DEFER_DELETE', id: 'id-1', name: 'blog/a' }]);
  });

  it('errors FOREIGN_DRAFT rather than stomping another PR draft', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', loaded('blog/a')]]),
      head: new Map([['blog/a', loaded('blog/a')]]),
      base: new Map(),
      remote: [remoteScenario('id-1', 'blog/a', ['draft:wix/skills#99'])],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([]);
    expect(plan.errors).toEqual([
      { kind: 'FOREIGN_DRAFT', name: 'blog/a', foreignTags: ['draft:wix/skills#99'], path: 'blog/a.yml' },
    ]);
  });

  it('never DELETEs a scenario still present in head but absent from changedHead', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map([['blog/a', loaded('blog/a')]]),
      base: new Map([['blog/a', loaded('blog/a')]]),
      remote: [remoteScenario('id-1', 'blog/a', [DRAFT_TAG])],
      draftTag: DRAFT_TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([]);
  });
});

describe('diffSyncPlan — tag strategy', () => {
  it('draftOnlyTags replaces semantic tags (wix-manage: promote restores them)', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['a', loaded('a', ['dashboard-page'])]]),
      head: new Map([['a', loaded('a', ['dashboard-page'])]]),
      base: new Map(),
      remote: [],
      draftTag: DRAFT_TAG,
      repo: REPO,
      tagStrategy: draftOnlyTags,
    });
    expect(plan.actions[0].kind === 'CREATE' && plan.actions[0].tags).not.toContain('dashboard-page');
  });

  it('semanticPlusDraftTags keeps the semantic tags so a tag query still finds the scenario', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['a', loaded('a', ['dashboard-page', 'data-collection'])]]),
      head: new Map([['a', loaded('a', ['dashboard-page', 'data-collection'])]]),
      base: new Map(),
      remote: [],
      draftTag: DRAFT_TAG,
      repo: REPO,
      tagStrategy: semanticPlusDraftTags,
    });
    expect(plan.actions[0].kind === 'CREATE' && plan.actions[0].tags)
      .toEqual(['dashboard-page', 'data-collection', DRAFT_TAG, ...MANAGED]);
  });

  it('semanticPlusDraftTags preserves semantic tags on UPDATE too', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['a', loaded('a', ['dashboard-page'])]]),
      head: new Map([['a', loaded('a', ['dashboard-page'])]]),
      base: new Map([['a', loaded('a', ['dashboard-page'])]]),
      remote: [remoteScenario('id-1', 'a', [DRAFT_TAG])],
      draftTag: DRAFT_TAG,
      repo: REPO,
      tagStrategy: semanticPlusDraftTags,
    });
    expect(plan.actions[0].kind === 'UPDATE' && plan.actions[0].tags).toContain('dashboard-page');
  });

  it('defaults to draftOnlyTags when no strategy is given', () => {
    const withDefault = diffSyncPlan({
      changedHead: new Map([['a', loaded('a', ['dashboard-page'])]]),
      head: new Map([['a', loaded('a', ['dashboard-page'])]]),
      base: new Map(), remote: [], draftTag: DRAFT_TAG, repo: REPO,
    });
    const withExplicit = diffSyncPlan({
      changedHead: new Map([['a', loaded('a', ['dashboard-page'])]]),
      head: new Map([['a', loaded('a', ['dashboard-page'])]]),
      base: new Map(), remote: [], draftTag: DRAFT_TAG, repo: REPO, tagStrategy: draftOnlyTags,
    });
    expect(withDefault).toEqual(withExplicit);
  });
});

describe('remoteScenarioFiltersForGate', () => {
  it('requests changed names, base-only names, and this PR draft tag', () => {
    const filters = remoteScenarioFiltersForGate({
      changedHead: new Map([['b', loaded('b')]]),
      head: new Map([['b', loaded('b')]]),
      base: new Map([['a', loaded('a')], ['b', loaded('b')]]),
      draftTag: DRAFT_TAG,
    });
    expect(filters).toEqual({ names: ['a', 'b'], tags: [DRAFT_TAG], all: false });
  });

  it('adds the derived semantic tags for a tag-selected gate', () => {
    const filters = remoteScenarioFiltersForGate({
      changedHead: new Map(), head: new Map(), base: new Map(), draftTag: DRAFT_TAG,
      extraTags: ['dashboard-page', 'data-collection'],
    });
    expect(filters.tags).toEqual([DRAFT_TAG, 'dashboard-page', 'data-collection']);
    expect(filters.all).toBe(false);
  });

  it('sets all when broad impact means the whole suite is in play', () => {
    const filters = remoteScenarioFiltersForGate({
      changedHead: new Map(), head: new Map(), base: new Map(), draftTag: DRAFT_TAG,
      extraTags: ['dashboard-page'], all: true,
    });
    expect(filters.all).toBe(true);
  });
});

describe('listRemoteScenariosForGate', () => {
  it('unions name and tag queries, deduping by id', async () => {
    const listTestScenarios = vi.fn().mockResolvedValue([remoteScenario('id-1', 'a')]);
    const listTestScenariosByTag = vi.fn()
      .mockResolvedValueOnce([remoteScenario('id-1', 'a')])
      .mockResolvedValueOnce([remoteScenario('id-2', 'b')]);

    const result = await listRemoteScenariosForGate(
      { listTestScenarios, listTestScenariosByTag }, 'P',
      { names: ['a'], tags: [DRAFT_TAG, 'dashboard-page'], all: false },
    );

    expect(result.map(entry => entry.id).sort()).toEqual(['id-1', 'id-2']);
    expect(listTestScenarios).toHaveBeenCalledWith('P', ['a']);
  });

  it('fetches every scenario and skips the filtered queries when all is set', async () => {
    const listTestScenarios = vi.fn().mockResolvedValue([remoteScenario('id-1', 'a')]);
    const listTestScenariosByTag = vi.fn();

    const result = await listRemoteScenariosForGate(
      { listTestScenarios, listTestScenariosByTag }, 'P',
      { names: ['a'], tags: [DRAFT_TAG], all: true },
    );

    expect(listTestScenarios).toHaveBeenCalledWith('P');
    expect(listTestScenariosByTag).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('skips the name query entirely when there are no names', async () => {
    const listTestScenarios = vi.fn();
    const listTestScenariosByTag = vi.fn().mockResolvedValue([]);

    await listRemoteScenariosForGate(
      { listTestScenarios, listTestScenariosByTag }, 'P',
      { names: [], tags: [DRAFT_TAG], all: false },
    );

    expect(listTestScenarios).not.toHaveBeenCalled();
  });
});

describe('stripInactiveForeignDraftTags', () => {
  it('drops foreign draft tags from closed PRs and caches repeated lookups', async () => {
    const isDraftTagActive = vi.fn(async (tag: string) => tag === 'draft:wix/skills#7');
    const remote = [
      remoteScenario('id-1', 'a', ['draft:wix/skills#9', 'blog']),
      remoteScenario('id-2', 'b', ['draft:wix/skills#9', 'draft:wix/skills#7']),
      remoteScenario('id-3', 'c', [DRAFT_TAG, 'blog']),
    ];

    const result = await stripInactiveForeignDraftTags(remote, DRAFT_TAG, isDraftTagActive);

    expect(result[0].tags).toEqual(['blog']);
    expect(result[1].tags).toEqual(['draft:wix/skills#7']);
    expect(result[2].tags).toEqual([DRAFT_TAG, 'blog']);
    expect(isDraftTagActive).toHaveBeenCalledTimes(2);
  });

  it('never strips this PR own draft tag', async () => {
    const result = await stripInactiveForeignDraftTags(
      [remoteScenario('id-1', 'a', [DRAFT_TAG])], DRAFT_TAG, async () => false,
    );
    expect(result[0].tags).toEqual([DRAFT_TAG]);
  });
});
