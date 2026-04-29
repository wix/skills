import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalForgeClient } from '../src/utils/evalforge';

const CLIENT = new EvalForgeClient('https://ef.example.com/api', 'app-1', 'secret-1');

function mockFetch(status: number, body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('EvalForgeClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('getTags returns a Set of tags', async () => {
    mockFetch(200, ['stores', 'calendar']);
    expect(await CLIENT.getTags('proj-1')).toEqual(new Set(['stores', 'calendar']));
  });

  it('throws with status on non-200', async () => {
    mockFetch(401, { error: 'Unauthorized' });
    await expect(CLIENT.getTags('proj-1')).rejects.toThrow('401');
  });

  it('throws with status 500 on server error', async () => {
    mockFetch(500, { error: 'server error' });
    const err = await CLIENT.getTags('proj-1').catch(e => e);
    expect(err.status).toBe(500);
  });
});

describe('getMcp', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns mcp with source', async () => {
    mockFetch(200, { id: 'mcp-1', source: { owner: 'wix', repo: 'skills', path: 'mcp.json', ref: 'main' } });
    const mcp = await CLIENT.getMcp('proj-1', 'mcp-1');
    expect(mcp.id).toBe('mcp-1');
    expect(mcp.source).not.toBeNull();
  });

  it('returns mcp with null source', async () => {
    mockFetch(200, { id: 'mcp-1', source: null });
    const mcp = await CLIENT.getMcp('proj-1', 'mcp-1');
    expect(mcp.source).toBeNull();
  });
});

describe('createMcpVersion', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns created version', async () => {
    mockFetch(201, { id: 'ver-1', version: 'pr-42-abc1234', origin: 'pr' });
    const ver = await CLIENT.createMcpVersion('proj-1', 'mcp-1', {
      version: 'pr-42-abc1234',
      source: { ref: 'abc1234' },
      origin: 'pr',
    });
    expect(ver.id).toBe('ver-1');
  });

  it('throws with status 409 on duplicate', async () => {
    mockFetch(409, { error: 'Version already exists' });
    const err = await CLIENT.createMcpVersion('proj-1', 'mcp-1', {
      version: 'pr-42-abc1234',
      source: { ref: 'abc1234' },
      origin: 'pr',
    }).catch(e => e);
    expect(err.status).toBe(409);
  });
});

describe('getMcpVersions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns list of versions', async () => {
    mockFetch(200, [{ id: 'ver-1', version: 'pr-42-abc1234', origin: 'pr' }]);
    const versions = await CLIENT.getMcpVersions('proj-1', 'mcp-1');
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe('ver-1');
  });
});

describe('createEvalRun', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns created eval run', async () => {
    mockFetch(201, { id: 'run-1', status: 'pending', scenarioIds: ['s1', 's2'] });
    const run = await CLIENT.createEvalRun('proj-1', {
      name: 'PR #42 skill eval',
      description: 'Skill eval for PR #42',
      projectId: 'proj-1',
      tags: ['stores'],
      agentId: 'agent-1',
    });
    expect(run.id).toBe('run-1');
    expect(run.scenarioIds).toHaveLength(2);
  });

  it('throws with status 400 when no scenarios match tags', async () => {
    mockFetch(400, { error: 'No scenarios found' });
    const err = await CLIENT.createEvalRun('proj-1', {
      name: 'PR #42 skill eval',
      description: 'Skill eval for PR #42',
      projectId: 'proj-1',
      tags: ['unknown-tag'],
      agentId: 'agent-1',
    }).catch(e => e);
    expect(err.status).toBe(400);
  });
});

describe('triggerEvalRun', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns evalRunId on success', async () => {
    mockFetch(200, { message: 'Evaluation started', evalRunId: 'run-1' });
    const result = await CLIENT.triggerEvalRun('proj-1', 'run-1');
    expect(result.evalRunId).toBe('run-1');
  });
});

describe('getEvalRun', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns status and metrics', async () => {
    mockFetch(200, {
      status: 'completed',
      progress: 100,
      aggregateMetrics: { totalAssertions: 10, passed: 10, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 1000, totalDuration: 10000 },
    });
    const run = await CLIENT.getEvalRun('proj-1', 'run-1');
    expect(run.status).toBe('completed');
    expect(run.aggregateMetrics.failed).toBe(0);
  });
});
