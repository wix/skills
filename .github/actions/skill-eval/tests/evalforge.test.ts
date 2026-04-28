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
