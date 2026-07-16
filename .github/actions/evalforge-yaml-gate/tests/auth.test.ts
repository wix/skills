import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import { TokenProvider } from '../src/utils/auth';

vi.mock('@actions/core', () => ({ setSecret: vi.fn() }));

beforeEach(() => { vi.restoreAllMocks(); });

function tokenResponse(token: string, expiresIn: number) {
  return new Response(
    JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('TokenProvider', () => {
  it('mints once and caches within the expiry window', async () => {
    const fetchMock = vi.fn(async () => tokenResponse('tok-A', 300));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    expect(await p.getToken()).toBe('tok-A');
    expect(await p.getToken()).toBe('tok-A');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-mints when the cached token is at/near expiry', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => tokenResponse(`tok-${++n}`, 0)); // expires_in:0 → always stale
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    expect(await p.getToken()).toBe('tok-1');
    expect(await p.getToken()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single mint across concurrent callers (single-flight)', async () => {
    let active = 0;
    let maxConcurrent = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return tokenResponse('tok-A', 300);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    const tokens = await Promise.all([p.getToken(), p.getToken(), p.getToken()]);
    expect(tokens).toEqual(['tok-A', 'tok-A', 'tok-A']);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not 3
    expect(maxConcurrent).toBe(1);
  });

  it('throws on a non-2xx token response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    await expect(p.getToken()).rejects.toThrow(/401/);
  });

  it('forceRefresh mints a fresh token even when the cache is still valid', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => tokenResponse(`tok-${++n}`, 300));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    expect(await p.getToken()).toBe('tok-1');
    expect(await p.forceRefresh()).toBe('tok-2');
    expect(await p.getToken()).toBe('tok-2'); // refreshed token is now cached
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('masks the minted token via core.setSecret', async () => {
    globalThis.fetch = vi.fn(async () => tokenResponse('tok-secret', 300)) as unknown as typeof fetch;
    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    await p.getToken();
    expect(core.setSecret).toHaveBeenCalledWith('tok-secret');
  });

  it('forceRefresh(staleToken) returns an already-refreshed token without minting again', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => tokenResponse(`tok-${++n}`, 300));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    const stale = await p.getToken();                 // tok-1
    expect(await p.forceRefresh(stale)).toBe('tok-2'); // stale token → mints once
    expect(await p.forceRefresh(stale)).toBe('tok-2'); // already past stale → no re-mint
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('concurrent forceRefresh of the same stale token folds into a single mint', async () => {
    let active = 0, maxConcurrent = 0, n = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return tokenResponse(`tok-${++n}`, 300);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p = new TokenProvider('https://x/oauth2/token', 'id', 'sec');
    const stale = await p.getToken(); // tok-1
    const [a, b, c] = await Promise.all([p.forceRefresh(stale), p.forceRefresh(stale), p.forceRefresh(stale)]);
    expect([a, b, c]).toEqual(['tok-2', 'tok-2', 'tok-2']); // one shared refresh, not three
    expect(maxConcurrent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial getToken + one shared refresh
  });
});
