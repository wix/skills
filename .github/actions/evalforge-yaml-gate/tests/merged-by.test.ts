import { describe, it, expect, vi } from 'vitest';
import { resolveMergedBy } from '../src/utils/merged-by';

const FALLBACK = { name: 'jane-doe', url: 'https://github.com/wix/skills/commit/abc123' };

function octokitWith(data: Array<{ html_url: string; user: { login: string } | null }>) {
  return {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: vi.fn().mockResolvedValue({ data }),
      },
    },
  };
}

describe('resolveMergedBy', () => {
  it('returns the associated PR author and PR link when one is found', async () => {
    const octokit = octokitWith([
      { html_url: 'https://github.com/wix/skills/pull/1000', user: { login: 'alice' } },
    ]);
    const out = await resolveMergedBy(octokit, 'wix', 'skills', 'abc123', FALLBACK);
    expect(out).toEqual({ name: 'alice', url: 'https://github.com/wix/skills/pull/1000' });
    expect(octokit.rest.repos.listPullRequestsAssociatedWithCommit).toHaveBeenCalledWith({
      owner: 'wix', repo: 'skills', commit_sha: 'abc123',
    });
  });

  it('takes the first associated PR when more than one is returned', async () => {
    const octokit = octokitWith([
      { html_url: 'https://github.com/wix/skills/pull/1000', user: { login: 'alice' } },
      { html_url: 'https://github.com/wix/skills/pull/999', user: { login: 'bob' } },
    ]);
    const out = await resolveMergedBy(octokit, 'wix', 'skills', 'abc123', FALLBACK);
    expect(out.name).toBe('alice');
  });

  it('falls back to the commit author when no PR is associated', async () => {
    const octokit = octokitWith([]);
    const out = await resolveMergedBy(octokit, 'wix', 'skills', 'abc123', FALLBACK);
    expect(out).toEqual(FALLBACK);
  });

  it('falls back when the associated PR has no user (e.g. a deleted account)', async () => {
    const octokit = octokitWith([{ html_url: 'https://github.com/wix/skills/pull/1000', user: null }]);
    const out = await resolveMergedBy(octokit, 'wix', 'skills', 'abc123', FALLBACK);
    expect(out).toEqual(FALLBACK);
  });
});
