import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalForgeClient } from '../src/utils/evalforge';

const APP_ID = 'aid';
const APP_SECRET = 'sec';
const URL_BASE = 'https://example.test';

type FetchResp = { status: number; body?: unknown; bodyText?: string };

function mockFetch(handler: (req: { url: string; method: string; body?: unknown; headers: Record<string, string> }) => FetchResp) {
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const r = handler({ url, method, body, headers });
    const text = r.bodyText ?? (r.body !== undefined ? JSON.stringify(r.body) : '');
    const bodyForResponse = (r.status === 204 || r.status === 304) ? null : text;
    return new Response(bodyForResponse, { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

beforeEach(() => { vi.restoreAllMocks(); });

const goodBody = {
  name: 'n',
  description: '',
  triggerPrompt: '0123456789',
  assertionLinks: [{
    assertionId: 'system:tool_called_with_param',
    params: { toolName: 't', expectedParams: '{}' },
  }],
};

describe('EvalForgeClient — test-scenarios', () => {
  it('listScenariosByTag POSTs filter to /v1 query, uses SRV.JWS auth (no legacy headers)', async () => {
    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios/query');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      expect(headers['x-app-id']).toBeUndefined();
      expect(headers['x-app-secret']).toBeUndefined();
      expect((body as { projectId?: unknown; filter?: unknown }).projectId).toBe('P');
      expect((body as { filter?: unknown }).filter).toEqual({ tags: ['draft:owner/repo#1'] });
      return { status: 200, body: { testScenarios: [{ id: 'a', name: 'x', tags: ['draft:owner/repo#1'] }] } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.listScenariosByTag('P', 'draft:owner/repo#1');
    expect(r).toEqual([{ id: 'a', name: 'x', tags: ['draft:owner/repo#1'] }]);
  });

  it('listScenariosByTag normalizes missing tags to []', async () => {
    mockFetch(() => ({ status: 200, body: { testScenarios: [{ id: 'a', name: 'x' }] } }));
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.listScenariosByTag('P', 't');
    expect(r[0].tags).toEqual([]);
  });

  it('findScenarioByExactName filters substring matches client-side', async () => {
    mockFetch(({ body }) => {
      expect((body as { filter?: unknown }).filter).toEqual({ name: 'foo' });
      return { status: 200, body: { testScenarios: [
        { id: '1', name: 'foobar', tags: [] },
        { id: '2', name: 'foo', tags: [] },
        { id: '3', name: 'unfoo', tags: [] },
      ] } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.findScenarioByExactName('P', 'foo');
    expect(r).toEqual({ id: '2', name: 'foo', tags: [] });
  });

  it('findScenarioByExactName returns undefined when no exact match', async () => {
    mockFetch(() => ({ status: 200, body: { testScenarios: [{ id: '1', name: 'foobar', tags: [] }] } }));
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.findScenarioByExactName('P', 'foo');
    expect(r).toBeUndefined();
  });

  it('createTestScenario POSTs to /v1, wraps body in testScenario, returns id from response', async () => {
    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      const b = body as { projectId?: unknown; testScenario?: { tags?: unknown; name?: unknown } };
      expect(b.projectId).toBe('P');
      expect(b.testScenario?.tags).toEqual(['draft:owner/repo#1']);
      expect(b.testScenario?.name).toBe('n');
      return { status: 200, body: { testScenario: { id: 'new-id' } } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.createTestScenario('P', goodBody, ['draft:owner/repo#1']);
    expect(r.id).toBe('new-id');
  });

  it('updateTestScenario PATCHes /v1 with id and projectId in body', async () => {
    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('PATCH');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      const b = body as { projectId?: unknown; testScenario?: { id?: unknown; tags?: unknown } };
      expect(b.projectId).toBe('P');
      expect(b.testScenario?.id).toBe('X');
      expect(b.testScenario?.tags).toEqual(['blog']);
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await c.updateTestScenario('P', 'X', goodBody, ['blog']);
  });

  it('deleteTestScenario DELETEs /v1 with SRV.JWS Authorization', async () => {
    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('DELETE');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await c.deleteTestScenario('P', 'X');
  });

  it('runEvaluation POSTs to /v1/.../eval-runs/run wrapping evalRun, returns evalRun from response', async () => {
    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/eval-runs/run');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      const b = body as { projectId?: unknown; evalRun?: { agentId?: unknown; scenarioIds?: unknown } };
      expect(b.projectId).toBe('P');
      expect(b.evalRun?.agentId).toBe('agent-1');
      expect(b.evalRun?.scenarioIds).toEqual(['s1', 's2']);
      return { status: 200, body: { evalRun: { id: 'run-1', status: 'pending' } } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.runEvaluation('P', {
      name: 'r', description: '', projectId: 'P', agentId: 'agent-1', scenarioIds: ['s1', 's2'],
    });
    expect(r).toEqual({ id: 'run-1', status: 'pending' });
  });

  it('getEvalRun GETs /v1/.../eval-runs/{id} with JWT, unwraps evalRun from response', async () => {
    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('GET');
      expect(url).toContain('/v1/projects/P/eval-runs/X');
      expect(headers['Authorization']).toMatch(/^SRV\.JWS\./);
      return {
        status: 200,
        body: {
          evalRun: {
            status: 'completed',
            progress: 100,
            aggregateMetrics: {
              totalAssertions: 2, passed: 2, failed: 0, skipped: 0, errors: 0,
              passRate: 1, avgDuration: 1, totalDuration: 2,
            },
          },
        },
      };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.getEvalRun('P', 'X');
    expect(r.status).toBe('completed');
    expect(r.aggregateMetrics.passRate).toBe(1);
  });

  it('error responses carry HTTP status', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await expect(c.deleteTestScenario('P', 'missing')).rejects.toMatchObject({ status: 404 });
  });
});
