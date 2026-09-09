/**
 * The values GitHub documents for `author_association`.
 *
 * Written out rather than imported: `@actions/github` types the payload's `pull_request`
 * as an open bag of `any` with no `author_association` on it, and `@octokit/webhooks-types`
 * — which does declare this union — is in none of these projects' dependency trees. Adding
 * it would mean a new entry in four separate lockfiles, each behind the 14-day cooldown, to
 * type eight string literals.
 *
 * Its only job is to catch a typo in `ORG_ASSOCIATIONS` below. Values arriving at runtime are
 * deliberately **not** narrowed to it: GitHub can add a value, and an unrecognised one should
 * read as "not a member" rather than crash the gate.
 */
export type AuthorAssociation =
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'MANNEQUIN'
  | 'MEMBER'
  | 'NONE'
  | 'OWNER';

/**
 * Raised when the payload carries no usable association. Typed so a caller that skips rather
 * than fails can recognise it, and let every other config error keep failing the check.
 */
export class AuthorAssociationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorAssociationError';
  }
}

/**
 * `author_association` values GitHub reports for someone who belongs to the
 * organization that owns the repo.
 *
 * GitHub computes this server-side from the account that opened the pull request, so
 * it is the only signal about the author that the author cannot set. A commit's author
 * email is free text copied from `user.email`, which is why none is consulted here.
 *
 * `COLLABORATOR` is deliberately **not** here. It means push access on this repo,
 * which an outside collaborator can hold without being in the organization — so
 * accepting it would gate on repo permissions rather than on org membership. Push
 * access is not the question this gate asks.
 */
const ORG_ASSOCIATIONS: ReadonlySet<string> = new Set<AuthorAssociation>(['OWNER', 'MEMBER']);

/**
 * The shape of the webhook payload this module reads. Declared structurally so the
 * package takes no dependency on `@actions/github`.
 *
 * `author_association` is `unknown` because `@actions/github` types the payload's
 * `pull_request` as an open bag of `any`. Narrowing it here would be a claim about
 * data this module does not control, so it is checked at runtime instead.
 */
export type AuthorAssociationPayload = {
  pull_request?: { author_association?: unknown; [key: string]: unknown } | null;
};

/**
 * The PR author's association, from a `pull_request` webhook payload.
 *
 * Throws rather than returning `undefined`, for the same reason `getPrNumber` does:
 * every gated mode is triggered by a `pull_request` event, and GitHub always puts
 * `author_association` on that payload's PR object. An absent one means the action was
 * wired to the wrong trigger or the payload is malformed — and a security gate that
 * cannot identify the author must fail loudly, not quietly pick a branch.
 */
export function requireAuthorAssociation(payload: AuthorAssociationPayload): string {
  const pr = payload.pull_request;
  if (!pr) {
    throw new AuthorAssociationError(
      'No pull_request payload — action must be triggered by a pull_request event',
    );
  }
  const association = pr.author_association;
  if (typeof association !== 'string' || association.trim() === '') {
    throw new AuthorAssociationError('PR payload missing author_association');
  }
  return association;
}

/** True when the PR author belongs to the organization that owns the repo. */
export function isWixOrgAuthor(association: string | undefined | null): boolean {
  return typeof association === 'string' && ORG_ASSOCIATIONS.has(association.trim().toUpperCase());
}

/**
 * Throw unless the PR author is a member of the organization that owns the repo.
 *
 * Takes the association rather than a client: the value is already on the payload
 * every gated mode receives, so deciding costs no API call, no token scope, and
 * nothing that can fail in transit.
 */
export function assertWixAuthor(
  association: string,
  owner: string,
  log?: (message: string) => void,
): void {
  if (!isWixOrgAuthor(association)) {
    throw new Error(
      `PR author gate failed: the PR author is not a member of the ${owner} organization ` +
        `(author_association: ${association}). This gate is restricted to Wix authors.`,
    );
  }
  log?.(`Author gate passed — PR author association: ${association}`);
}
