import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalForgeClient, CODE_TAG, repoTagFor, managedTagsFor, withManagedTags } from '../src/utils/evalforge';

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

  it('listTestScenarios appends repeated name and tags filters', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/projects/P/test-scenarios');
      expect(parsed.searchParams.getAll('name')).toEqual(['blog/a', 'stores/product setup']);
      expect(parsed.searchParams.getAll('tags')).toEqual(['draft:wix/skills#42', 'stores']);
      return { status: 200, body: [{ id: 'a', name: 'blog/a' }] };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.listTestScenarios('P', {
      names: ['blog/a', 'stores/product setup'],
      tags: ['draft:wix/skills#42', 'stores'],
    });
    expect(r).toEqual([{ id: 'a', name: 'blog/a', tags: [] }]);
  });

  it('listTestScenarios splits large name filters into bounded requests', async () => {
    const calls: string[][] = [];
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      const names = new URL(url).searchParams.getAll('name');
      calls.push(names);
      expect(names.length).toBeLessThanOrEqual(50);
      return {
        status: 200,
        body: [
          { id: 'shared', name: 'blog/shared', tags: ['blog'] },
          { id: `call-${calls.length}`, name: names[0], tags: ['blog'] },
        ],
      };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const names = Array.from({ length: 51 }, (_, i) => `blog/${i}`);

    const r = await c.listTestScenarios('P', { names });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveLength(50);
    expect(calls[1]).toEqual(['blog/50']);
    expect(r.map(s => s.id)).toEqual(['shared', 'call-1', 'call-2']);
  });

  it('createTestScenario POSTs body+projectId+tags and returns id', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/projects/P/test-scenarios');
      const b = body as { projectId?: unknown; tags?: unknown };
      expect(b.projectId).toBe('P');
      expect(b.tags).toEqual(['draft:owner/repo#1']);
      return { status: 200, body: { id: 'new-id' } };
    });
    const c = new EvalForgeClient(URL_BASE, APP_ID, APP_SECRET);
    const r = await c.createTestScenario('P', goodBody, ['draft:owner/repo#1']);
    expect(r.id).toBe('new-id');
  });

  it('updateTestScenario PUTs to /:id with projectId in body', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('PUT');
      expect(url).toContain('/projects/P/test-scenarios/X');
      expect((body as { projectId?: unknown }).projectId).toBe('P');
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

describe('managed code-origin tags', () => {
  it('repoTagFor builds a repo:<owner>/<repo> tag', () => {
    expect(repoTagFor('wix/skills')).toBe('repo:wix/skills');
  });

  it('managedTagsFor returns the marker tag and the repo tag', () => {
    expect(managedTagsFor('wix/skills')).toEqual([CODE_TAG, 'repo:wix/skills']);
  });

  it('withManagedTags appends both managed tags, preserving existing order', () => {
    expect(withManagedTags(['ecommerce'], 'wix/skills'))
      .toEqual(['ecommerce', 'created-via-code', 'repo:wix/skills']);
  });

  it('withManagedTags is idempotent and does not duplicate existing managed tags', () => {
    const once = withManagedTags(['ecommerce'], 'wix/skills');
    expect(withManagedTags(once, 'wix/skills')).toEqual(once);
  });

  it('withManagedTags keeps a draft tag alongside the managed tags', () => {
    expect(withManagedTags(['draft:wix/skills#7'], 'wix/skills'))
      .toEqual(['draft:wix/skills#7', 'created-via-code', 'repo:wix/skills']);
  });

  it('withManagedTags fills in only the missing managed tag', () => {
    expect(withManagedTags(['created-via-code'], 'wix/skills'))
      .toEqual(['created-via-code', 'repo:wix/skills']);
  });
});
