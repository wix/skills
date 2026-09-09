import { describe, it, expect } from 'vitest';
import {
  isWixAuthorEmail,
  isWixOrgAuthor,
  getFirstCommitAuthorEmail,
  resolveWixAuthor,
  assertWixAuthor,
} from '../src/author-gate';

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

describe('isWixOrgAuthor', () => {
  it('accepts org members, owners and direct collaborators', () => {
    expect(isWixOrgAuthor('MEMBER')).toBe(true);
    expect(isWixOrgAuthor('OWNER')).toBe(true);
    expect(isWixOrgAuthor('COLLABORATOR')).toBe(true);
    expect(isWixOrgAuthor('  member  ')).toBe(true);
  });

  it('rejects outside authors and missing associations', () => {
    expect(isWixOrgAuthor('CONTRIBUTOR')).toBe(false);
    expect(isWixOrgAuthor('FIRST_TIME_CONTRIBUTOR')).toBe(false);
    expect(isWixOrgAuthor('NONE')).toBe(false);
    expect(isWixOrgAuthor('')).toBe(false);
    expect(isWixOrgAuthor(undefined)).toBe(false);
    expect(isWixOrgAuthor(null)).toBe(false);
  });
});

describe('resolveWixAuthor', () => {
  it('clears an org member without reading the commits', async () => {
    let called = false;
    const octokit = {
      rest: { pulls: { listCommits: async () => { called = true; return { data: [] }; } } },
    } as unknown as Parameters<typeof getFirstCommitAuthorEmail>[0];
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, 'MEMBER');
    expect(r).toMatchObject({ authorized: true, via: 'org' });
    expect(called).toBe(false);
  });

  it('falls back to the commit email when the association does not clear the author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'dev@wix.com' } } }]);
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, 'CONTRIBUTOR');
    expect(r).toMatchObject({ authorized: true, via: 'email', email: 'dev@wix.com' });
  });

  it('falls back to the commit email when the payload carries no association', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'dev@wix.com' } } }]);
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, undefined);
    expect(r).toMatchObject({ authorized: true, via: 'email' });
  });

  it('refuses an outside author with a non-wix commit email', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'outsider@gmail.com' } } }]);
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, 'CONTRIBUTOR');
    expect(r).toMatchObject({ authorized: false, via: 'none' });
  });
});

describe('assertWixAuthor', () => {
  it('resolves for an org member', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'noreply@users.noreply.github.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1, undefined, 'MEMBER')).resolves.toBeUndefined();
  });

  it('resolves when the first commit is a @wix.com author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'dev@wix.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).resolves.toBeUndefined();
  });

  it('throws when the author is neither an org member nor a @wix.com author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'outsider@gmail.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1, undefined, 'CONTRIBUTOR')).rejects.toThrow(
      /not a member of the wix organization/,
    );
  });

  it('throws when the first commit is not a @wix.com author', async () => {
    const octokit = fakeOctokit([{ commit: { author: { email: 'outsider@gmail.com' } } }]);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).rejects.toThrow(/not a @wix\.com address/);
  });

  it('throws when the PR has no commits', async () => {
    await expect(assertWixAuthor(fakeOctokit([]), 'wix', 'skills', 1)).rejects.toThrow(/author gate failed/i);
  });
});
