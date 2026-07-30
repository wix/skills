import * as github from '@actions/github';
import { getPrNumber } from '@wix/evalforge-core';

export type CommentPrContext = {
  prNumber: number;
  headSha: string;
  prAuthor: string;
  requester: string;
  commentBody: string;
  state: 'open' | 'closed';
  isDraft: boolean;
  isSameRepo: boolean;
};

/** Declared structurally, matching `pr-lookups.ts`, so tests can supply a typed partial. */
export type PullsGetClient = {
  rest: {
    pulls: {
      get: (params: { owner: string; repo: string; pull_number: number }) => Promise<{
        data: {
          head: { sha: string; repo?: { full_name?: string } | null };
          user?: { login?: string } | null;
          state: string;
          draft?: boolean;
        };
      }>;
    };
  };
};

/**
 * Everything the `/re-eval` dispatcher needs about a PR and the person asking.
 *
 * One `pulls.get` supplies state, draft and whether the head is a fork — which the automatic gate
 * gets from its workflow `if:`, and a comment trigger has no equivalent of.
 */
export async function resolveCommentPrContext(octokit: PullsGetClient): Promise<CommentPrContext> {
  const { owner, repo } = github.context.repo;
  const prNumber = getPrNumber(github.context.payload);
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

  const comment = github.context.payload.comment as
    { body?: string; user?: { login?: string } } | undefined;

  return {
    prNumber,
    headSha: data.head.sha,
    prAuthor: data.user?.login ?? '',
    requester: comment?.user?.login ?? '',
    commentBody: comment?.body ?? '',
    state: data.state === 'open' ? 'open' : 'closed',
    isDraft: data.draft === true,
    isSameRepo: data.head.repo?.full_name === `${owner}/${repo}`,
  };
}
