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

describe('createMcpVersion', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends correct request body with skillsPr URL', async () => {
    const capVersion = { id: 'ver-uuid-1', capabilityId: 'mcp-1', version: 'pr-42-abc1234' };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 201, json: async () => capVersion,
    } as Response);

    const result = await CLIENT.createMcpVersion('mcp-1', 'proj-1', 'pr-42-abc1234', 42, 'abc1234deadbeef');

    expect(result.id).toBe('ver-uuid-1');
    expect(result.version).toBe('pr-42-abc1234');

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.version).toBe('pr-42-abc1234');
    expect(body.origin).toBe('pr');
    expect(body.content.config['wix-mcp-remote'].url).toContain('skillsPr=abc1234deadbeef');
    expect(body.content.config['wix-mcp-remote'].url).toContain('skillsRepo=wix/skills');
  });

  it('throws with status 409 on conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 409, json: async () => ({ error: 'Conflict' }),
    } as Response);
    const err = await CLIENT.createMcpVersion('mcp-1', 'proj-1', 'pr-42-abc1234', 42, 'abc1234').catch(e => e);
    expect(err.status).toBe(409);
  });
});

describe('listMcpVersions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns array of capability versions', async () => {
    const versions = [
      { id: 'ver-1', capabilityId: 'mcp-1', version: 'pr-42-abc1234' },
      { id: 'ver-2', capabilityId: 'mcp-1', version: '1.0.0' },
    ];
    mockFetch(200, versions);
    const result = await CLIENT.listMcpVersions('mcp-1', 'proj-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ver-1');
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

describe('deleteMcpVersion', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends DELETE request to correct URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'CapabilityVersion deleted successfully' }),
    } as Response);

    await CLIENT.deleteMcpVersion('mcp-1', 'proj-1', 'ver-uuid-1');

    expect(spy).toHaveBeenCalledWith(
      'https://ef.example.com/api/projects/proj-1/capabilities/mcp-1/versions/ver-uuid-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws with status 404 when version not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'CapabilityVersion not found' }),
    } as Response);

    const err = await CLIENT.deleteMcpVersion('mcp-1', 'proj-1', 'ver-uuid-1').catch(e => e);
    expect(err.status).toBe(404);
  });
});
