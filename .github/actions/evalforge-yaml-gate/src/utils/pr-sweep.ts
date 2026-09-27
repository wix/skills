import * as core from '@actions/core';
import * as github from '@actions/github';
import { getPrSweepConfig } from './config';
import { fail, makeSweepCommenter, makeSweepPendingCommenter } from './github';
import { formatPrSweepPending } from './comment';
import { prVersionLabel, resolveSweepTags, sweep } from './merge-tag-sweep';
import { reportPrVerdict } from './sweep-report';
import { workspaceRoot } from './workspace';
import type { SweepVerdict } from './sweep-verdict';

/**
 * A push must not spend, but it still has to produce a run: a required check has to be reported on
 * every head commit, and `/sweep` re-runs the head's own run. A re-run replays the original payload,
 * so the event cannot tell "someone asked" from "a commit was pushed" — the attempt number can.
 */
export function shouldSweep(env: NodeJS.ProcessEnv): boolean {
  return Number(env.GITHUB_RUN_ATTEMPT ?? '1') > 1;
}

/**
 * The on-demand sweep of an open PR, modelled on the skill review. On the first attempt it spends
 * nothing: a PR the sweep does not cover passes silently; one it does cover is red only if
 * `required`, and gets a reminder comment only if `remind`. On a re-run it sweeps the tag-matched
 * scenarios against the PR's own MCP version and reports in a PR comment; that verdict is red only
 * if `blocking`.
 *
 * Anything that throws — a missing repo variable, a malformed payload — is red only when `required`
 * or `blocking` is on. With both off the check cannot block a merge, whatever goes wrong.
 */
export async function runPrSweep(): Promise<void> {
  // Read before anything that can throw, so a failure can be judged against them.
  const required = core.getInput('required') === 'true';
  const blocking = core.getInput('blocking') === 'true';
  try {
    await prSweep();
  } catch (e) {
    fail(`PR sweep could not run: ${e instanceof Error ? e.message : String(e)}`, required || blocking);
  }
}

async function prSweep(): Promise<void> {
  const config = getPrSweepConfig();
  const { pr } = config;
  const octokit = github.getOctokit(config.githubToken);
  const pending = makeSweepPendingCommenter(octokit, config.owner, config.repo, pr.number);

  if (!shouldSweep(process.env)) {
    // The workflow runs on every PR in the repo; one the sweep does not cover must look as if the
    // workflow did not exist. The clear removes a reminder an earlier commit of this PR earned.
    const scope = resolveSweepTags(config.changedFilesRaw, workspaceRoot(), `PR #${pr.number}`);
    if ('reason' in scope) {
      core.info(`PR sweep: ${scope.reason} — nothing to sweep`);
      await pending.clear();
      return;
    }
    core.info(`PR sweep: tags ${scope.tags.join(', ')} are unswept. Comment \`/sweep\` to sweep this commit.`);
    if (pr.remind) await pending.post(formatPrSweepPending(pr.headSha));
    fail(
      `Commit ${pr.headSha.slice(0, 7)} has not been swept. Comment \`/sweep\` on the PR to sweep it.`,
      pr.required,
    );
    return;
  }

  let verdict: SweepVerdict;
  try {
    verdict = await sweep(config);
  } catch (e) {
    verdict = {
      kind: 'infra-error',
      message: `Sweep failed before it could report a verdict: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const comment = makeSweepCommenter(octokit, config.owner, config.repo, pr.number);
  await reportPrVerdict(verdict, core, comment, { blocking: pr.blocking, versionLabel: prVersionLabel(pr) });
  // The verdict comment replaces the reminder and the `/sweep` acknowledgement.
  await pending.clear();
}
