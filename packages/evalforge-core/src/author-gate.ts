const WIX_EMAIL_RE = /@wix\.com$/i;

/**
 * The slice of Octokit this module needs. Declared structurally so the package
 * takes no dependency on `@actions/github` — a real Octokit satisfies it.
 */
export type PullCommitsClient = {
  rest: {
    pulls: {
      listCommits: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
      }) => Promise<{ data: Array<{ commit?: { author?: { email?: string | null } | null } | null }> }>;
    };
  };
};

export function isWixAuthorEmail(email: string | undefined | null): boolean {
  return typeof email === 'string' && WIX_EMAIL_RE.test(email.trim());
}

export async function getFirstCommitAuthorEmail(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string | undefined> {
  // listCommits returns the PR's commits oldest-first; we only need the first,
  // so ask for a single-item page rather than paginating the whole PR.
  const { data } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 1,
  });
  return data[0]?.commit?.author?.email ?? undefined;
}

export async function assertWixAuthor(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
  log?: (message: string) => void,
): Promise<void> {
  const email = await getFirstCommitAuthorEmail(octokit, owner, repo, prNumber);
  if (!isWixAuthorEmail(email)) {
    throw new Error(
      `PR author gate failed: the PR's first-commit author email (${email ?? 'unknown'}) ` +
        `is not a @wix.com address. This gate is restricted to Wix authors.`,
    );
  }
  log?.(`Author gate passed — first-commit author email: ${email}`);
}
