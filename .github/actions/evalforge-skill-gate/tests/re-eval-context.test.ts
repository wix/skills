import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PullsGetClient } from '../src/utils/re-eval-context';

const context = {
  repo: { owner: 'wix', repo: 'skills' },
  payload: {} as Record<string, unknown>,
};

vi.mock('@actions/github', () => ({ context, getOctokit: vi.fn() }));

const PULL = {
  head: { sha: 'abc1234', repo: { full_name: 'wix/skills' } },
  user: { login: 'author' },
  state: 'open',
  draft: false,
};

const octokitWith = (pull: unknown): PullsGetClient =>
  ({ rest: { pulls: { get: vi.fn().mockResolvedValue({ data: pull }) } } }) as unknown as PullsGetClient;

beforeEach(() => {
  vi.resetModules();
  context.payload = {
    issue: { number: 42, pull_request: { url: 'https://api.github.com/repos/wix/skills/pulls/42' } },
    comment: { body: '/re-eval', user: { login: 'someone' } },
  };
});

describe('resolveCommentPrContext', () => {
  it('maps the PR and the comment into one context', async () => {
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');

    expect(await resolveCommentPrContext(octokitWith(PULL))).toEqual({
      prNumber: 42,
      headSha: 'abc1234',
      prAuthor: 'author',
      requester: 'someone',
      commentBody: '/re-eval',
      state: 'open',
      isDraft: false,
      isSameRepo: true,
    });
  });

  it('asks GitHub for the PR the comment was posted on', async () => {
    const pullsGet = vi.fn().mockResolvedValue({ data: PULL });
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');

    await resolveCommentPrContext({ rest: { pulls: { get: pullsGet } } } as unknown as PullsGetClient);

    expect(pullsGet).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', pull_number: 42 });
  });

  it('reports a fork head as not same-repo', async () => {
    const forked = { ...PULL, head: { ...PULL.head, repo: { full_name: 'someone/skills' } } };
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');

    expect((await resolveCommentPrContext(octokitWith(forked))).isSameRepo).toBe(false);
  });

  // A deleted fork leaves `head.repo` null, which must not read as same-repo.
  it('reports a missing head repo as not same-repo', async () => {
    const orphaned = { ...PULL, head: { sha: 'abc1234', repo: null } };
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');

    expect((await resolveCommentPrContext(octokitWith(orphaned))).isSameRepo).toBe(false);
  });

  it('reports a closed draft PR as both', async () => {
    const closedDraft = { ...PULL, state: 'closed', draft: true };
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');
    const result = await resolveCommentPrContext(octokitWith(closedDraft));

    expect(result.state).toBe('closed');
    expect(result.isDraft).toBe(true);
  });

  it('treats a merged PR as closed', async () => {
    const merged = { ...PULL, state: 'merged' };
    const { resolveCommentPrContext } = await import('../src/utils/re-eval-context');

    expect((await resolveCommentPrContext(octokitWith(merged))).state).toBe('closed');
  });
});
