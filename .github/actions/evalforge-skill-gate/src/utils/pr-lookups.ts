import * as core from '@actions/core';
import * as github from '@actions/github';
import { getFirstCommitAuthorEmail, isWixAuthorEmail, parseDraftTag } from '@wix/evalforge-core';
import { describeError } from './report';
import type { GateConfig } from './config';

// Both lookups swallow their errors and return the safe answer. A GitHub blip must not fail a
// PR's check — least of all during the soak period, when the gate promises it cannot.

/** `isUnexpected` separates a routine non-Wix author from a lookup that actually broke. */
export type AuthorCheck =
  | { allowed: true }
  | { allowed: false; reason: string; isUnexpected: boolean };

const AUTHOR_ALLOWED: AuthorCheck = { allowed: true };

/**
 * Whether the gate may run for this PR's author. Denies both when the author is not a Wix address
 * and when the lookup fails: either way the gate must not run, and neither is worth failing a check.
 */
export async function checkPrAuthor(
  octokit: ReturnType<typeof github.getOctokit>,
  config: Pick<GateConfig, 'owner' | 'repo' | 'prNumber'>,
): Promise<AuthorCheck> {
  try {
    const email = await getFirstCommitAuthorEmail(octokit, config.owner, config.repo, config.prNumber);
    if (isWixAuthorEmail(email)) return AUTHOR_ALLOWED;
    return { allowed: false, reason: 'the PR author is not a wix author', isUnexpected: false };
  } catch (error) {
    return {
      allowed: false,
      reason: `could not resolve the PR author: ${describeError(error)}`,
      isUnexpected: true,
    };
  }
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
