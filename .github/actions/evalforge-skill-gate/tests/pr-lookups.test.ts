import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as github from '@actions/github';

const getFirstCommitAuthorEmail = vi.fn();

vi.mock('@wix/evalforge-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@wix/evalforge-core')>(),
  getFirstCommitAuthorEmail,
}));

type Octokit = ReturnType<typeof github.getOctokit>;

/**
 * Only `pulls.get` is real. A bare `{ pulls: {} }` makes the call throw a TypeError that the
 * catch swallows, which is how the `state !== 'open'` branch went untested.
 */
const octokitWith = (pullsGet: unknown): Octokit =>
  ({ rest: { pulls: { get: pullsGet } } }) as unknown as Octokit;

const CONFIG = { owner: 'wix', repo: 'skills', prNumber: 42 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkPrAuthor', () => {
  it('allows a @wix.com author', async () => {
    getFirstCommitAuthorEmail.mockResolvedValue('someone@wix.com');
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');

    expect(await checkPrAuthor(octokitWith(vi.fn()), CONFIG)).toEqual({ allowed: true });
  });

  it('denies a non-Wix author as routine, not unexpected', async () => {
    getFirstCommitAuthorEmail.mockResolvedValue('outsider@gmail.com');
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');

    expect(await checkPrAuthor(octokitWith(vi.fn()), CONFIG)).toEqual({
      allowed: false,
      reason: 'the PR author is not a wix author',
      isUnexpected: false,
    });
  });

  // A missing return here would open the gate rather than close it, which is why the result is a
  // discriminated union rather than an optional value.
  it('denies and flags as unexpected when the lookup throws', async () => {
    getFirstCommitAuthorEmail.mockRejectedValue(new Error('Bad credentials'));
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');
    const result = await checkPrAuthor(octokitWith(vi.fn()), CONFIG);

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.isUnexpected).toBe(true);
    expect(result.reason).toContain('Bad credentials');
  });
});

describe('isDraftTagActive', () => {
  it('reports an open PR as holding its lock', async () => {
    const pullsGet = vi.fn().mockResolvedValue({ data: { state: 'open' } });
    const { isDraftTagActive } = await import('../src/utils/pr-lookups');

    expect(await isDraftTagActive(octokitWith(pullsGet), 'draft:wix/skills#7')).toBe(true);
    expect(pullsGet).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', pull_number: 7 });
  });

  /**
   * The branch that frees an abandoned PR's lock. Always answering `true` here is a silent
   * deadlock: every later PR touching that scenario fails FOREIGN_DRAFT forever, with nothing
   * saying why. Replacing the comparison with `return true` used to leave the suite green.
   */
  it('releases the lock once the holding PR is closed', async () => {
    const pullsGet = vi.fn().mockResolvedValue({ data: { state: 'closed' } });
    const { isDraftTagActive } = await import('../src/utils/pr-lookups');

    expect(await isDraftTagActive(octokitWith(pullsGet), 'draft:wix/skills#7')).toBe(false);
  });

  it('keeps the lock when the lookup fails, and says so', async () => {
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const pullsGet = vi.fn().mockRejectedValue(new Error('Not Found'));
    const { isDraftTagActive } = await import('../src/utils/pr-lookups');

    expect(await isDraftTagActive(octokitWith(pullsGet), 'draft:wix/skills#7')).toBe(true);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('draft:wix/skills#7'));
  });

  it('keeps the lock for a tag it cannot parse, without calling GitHub', async () => {
    const pullsGet = vi.fn();
    const { isDraftTagActive } = await import('../src/utils/pr-lookups');

    expect(await isDraftTagActive(octokitWith(pullsGet), 'dashboard-page')).toBe(true);
    expect(pullsGet).not.toHaveBeenCalled();
  });

  it('keeps the lock for a draft tag whose repo has no owner/name split', async () => {
    const pullsGet = vi.fn();
    const { isDraftTagActive } = await import('../src/utils/pr-lookups');

    expect(await isDraftTagActive(octokitWith(pullsGet), 'draft:skills#7')).toBe(true);
    expect(pullsGet).not.toHaveBeenCalled();
  });
});
