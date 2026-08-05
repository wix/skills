import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldScenarioIterations } from '../src/fold-scenario-iterations';
import { scenarioPassed } from '../src/classify-change-impact';
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

  it('omits a row with an empty scenarioId rather than folding it into a synthetic outcome', () => {
    expect(foldScenarioIterations([row({ scenarioId: '' })])).toEqual([]);
  });

  it('keeps a valid row when an empty-id row is mixed in, yielding exactly one outcome', () => {
    const outcomes = foldScenarioIterations([
      row({ scenarioId: 'sc-1' }),
      row({ scenarioId: '' }),
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].scenarioId).toBe('sc-1');
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

  it('composes with scenarioPassed: an intermittent failure fails the folded scenario', () => {
    const [outcome] = foldScenarioIterations([
      row({ iterationIndex: 0 }),
      row({ iterationIndex: 1, passed: 1, failed: 1 }),
    ]);
    expect(scenarioPassed(outcome)).toBe(false);
  });

  it('composes with scenarioPassed: all-green iterations pass the folded scenario', () => {
    const [outcome] = foldScenarioIterations([
      row({ iterationIndex: 0 }),
      row({ iterationIndex: 1 }),
    ]);
    expect(scenarioPassed(outcome)).toBe(true);
  });
});

// Finding 5: `tests/fixtures/live-eval-run-pr-arm.json` (captured from a real run) carries two
// distinct assertions both named exactly "Skill was called" — different reference files,
// distinguished only by `assertionId`. Deduping on `assertionName` (a `Set<string>`) would
// collapse two genuinely distinct failures into one, silently dropping information rather than
// merely rendering an ambiguous label.
describe('foldScenarioIterations — assertions that share a name (Finding 5)', () => {
  const LIVE_PR_ARM_ASSERTIONS = (JSON.parse(
    readFileSync(join(__dirname, 'fixtures/live-eval-run-pr-arm.json'), 'utf8'),
  ).evalRun.results[0].assertionResults as Array<Record<string, string>>).map(raw => ({
    assertionName: raw.assertionName,
    assertionType: raw.assertionType,
    assertionId: raw.assertionId,
    status: raw.status.replace('ASSERTION_RESULT_STATUS_', ''),
  })) as EvalRunResultRow['assertions'];

  const skillWasCalled = (): EvalRunResultRow['assertions'] =>
    LIVE_PR_ARM_ASSERTIONS.filter(assertion => assertion.assertionName === 'Skill was called');

  it('the fixture really does carry two distinct "Skill was called" assertions', () => {
    const pair = skillWasCalled();
    expect(pair).toHaveLength(2);
    expect(pair[0].assertionId).not.toBe(pair[1].assertionId);
  });

  it('keeps both as distinct failing entries when both fail, disambiguated by assertionId', () => {
    const [first, second] = skillWasCalled();
    const bothFailing = [first, second].map(assertion => ({ ...assertion, status: 'FAILED' }));
    const [outcome] = foldScenarioIterations([row({ assertions: bothFailing, failed: 2 })]);
    expect(outcome.failingAssertionNames).toEqual([
      `Skill was called [${first.assertionId}]`,
      `Skill was called [${second.assertionId}]`,
    ]);
  });

  it('still disambiguates the failing one by assertionId when its same-named sibling passed', () => {
    const [failingAssertion, passingAssertion] = skillWasCalled();
    const mixed = [{ ...failingAssertion, status: 'FAILED' }, passingAssertion];
    const [outcome] = foldScenarioIterations([row({ assertions: mixed, failed: 1 })]);
    // Exactly one failing entry — the passing sibling is correctly excluded from the failing
    // list — but the name alone is ambiguous against that same-named passing sibling, so the
    // reported entry still carries the assertionId that lets the reader tell which one this is.
    expect(outcome.failingAssertionNames).toEqual([`Skill was called [${failingAssertion.assertionId}]`]);
  });

  it('renders a genuinely unique name without a suffix, unaffected by an unrelated collision elsewhere', () => {
    const [outcome] = foldScenarioIterations([
      row({ assertions: [{ assertionName: 'Build passed', assertionType: 'build_passed', status: 'FAILED' }], failed: 1 }),
    ]);
    expect(outcome.failingAssertionNames).toEqual(['Build passed']);
  });
});
