import { describe, it, expect } from 'vitest';
import { foldScenarioIterations } from '../src/fold-scenario-iterations';
import type { EvalRunResultRow } from '../src/evalforge';

const row = (overrides: Partial<EvalRunResultRow> = {}): EvalRunResultRow => ({
  scenarioId: 'sc-1', scenarioName: 'creates a page',
  passed: 2, failed: 0, partial: false, iterationIndex: 0, assertions: [],
  ...overrides,
});

describe('foldScenarioIterations', () => {
  it('folds one iteration into one outcome', () => {
    const [outcome] = foldScenarioIterations([row()]);
    expect(outcome).toMatchObject({ scenarioId: 'sc-1', scenarioName: 'creates a page', failed: 0 });
  });

  it('passes only when every scored iteration passed', () => {
    const outcomes = foldScenarioIterations([
      row({ iterationIndex: 0 }),
      row({ iterationIndex: 1 }),
    ]);
    expect(outcomes[0].failed).toBe(0);
  });

  it('treats an intermittent failure as a failure, summing failed across iterations', () => {
    const outcomes = foldScenarioIterations([
      row({ iterationIndex: 0 }),
      row({ iterationIndex: 1, passed: 1, failed: 1 }),
    ]);
    expect(outcomes[0].failed).toBe(1);
  });

  it('excludes partial iterations from scoring', () => {
    const outcomes = foldScenarioIterations([
      row({ iterationIndex: 0 }),
      row({ iterationIndex: 1, passed: 0, failed: 0, partial: true }),
    ]);
    expect(outcomes[0].totalAssertions).toBe(2);
    expect(outcomes[0].failed).toBe(0);
  });

  it('omits a scenario whose every iteration is partial — unmeasured, not failed', () => {
    expect(foldScenarioIterations([row({ partial: true })])).toEqual([]);
  });

  it('keeps scenarios separate', () => {
    const outcomes = foldScenarioIterations([
      row({ scenarioId: 'sc-1' }),
      row({ scenarioId: 'sc-2', scenarioName: 'other', passed: 1, failed: 1 }),
    ]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.find(outcome => outcome.scenarioId === 'sc-2')!.failed).toBe(1);
  });

  it('collects the names of assertions that did not pass, across iterations, deduped', () => {
    const outcomes = foldScenarioIterations([
      row({ iterationIndex: 0, failed: 1, assertions: [
        { assertionName: 'build', assertionType: 'build_passed', status: 'FAILED' },
      ] }),
      row({ iterationIndex: 1, failed: 1, assertions: [
        { assertionName: 'build', assertionType: 'build_passed', status: 'FAILED' },
        { assertionName: 'judge', assertionType: 'llm_judge', status: 'ERROR' },
      ] }),
    ]);
    expect(outcomes[0].failingAssertionNames).toEqual(['build', 'judge']);
  });

  it('omits failingAssertionNames when nothing failed', () => {
    expect(foldScenarioIterations([row()])[0].failingAssertionNames).toBeUndefined();
  });

  it('counts an errored assertion toward errors, not just failed', () => {
    const outcomes = foldScenarioIterations([
      row({ assertions: [{ assertionName: 'judge', assertionType: 'llm_judge', status: 'ERROR' }] }),
    ]);
    expect(outcomes[0].errors).toBe(1);
  });
});
