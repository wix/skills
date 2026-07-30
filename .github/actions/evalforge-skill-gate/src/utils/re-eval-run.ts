import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  GateRunLookup, RE_EVAL_COMMENT_MARKER, checkReEvalRequester, findGateRun,
  formatReEvalRefusal, makeCommenter, parseReEvalCommand,
} from '@wix/evalforge-core';
import { getReEvalConfig } from './config';
import { resolveCommentPrContext, type CommentPrContext } from './re-eval-context';

/**
 * The `/re-eval` dispatcher.
 *
 * It evaluates nothing. It re-runs the PR's own gate run, so the existing check updates in place —
 * the only version of this feature that leaves the PR mergeable once the gate is a required check.
 * An `issue_comment` run is associated with the default branch's commit, while required checks are
 * evaluated on the PR head, so a second workflow would pass somewhere the PR cannot see.
 */
export async function runReEval(): Promise<void> {
  const config = getReEvalConfig();
  const octokit = github.getOctokit(config.githubToken);
  const context = await resolveCommentPrContext(octokit);

  if (!parseReEvalCommand(context.commentBody).isCommand) {
    core.info('Comment is not a /re-eval command — nothing to do.');
    return;
  }

  const refuse = async (reason: string): Promise<void> => {
    core.info(`Declining /re-eval from ${context.requester} on PR #${context.prNumber}: ${reason}`);
    // Its own marker: upserting through GATE_COMMENT_MARKER would overwrite the last real verdict,
    // and anyone who can comment on a public repo can reach this path.
    const comment = makeCommenter(
      octokit,
      { owner: config.owner, repo: config.repo, prNumber: context.prNumber, marker: RE_EVAL_COMMENT_MARKER },
      {
        warn: core.warning,
        writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
      },
    );
    await comment(formatReEvalRefusal(reason));
  };

  const ineligible = describeIneligibility(context);
  if (ineligible !== null) return refuse(ineligible);

  const requester = await checkReEvalRequester(octokit, {
    owner: config.owner,
    repo: config.repo,
    requester: context.requester,
    prAuthor: context.prAuthor,
  });
  if (!requester.allowed) return refuse(requester.reason);

  const run = await findGateRun(octokit, {
    owner: config.owner,
    repo: config.repo,
    workflowFile: config.gateWorkflowFile,
    headSha: context.headSha,
    now: new Date(),
  });

  switch (run.kind) {
    case GateRunLookup.NONE:
      return refuse(
        'no gate run exists for this commit — push a commit touching a gated path and the gate '
        + 'runs automatically',
      );
    case GateRunLookup.ACTIVE:
      return refuse(`a gate run is already in progress for this commit — see ${run.runUrl}`);
    case GateRunLookup.TOO_OLD:
      return refuse(
        `the gate run for this commit completed on ${run.completedAt.slice(0, 10)} and is past `
        + "GitHub's 30-day re-run window — push a commit to run the gate again",
      );
    case GateRunLookup.FOUND:
      await octokit.rest.actions.reRunWorkflow({
        owner: config.owner,
        repo: config.repo,
        run_id: run.runId,
      });
      core.info(
        `Re-running gate run ${run.runId} (${run.runUrl}) for PR #${context.prNumber}, `
        + `requested by ${context.requester} (allowed as ${requester.via}).`,
      );
      return;
  }
}

/**
 * The three PR states the automatic gate excludes in its workflow `if:`, which a comment trigger
 * has to check for itself.
 *
 * `null` means "no reason to refuse" — a genuine absence, not a "stop here" signal, so a plain
 * nullable is right here where a discriminated result would be ceremony. Checked before the
 * requester so an ineligible PR costs no permission lookup.
 */
function describeIneligibility(context: CommentPrContext): string | null {
  if (context.state === 'closed') {
    return 'this PR is closed — the gate only evaluates open PRs, and its capability version and '
      + 'draft tags were already swept on close';
  }
  if (context.isDraft) {
    return 'this PR is a draft — mark it ready for review and the gate runs automatically';
  }
  if (!context.isSameRepo) {
    return 'the branch lives in a fork — the gate only evaluates branches in this repository';
  }
  return null;
}
