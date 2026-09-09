const WIX_EMAIL_RE = /@wix\.com$/i;

/**
 * `author_association` values GitHub reports for someone who belongs to the repo's
 * organization, or who has been granted access to the repo directly.
 *
 * This is the primary signal: GitHub computes it server-side from the PR author's
 * identity, so unlike a commit author email it cannot be set by whoever wrote the
 * commit. It also costs no API call and needs no extra token scope — reading org
 * membership directly (`orgs.checkMembershipForUser`) would need `members: read`,
 * which the default `GITHUB_TOKEN` does not carry, and would 404 for anyone whose
 * membership is private.
 */
const ORG_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** listCommits caps at 100 per page; PR branches here are far shorter than that. */
const COMMITS_PER_PAGE = 100;

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
        page?: number;
      }) => Promise<{ data: Array<{ commit?: { author?: { email?: string | null } | null } | null }> }>;
    };
  };
};

export function isWixAuthorEmail(email: string | undefined | null): boolean {
  return typeof email === 'string' && WIX_EMAIL_RE.test(email.trim());
}

/**
 * True when the PR author belongs to the organization that owns the repo, or has
 * direct access to it, per `author_association` on the pull_request payload.
 */
export function isWixOrgAuthor(association: string | undefined | null): boolean {
  return typeof association === 'string' && ORG_ASSOCIATIONS.has(association.trim().toUpperCase());
}

async function listCommitsPage(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
  page: number,
  perPage: number,
) {
  const { data } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
    per_page: perPage,
    page,
  });
  return data;
}

export async function getFirstCommitAuthorEmail(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string | undefined> {
  // listCommits returns the PR's commits oldest-first; we only need the first,
  // so ask for a single-item page rather than paginating the whole PR.
  const data = await listCommitsPage(octokit, owner, repo, prNumber, 1, 1);
  return data[0]?.commit?.author?.email ?? undefined;
}

/**
 * The author email of the PR's **latest** commit — the current committer.
 *
 * This is what the gate should judge: the head commit is the content an eval run
 * actually spends on. The first commit is both less relevant and weaker evidence,
 * since anyone can open a PR whose opening commit was cherry-picked from someone
 * else and then push their own work on top.
 */
export async function getHeadCommitAuthorEmail(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string | undefined> {
  let page = 1;
  let last: Awaited<ReturnType<typeof listCommitsPage>> = [];
  // Walk forward until a short page proves it was the last one. The PR commits API
  // returns them oldest-first and has no "give me the newest" option.
  for (;;) {
    const data = await listCommitsPage(octokit, owner, repo, prNumber, page, COMMITS_PER_PAGE);
    if (data.length > 0) last = data;
    if (data.length < COMMITS_PER_PAGE) break;
    page += 1;
  }
  return last[last.length - 1]?.commit?.author?.email ?? undefined;
}

export type AuthorGateResult = {
  authorized: boolean;
  /** Which signal cleared the author, for logging. */
  via: 'org' | 'email' | 'none';
  association?: string;
  email?: string;
};

/**
 * Resolve whether a PR author is a Wix author: organization membership first,
 * falling back to the current committer's email.
 *
 * The email fallback is kept so the gate still clears authors on payloads that
 * carry no `author_association` — a replayed or manually dispatched run — rather
 * than turning a missing field into a refusal.
 */
export async function resolveWixAuthor(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
  authorAssociation?: string | null,
): Promise<AuthorGateResult> {
  const association = authorAssociation ?? undefined;
  if (isWixOrgAuthor(association)) {
    return { authorized: true, via: 'org', association };
  }
  const email = await getHeadCommitAuthorEmail(octokit, owner, repo, prNumber);
  if (isWixAuthorEmail(email)) {
    return { authorized: true, via: 'email', association, email };
  }
  return { authorized: false, via: 'none', association, email };
}

export async function assertWixAuthor(
  octokit: PullCommitsClient,
  owner: string,
  repo: string,
  prNumber: number,
  log?: (message: string) => void,
  authorAssociation?: string | null,
): Promise<void> {
  const result = await resolveWixAuthor(octokit, owner, repo, prNumber, authorAssociation);
  if (!result.authorized) {
    throw new Error(
      `PR author gate failed: the PR author is not a member of the ${owner} organization ` +
        `(author_association: ${result.association ?? 'unknown'}), and the latest commit's ` +
        `author email (${result.email ?? 'unknown'}) is not a @wix.com address. ` +
        `This gate is restricted to Wix authors.`,
    );
  }
  log?.(
    result.via === 'org'
      ? `Author gate passed — PR author association: ${result.association}`
      : `Author gate passed — latest commit author email: ${result.email}`,
  );
}
