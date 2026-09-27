import * as core from '@actions/core';
import * as github from '@actions/github';
import { getPrSweepConfig } from './config';
import { fail, makeSweepCommenter, makeSweepPendingCommenter } from './github';
import { formatPrSweepPending } from './comment';
import { prVersionLabel, sweep } from './merge-tag-sweep';
import { reportPrVerdict } from './sweep-report';
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
 * The on-demand sweep of an open PR, modelled on the skill review. On the first attempt it only
 * reminds — red if `required`, green otherwise. On a re-run it sweeps the tag-matched scenarios
 * against the PR's own MCP version and reports in a PR comment; that verdict goes red only if
 * `blocking`.
 */
export async function runPrSweep(): Promise<void> {
  const config = getPrSweepConfig();
  const { pr } = config;
  const octokit = github.getOctokit(config.githubToken);
  const pending = makeSweepPendingCommenter(octokit, config.owner, config.repo, pr.number);

  if (!shouldSweep(process.env)) {
    core.info('The PR sweep runs on request. Comment `/sweep` to sweep this commit.');
    await pending.post(formatPrSweepPending(pr.headSha));
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
