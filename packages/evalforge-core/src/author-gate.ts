/**
 * `author_association` values GitHub reports for someone who belongs to the repo's
 * organization, or who has been granted access to the repo directly.
 *
 * GitHub computes this server-side from the PR author's identity, so it is the only
 * signal here that the author cannot set themselves. It also needs no extra token
 * scope — reading org membership directly (`orgs.checkMembershipForUser`) would need
 * `members: read`, which the default `GITHUB_TOKEN` does not carry, and would 404 for
 * anyone whose membership is private.
 *
 * `COLLABORATOR` means push access granted on this repo specifically. That is a
 * deliberate grant rather than an org identity, so it is accepted on the same footing
 * as membership; drop it from this set if the gate should be org-only.
 */
const ORG_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * The slice of Octokit this module needs. Declared structurally so the package takes
 * no dependency on `@actions/github` — a real Octokit satisfies it.
 */
export type PullAuthorClient = {
  rest: {
    pulls: {
      get: (params: {
        owner: string;
        repo: string;
        pull_number: number;
      }) => Promise<{ data: { author_association?: string | null } }>;
    };
  };
};

/**
 * The shape of the webhook payload this module reads, for the same reason.
 *
 * `author_association` is `unknown` because `@actions/github` types the payload's
 * `pull_request` as an open bag of `any`. Narrowing it here would be a claim about
 * data this module does not control, so `readAuthorAssociation` checks it at runtime
 * instead.
 */
export type AuthorAssociationPayload = {
  pull_request?: { author_association?: unknown; [key: string]: unknown } | null;
};

/**
 * True when the PR author belongs to the organization that owns the repo, or has
 * direct access to it.
 */
export function isWixOrgAuthor(association: string | undefined | null): boolean {
  return typeof association === 'string' && ORG_ASSOCIATIONS.has(association.trim().toUpperCase());
}

/**
 * The association carried on a `pull_request` webhook payload, if there is one.
 *
 * Shared by both actions so neither has to reach into the payload itself. Every
 * author-gated mode runs on a `pull_request` event, and a workflow re-run replays
 * the original payload, so in practice this is always populated — but a payload
 * from any other event has no `pull_request` at all, hence `undefined` rather than
 * a throw, and hence `getPullAuthorAssociation` as the fallback.
 */
export function readAuthorAssociation(payload: AuthorAssociationPayload): string | undefined {
  const association = payload.pull_request?.author_association;
  return typeof association === 'string' ? association : undefined;
}

/** The same field, read from the API rather than the payload. */
export async function getPullAuthorAssociation(
  octokit: PullAuthorClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string | undefined> {
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  return data.author_association ?? undefined;
}

export type AuthorGateResult = {
  authorized: boolean;
  /** Where the deciding association came from, for logging. */
  via: 'payload' | 'api' | 'none';
  association?: string;
};

/**
 * Resolve whether a PR author is a Wix author, from organization membership alone.
 *
 * A commit author email is deliberately **not** consulted. `user.email` is whatever
 * the author typed into `git config`: an unsigned commit can claim any `@wix.com`
 * address, so an email check would let any outside contributor past the gate. The
 * association cannot be self-asserted, which is the whole reason to prefer it.
 *
 * The payload value is authoritative when present, including when it *denies* the
 * author, so the API call happens only when the payload carried no association at
 * all — never to second-guess a refusal.
 */
export async function resolveWixAuthor(
  octokit: PullAuthorClient,
  owner: string,
  repo: string,
  prNumber: number,
  authorAssociation?: string | null,
): Promise<AuthorGateResult> {
  const fromPayload = authorAssociation ?? undefined;
  if (fromPayload !== undefined) {
    return { authorized: isWixOrgAuthor(fromPayload), via: 'payload', association: fromPayload };
  }
  const association = await getPullAuthorAssociation(octokit, owner, repo, prNumber);
  if (association === undefined) return { authorized: false, via: 'none' };
  return { authorized: isWixOrgAuthor(association), via: 'api', association };
}

export async function assertWixAuthor(
  octokit: PullAuthorClient,
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
        `and has no direct access to this repository (author_association: ` +
        `${result.association ?? 'unknown'}). This gate is restricted to Wix authors.`,
    );
  }
  log?.(`Author gate passed — PR author association: ${result.association} (from the ${result.via})`);
}
