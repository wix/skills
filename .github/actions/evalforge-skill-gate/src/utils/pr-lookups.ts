import * as core from '@actions/core';
import * as github from '@actions/github';
import { getFirstCommitAuthorEmail, isWixAuthorEmail, parseDraftTag } from '@wix/evalforge-core';
import { describeError } from './report';
import type { GateConfig } from './config';

// Both lookups swallow their errors and return the safe answer. A GitHub blip must not fail a
// PR's check — least of all during the soak period, when the gate promises it cannot.

/** False when the author is not a Wix address *or* cannot be resolved: either way, do not run. */
export async function isWixAuthoredPr(
  octokit: ReturnType<typeof github.getOctokit>,
  config: Pick<GateConfig, 'owner' | 'repo' | 'prNumber'>,
): Promise<boolean> {
  try {
    const email = await getFirstCommitAuthorEmail(octokit, config.owner, config.repo, config.prNumber);
    if (isWixAuthorEmail(email)) return true;
    core.info('Skipping wix-app eval gate — PR author is not a @wix.com address');
    return false;
  } catch (error) {
    core.warning(`Skipping wix-app eval gate — could not resolve the PR author: ${describeError(error)}`);
    return false;
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
