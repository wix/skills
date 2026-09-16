/**
 * Whether a PR's author may spend an eval run.
 *
 * The question this asks is "did the author have push access to this repository",
 * answered by where the PR's head branch lives. Only someone with push access can
 * create a branch in the repo itself; everyone else must fork, and a fork's head
 * lives in their own namespace. The author cannot forge that — unlike a commit
 * author email, which is free text copied from `user.email`.
 *
 * **`author_association` does not work for this**, which is worth recording because it
 * looks like it should. That field is viewer-relative: GitHub computes the copy in an
 * Actions webhook payload without visibility into private org membership, so a member
 * whose membership is private is reported as `CONTRIBUTOR`. Measured on wix/skills, every
 * recent PR author reads `MEMBER` to an authenticated viewer and `CONTRIBUTOR` to the
 * payload, because none of them is a *public* org member. A gate on that field refuses
 * everybody.
 *
 * This check is the same one the workflows already apply at the job level
 * (`github.event.pull_request.head.repo.full_name == github.repository`), so the action
 * agrees with its own trigger rather than inventing a second notion of trust.
 */

/** The slice of the webhook payload this needs, declared structurally. */
export type PullRequestSourcePayload = {
  pull_request?: {
    head?: { repo?: { full_name?: unknown } | null } | null;
    [key: string]: unknown;
  } | null;
};

/**
 * The full name (`owner/repo`) of the repository holding the PR's head branch.
 *
 * `null` when GitHub reports no head repository. Per its payload schema `head.repo` is
 * `oneOf: [repository, null]`, and it goes null when the source fork has been deleted.
 * That is a real, reachable state rather than a malformed payload — and it is emphatically
 * not this repository, so it reads as a refusal rather than an error.
 */
export function readHeadRepoFullName(payload: PullRequestSourcePayload): string | null {
  const fullName = payload.pull_request?.head?.repo?.full_name;
  return typeof fullName === 'string' && fullName.trim() !== '' ? fullName : null;
}

/**
 * True when the PR's head branch lives in this repository, which means its author had
 * push access here.
 *
 * Compared case-insensitively: GitHub treats owner and repository names that way, and a
 * gate should not turn on the casing of a string it did not choose.
 */
export function isSameRepoBranch(
  headRepoFullName: string | null,
  owner: string,
  repo: string,
): boolean {
  if (headRepoFullName === null) return false;
  return headRepoFullName.trim().toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

export function assertSameRepoBranch(
  headRepoFullName: string | null,
  owner: string,
  repo: string,
  log?: (message: string) => void,
): void {
  if (!isSameRepoBranch(headRepoFullName, owner, repo)) {
    throw new Error(
      `PR author gate failed: this pull request's head branch is in ` +
        `${headRepoFullName ?? 'a repository that no longer exists'}, not ${owner}/${repo}. ` +
        `This gate is restricted to branches pushed to ${owner}/${repo}, which requires write access.`,
    );
  }
  log?.(`Author gate passed — head branch is in ${owner}/${repo}, so its author has write access.`);
}
