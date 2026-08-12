import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvalForgeClient, CODE_TAG, repoTagFor, managedTagsFor, withManagedTags } from '../src/evalforge';

// Captured verbatim (then trimmed of unused bulky fields — conversation/llmTrace/files/
// templateFiles/fileDiffs) from a real EvalForge run against the live API. This is what
// caught the ASSERTION_RESULT_STATUS_ prefix bug: every invented fixture in this file uses
// bare statuses ('PASSED'), which the real API never sends.
const LIVE_PR_ARM_BODY = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/live-eval-run-pr-arm.json'), 'utf8'),
);
const LIVE_BASE_ARM_BODY = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/live-eval-run-base-arm.json'), 'utf8'),
);

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

  it('listTestScenarios() throws when pagingMetadata reports a next cursor', async () => {
    mockFetch(() => ({
      status: 200,
      body: { testScenarios: [{ id: 'a', name: 'x' }], pagingMetadata: { cursors: { next: 'c2' } } },
    }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.listTestScenarios('P')).rejects.toThrow(/truncated page/);
  });

  it('listTestScenarios() throws when pagingMetadata.total exceeds the page received', async () => {
    mockFetch(() => ({
      status: 200,
      body: { testScenarios: [{ id: 'a', name: 'x' }], pagingMetadata: { total: 42, count: 1 } },
    }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.listTestScenarios('P')).rejects.toThrow(/received 1 of 42/);
  });

  it('listTestScenarios() accepts a complete page, and tolerates absent pagingMetadata', async () => {
    mockFetch(() => ({
      status: 200,
      body: { testScenarios: [{ id: 'a', name: 'x' }], pagingMetadata: { total: 1, count: 1 } },
    }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.listTestScenarios('P')).resolves.toEqual([{ id: 'a', name: 'x', tags: [] }]);

    mockFetch(() => ({ status: 200, body: { testScenarios: [{ id: 'a', name: 'x' }] } }));
    const c2 = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c2.listTestScenarios('P')).resolves.toHaveLength(1);
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

  it('createEvalRun supports tag-filtered scheduled runs', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/eval-runs/run');
      expect((body as { evalRun?: { filter?: unknown } }).evalRun).toMatchObject({
        filter: { tag: 'created-via-code' },
      });
      expect((body as { evalRun?: { scenarioIds?: unknown } }).evalRun).not.toHaveProperty('scenarioIds');
      return { status: 200, body: { evalRun: { id: 'run-1', status: 'PENDING' } } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.createAndRunEvalRun('P', {
      name: 'scheduled-1',
      description: 'scheduled',
      projectId: 'P',
      agentId: 'agent-1',
      filter: { tag: 'created-via-code' },
    });
    expect(r).toEqual({ id: 'run-1', status: 'pending' });
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
    const r = await c.createAndRunEvalRun('P', { name: 'n', description: 'd', projectId: 'P', agentId: 'a', scenarioIds: ['s1'] });
    expect(r).toEqual({ id: 'run-1', status: 'pending' });
  });

  it('carries the comparison group, label and runsPerScenario on the run', async () => {
    mockFetch(({ body }) => {
      expect((body as { evalRun?: unknown }).evalRun).toMatchObject({
        comparisonGroupId: 'pr-42-abc1234', comparisonLabel: 'pr', runsPerScenario: 3,
      });
      return { status: 200, body: { evalRun: { id: 'run-1', status: 'PENDING' } } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.createAndRunEvalRun('P', {
      name: 'n', description: 'd', projectId: 'P', agentId: 'agent-1',
      scenarioIds: ['sc-1'], capabilityIds: ['cap-1'],
      capabilityVersions: { 'cap-1': 'ver-pr' },
      comparisonGroupId: 'pr-42-abc1234', comparisonLabel: 'pr', runsPerScenario: 3,
    });
  });

  it('omits capabilityVersions entirely when no version is pinned', async () => {
    mockFetch(({ body }) => {
      expect('capabilityVersions' in (body as { evalRun: object }).evalRun).toBe(false);
      return { status: 200, body: { evalRun: { id: 'run-1', status: 'PENDING' } } };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.createAndRunEvalRun('P', {
      name: 'n', description: 'd', projectId: 'P', agentId: 'agent-1',
      scenarioIds: ['sc-1'], capabilityIds: ['cap-1'],
      comparisonGroupId: 'pr-42-abc1234', comparisonLabel: 'base',
    });
  });

  it('triggerEvalRun is a no-op returning the run id (no network call)', async () => {
    mockFetch(() => ({ status: 500 })); // would fail if called
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(c.triggerEvalRun('P', 'run-1')).resolves.toEqual({ evalRunId: 'run-1' });
  });

  it('getEvalRun unwraps {evalRun}, lowercases status, and keeps passRate as a percentage', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toContain('/v1/projects/P/eval-runs/run-1');
      return {
        status: 200,
        body: { evalRun: { id: 'run-1', status: 'COMPLETED', progress: 100, aggregateMetrics: { totalAssertions: 4, passed: 3, failed: 1, passRate: 75 } } },
      };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const r = await c.getEvalRun('P', 'run-1');
    expect(r.status).toBe('completed');
    expect(r.aggregateMetrics.passRate).toBe(75);
    expect(r.aggregateMetrics.passed).toBe(3);
  });
});

describe('getEvalRun — per-scenario results', () => {
  const resultsBody = {
    evalRun: {
      id: 'run-1',
      status: 'COMPLETED',
      aggregateMetrics: { totalAssertions: 4, passed: 3, failed: 1 },
      results: [
        {
          scenarioId: 'sc-1', scenarioName: 'creates a page', passed: 2, failed: 0,
          iterationIndex: 0,
          assertionResults: [
            { assertionName: 'skill called', assertionType: 'skill_was_called', status: 'PASSED' },
            { assertionName: 'judge', assertionType: 'llm_judge', status: 'PASSED' },
          ],
        },
        {
          scenarioId: 'sc-2', scenarioName: 'skips the plugin', passed: 1, failed: 1,
          iterationIndex: 0,
          assertionResults: [
            { assertionName: 'build', assertionType: 'build_passed', status: 'FAILED', message: 'tsc failed' },
            { assertionName: 'judge', assertionType: 'llm_judge', status: 'PASSED' },
          ],
        },
        {
          scenarioId: 'sc-3', scenarioName: 'cancelled midway', passed: 0, failed: 0,
          iterationIndex: 0, partial: true, assertionResults: [],
        },
      ],
    },
  };

  it('surfaces one row per scenario result', async () => {
    mockFetch(() => ({ status: 200, body: resultsBody }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results.map(row => row.scenarioId)).toEqual(['sc-1', 'sc-2', 'sc-3']);
  });

  it('carries assertion names and statuses', async () => {
    mockFetch(() => ({ status: 200, body: resultsBody }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[1].assertions).toEqual([
      { assertionName: 'build', assertionType: 'build_passed', status: 'FAILED', message: 'tsc failed' },
      { assertionName: 'judge', assertionType: 'llm_judge', status: 'PASSED' },
    ]);
  });

  // Finding 5: `assertionId` is the only field that disambiguates two assertions sharing a name
  // (see the live fixture used in `fold-scenario-iterations.test.ts`), so it must survive the
  // wire mapping rather than being dropped like the trimmed fields never were.
  it('carries assertionId through when the wire row sends one', async () => {
    const withAssertionId = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{
          scenarioId: 'sc-1', scenarioName: 'x',
          assertionResults: [{
            assertionName: 'Skill was called', assertionType: 'skill_was_called', status: 'PASSED',
            assertionId: 'aid-123',
          }],
        }],
      },
    };
    mockFetch(() => ({ status: 200, body: withAssertionId }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions[0].assertionId).toBe('aid-123');
  });

  it('omits assertionId rather than a synthetic default when the wire row does not send one', async () => {
    mockFetch(() => ({ status: 200, body: resultsBody }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect('assertionId' in status.results[0].assertions[0]).toBe(false);
  });

  it('marks a partial row, and defaults partial to false when absent', async () => {
    mockFetch(() => ({ status: 200, body: resultsBody }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[2].partial).toBe(true);
    expect(status.results[0].partial).toBe(false);
  });

  it('defaults iterationIndex to 0 when absent, and assertions to [] when assertionResults is absent', async () => {
    const withoutIndex = { evalRun: { ...resultsBody.evalRun, results: [{ scenarioId: 'sc-1', scenarioName: 'x' }] } };
    mockFetch(() => ({ status: 200, body: withoutIndex }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].iterationIndex).toBe(0);
    expect(status.results[0].assertions).toEqual([]);
  });

  it('tolerates a response with no results array at all', async () => {
    const withoutResults = { evalRun: { id: 'run-1', status: 'RUNNING' } };
    mockFetch(() => ({ status: 200, body: withoutResults }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results).toEqual([]);
    expect(status.aggregateMetrics.totalAssertions).toBe(0);
  });

  it('tolerates a null entry inside results, yielding a safe empty row', async () => {
    const withNullEntry = { evalRun: { ...resultsBody.evalRun, results: [null] } };
    mockFetch(() => ({ status: 200, body: withNullEntry }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results).toEqual([
      { scenarioId: '', scenarioName: '', passed: 0, failed: 0, partial: false, iterationIndex: 0, assertions: [] },
    ]);
  });

  // Finding 4: a null entry has no `status` at all — the same "absent" case a real proto3 payload
  // reaches whenever the wire omits a zero-valued enum field. That must not read as `ERROR` (a
  // genuine wire status this action did not see), so it maps to `UNKNOWN` instead.
  it('tolerates a null entry inside assertionResults, yielding a safe empty assertion outcome', async () => {
    const withNullAssertion = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{ scenarioId: 'sc-1', scenarioName: 'x', assertionResults: [null] }],
      },
    };
    mockFetch(() => ({ status: 200, body: withNullAssertion }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions).toEqual([
      { assertionName: '(unnamed)', assertionType: 'unknown', status: 'UNKNOWN' },
    ]);
  });

  it('tolerates assertionResults arriving as a non-array', async () => {
    const withNonArrayAssertions = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{ scenarioId: 'sc-1', scenarioName: 'x', assertionResults: {} }],
      },
    };
    mockFetch(() => ({ status: 200, body: withNonArrayAssertions }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions).toEqual([]);
  });

  it('tolerates results arriving as a non-array', async () => {
    const withNonArrayResults = { evalRun: { id: 'run-1', status: 'RUNNING', results: {} } };
    mockFetch(() => ({ status: 200, body: withNonArrayResults }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results).toEqual([]);
  });

  it('maps the real API\'s ASSERTION_RESULT_STATUS_-prefixed statuses to PASSED/FAILED, not ERROR', async () => {
    mockFetch(() => ({ status: 200, body: LIVE_PR_ARM_BODY }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    const statuses = status.results[0].assertions.map(assertion => assertion.status);
    expect(statuses).toEqual(['FAILED', 'PASSED', 'PASSED', 'FAILED', 'PASSED', 'FAILED', 'FAILED']);
    expect(statuses).not.toContain('ERROR');
  });

  // Finding 4: an unrecognised status — whether a typo or a genuinely new future enum member —
  // is not evidence the assertion errored. Folding it into `ERROR` would manufacture a failure
  // (`foldScenarioIterations` counts every `ERROR` toward `errors`) for a value this action simply
  // does not know how to read, so it maps to `UNKNOWN` instead.
  it('maps an unrecognised assertion status to UNKNOWN, not ERROR', async () => {
    const withUnknownStatus = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{
          scenarioId: 'sc-1', scenarioName: 'x',
          assertionResults: [{ assertionName: 'a', assertionType: 't', status: 'BOGUS' }],
        }],
      },
    };
    mockFetch(() => ({ status: 200, body: withUnknownStatus }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions[0].status).toBe('UNKNOWN');
  });

  it('maps ASSERTION_RESULT_STATUS_UNSPECIFIED to UNKNOWN, not ERROR', async () => {
    const withUnspecified = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{
          scenarioId: 'sc-1', scenarioName: 'x',
          assertionResults: [{
            assertionName: 'a', assertionType: 't', status: 'ASSERTION_RESULT_STATUS_UNSPECIFIED',
          }],
        }],
      },
    };
    mockFetch(() => ({ status: 200, body: withUnspecified }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions[0].status).toBe('UNKNOWN');
  });

  it('maps a wholly absent status to UNKNOWN — the proto3 zero-value-omitted case', async () => {
    const withAbsentStatus = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{
          scenarioId: 'sc-1', scenarioName: 'x',
          assertionResults: [{ assertionName: 'a', assertionType: 't' }],
        }],
      },
    };
    mockFetch(() => ({ status: 200, body: withAbsentStatus }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions[0].status).toBe('UNKNOWN');
  });

  // Finding 3: `status` is untrusted wire data, not necessarily a string — a proto enum can arrive
  // as a number, or (in a malformed response) as anything else. Calling `.startsWith` on it without
  // a `typeof` guard threw, which previously surfaced as a poll failure for a run that had actually
  // completed.
  it.each([
    ['a numeric proto enum', 1],
    ['an object', { code: 1 }],
    ['an array', [1]],
  ])('does not throw when status arrives as %s, mapping it to UNKNOWN', async (_label, wireStatus) => {
    const withNonStringStatus = {
      evalRun: {
        ...resultsBody.evalRun,
        results: [{
          scenarioId: 'sc-1', scenarioName: 'x',
          assertionResults: [{ assertionName: 'a', assertionType: 't', status: wireStatus }],
        }],
      },
    };
    mockFetch(() => ({ status: 200, body: withNonStringStatus }));
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const status = await c.getEvalRun('proj-1', 'run-1');
    expect(status.results[0].assertions[0].status).toBe('UNKNOWN');
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
    await c.listCapabilityVersions('M', 'P');
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
    await expect(c.listCapabilityVersions('M', 'P')).rejects.toThrow(/401/);
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

  it('posts the nested mcpContent config wix-mcp-remote expects, with type and header placeholders', async () => {
    let captured: unknown;
    mockFetch(({ url, method, body }) => {
      if (url.includes('/capabilities/M/versions') && method === 'POST') {
        captured = body;
        return { status: 200, body: { capabilityVersion: { id: 'ver-1', capabilityId: 'M', version: 'pr-1-abc' } } };
      }
      return { status: 404 };
    });
    const c = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await c.ensureMcpVersion('M', 'P', 'pr-1-abc', 1, 'abc1234', 'wix/skills');

    expect((captured as { capabilityVersion: { mcpContent: unknown } }).capabilityVersion.mcpContent).toEqual({
      config: {
        'wix-mcp-remote': {
          url: 'https://mcp.wix.com/mcp?skillsRepo=wix%2Fskills&skillsPr=abc1234',
          type: 'http',
          headers: {
            Authorization: '{{wix-auth-token}}',
            'wix-account-id': '{{wix-auth-user-id}}',
          },
        },
      },
    });
  });
});

describe('EvalForgeClient (V1) — skill capability versions', () => {
  const files = [
    { path: 'SKILL.md', content: '# wix-app' },
    { path: 'references/DASHBOARD_PAGE.md', content: 'dashboard docs' },
  ];

  it('posts skillContent with the file list to the capability versions endpoint', async () => {
    let captured: unknown;
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toContain('/v1/projects/P/capabilities/C/versions');
      captured = body;
      return { status: 200, body: { capabilityVersion: { id: 'v1', capabilityId: 'C', version: 'pr-42-abc1234' } } };
    });

    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const version = await client.createOrReuseSkillVersion('C', 'P', 'pr-42-abc1234', 42, files);

    expect(version).toEqual({ id: 'v1', capabilityId: 'C', version: 'pr-42-abc1234' });
    expect(captured).toMatchObject({
      capabilityVersion: {
        capabilityId: 'C',
        version: 'pr-42-abc1234',
        origin: 'pr',
        skillContent: { files },
      },
    });
  });


  it('createOrReuseSkillVersion reuses an existing version on a 409', async () => {
    mockFetch(({ method }) => {
      if (method === 'POST') return { status: 409, body: { message: 'already exists' } };
      return { status: 200, body: { capabilityVersions: [{ id: 'v9', capabilityId: 'C', version: 'pr-42-abc1234' }] } };
    });

    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    const version = await client.createOrReuseSkillVersion('C', 'P', 'pr-42-abc1234', 42, files);

    expect(version).toEqual({ id: 'v9', capabilityId: 'C', version: 'pr-42-abc1234' });
  });

  it('createOrReuseSkillVersion also recovers from the backend 500 for a duplicate label', async () => {
    mockFetch(({ method }) => {
      if (method === 'POST') return { status: 500, body: { message: 'already exists' } };
      return { status: 200, body: { capabilityVersions: [{ id: 'v9', capabilityId: 'C', version: 'L' }] } };
    });

    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(client.createOrReuseSkillVersion('C', 'P', 'L', 42, files)).resolves.toMatchObject({ id: 'v9' });
  });

  it('createOrReuseSkillVersion rethrows when the label genuinely is not there', async () => {
    mockFetch(({ method }) => {
      if (method === 'POST') return { status: 500, body: { message: 'boom' } };
      return { status: 200, body: { capabilityVersions: [] } };
    });

    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(client.createOrReuseSkillVersion('C', 'P', 'L', 42, files)).rejects.toMatchObject({ status: 500 });
  });

  it('createOrReuseSkillVersion does not swallow a 400', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'bad request' } }));
    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(client.createOrReuseSkillVersion('C', 'P', 'L', 42, files)).rejects.toMatchObject({ status: 400 });
  });
});

describe('createOrReuseCapabilityVersion', () => {
  it('posts skillContent for a skill entity', async () => {
    let captured: unknown;
    mockFetch(({ method, body }) => {
      expect(method).toBe('POST');
      captured = body;
      return { status: 200, body: { capabilityVersion: { id: 'v1', capabilityId: 'C', version: 'pr-42-abc1234' } } };
    });
    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);

    await client.createOrReuseCapabilityVersion('C', 'P', 'pr-42-abc1234', 42, {
      kind: 'skill', files: [{ path: 'SKILL.md', content: '# skill' }],
    });

    expect((captured as { capabilityVersion: { skillContent: unknown } }).capabilityVersion.skillContent).toEqual({
      files: [{ path: 'SKILL.md', content: '# skill' }],
    });
  });

  it('posts mcpContent for an mcp entity', async () => {
    let captured: unknown;
    mockFetch(({ method, body }) => {
      expect(method).toBe('POST');
      captured = body;
      return { status: 200, body: { capabilityVersion: { id: 'v2', capabilityId: 'M', version: 'pr-42-abc1234' } } };
    });
    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);

    await client.createOrReuseCapabilityVersion('M', 'P', 'pr-42-abc1234', 42, {
      kind: 'mcp', url: 'https://example.test/mcp',
    });

    expect((captured as { capabilityVersion: { mcpContent: unknown } }).capabilityVersion.mcpContent).toEqual({
      config: {
        'wix-mcp-remote': {
          url: 'https://example.test/mcp',
          type: 'http',
          headers: {
            Authorization: '{{wix-auth-token}}',
            'wix-account-id': '{{wix-auth-user-id}}',
          },
        },
      },
    });
  });

  it('reuses the existing version when the label already exists', async () => {
    mockFetch(({ method }) => {
      if (method === 'POST') return { status: 409 };
      return { status: 200, body: { capabilityVersions: [{ id: 'v-existing', capabilityId: 'C', version: 'pr-42-abc1234' }] } };
    });
    const client = new EvalForgeClient(URL_BASE, CLIENT_ID, CLIENT_SECRET);

    const version = await client.createOrReuseCapabilityVersion('C', 'P', 'pr-42-abc1234', 42, {
      kind: 'skill', files: [{ path: 'SKILL.md', content: '# skill' }],
    });

    expect(version.id).toBe('v-existing');
  });
});
