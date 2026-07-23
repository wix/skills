import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/reconcile';
import { repoTagFor } from '../src/evalforge';
import type { Scenario } from '../src/schema';

const REPO = 'wix/skills';
const scn = (name: string): Scenario => ({
  name, description: 'd', triggerPrompt: 'trigger prompt long enough',
  tags: ['dashboard-page'], assertions: [{ type: 'llm_judge', prompt: 'p', minScore: 7 }],
});

describe('reconcile', () => {
  it('CREATEs a local scenario with no remote match', () => {
    const { actions } = reconcile({ local: [scn('a')], remote: [], repo: REPO });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'CREATE', name: 'a' });
    expect(actions[0].kind === 'CREATE' && actions[0].tags).toContain(repoTagFor(REPO));
  });
  it('UPDATEs a scenario present in both (carrying remote id)', () => {
    const remote = [{ id: 'r1', name: 'a', tags: [repoTagFor(REPO)] }];
    const { actions } = reconcile({ local: [scn('a')], remote, repo: REPO });
    expect(actions[0]).toMatchObject({ kind: 'UPDATE', id: 'r1', name: 'a' });
  });
  it('DELETEs a managed remote scenario absent from local', () => {
    const remote = [{ id: 'r1', name: 'gone', tags: [repoTagFor(REPO)] }];
    const { actions } = reconcile({ local: [], remote, repo: REPO });
    expect(actions).toEqual([{ kind: 'DELETE', id: 'r1', name: 'gone' }]);
  });
  it('SKIPs (never deletes) an unmanaged remote scenario absent from local', () => {
    const remote = [{ id: 'r1', name: 'ui-only', tags: ['dashboard-page'] }];
    const { actions, skipped } = reconcile({ local: [], remote, repo: REPO });
    expect(actions).toHaveLength(0);
    expect(skipped).toEqual([{ id: 'r1', name: 'ui-only', reason: 'unmanaged' }]);
  });
});
