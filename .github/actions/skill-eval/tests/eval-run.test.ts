import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureMcpVersion, pollUntilDone } from '../src/utils/eval-run';
import type { EvalForgeClient, EvalRunStatus } from '../src/utils/evalforge';

vi.mock('@actions/core', () => ({ info: vi.fn(), error: vi.fn() }));

function makeClient(): EvalForgeClient {
  return {
    getMcp: vi.fn(),
    createMcpVersion: vi.fn(),
    getMcpVersions: vi.fn(),
    getEvalRun: vi.fn(),
  } as unknown as EvalForgeClient;
}

const BASE_CONFIG = {
  projectId: 'proj-1',
  mcpId: 'mcp-1',
  prNumber: 42,
  headSha: 'abc1234def',
};

describe('ensureMcpVersion', () => {
  it('returns null when mcp has no source', async () => {
    const client = makeClient();
    vi.mocked(client.getMcp).mockResolvedValue({ id: 'mcp-1', source: null });
    const result = await ensureMcpVersion(client, BASE_CONFIG);
    expect(result).toBeNull();
    expect(client.createMcpVersion).not.toHaveBeenCalled();
  });

  it('creates and returns version when mcp has source', async () => {
    const client = makeClient();
    vi.mocked(client.getMcp).mockResolvedValue({
      id: 'mcp-1',
      source: { owner: 'wix', repo: 'skills', path: 'mcp.json', ref: 'main' },
    });
    vi.mocked(client.createMcpVersion).mockResolvedValue({ id: 'ver-1', version: 'pr-42-abc1234', origin: 'pr' });
    const result = await ensureMcpVersion(client, BASE_CONFIG);
    expect(result).toBe('ver-1');
    expect(client.createMcpVersion).toHaveBeenCalledWith(
      'proj-1', 'mcp-1',
      expect.objectContaining({
        version: 'pr-42-abc1234',
        source: { owner: 'wix', repo: 'skills', path: 'mcp.json', ref: 'abc1234def' },
        origin: 'pr',
      }),
    );
  });

  it('recovers from 409 by finding existing version', async () => {
    const client = makeClient();
    vi.mocked(client.getMcp).mockResolvedValue({
      id: 'mcp-1',
      source: { owner: 'wix', repo: 'skills', path: 'mcp.json', ref: 'main' },
    });
    vi.mocked(client.createMcpVersion).mockRejectedValue(
      Object.assign(new Error('Version already exists'), { status: 409 }),
    );
    vi.mocked(client.getMcpVersions).mockResolvedValue([
      { id: 'existing-ver', version: 'pr-42-abc1234', origin: 'pr' },
    ]);
    const result = await ensureMcpVersion(client, BASE_CONFIG);
    expect(result).toBe('existing-ver');
  });

  it('throws when 409 recovery finds no matching version', async () => {
    const client = makeClient();
    vi.mocked(client.getMcp).mockResolvedValue({
      id: 'mcp-1',
      source: { owner: 'wix', repo: 'skills', path: 'mcp.json', ref: 'main' },
    });
    vi.mocked(client.createMcpVersion).mockRejectedValue(
      Object.assign(new Error('Version already exists'), { status: 409 }),
    );
    vi.mocked(client.getMcpVersions).mockResolvedValue([]);
    await expect(ensureMcpVersion(client, BASE_CONFIG)).rejects.toThrow();
  });
});

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
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ timeout: true });
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
