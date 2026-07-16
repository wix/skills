import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalPipelineClient } from '../src/utils/eval-pipeline';

beforeEach(() => { vi.restoreAllMocks(); });

describe('EvalPipelineClient — OAuth Bearer auth', () => {
  it('runComparison mints a token and sends Authorization: Bearer (no x-app headers)', async () => {
    let seen: Headers | undefined;
    let body: unknown;
    let mints = 0;
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        mints++;
        return new Response(JSON.stringify({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      seen = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      expect(url).toBe('https://pipe.test/run-comparison');
      return new Response(JSON.stringify({ comparisonGroupId: 'cg-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const c = new EvalPipelineClient('https://pipe.test', 'aid', 'sec');
    const r = await c.runComparison(['draft:o/r#1'], 'agent', 'sha', 'wix/skills', ['s1', 's2']);
    expect(r).toEqual({ comparisonGroupId: 'cg-1' });
    expect(seen?.get('authorization')).toBe('Bearer tok-1');
    expect(seen?.get('x-app-id')).toBeNull();
    expect(seen?.get('x-app-secret')).toBeNull();
    expect(body).toEqual({
      tags: ['draft:o/r#1'],
      agentName: 'agent',
      commitSha: 'sha',
      skillsRepo: 'wix/skills',
      scenarioIds: ['s1', 's2'],
    });
    expect(mints).toBe(1);
  });

  it('surfaces the HTTP status on a non-2xx pipeline response', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const c = new EvalPipelineClient('https://pipe.test', 'aid', 'sec');
    await expect(c.runComparison(['t'], 'agent')).rejects.toMatchObject({ status: 401 });
  });
});
