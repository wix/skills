/**
 * Who may spend eval budget with `/re-eval`.
 *
 * This is a spend gate, not a security boundary: the dispatcher checks out nothing, and the run it
 * triggers replays an event that already happened against content the gate already evaluated. But
 * `wix/skills` is public, so without a check any GitHub account could pay for a live agent build
 * per scenario.
 */
export type RequesterCheck =
  | { allowed: true; via: 'author' | 'collaborator' }
  | { allowed: false; reason: string };

/**
 * The slice of Octokit this module needs. Declared structurally so the package takes no dependency
 * on `@actions/github` — a real Octokit satisfies it.
 */
export type CollaboratorPermissionClient = {
  rest: {
    repos: {
      getCollaboratorPermissionLevel: (params: {
        owner: string;
        repo: string;
        username: string;
      }) => Promise<{ data: { permission?: string } }>;
    };
  };
};

/**
 * Allow-list rather than a deny-list: `triage` and anything GitHub adds later must not be read as
 * approval just because it is not `read`.
 */
const ALLOWED_PERMISSIONS = ['admin', 'write'];

export async function checkReEvalRequester(
  octokit: CollaboratorPermissionClient,
  target: { owner: string; repo: string; requester: string; prAuthor: string },
): Promise<RequesterCheck> {
  // First, so the common case — "my run flaked, run it again" — costs no API call and cannot be
  // denied by a permissions problem on an endpoint that itself wants push access.
  if (target.requester === target.prAuthor) return { allowed: true, via: 'author' };

  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: target.owner,
      repo: target.repo,
      username: target.requester,
    });
    if (data.permission && ALLOWED_PERMISSIONS.includes(data.permission)) {
      return { allowed: true, via: 'collaborator' };
    }
    return {
      allowed: false,
      reason: 'only the PR author or a collaborator with write access can trigger `/re-eval`',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `the collaborator permission lookup failed (${detail}), so the request could not be authorised`,
    };
  }
}
