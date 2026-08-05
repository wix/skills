import { describe, it, expect } from 'vitest';
import { planCleanup } from '../src/plan-cleanup';
import type { Scenario } from '../src/schema';
import type { RemoteScenario } from '../src/evalforge';

const DRAFT_TAG = 'draft:wix/skills#42';
const REPO = 'wix/skills';
const MANAGED = ['created-via-code', 'repo:wix/skills'];

const scenario = (name: string, tags = ['blog']): Scenario => ({
  name, description: '', triggerPrompt: '0123456789', tags,
  assertions: [{ tool: 'T', params: { url: 'https://x.com/a' } }],
});
const loaded = (name: string, tags?: string[]) => ({ path: `${name}.yml`, scenario: scenario(name, tags) });
const remoteScenario = (id: string, name: string, tags: string[]): RemoteScenario => ({ id, name, tags });

describe('planCleanup', () => {
  it('DELETEs a draft with no matching base YAML — it was PR-only', () => {
    const actions = planCleanup([remoteScenario('id-1', 'new', [DRAFT_TAG])], new Map(), DRAFT_TAG, REPO);
    expect(actions).toEqual([{ kind: 'DELETE', id: 'id-1', name: 'new' }]);
  });

  it('RESTOREs a draft whose name matches a base YAML — it pre-existed the PR', () => {
    const base = new Map([['kept', loaded('kept', ['dashboard-page'])]]);
    const actions = planCleanup([remoteScenario('id-1', 'kept', [DRAFT_TAG])], base, DRAFT_TAG, REPO);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'RESTORE', id: 'id-1', name: 'kept' });
  });

  it('restores the base YAML tags plus managed tags, dropping the draft tag', () => {
    const base = new Map([['kept', loaded('kept', ['dashboard-page'])]]);
    const actions = planCleanup([remoteScenario('id-1', 'kept', [DRAFT_TAG, 'stale'])], base, DRAFT_TAG, REPO);
    expect(actions[0].kind === 'RESTORE' && actions[0].tags).toEqual(['dashboard-page', ...MANAGED]);
  });

  it('ignores scenarios not tagged for this PR', () => {
    const actions = planCleanup([
      remoteScenario('id-1', 'other', ['draft:wix/skills#99']),
      remoteScenario('id-2', 'plain', MANAGED),
    ], new Map(), DRAFT_TAG, REPO);
    expect(actions).toEqual([]);
  });

  it('handles a mix — restoring some and deleting others', () => {
    const base = new Map([['kept', loaded('kept')]]);
    const actions = planCleanup([
      remoteScenario('id-1', 'kept', [DRAFT_TAG]),
      remoteScenario('id-2', 'new', [DRAFT_TAG]),
    ], base, DRAFT_TAG, REPO);
    expect(actions.map(action => action.kind)).toEqual(['RESTORE', 'DELETE']);
  });
});
