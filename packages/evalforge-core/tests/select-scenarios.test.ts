import { describe, it, expect } from 'vitest';
import { selectScenarios } from '../src/select-scenarios';
import type { Scenario } from '../src/schema';

const scenario = (name: string, tags: string[]): Scenario => ({
  name, description: '', triggerPrompt: 'build something real', tags,
  assertions: [{ type: 'llm_judge', prompt: 'good?', minScore: 7 }],
});

const pathOf = (name: string) => `yaml/wix-app-evals/${name}.yml`;

function loadedMap(...entries: Array<[string, string[]]>) {
  return new Map(entries.map(([name, tags]) => [name, { path: pathOf(name), scenario: scenario(name, tags) }]));
}

const idsFor = (...names: string[]) => new Map(names.map(name => [name, `id-${name}`]));

describe('selectScenarios', () => {
  it('selects scenarios carrying any derived tag', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page'],
      localScenarios: loadedMap(['covers', ['dashboard-page']], ['other', ['backend-api']]),
      nameToId: idsFor('covers', 'other'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['covers']);
    expect(selection.ids).toEqual(['id-covers']);
    expect(selection.dropped).toEqual([]);
    expect(selection.missingIds).toEqual([]);
  });

  it('selects every scenario on broad impact, ignoring the tag list', () => {
    const selection = selectScenarios({
      broadImpact: true,
      tags: [],
      localScenarios: loadedMap(['a', ['dashboard-page']], ['b', ['backend-api']]),
      nameToId: idsFor('a', 'b'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['a', 'b']);
  });

  it('includes a touched scenario even when it carries no derived tag', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page'],
      localScenarios: loadedMap(['tagged', ['dashboard-page']], ['edited', ['backend-api']]),
      nameToId: idsFor('tagged', 'edited'),
      touchedScenarioPaths: new Set([pathOf('edited')]),
      maxScenarios: 25,
    });
    expect([...selection.selected].sort()).toEqual(['edited', 'tagged']);
  });

  it('dedupes a scenario matching several derived tags', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page', 'data-collection'],
      localScenarios: loadedMap(['both', ['dashboard-page', 'data-collection']]),
      nameToId: idsFor('both'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.ids).toEqual(['id-both']);
  });

  it('caps at maxScenarios and reports what was dropped', () => {
    const selection = selectScenarios({
      broadImpact: true,
      tags: [],
      localScenarios: loadedMap(['a', ['t']], ['b', ['t']], ['c', ['t']]),
      nameToId: idsFor('a', 'b', 'c'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 2,
    });
    expect(selection.selected).toEqual(['a', 'b']);
    expect(selection.dropped).toEqual(['c']);
  });

  it('keeps the PR own touched scenarios when the cap bites', () => {
    const selection = selectScenarios({
      broadImpact: true,
      tags: [],
      localScenarios: loadedMap(['aaa', ['t']], ['bbb', ['t']], ['zzz', ['t']]),
      nameToId: idsFor('aaa', 'bbb', 'zzz'),
      touchedScenarioPaths: new Set([pathOf('zzz')]),
      maxScenarios: 1,
    });
    expect(selection.selected).toEqual(['zzz']);
    expect(selection.dropped).toEqual(['aaa', 'bbb']);
  });

  it('reports a selected scenario with no known EvalForge id instead of silently skipping it', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page'],
      localScenarios: loadedMap(['known', ['dashboard-page']], ['unsynced', ['dashboard-page']]),
      nameToId: idsFor('known'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.ids).toEqual(['id-known']);
    expect(selection.missingIds).toEqual(['unsynced']);
    expect(selection.selected).toEqual(['known']);
  });

  it('does not run a scenario the PR deleted, though EvalForge still holds it', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page'],
      localScenarios: loadedMap(['kept', ['dashboard-page']]),
      nameToId: idsFor('kept', 'deleted-in-pr'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['kept']);
    expect(selection.ids).toEqual(['id-kept']);
    expect(selection.missingIds).toEqual([]);
  });

  it('keeps a deleted scenario out of a broad-impact run too', () => {
    const selection = selectScenarios({
      broadImpact: true,
      tags: [],
      localScenarios: loadedMap(['kept', ['dashboard-page']]),
      nameToId: idsFor('kept', 'deleted-in-pr'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['kept']);
  });

  it('runs the PR version of a renamed scenario, not the old name', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['dashboard-page'],
      localScenarios: loadedMap(['new-name', ['dashboard-page']]),
      nameToId: idsFor('old-name', 'new-name'),
      touchedScenarioPaths: new Set([pathOf('new-name')]),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['new-name']);
  });

  it('returns an empty selection when nothing matches', () => {
    const selection = selectScenarios({
      broadImpact: false,
      tags: ['backend-api'],
      localScenarios: loadedMap(['other', ['dashboard-page']]),
      nameToId: idsFor('other'),
      touchedScenarioPaths: new Set(),
      maxScenarios: 25,
    });
    expect(selection).toEqual({ ids: [], selected: [], dropped: [], missingIds: [] });
  });

  it('orders selection deterministically — touched first, then alphabetical', () => {
    const selection = selectScenarios({
      broadImpact: true,
      tags: [],
      localScenarios: loadedMap(['c', ['t']], ['a', ['t']], ['b', ['t']]),
      nameToId: idsFor('a', 'b', 'c'),
      touchedScenarioPaths: new Set([pathOf('c')]),
      maxScenarios: 25,
    });
    expect(selection.selected).toEqual(['c', 'a', 'b']);
  });
});
