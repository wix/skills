import { describe, it, expect } from 'vitest';
import { evaluateRunResult } from '../src/evaluate-run-result';
import type { EvalRunStatus } from '../src/evalforge';

const runStatus = (
  overrides: Partial<EvalRunStatus['aggregateMetrics']> & { status?: EvalRunStatus['status'] } = {},
): EvalRunStatus => {
  const { status, ...metrics } = overrides;
  return {
    status: status ?? 'completed',
    progress: 100,
    aggregateMetrics: {
      totalAssertions: 5, passed: 5, failed: 0, skipped: 0,
      errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0,
      ...metrics,
    },
    results: [],
  };
};

describe('evaluateRunResult', () => {
  it('passes a completed run with no failures and no errors', () => {
    expect(evaluateRunResult(runStatus())).toEqual({ passed: true, reasons: [] });
  });

  it('fails on failed assertions, naming the count', () => {
    const verdict = evaluateRunResult(runStatus({ failed: 2, passed: 3, passRate: 60 }));
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining('2 assertion')]);
  });

  it('fails on errored assertions', () => {
    const verdict = evaluateRunResult(runStatus({ errors: 1, passed: 4 }));
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining('error')]);
  });

  it('reports both failures and errors', () => {
    const verdict = evaluateRunResult(runStatus({ failed: 1, errors: 1, passed: 3 }));
    expect(verdict.reasons).toHaveLength(2);
  });

  it('fails a run whose own status is failed even with clean metrics', () => {
    const verdict = evaluateRunResult(runStatus({ status: 'failed' }));
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining('failed')]);
  });

  it('fails a cancelled run', () => {
    const verdict = evaluateRunResult(runStatus({ status: 'cancelled' }));
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining('cancelled')]);
  });

  it('fails a run that is still running — a non-terminal status is not a pass', () => {
    const verdict = evaluateRunResult(runStatus({ status: 'running' }));
    expect(verdict.passed).toBe(false);
  });

  it('fails a run that produced no assertions at all', () => {
    const verdict = evaluateRunResult(runStatus({ totalAssertions: 0, passed: 0, passRate: 0 }));
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining('no assertions')]);
  });

  it('uses singular wording for a single failure', () => {
    const verdict = evaluateRunResult(runStatus({ failed: 1, passed: 4 }));
    expect(verdict.reasons[0]).toContain('1 assertion failed');
  });
});
