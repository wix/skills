import type { EvalRunStatus } from './evalforge';

export type RunVerdict = {
  passed: boolean;
  /** Why it failed, in comment-ready wording. Empty when it passed. */
  reasons: string[];
};

/**
 * Decides whether a finished run counts as a pass.
 *
 * Note the zero-assertion rule: a run that evaluated nothing has no failures, so a naive
 * `failed + errors === 0` check would report green having verified nothing. That is exactly
 * the false pass the gate exists to prevent, so it is an explicit failure.
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
