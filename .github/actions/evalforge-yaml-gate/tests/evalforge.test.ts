import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalForgeClient } from '../src/utils/evalforge';

const APP_ID = 'aid';
const APP_SECRET = 'sec';
const URL_BASE = 'https://example.test';

type FetchResp = { status: number; body?: unknown; bodyText?: string };

function mockFetch(handler: (req: { url: string; method: string; body?: unknown }) => FetchResp) {
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const r = handler({ url, method, body });
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
  it('queryTestScenarios POSTs filter to /v1/projects/:id/test-scenarios/query and unwraps response', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios/query');
      expect((body as { projectId?: unknown; filter?: unknown }).projectId).toBe('P');
      expect((body as { filter?: unknown }).filter).toEqual({ tags: ['draft:owner/repo#1'] });
      return { status: 200, body: { testScenarios: [{ id: 'a', name: 'x', tags: ['draft:owner/repo#1'] }] } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.queryTestScenarios('P', { tags: ['draft:owner/repo#1'] });
    expect(r).toEqual([{ id: 'a', name: 'x', tags: ['draft:owner/repo#1'] }]);
  });

  it('queryTestScenarios normalizes missing tags to []', async () => {
    mockFetch(() => ({ status: 200, body: { testScenarios: [{ id: 'a', name: 'x' }] } }));
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.queryTestScenarios('P', { name: 'x' });
    expect(r[0].tags).toEqual([]);
  });

  it('createTestScenario POSTs to /v1, wraps body in testScenario, returns id from response', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios');
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
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('PATCH');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      const b = body as { projectId?: unknown; testScenario?: { id?: unknown; tags?: unknown } };
      expect(b.projectId).toBe('P');
      expect(b.testScenario?.id).toBe('X');
      expect(b.testScenario?.tags).toEqual(['blog']);
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await c.updateTestScenario('P', 'X', goodBody, ['blog']);
  });

  it('deleteTestScenario DELETEs /v1', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('DELETE');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await c.deleteTestScenario('P', 'X');
  });

  it('error responses carry HTTP status', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await expect(c.deleteTestScenario('P', 'missing')).rejects.toMatchObject({ status: 404 });
  });
});
