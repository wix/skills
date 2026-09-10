import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as github from '@actions/github';

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
  it('allows a branch pushed to this repository', async () => {
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');
    expect(checkPrAuthor({ owner: 'wix', repo: 'skills', headRepoFullName: 'wix/skills' })).toEqual({ allowed: true });
  });

  it('denies a fork, with the reason the gate comments on the PR', async () => {
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');
    expect(checkPrAuthor({ owner: 'wix', repo: 'skills', headRepoFullName: 'outsider/skills' })).toEqual({
      allowed: false,
      reason: 'the PR branch is not in this repository, so its author has no write access',
    });
  });

  // A missing return here would open the gate rather than close it, which is why the result is a
  // discriminated union rather than an optional value.
  it('denies a PR whose head repository has been deleted', async () => {
    const { checkPrAuthor } = await import('../src/utils/pr-lookups');
    expect(checkPrAuthor({ owner: 'wix', repo: 'skills', headRepoFullName: null }).allowed).toBe(false);
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
