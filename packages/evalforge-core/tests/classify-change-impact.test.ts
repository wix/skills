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

  // Finding 1: a zero-assertion PR outcome (e.g. every assertion SKIPPED) is a scenario the PR
  // arm never actually scored — the same reasoning already applied to a zero-assertion base
  // outcome below. Scoring it as a PR failure would manufacture a false `newly-broken` for a run
  // whose own metrics render "Passed" / "Pass rate: 100%".
  it('treats a zero-assertion PR outcome as unattributed, never newly-broken, against a green base', () => {
    const empty = outcome('a', true, { totalAssertions: 0 });
    const impact = classifyChangeImpact([empty], [outcome('a', true)]);
    expect(impact.scenarios[0].impact).toBe('unattributed');
    expect(impact.newlyBroken).toBe(0);
    expect(impact.scenarios[0].prPassed).toBeUndefined();
  });

  it('treats a zero-assertion PR outcome as unattributed against a failing base too', () => {
    const empty = outcome('a', true, { totalAssertions: 0 });
    const impact = classifyChangeImpact([empty], [outcome('a', false)]);
    expect(impact.scenarios[0].impact).toBe('unattributed');
    expect(impact.fixed).toBe(0);
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

  it('classifies correctly when failingAssertionNames is absent', () => {
    const outcomeWithoutNames = outcome('a', true);
    delete outcomeWithoutNames.failingAssertionNames;
    const impact = classifyChangeImpact([outcomeWithoutNames], [outcome('a', false)]);
    expect(impact.scenarios[0].impact).toBe('fixed');
    expect('failingAssertionNames' in impact.scenarios[0]).toBe(false);
  });

  it('treats an empty base arm the same as an unmeasured one', () => {
    const impact = classifyChangeImpact([outcome('a', true), outcome('b', false)], []);
    expect(impact.scenarios.map(scenario => scenario.impact))
      .toEqual(['unattributed', 'unattributed']);
    expect(impact.attributionAvailable).toBe(false);
  });
});

describe('classifyChangeImpact — expectedScenarios (a requested scenario that measured nothing)', () => {
  it('leaves output unchanged when expectedScenarios is omitted', () => {
    const withThirdArg = classifyChangeImpact([outcome('a', true)], [outcome('a', false)], undefined);
    const withoutThirdArg = classifyChangeImpact([outcome('a', true)], [outcome('a', false)]);
    expect(withThirdArg).toEqual(withoutThirdArg);
  });

  it('appends a missing scenario as unattributed rather than omitting it', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true)],
      [outcome('a', false)],
      [{ id: 'a', name: 'scenario a' }, { id: 'b', name: 'scenario b' }],
    );
    expect(impact.scenarios).toHaveLength(2);
    expect(impact.scenarios[1]).toEqual({
      scenarioId: 'b',
      scenarioName: 'scenario b',
      impact: 'unattributed',
    });
  });

  // `prPassed: false` on a scenario that produced no data would read as "the PR failed this" to
  // any consumer of the field — the very claim the third parameter exists to prevent.
  it('states no prPassed for a scenario the PR arm never measured', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true)],
      [outcome('a', false)],
      [{ id: 'a', name: 'scenario a' }, { id: 'b', name: 'scenario b' }],
    );
    expect(impact.scenarios[1].prPassed).toBeUndefined();
    expect(impact.scenarios[1]).not.toHaveProperty('prPassed');
    expect(impact.scenarios[0].prPassed).toBe(true);
  });

  it('appends a duplicated requested id only once', () => {
    const impact = classifyChangeImpact(
      [],
      [outcome('a', true)],
      [{ id: 'b', name: 'scenario b' }, { id: 'b', name: 'scenario b' }],
    );
    expect(impact.scenarios).toHaveLength(1);
    expect(impact.unattributed).toBe(1);
  });

  it('counts the appended scenario in unattributed and leaves other counts alone', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true)],
      [outcome('a', false)],
      [{ id: 'a', name: 'scenario a' }, { id: 'b', name: 'scenario b' }],
    );
    expect(impact.fixed).toBe(1);
    expect(impact.unattributed).toBe(1);
  });

  it('does not duplicate a scenario that was actually measured', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true)],
      [outcome('a', false)],
      [{ id: 'a', name: 'scenario a' }],
    );
    expect(impact.scenarios).toHaveLength(1);
    expect(impact.scenarios[0].impact).toBe('fixed');
  });

  it('never classifies a missing scenario as newly-broken, even against a passing base', () => {
    const impact = classifyChangeImpact(
      [],
      [outcome('a', true)],
      [{ id: 'a', name: 'scenario a' }],
    );
    expect(impact.scenarios).toHaveLength(1);
    expect(impact.scenarios[0].impact).toBe('unattributed');
  });

  // Finding 6: `toResultRow` defaults a wire row's `scenarioName` to `''` when the API omits it.
  // A *measured* scenario still has an authoritative name available — the same `expectedScenarios`
  // list already used to name the unmeasured ones — so it must not fall through to the id (or an
  // empty string) when that name is on hand.
  it('prefers the repo-YAML name over an empty wire scenarioName for a measured scenario', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true, { scenarioName: '' })],
      [outcome('a', false)],
      [{ id: 'a', name: 'scenario a' }],
    );
    expect(impact.scenarios[0].scenarioName).toBe('scenario a');
  });

  it('falls back to the wire scenarioName when no expectedScenarios entry names this id', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true, { scenarioName: 'wire name' })],
      [outcome('a', false)],
    );
    expect(impact.scenarios[0].scenarioName).toBe('wire name');
  });

  it('falls back to the scenarioId when both the expected name and the wire name are empty', () => {
    const impact = classifyChangeImpact(
      [outcome('a', true, { scenarioName: '' })],
      [outcome('a', false)],
    );
    expect(impact.scenarios[0].scenarioName).toBe('a');
  });
});
