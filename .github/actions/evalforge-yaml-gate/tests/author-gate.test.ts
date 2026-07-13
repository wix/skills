import { describe, it, expect } from 'vitest';
import { isWixAuthorEmail, getFirstCommitAuthorEmail, assertWixAuthor } from '../src/utils/author-gate';

describe('isWixAuthorEmail', () => {
  it('accepts @wix.com addresses (case-insensitive)', () => {
    expect(isWixAuthorEmail('orgold@wix.com')).toBe(true);
    expect(isWixAuthorEmail('Some.Person@Wix.com')).toBe(true);
    expect(isWixAuthorEmail('  dev@wix.com  ')).toBe(true);
  });

  it('rejects non-wix, spoofed, bot, and empty addresses', () => {
    expect(isWixAuthorEmail('attacker@gmail.com')).toBe(false);
    expect(isWixAuthorEmail('evil@wix.com.attacker.io')).toBe(false);
    expect(isWixAuthorEmail('wix.com@gmail.com')).toBe(false);
    expect(isWixAuthorEmail('123+bot@users.noreply.github.com')).toBe(false);
    expect(isWixAuthorEmail('')).toBe(false);
    expect(isWixAuthorEmail(undefined)).toBe(false);
    expect(isWixAuthorEmail(null)).toBe(false);
  });
});

type CommitStub = { commit: { author: { email: string } | null } };

function fakeOctokit(commits: CommitStub[]) {
  return {
    rest: { pulls: { listCommits: async () => ({ data: commits }) } },
  } as unknown as Parameters<typeof getFirstCommitAuthorEmail>[0];
}

describe('getFirstCommitAuthorEmail', () => {
  it('returns the first (oldest) commit author email', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'first@wix.com' } } }]);
    expect(await getFirstCommitAuthorEmail(octokit, 'wix', 'skills', 1)).toBe('first@wix.com');
  });

  it('returns undefined when there are no commits', async () => {
    expect(await getFirstCommitAuthorEmail(fakeOctokit([]), 'wix', 'skills', 1)).toBeUndefined();
  });
});

describe('assertWixAuthor', () => {
  it('resolves when the first commit is a @wix.com author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'dev@wix.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).resolves.toBeUndefined();
  });

  it('throws when the first commit is not a @wix.com author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'outsider@gmail.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).rejects.toThrow(/not a @wix\.com address/);
  });

  it('throws when the PR has no commits', async () => {
    await expect(assertWixAuthor(fakeOctokit([]), 'wix', 'skills', 1)).rejects.toThrow(/author gate failed/i);
  });
});
