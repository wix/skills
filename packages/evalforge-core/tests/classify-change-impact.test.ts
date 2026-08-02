import { describe, it, expect } from 'vitest';
import { classifyChangeImpact, type ScenarioOutcome } from '../src/classify-change-impact';

const outcome = (
  scenarioId: string,
  passed: boolean,
  overrides: Partial<ScenarioOutcome> = {},
): ScenarioOutcome => ({
  scenarioId,
  scenarioName: `scenario ${scenarioId}`,
  totalAssertions: 3,
  failed: passed ? 0 : 1,
  errors: 0,
  failingAssertionNames: passed ? [] : ['judge'],
  ...overrides,
});

describe('classifyChangeImpact', () => {
  it('classifies green-on-both as still-passing', () => {
    const impact = classifyChangeImpact([outcome('a', true)], [outcome('a', true)]);
    expect(impact.scenarios[0].impact).toBe('still-passing');
    expect(impact.stillPassing).toBe(1);
  });

  it('classifies base-red PR-green as fixed', () => {
    const impact = classifyChangeImpact([outcome('a', true)], [outcome('a', false)]);
    expect(impact.scenarios[0].impact).toBe('fixed');
    expect(impact.fixed).toBe(1);
  });

  it('classifies base-green PR-red as newly-broken', () => {
    const impact = classifyChangeImpact([outcome('a', false)], [outcome('a', true)]);
    expect(impact.scenarios[0].impact).toBe('newly-broken');
    expect(impact.newlyBroken).toBe(1);
  });

  it('classifies red-on-both as still-failing', () => {
    const impact = classifyChangeImpact([outcome('a', false)], [outcome('a', false)]);
    expect(impact.scenarios[0].impact).toBe('still-failing');
    expect(impact.stillFailing).toBe(1);
  });

  it('treats an absent base arm as wholly unattributed', () => {
    const impact = classifyChangeImpact([outcome('a', true), outcome('b', false)], undefined);
    expect(impact.scenarios.map(scenario => scenario.impact))
      .toEqual(['unattributed', 'unattributed']);
    expect(impact.attributionAvailable).toBe(false);
  });

  it('degrades per scenario when the base arm is missing just one', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true), outcome('b', true)],
      [outcome('a', true)],
    );
    expect(impact.scenarios[0].impact).toBe('still-passing');
    expect(impact.scenarios[1].impact).toBe('unattributed');
    expect(impact.attributionAvailable).toBe(true);
    expect(impact.unattributed).toBe(1);
  });

  it('counts an errored assertion as a failure, not a pass', () => {
    const prOutcome = outcome('a', true, { errors: 1, failingAssertionNames: ['build'] });
    const impact = classifyChangeImpact([prOutcome], [outcome('a', true)]);
    expect(impact.scenarios[0].impact).toBe('newly-broken');
  });

  it('does not count a zero-assertion scenario as passing', () => {
    const empty = outcome('a', true, { totalAssertions: 0 });
    const impact = classifyChangeImpact([empty], [outcome('a', true)]);
    expect(impact.scenarios[0].impact).toBe('newly-broken');
  });

  it('ignores base scenarios that the PR arm did not run', () => {
    const impact = classifyChangeImpact([outcome('a', true)], [outcome('a', true), outcome('z', false)]);
    expect(impact.scenarios).toHaveLength(1);
  });

  it('reports a net effect of fixed minus newly-broken', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true), outcome('b', false)],
      [outcome('a', false), outcome('b', true)],
    );
    expect(impact.netEffect).toBe(0);
  });

  it('treats a zero-assertion base scenario as unattributed, not fixed', () => {
    const unmeasuredBase = outcome('a', false, { totalAssertions: 0 });
    const impact = classifyChangeImpact([outcome('a', true)], [unmeasuredBase]);
    expect(impact.scenarios[0].impact).toBe('unattributed');
    expect(impact.fixed).toBe(0);
    expect(impact.netEffect).toBe(0);
  });

  it('reports attributionAvailable false when base ids are disjoint from PR ids', () => {
    const impact = classifyChangeImpact([outcome('a', true)], [outcome('z', false)]);
    expect(impact.scenarios[0].impact).toBe('unattributed');
    expect(impact.attributionAvailable).toBe(false);
  });

  it('treats an empty base arm the same as an unmeasured one', () => {
    const impact = classifyChangeImpact([outcome('a', true), outcome('b', false)], []);
    expect(impact.scenarios.map(scenario => scenario.impact))
      .toEqual(['unattributed', 'unattributed']);
    expect(impact.attributionAvailable).toBe(false);
  });
});
