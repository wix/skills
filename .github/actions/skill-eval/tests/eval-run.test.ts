import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollUntilDone } from '../src/utils/eval-run';
import type { EvalForgeClient, EvalRunStatus } from '../src/utils/evalforge';

vi.mock('@actions/core', () => ({ info: vi.fn(), error: vi.fn() }));

function makeClient(): EvalForgeClient {
  return {
    getEvalRun: vi.fn(),
  } as unknown as EvalForgeClient;
}

describe('pollUntilDone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns status when completed immediately', async () => {
    const client = makeClient();
    const completedStatus: EvalRunStatus = {
      status: 'completed',
      progress: 100,
      aggregateMetrics: { totalAssertions: 5, passed: 5, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 100, totalDuration: 500 },
    };
    vi.mocked(client.getEvalRun).mockResolvedValue(completedStatus);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('completed');
  });

  it('polls multiple times before completing', async () => {
    const client = makeClient();
    const running: EvalRunStatus = {
      status: 'running', progress: 50,
      aggregateMetrics: { totalAssertions: 5, passed: 2, failed: 0, skipped: 0, errors: 0, passRate: 40, avgDuration: 100, totalDuration: 200 },
    };
    const done: EvalRunStatus = {
      status: 'completed', progress: 100,
      aggregateMetrics: { totalAssertions: 5, passed: 5, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 100, totalDuration: 500 },
    };
    vi.mocked(client.getEvalRun)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(done);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(client.getEvalRun).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('completed');
  });

  it('throws timeout error after 30 minutes', async () => {
    const client = makeClient();
    const running: EvalRunStatus = {
      status: 'running', progress: 10,
      aggregateMetrics: { totalAssertions: 5, passed: 1, failed: 0, skipped: 0, errors: 0, passRate: 20, avgDuration: 100, totalDuration: 100 },
    };
    vi.mocked(client.getEvalRun).mockResolvedValue(running);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await Promise.all([
      expect(promise).rejects.toMatchObject({ timeout: true }),
      vi.runAllTimersAsync(),
    ]);
  });

  it('retries on 5xx and eventually succeeds', async () => {
    const client = makeClient();
    const done: EvalRunStatus = {
      status: 'completed', progress: 100,
      aggregateMetrics: { totalAssertions: 5, passed: 5, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 100, totalDuration: 500 },
    };
    vi.mocked(client.getEvalRun)
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockResolvedValueOnce(done);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('completed');
  });
});
