import * as core from '@actions/core';
import * as github from '@actions/github';
import { isWixOrgAuthor, parseDraftTag } from '@wix/evalforge-core';
import { describeError } from './report';
import type { GateConfig } from './config';

// isDraftTagActive swallows its errors and returns the safe answer. A GitHub blip must not
// fail a PR's check — least of all during the soak period, when the gate promises it cannot.

export type AuthorCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

const AUTHOR_ALLOWED: AuthorCheck = { allowed: true };

/**
 * Whether the gate may run for this PR's author.
 *
 * Synchronous and client-free: the association is already on the payload the workflow was
 * triggered by, so there is no lookup here to blip, and no "could not resolve" case.
 */
export function checkPrAuthor(
  config: Pick<GateConfig, 'authorAssociation'>,
): AuthorCheck {
  if (isWixOrgAuthor(config.authorAssociation)) return AUTHOR_ALLOWED;
  return { allowed: false, reason: 'the PR author is not a wix author' };
}

/** True when unresolvable, so a lookup failure never releases another PR's lock. */
export async function isDraftTagActive(
  octokit: ReturnType<typeof github.getOctokit>,
  tag: string,
): Promise<boolean> {
  const draft = parseDraftTag(tag);
  if (!draft) return true;
  const [owner, repo] = draft.repo.split('/', 2);
  if (!owner || !repo) return true;
  try {
    const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: draft.prNumber });
    return pull.data.state === 'open';
  } catch (error) {
    core.warning(`Could not resolve draft tag ${tag}: ${describeError(error)}`);
    return true;
  }
}
