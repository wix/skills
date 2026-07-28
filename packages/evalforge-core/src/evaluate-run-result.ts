import type { EvalRunStatus } from './evalforge';

export type RunVerdict = {
  passed: boolean;
  /** Comment-ready wording. Empty when it passed. */
  reasons: string[];
};

/**
 * Zero assertions fails: such a run has no failures either, so `failed + errors === 0` alone
 * would report green having verified nothing.
 */
export function evaluateRunResult(status: EvalRunStatus): RunVerdict {
  const reasons: string[] = [];
  const metrics = status.aggregateMetrics;

  if (status.status !== 'completed') {
    reasons.push(
      `the eval run ${status.status === 'cancelled' ? 'was cancelled' : `ended as "${status.status}"`}`,
    );
  }

  if (metrics.failed > 0) {
    reasons.push(`${metrics.failed} assertion${metrics.failed === 1 ? '' : 's'} failed`);
  }

  if (metrics.errors > 0) {
    reasons.push(`${metrics.errors} assertion${metrics.errors === 1 ? '' : 's'} errored`);
  }

  if (metrics.totalAssertions === 0) {
    reasons.push('the run produced no assertions, so nothing was verified');
  }

  return { passed: reasons.length === 0, reasons };
}
