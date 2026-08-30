export type MergedBy = { name: string; url: string };

/** The slice of Octokit this module needs — declared structurally so tests need no client. */
export type PullRequestLookupClient = {
  rest: {
    repos: {
      listPullRequestsAssociatedWithCommit(params: {
        owner: string;
        repo: string;
        commit_sha: string;
      }): Promise<{ data: Array<{ html_url: string; user: { login: string } | null }> }>;
    };
  };
};

/**
 * Attributes a merge commit to a PR author, for the merge-tag sweep's Slack notification.
 * Works across both squash and rebase merges (a squash-commit-message regex would not) since
 * it asks GitHub directly which PR(s) a commit belongs to, rather than parsing commit text.
 * Falls back to the caller-supplied commit author when no PR is associated (e.g. a direct
 * push bypassing PR flow) or the associated PR's account no longer exists.
 */
export async function resolveMergedBy(
  octokit: PullRequestLookupClient,
  owner: string,
  repo: string,
  commitSha: string,
  fallback: MergedBy,
): Promise<MergedBy> {
  const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner, repo, commit_sha: commitSha,
  });
  const pr = data[0];
  if (!pr || !pr.user) return fallback;
  return { name: pr.user.login, url: pr.html_url };
}
