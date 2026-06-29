import { describe, it, expect } from 'vitest';
import { planCleanup } from '../src/utils/cleanup';
import type { RemoteScenario } from '../src/utils/evalforge';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '../src/utils/schema';

const TAG = 'draft:wix/skills#100';
const REPO = 'wix/skills';
const MANAGED = ['created-via-code', 'repo:wix/skills'];

const remote = (id: string, name: string, tags: string[]): RemoteScenario => ({ id, name, tags });

const scenario = (name: string, tags: string[]): Scenario => ({
  name, description: '', triggerPrompt: '0123456789', tags,
  assertions: [{ tool: 't', params: { url: `https://x.com/${name}` } }],
});

const loaded = (name: string, tags = ['production-tag']): LoadedScenario => ({
  path: `yaml/wix-manage-evals/area/${name.split('/').pop()}.yml`,
  scenario: scenario(name, tags),
});

describe('planCleanup', () => {
  it('DELETEs drafts with no matching base YAML (PR-only drafts)', () => {
    const plan = planCleanup(
      [remote('id1', 'events/list-events', [TAG])],
      new Map(),                     // empty base = no pre-existing
      TAG,
      REPO,
    );
    expect(plan).toEqual([{ kind: 'DELETE', id: 'id1', name: 'events/list-events' }]);
  });

  it('RESTOREs drafts whose name matches a base YAML (pre-existing scenario)', () => {
    const baseEvals = new Map([['events/list-events', loaded('events/list-events', ['events'])]]);
    const plan = planCleanup(
      [remote('id1', 'events/list-events', [TAG])],
      baseEvals,
      TAG,
      REPO,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: 'RESTORE',
      id: 'id1',
      name: 'events/list-events',
      tags: ['events', ...MANAGED], // base YAML's tags + managed code-origin tags, NOT the draft tag
    });
    // body should be the mapped EvalForge shape from the base scenario
    if (plan[0].kind === 'RESTORE') {
      expect(plan[0].body.name).toBe('events/list-events');
      expect(plan[0].body.triggerPrompt).toBeDefined();
    }
  });

  it('ignores scenarios not tagged for this PR', () => {
    const plan = planCleanup(
      [
        remote('id1', 'events/list-events', ['events']),                    // not a draft at all
        remote('id2', 'blog/post', ['draft:wix/skills#999']),                // someone else’s draft
      ],
      new Map(),
      TAG,
      REPO,
    );
    expect(plan).toEqual([]);
  });

  it('handles a mix: restore some, delete others', () => {
    const baseEvals = new Map([['events/list-events', loaded('events/list-events', ['events'])]]);
    const plan = planCleanup(
      [
        remote('id1', 'events/list-events', [TAG]),    // was in base → RESTORE
        remote('id2', 'events/new-scenario', [TAG]),   // PR-only → DELETE
        remote('id3', 'unrelated', ['blog']),          // ignored
      ],
      baseEvals,
      TAG,
      REPO,
    );
    expect(plan.map(a => a.kind)).toEqual(['RESTORE', 'DELETE']);
    expect(plan.map(a => a.name)).toEqual(['events/list-events', 'events/new-scenario']);
  });

  it('restores base YAML tags plus managed tags, dropping the draft and any leftover tags', () => {
    const baseEvals = new Map([
      ['blog/post', loaded('blog/post', ['blog', 'blog-v2', 'reviewed'])],
    ]);
    const plan = planCleanup(
      [remote('id1', 'blog/post', [TAG, 'leftover-tag'])],
      baseEvals,
      TAG,
      REPO,
    );
    if (plan[0].kind !== 'RESTORE') throw new Error('expected RESTORE');
    expect(plan[0].tags).toEqual(['blog', 'blog-v2', 'reviewed', ...MANAGED]);
    expect(plan[0].tags).not.toContain(TAG);
    expect(plan[0].tags).not.toContain('leftover-tag');
  });
});
