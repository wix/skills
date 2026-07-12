import * as core from '@actions/core';
import * as github from '@actions/github';

type Octokit = ReturnType<typeof github.getOctokit>;

const WIX_EMAIL_RE = /@wix\.com$/i;

export function isWixAuthorEmail(email: string | undefined | null): boolean {
  return typeof email === 'string' && WIX_EMAIL_RE.test(email.trim());
}

export async function getFirstCommitAuthorEmail(
  octokit: Octokit,
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
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const email = await getFirstCommitAuthorEmail(octokit, owner, repo, prNumber);
  if (!isWixAuthorEmail(email)) {
    throw new Error(
      `PR author gate failed: the PR's first-commit author email (${email ?? 'unknown'}) ` +
        `is not a @wix.com address. This gate is restricted to Wix authors.`,
    );
  }
  core.info(`Author gate passed — first-commit author email: ${email}`);
}
