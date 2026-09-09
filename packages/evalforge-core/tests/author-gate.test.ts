import { describe, it, expect } from 'vitest';
import {
  isWixOrgAuthor,
  readAuthorAssociation,
  getPullAuthorAssociation,
  resolveWixAuthor,
  assertWixAuthor,
  type PullAuthorClient,
} from '../src/author-gate';

/** Records whether the API was consulted, which is half of what these tests assert. */
function fakeOctokit(association?: string | null) {
  const calls: number[] = [];
  const octokit = {
    rest: {
      pulls: {
        get: async ({ pull_number }: { pull_number: number }) => {
          calls.push(pull_number);
          return { data: { author_association: association } };
        },
      },
    },
  } satisfies PullAuthorClient;
  return { octokit, calls };
}

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

describe('readAuthorAssociation', () => {
  it('reads the association off a pull_request payload', () => {
    expect(readAuthorAssociation({ pull_request: { author_association: 'MEMBER' } })).toBe('MEMBER');
  });

  it('returns undefined for a payload from any other event', () => {
    expect(readAuthorAssociation({})).toBeUndefined();
    expect(readAuthorAssociation({ pull_request: null })).toBeUndefined();
    expect(readAuthorAssociation({ pull_request: { number: 7 } })).toBeUndefined();
  });

  it('ignores a non-string association rather than passing it on', () => {
    expect(readAuthorAssociation({ pull_request: { author_association: 42 } })).toBeUndefined();
    expect(readAuthorAssociation({ pull_request: { author_association: null } })).toBeUndefined();
  });
});

describe('getPullAuthorAssociation', () => {
  it('returns the association the API reports', async () => {
    const { octokit, calls } = fakeOctokit('OWNER');
    expect(await getPullAuthorAssociation(octokit, 'wix', 'skills', 9)).toBe('OWNER');
    expect(calls).toEqual([9]);
  });

  it('returns undefined when the API omits it', async () => {
    const { octokit } = fakeOctokit(null);
    expect(await getPullAuthorAssociation(octokit, 'wix', 'skills', 9)).toBeUndefined();
  });
});

describe('resolveWixAuthor', () => {
  it('clears an org member from the payload alone, with no API call', async () => {
    const { octokit, calls } = fakeOctokit('NONE');
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, 'MEMBER');
    expect(r).toEqual({ authorized: true, via: 'payload', association: 'MEMBER' });
    expect(calls).toEqual([]);
  });

  // The payload value is GitHub's own answer, so a refusal is final: re-asking would
  // only give the API a chance to contradict an authoritative "no".
  it('refuses an outside author from the payload alone, with no API call', async () => {
    const { octokit, calls } = fakeOctokit('MEMBER');
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, 'CONTRIBUTOR');
    expect(r).toEqual({ authorized: false, via: 'payload', association: 'CONTRIBUTOR' });
    expect(calls).toEqual([]);
  });

  it('falls back to the API only when the payload carries no association', async () => {
    const { octokit, calls } = fakeOctokit('MEMBER');
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 3, undefined);
    expect(r).toEqual({ authorized: true, via: 'api', association: 'MEMBER' });
    expect(calls).toEqual([3]);
  });

  it('refuses an outside author reported by the API', async () => {
    const { octokit } = fakeOctokit('FIRST_TIME_CONTRIBUTOR');
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, undefined);
    expect(r).toEqual({ authorized: false, via: 'api', association: 'FIRST_TIME_CONTRIBUTOR' });
  });

  it('refuses when neither the payload nor the API reports an association', async () => {
    const { octokit } = fakeOctokit(null);
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, undefined);
    expect(r).toEqual({ authorized: false, via: 'none' });
  });

  it('propagates an API failure instead of silently refusing', async () => {
    const octokit = {
      rest: { pulls: { get: async () => { throw new Error('502'); } } },
    } satisfies PullAuthorClient;
    await expect(resolveWixAuthor(octokit, 'wix', 'skills', 1, undefined)).rejects.toThrow('502');
  });

  /**
   * The whole point of judging the association: a commit author email is whatever the
   * author typed into `git config`, so an unsigned commit can claim any address. No
   * commit data reaches this decision, so there is nothing to spoof.
   */
  it('cannot be cleared by a commit claiming a wix address', async () => {
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { author_association: 'NONE' } }),
          // Present but unused: an attacker's self-asserted email must not matter.
          listCommits: async () => ({ data: [{ commit: { author: { email: 'ceo@wix.com' } } }] }),
        },
      },
    };
    const r = await resolveWixAuthor(octokit, 'wix', 'skills', 1, undefined);
    expect(r.authorized).toBe(false);
  });
});

describe('assertWixAuthor', () => {
  it('resolves for an org member and logs where the association came from', async () => {
    const { octokit } = fakeOctokit(null);
    const lines: string[] = [];
    await expect(
      assertWixAuthor(octokit, 'wix', 'skills', 1, m => lines.push(m), 'MEMBER'),
    ).resolves.toBeUndefined();
    expect(lines).toEqual(['Author gate passed — PR author association: MEMBER (from the payload)']);
  });

  it('resolves for a member the API reports when the payload has none', async () => {
    const { octokit } = fakeOctokit('OWNER');
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).resolves.toBeUndefined();
  });

  it('throws for an outside author, naming the association and the org', async () => {
    const { octokit } = fakeOctokit(null);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1, undefined, 'CONTRIBUTOR')).rejects.toThrow(
      /not a member of the wix organization.*author_association: CONTRIBUTOR/s,
    );
  });

  it('throws when no association can be determined at all', async () => {
    const { octokit } = fakeOctokit(null);
    await expect(assertWixAuthor(octokit, 'wix', 'skills', 1)).rejects.toThrow(
      /author_association: unknown/,
    );
  });
});
