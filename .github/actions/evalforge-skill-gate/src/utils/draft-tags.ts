import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseDraftTag } from '@wix/evalforge-core';
import { describeError } from './report';

/** Unresolvable tags count as active, so a lookup failure never releases another PR's lock. */
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
