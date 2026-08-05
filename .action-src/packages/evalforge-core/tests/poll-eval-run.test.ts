import { describe, it, expect, vi } from 'vitest';
import { pollUntilDone, EvalRunTimeoutError } from '../src/poll-eval-run';
import type { EvalRunStatus } from '../src/evalforge';

const status = (state: string): EvalRunStatus => ({
  status: state as EvalRunStatus['status'],
  progress: 0,
  aggregateMetrics: {
    totalAssertions: 1, passed: 1, failed: 0, skipped: 0,
    errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0,
  },
});

const noSleep = () => Promise.resolve();

describe('pollUntilDone', () => {
  it('returns as soon as the run reaches a terminal status', async () => {
    const getEvalRun = vi.fn().mockResolvedValue(status('completed'));
    const result = await pollUntilDone({ getEvalRun }, 'P', 'run-1', { sleep: noSleep });
    expect(result.status).toBe('completed');
    expect(getEvalRun).toHaveBeenCalledTimes(1);
  });

  it('keeps polling through non-terminal statuses and logs progress', async () => {
    const getEvalRun = vi.fn()
      .mockResolvedValueOnce(status('pending'))
      .mockResolvedValueOnce(status('running'))
      .mockResolvedValueOnce(status('failed'));
    const logged: string[] = [];
    const result = await pollUntilDone({ getEvalRun }, 'P', 'run-1', {
      sleep: noSleep,
      log: message => logged.push(message),
    });
    expect(result.status).toBe('failed');
    expect(getEvalRun).toHaveBeenCalledTimes(3);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain('pending');
  });

  it('retries a 5xx and warns, then succeeds', async () => {
    const serverError = Object.assign(new Error('boom'), { status: 503 });
    const getEvalRun = vi.fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(status('completed'));
    const warnings: string[] = [];
    const result = await pollUntilDone({ getEvalRun }, 'P', 'run-1', {
      sleep: noSleep,
      warn: message => warnings.push(message),
    });
    expect(result.status).toBe('completed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('retry 1/5');
  });

  it('rethrows a non-retriable error without retrying', async () => {
    const clientError = Object.assign(new Error('nope'), { status: 404 });
    const getEvalRun = vi.fn().mockRejectedValue(clientError);
    await expect(
      pollUntilDone({ getEvalRun }, 'P', 'run-1', { sleep: noSleep }),
    ).rejects.toThrow('nope');
    expect(getEvalRun).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry limit on repeated 5xx', async () => {
    const serverError = Object.assign(new Error('boom'), { status: 500 });
    const getEvalRun = vi.fn().mockRejectedValue(serverError);
    await expect(
      pollUntilDone({ getEvalRun }, 'P', 'run-1', { sleep: noSleep }),
    ).rejects.toThrow('boom');
    expect(getEvalRun).toHaveBeenCalledTimes(6);
  });

  it('throws EvalRunTimeoutError once the deadline passes', async () => {
    const getEvalRun = vi.fn().mockResolvedValue(status('running'));
    await expect(
      pollUntilDone({ getEvalRun }, 'P', 'run-1', { sleep: noSleep, timeoutMs: 0 }),
    ).rejects.toThrow(EvalRunTimeoutError);
  });

  it('treats an AbortError as retriable', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const getEvalRun = vi.fn()
      .mockRejectedValueOnce(aborted)
      .mockResolvedValueOnce(status('completed'));
    const result = await pollUntilDone({ getEvalRun }, 'P', 'run-1', { sleep: noSleep });
    expect(result.status).toBe('completed');
  });
});
