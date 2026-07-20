import { describe, it, expect } from 'vitest';
import { diffSyncPlan } from '../src/utils/sync';
import type { RemoteScenario } from '../src/utils/evalforge';
import type { Scenario } from '../src/utils/schema';

const s = (name: string): Scenario => ({
  name, description: '', triggerPrompt: '0123456789', tags: ['blog'],
  assertions: [{ tool: 'T', params: { url: `https://x.com/${name}` } }],
});

const r = (id: string, name: string, tags: string[] = []): RemoteScenario => ({ id, name, tags });

const TAG = 'draft:wix/skills#42';
const REPO = 'wix/skills';
const MANAGED = ['created-via-code', 'repo:wix/skills'];

const ls = (name: string) => ({ path: `${name}.yml`, scenario: s(name) });

describe('diffSyncPlan', () => {
  it('plans CREATE for a new YAML not in remote', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', ls('blog/a')]]),
      head: new Map([['blog/a', ls('blog/a')]]),
      base: new Map(),
      remote: [],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'CREATE', name: 'blog/a', tags: [TAG, ...MANAGED] });
    expect(plan.errors).toEqual([]);
  });

  it('plans UPDATE for a YAML modified in PR, no foreign draft tag', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', ls('blog/a')]]),
      head: new Map([['blog/a', ls('blog/a')]]),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [r('id-1', 'blog/a', [TAG])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'UPDATE', id: 'id-1', name: 'blog/a', tags: [TAG, ...MANAGED] });
  });

  it('plans FAIL on foreign draft tag at update site', () => {
    const plan = diffSyncPlan({
      changedHead: new Map([['blog/a', ls('blog/a')]]),
      head: new Map([['blog/a', ls('blog/a')]]),
      base: new Map(),
      remote: [r('id-1', 'blog/a', ['draft:wix/skills#99'])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ kind: 'FOREIGN_DRAFT', name: 'blog/a' });
    expect(plan.actions).toEqual([]);
  });

  it('plans DELETE for a YAML deleted on PR branch where existing has THIS PR draft tag', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [r('id-1', 'blog/a', [TAG])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([{ kind: 'DELETE', id: 'id-1', name: 'blog/a' }]);
  });

  it('plans DEFER_DELETE for a YAML deleted where existing has no draft tag (non-draft)', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [r('id-1', 'blog/a', ['blog'])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([{ kind: 'DEFER_DELETE', id: 'id-1', name: 'blog/a' }]);
  });

  it('plans FAIL on delete-of-foreign-draft', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [r('id-1', 'blog/a', ['draft:wix/skills#99'])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ kind: 'FOREIGN_DRAFT', name: 'blog/a' });
  });

  it('skips removed YAML that has no remote at all (already gone)', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map(),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  // Regression: user modified scenario then reverted it while keeping other PR changes.
  // The scenario is in head AND base (matches base after revert), but absent from changedHead
  // (no net file diff). It must NOT be treated as a removal — the previous code passed
  // changedHead as `head` to the base loop and incorrectly DELETEd the remote.
  it('does NOT delete a scenario that is unchanged in net diff but still present in head', () => {
    const plan = diffSyncPlan({
      changedHead: new Map(),
      head: new Map([['blog/a', ls('blog/a')]]),
      base: new Map([['blog/a', ls('blog/a')]]),
      remote: [r('id-1', 'blog/a', [TAG])],
      draftTag: TAG,
      repo: REPO,
    });
    expect(plan.actions).toEqual([]);
    expect(plan.errors).toEqual([]);
  });
});
