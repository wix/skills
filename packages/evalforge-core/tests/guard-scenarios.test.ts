import { describe, it, expect } from 'vitest';
import { guardScenarios, meetsQualityBar, DEFAULT_QUALITY_BAR } from '../src/guard-scenarios';
import type { Assertion, Scenario } from '../src/schema';

const judge: Assertion = { type: 'llm_judge', prompt: 'is it good', minScore: 7 };
const build: Assertion = { type: 'build_passed', command: 'npm run build' };
const called: Assertion = { type: 'skill_was_called', skillNames: ['wix-app'] };
const cost: Assertion = { type: 'cost', maxCostUsd: 1 };

const scenario = (name: string, tags: string[], assertions: Assertion[]): Scenario => ({
  name, description: '', triggerPrompt: 'build me a dashboard page', tags, assertions,
});

const strong = (name: string, tags: string[]) => scenario(name, tags, [called, build, judge]);
const weak = (name: string, tags: string[]) => scenario(name, tags, [called]);

const pathOf = (name: string) => `yaml/wix-app-evals/${name}.yml`;

function loadedMap(...scenarios: Scenario[]): Map<string, { path: string; scenario: Scenario }> {
  return new Map(scenarios.map(entry => [entry.name, { path: pathOf(entry.name), scenario: entry }]));
}

describe('meetsQualityBar', () => {
  it('accepts three assertions including an llm_judge', () => {
    expect(meetsQualityBar(strong('a', ['t']), DEFAULT_QUALITY_BAR)).toEqual({ ok: true, reasons: [] });
  });

  it('rejects too few assertions, naming the count', () => {
    const check = meetsQualityBar(scenario('a', ['t'], [called, judge]), DEFAULT_QUALITY_BAR);
    expect(check.ok).toBe(false);
    expect(check.reasons).toEqual([expect.stringContaining('2 assertion')]);
  });

  it('rejects a scenario with enough assertions but no llm_judge', () => {
    const check = meetsQualityBar(scenario('a', ['t'], [called, build, cost]), DEFAULT_QUALITY_BAR);
    expect(check.ok).toBe(false);
    expect(check.reasons).toEqual([expect.stringContaining('llm_judge')]);
  });

  it('reports both shortfalls at once', () => {
    const check = meetsQualityBar(scenario('a', ['t'], [called]), DEFAULT_QUALITY_BAR);
    expect(check.reasons).toHaveLength(2);
  });

  it('defaults to the standard bar when none is passed', () => {
    expect(meetsQualityBar(strong('a', ['t'])).ok).toBe(true);
    expect(meetsQualityBar(weak('b', ['t'])).ok).toBe(false);
  });
});

describe('guardScenarios — the outcome table', () => {
  it('row 1: blocks when a derived tag has no scenario at all', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['backend-api'],
      scenarios: loadedMap(strong('other', ['dashboard-page'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }]);
    expect(warnings).toEqual([]);
  });

  it('row 2: blocks when the tag only scenario is below the bar and untouched', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(weak('thin', ['dashboard-page'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([
      { kind: 'WEAK_TAG', tag: 'dashboard-page', scenarios: ['thin'] },
    ]);
    expect(warnings).toEqual([]);
  });

  it('row 3: passes with a warning when a good and a weak scenario share the tag', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(strong('good', ['dashboard-page']), weak('thin', ['dashboard-page'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'WEAK_UNTOUCHED_SCENARIO', name: 'thin', path: pathOf('thin'), tags: ['dashboard-page'],
    });
  });

  it('row 4: blocks a touched below-bar scenario even when a strong sibling covers the tag', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(strong('good', ['dashboard-page']), weak('thin', ['dashboard-page'])),
      touchedScenarioPaths: new Set([pathOf('thin')]),
    });
    expect(violations).toEqual([
      { kind: 'WEAK_TOUCHED_SCENARIO', name: 'thin', path: pathOf('thin'), reasons: expect.any(Array) },
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('guardScenarios — further cases', () => {
  it('passes cleanly when every derived tag has a scenario meeting the bar', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['dashboard-page', 'data-collection'],
      scenarios: loadedMap(strong('both', ['dashboard-page', 'data-collection'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('checks a touched scenario even when the PR derived no tags at all', () => {
    const { violations } = guardScenarios({
      tags: [],
      scenarios: loadedMap(weak('thin', ['dashboard-page'])),
      touchedScenarioPaths: new Set([pathOf('thin')]),
    });
    expect(violations).toEqual([
      { kind: 'WEAK_TOUCHED_SCENARIO', name: 'thin', path: pathOf('thin'), reasons: expect.any(Array) },
    ]);
  });

  it('reports one warning per weak scenario, listing every derived tag it carries', () => {
    const { warnings } = guardScenarios({
      tags: ['dashboard-page', 'data-collection'],
      scenarios: loadedMap(
        strong('good', ['dashboard-page', 'data-collection']),
        weak('thin', ['dashboard-page', 'data-collection']),
      ),
      touchedScenarioPaths: new Set(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tags).toEqual(['dashboard-page', 'data-collection']);
  });

  it('does not warn about a weak scenario whose tags the PR did not touch', () => {
    const { violations, warnings } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(strong('good', ['dashboard-page']), weak('elsewhere', ['backend-api'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports every uncovered tag rather than stopping at the first', () => {
    const { violations } = guardScenarios({
      tags: ['backend-api', 'site-plugin'],
      scenarios: loadedMap(),
      touchedScenarioPaths: new Set(),
    });
    expect(violations.map(violation => violation.kind)).toEqual(['UNCOVERED_TAG', 'UNCOVERED_TAG']);
  });

  it('honours a custom bar', () => {
    const { violations } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(scenario('two', ['dashboard-page'], [called, judge])),
      touchedScenarioPaths: new Set(),
      bar: { minAssertions: 2, requireLlmJudge: true },
    });
    expect(violations).toEqual([]);
  });

  it('passes with no tags and nothing touched — nothing to check', () => {
    const { violations, warnings } = guardScenarios({
      tags: [],
      scenarios: loadedMap(weak('thin', ['dashboard-page'])),
      touchedScenarioPaths: new Set(),
    });
    expect(violations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('sorts warnings by scenario name for a stable comment', () => {
    const { warnings } = guardScenarios({
      tags: ['dashboard-page'],
      scenarios: loadedMap(
        strong('good', ['dashboard-page']),
        weak('zebra', ['dashboard-page']),
        weak('alpha', ['dashboard-page']),
      ),
      touchedScenarioPaths: new Set(),
    });
    expect(warnings.map(warning => warning.name)).toEqual(['alpha', 'zebra']);
  });
});
