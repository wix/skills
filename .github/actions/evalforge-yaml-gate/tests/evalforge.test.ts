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
  assertions: [{
    type: 'tool_called_with_param' as const,
    toolName: 't',
    expectedParams: '{}',
  }],
};

describe('EvalForgeClient — test-scenarios', () => {
  it('listTestScenarios GETs /projects/:id/test-scenarios', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toContain('/projects/P/test-scenarios');
      return { status: 200, body: [{ id: 'a', name: 'x', tags: ['t'] }] };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.listTestScenarios('P');
    expect(r).toEqual([{ id: 'a', name: 'x', tags: ['t'] }]);
  });

  it('createTestScenario POSTs body+tags and returns id', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/projects/P/test-scenarios');
      expect((body as { tags?: unknown }).tags).toEqual(['draft:owner/repo#1']);
      return { status: 200, body: { id: 'new-id' } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.createTestScenario('P', goodBody, ['draft:owner/repo#1']);
    expect(r.id).toBe('new-id');
  });

  it('updateTestScenario PUTs to /:id', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('PUT');
      expect(url).toContain('/projects/P/test-scenarios/X');
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    await c.updateTestScenario('P', 'X', goodBody, ['blog']);
  });

  it('deleteTestScenario DELETEs', async () => {
    mockFetch(({ method }) => {
      expect(method).toBe('DELETE');
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
