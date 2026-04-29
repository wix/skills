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

  it('throws after exhausting all 5xx retries', async () => {
    const client = makeClient();
    const serverError = Object.assign(new Error('server error'), { status: 500 });
    vi.mocked(client.getEvalRun).mockRejectedValue(serverError);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await Promise.all([
      expect(promise).rejects.toMatchObject({ status: 500 }),
      vi.runAllTimersAsync(),
    ]);
  });

  it('throws immediately on non-retriable 4xx without retrying', async () => {
    const client = makeClient();
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    vi.mocked(client.getEvalRun).mockRejectedValueOnce(notFound);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await Promise.all([
      expect(promise).rejects.toMatchObject({ status: 404 }),
      vi.runAllTimersAsync(),
    ]);
    expect(client.getEvalRun).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'cancelled'] as const)('returns immediately on terminal status "%s"', async (terminalStatus) => {
    const client = makeClient();
    const terminal: EvalRunStatus = {
      status: terminalStatus, progress: 0,
      aggregateMetrics: { totalAssertions: 0, passed: 0, failed: 0, skipped: 0, errors: 0, passRate: 0, avgDuration: 0, totalDuration: 0 },
    };
    vi.mocked(client.getEvalRun).mockResolvedValue(terminal);
    const promise = pollUntilDone(client, 'proj-1', 'run-1');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe(terminalStatus);
  });
});
