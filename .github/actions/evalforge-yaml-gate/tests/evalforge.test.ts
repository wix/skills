import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalForgeClient, CODE_TAG, repoTagFor, managedTagsFor, withManagedTags } from '../src/utils/evalforge';

const CLIENT_ID = 'cid';
const CLIENT_SECRET = 'csec';
const URL_BASE = 'https://example.test';

type FetchResp = { status: number; body?: unknown; bodyText?: string };

// Auto-answers the OAuth token endpoint; routes everything else to `handler`.
function mockFetch(
  handler: (req: { url: string; method: string; body?: unknown; headers: Record<string, string> }) => FetchResp,
) {
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url.endsWith('/oauth2/token')) {
      return new Response(
        JSON.stringify({ access_token: 'tok-123', token_type: 'Bearer', expires_in: 300 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    const r = handler({ url, method, body, headers });
    const text = r.bodyText ?? (r.body !== undefined ? JSON.stringify(r.body) : '');
    const bodyForResponse = r.status === 204 || r.status === 304 ? null : text;
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

describe('EvalForgeClient (V1) — auth + test-scenarios', () => {
  it('sends a Bearer token and queries V1 for listTestScenarios', async () => {
    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios/query');
      expect(headers.Authorization).toBe('Bearer tok-123');
      return { status: 200, body: { testScenarios: [{ id: 'a', name: 'x', tags: ['t'] }, { id: 'b', name: 'y' }] } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.listTestScenarios('P');
    expect(r).toEqual([{ id: 'a', name: 'x', tags: ['t'] }, { id: 'b', name: 'y', tags: [] }]);
  });

  it('listTestScenarios(names) queries each name and keeps only exact matches', async () => {
    const queried: (string | undefined)[] = [];
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios/query');
      const name = (body as { filter?: { name?: string } }).filter?.name;
      queried.push(name);
      // Server does a substring match; the extra near-match must be dropped client-side.
      if (name === 'svc/a') return { status: 200, body: { testScenarios: [{ id: 'a', name: 'svc/a', tags: ['t'] }, { id: 'a2', name: 'svc/a-extra' }] } };
      if (name === 'svc/b') return { status: 200, body: { testScenarios: [{ id: 'b', name: 'svc/b' }] } };
      return { status: 200, body: { testScenarios: [] } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.listTestScenarios('P', ['svc/a', 'svc/b']);
    expect(r).toEqual([{ id: 'a', name: 'svc/a', tags: ['t'] }, { id: 'b', name: 'svc/b', tags: [] }]);
    expect(queried.sort()).toEqual(['svc/a', 'svc/b']);
  });

  it('listTestScenarios([]) returns [] without querying', async () => {
    mockFetch(() => ({ status: 500 })); // would fail if any request fired
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.listTestScenarios('P', [])).resolves.toEqual([]);
  });

  it('listTestScenarios(names) bounds query concurrency to 8', async () => {
    let active = 0, maxConcurrent = 0;
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      const name = (JSON.parse(init!.body as string) as { filter: { name: string } }).filter.name;
      return new Response(JSON.stringify({ testScenarios: [{ id: name, name, tags: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const names = Array.from({ length: 20 }, (_, i) => `svc/${i}`);
    const r = await c.listTestScenarios('P', names);
    expect(r).toHaveLength(20);
    expect(maxConcurrent).toBeGreaterThan(1);   // does run concurrently
    expect(maxConcurrent).toBeLessThanOrEqual(8); // but bounded
  });

  it('listTestScenariosByTag filters by the tag', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios/query');
      expect((body as { filter?: { tags?: string[] } }).filter?.tags).toEqual(['draft:o/r#1']);
      return { status: 200, body: { testScenarios: [{ id: 'a', name: 'svc/a', tags: ['draft:o/r#1'] }] } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.listTestScenariosByTag('P', 'draft:o/r#1');
    expect(r).toEqual([{ id: 'a', name: 'svc/a', tags: ['draft:o/r#1'] }]);
  });

  it('createTestScenario POSTs {testScenario:{...,tags}} and returns id', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/test-scenarios');
      expect(url).not.toContain('/query');
      const ts = (body as { testScenario?: { tags?: unknown; name?: unknown } }).testScenario;
      expect(ts?.name).toBe('n');
      expect(ts?.tags).toEqual(['draft:owner/repo#1']);
      return { status: 200, body: { testScenario: { id: 'new-id' } } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.createTestScenario('P', goodBody, ['draft:owner/repo#1']);
    expect(r.id).toBe('new-id');
  });

  it('updateTestScenario PATCHes /:id with {testScenario:{id,...}} and no explicit fieldMask', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('PATCH');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      expect((body as { testScenario?: { id?: string } }).testScenario?.id).toBe('X');
      // site_setup is not a maskable path; the gateway derives the mask from the
      // present fields, so we must NOT send an explicit fieldMask.
      expect((body as { fieldMask?: string }).fieldMask).toBeUndefined();
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.updateTestScenario('P', 'X', goodBody, ['blog']);
  });

  it('deleteTestScenario DELETEs the V1 path', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('DELETE');
      expect(url).toContain('/v1/projects/P/test-scenarios/X');
      return { status: 204 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.deleteTestScenario('P', 'X');
  });

  it('error responses carry HTTP status (V1 {message})', async () => {
    mockFetch(() => ({ status: 404, body: { message: 'not found' } }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
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

describe('EvalForgeClient (V1) — eval runs', () => {
  it('createEvalRun maps to eval-runs/run and normalizes status', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/eval-runs/run');
      expect((body as { evalRun?: { scenarioIds?: string[] } }).evalRun?.scenarioIds).toEqual(['s1']);
      return { status: 200, body: { evalRun: { id: 'run-1', status: 'PENDING' } } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.createEvalRun('P', { name: 'n', description: 'd', projectId: 'P', agentId: 'a', scenarioIds: ['s1'] });
    expect(r).toEqual({ id: 'run-1', status: 'pending' });
  });

  it('triggerEvalRun is a no-op returning the run id (no network call)', async () => {
    mockFetch(() => ({ status: 500 })); // would fail if called
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.triggerEvalRun('P', 'run-1')).resolves.toEqual({ evalRunId: 'run-1' });
  });

  it('getEvalRun unwraps {evalRun}, lowercases status, and converts passRate to a percent', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toContain('/v1/projects/P/eval-runs/run-1');
      return {
        status: 200,
        body: { evalRun: { id: 'run-1', status: 'COMPLETED', progress: 100, aggregateMetrics: { totalAssertions: 4, passed: 3, failed: 1, passRate: 0.75 } } },
      };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.getEvalRun('P', 'run-1');
    expect(r.status).toBe('completed');
    expect(r.aggregateMetrics.passRate).toBe(75);
    expect(r.aggregateMetrics.passed).toBe(3);
  });
});

describe('EvalForgeClient (V1) — 401 handling', () => {
  it('refreshes the token and retries once on 401', async () => {
    let mints = 0;
    let apiCalls = 0;
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        mints++;
        return new Response(
          JSON.stringify({ access_token: `tok-${mints}`, token_type: 'Bearer', expires_in: 300 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      apiCalls++;
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (apiCalls === 1) {
        expect(auth).toBe('Bearer tok-1'); // first attempt uses the original token
        return new Response('', { status: 401 });
      }
      expect(auth).toBe('Bearer tok-2'); // retry uses the refreshed token
      return new Response(JSON.stringify({ capabilityVersions: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.listMcpVersions('M', 'P');
    expect(mints).toBe(2);    // initial mint + forced refresh
    expect(apiCalls).toBe(2); // 401 then retry
  });

  it('throws when the refreshed retry still returns 401', async () => {
    let apiCalls = 0;
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 300 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      apiCalls++;
      return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.listMcpVersions('M', 'P')).rejects.toThrow(/401/);
    expect(apiCalls).toBe(2); // original attempt + one retry, then give up
  });
});

describe('EvalForgeClient (V1) — ensureMcpVersion idempotency', () => {
  const listBody = (version: string) => ({ capabilityVersions: [{ id: 'ver-1', capabilityId: 'M', version }] });

  it('recovers from a 500 "already exists" by reusing the existing version', async () => {
    mockFetch(({ url, method }) => {
      if (url.includes('/capabilities/M/versions') && method === 'POST') return { status: 500 };
      if (url.includes('/capabilities/M/versions') && method === 'GET') return { status: 200, body: listBody('pr-1-abc') };
      return { status: 404 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const v = await c.ensureMcpVersion('M', 'P', 'pr-1-abc', 1, 'abc1234', 'wix/skills');
    expect(v).toEqual({ id: 'ver-1', capabilityId: 'M', version: 'pr-1-abc' });
  });

  it('recovers from a 409 the same way', async () => {
    mockFetch(({ url, method }) => {
      if (url.includes('/capabilities/M/versions') && method === 'POST') return { status: 409 };
      if (url.includes('/capabilities/M/versions') && method === 'GET') return { status: 200, body: listBody('pr-1-abc') };
      return { status: 404 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const v = await c.ensureMcpVersion('M', 'P', 'pr-1-abc', 1, 'abc1234', 'wix/skills');
    expect(v.id).toBe('ver-1');
  });

  it('rethrows the original error when the version is genuinely absent', async () => {
    mockFetch(({ url, method }) => {
      if (url.includes('/capabilities/M/versions') && method === 'POST') return { status: 500 };
      if (url.includes('/capabilities/M/versions') && method === 'GET') return { status: 200, body: listBody('pr-2-other') };
      return { status: 404 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.ensureMcpVersion('M', 'P', 'pr-1-abc', 1, 'abc1234', 'wix/skills')).rejects.toMatchObject({ status: 500 });
  });
});
