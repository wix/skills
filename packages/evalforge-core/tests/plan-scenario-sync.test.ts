import { describe, it, expect } from 'vitest';
import { planScenarioSync } from '../src/plan-scenario-sync';
import { repoTagFor } from '../src/evalforge';
import type { Scenario } from '../src/schema';

const REPO = 'wix/skills';
const scn = (name: string): Scenario => ({
  name, description: 'd', triggerPrompt: 'trigger prompt long enough',
  tags: ['dashboard-page'], assertions: [{ type: 'llm_judge', prompt: 'p', minScore: 7 }],
});

describe('planScenarioSync', () => {
  it('CREATEs a local scenario with no remote match', () => {
    const { actions } = planScenarioSync({ local: [scn('a')], remote: [], repo: REPO });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'CREATE', name: 'a' });
    expect(actions[0].kind === 'CREATE' && actions[0].tags).toContain(repoTagFor(REPO));
  });
  it('carries a file-template scenario\'s templateId into the CREATE body', () => {
    const local: Scenario = { ...scn('with-file-template'), templateId: 'blank-editor' };
    const { actions } = planScenarioSync({ local: [local], remote: [], repo: REPO });
    expect(actions[0].kind === 'CREATE' && actions[0].body.templateId).toBe('blank-editor');
  });
  it('omits templateId from the CREATE body when the scenario has none', () => {
    const { actions } = planScenarioSync({ local: [scn('no-template')], remote: [], repo: REPO });
    expect(actions[0].kind === 'CREATE' && actions[0].body).not.toHaveProperty('templateId');
  });
  it('UPDATEs a scenario present in both (carrying remote id)', () => {
    const remote = [{ id: 'r1', name: 'a', tags: [repoTagFor(REPO)] }];
    const { actions } = planScenarioSync({ local: [scn('a')], remote, repo: REPO });
    expect(actions[0]).toMatchObject({ kind: 'UPDATE', id: 'r1', name: 'a' });
  });
  it('DELETEs a managed remote scenario absent from local', () => {
    const remote = [{ id: 'r1', name: 'gone', tags: [repoTagFor(REPO)] }];
    const { actions } = planScenarioSync({ local: [], remote, repo: REPO });
    expect(actions).toEqual([{ kind: 'DELETE', id: 'r1', name: 'gone' }]);
  });
  it('SKIPs (never deletes) an unmanaged remote scenario absent from local', () => {
    const remote = [{ id: 'r1', name: 'ui-only', tags: ['dashboard-page'] }];
    const { actions, skipped } = planScenarioSync({ local: [], remote, repo: REPO });
    expect(actions).toHaveLength(0);
    expect(skipped).toEqual([{ id: 'r1', name: 'ui-only', reason: 'unmanaged' }]);
  });
  it('never DELETEs a managed remote scenario that is still present in local', () => {
    const remote = [{ id: 'r1', name: 'a', tags: [repoTagFor(REPO)] }];
    const { actions, skipped } = planScenarioSync({ local: [scn('a')], remote, repo: REPO });
    expect(actions.filter(a => a.kind === 'DELETE')).toHaveLength(0);
    expect(actions).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
  it('deletes only the managed absentee when local and remote partially overlap', () => {
    const remote = [
      { id: 'r1', name: 'kept', tags: [repoTagFor(REPO)] },
      { id: 'r2', name: 'gone', tags: [repoTagFor(REPO)] },
      { id: 'r3', name: 'ui-only', tags: ['dashboard-page'] },
    ];
    const { actions, skipped } = planScenarioSync({ local: [scn('kept'), scn('fresh')], remote, repo: REPO });
    expect(actions).toContainEqual(expect.objectContaining({ kind: 'UPDATE', id: 'r1', name: 'kept' }));
    expect(actions).toContainEqual(expect.objectContaining({ kind: 'CREATE', name: 'fresh' }));
    expect(actions).toContainEqual({ kind: 'DELETE', id: 'r2', name: 'gone' });
    expect(skipped).toEqual([{ id: 'r3', name: 'ui-only', reason: 'unmanaged' }]);
  });
});
