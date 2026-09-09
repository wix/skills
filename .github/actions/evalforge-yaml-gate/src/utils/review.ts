import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getFirstCommitAuthorEmail, isWixAuthorEmail } from '@wix/evalforge-core';
import { getReviewConfig, type ReviewConfig } from './config';
import {
  classifyChanges, fail, getChangedFiles, makeReviewCommenter, makeReviewPendingCommenter,
  type ChangedFile,
} from './github';
import { workspaceRoot } from './workspace';
import {
  formatReviewClean, formatReviewFindings, formatReviewPending, formatReviewServiceError,
  formatReviewSkipped,
  type ReviewFinding,
} from './review-comment';
import { runReviewAgent } from './review-agent';

/**
 * `synchronize` is absent because a push must not spend, but it still has to trigger the workflow:
 * a required check has to be reported on every head commit, and `/review` re-runs the head's own
 * run, so there has to be one. See evalforge-skill-review.yml.
 */
const FIRST_LOOK_EVENTS = ['opened', 'reopened', 'ready_for_review'];

/**
 * A re-run replays the original payload, so `action` alone cannot tell "someone asked again" from
 * the push that produced it. The attempt number can.
 */
function shouldReview(): boolean {
  const action = github.context.payload.action ?? '';
  if (FIRST_LOOK_EVENTS.includes(action)) return true;
  return Number(process.env.GITHUB_RUN_ATTEMPT ?? '1') > 1;
}

function inScope(files: ChangedFile[]): ChangedFile[] {
  const { mdFiles, evalsAdded, evalsModified } = classifyChanges(files);
  return [...mdFiles, ...evalsAdded, ...evalsModified];
}

function buildTask(config: ReviewConfig, files: ChangedFile[]): string {
  return [
    `Review pull request #${config.prNumber} in ${config.owner}/${config.repo}.`,
    `Head commit ${config.headSha}. Base commit ${config.baseSha}.`,
    'The repository is checked out at the merge result: the tree as it will be once this PR lands.',
    '',
    'Changed files in review scope:',
    ...files.map(file => `- ${file.filename} (${file.status})`),
  ].join('\n');
}

/** A commit nobody could review is not a reviewed commit, so this fails like a push does. */
async function reportUnavailable(
  reason: string,
  pending: { post: (body: string) => Promise<void> },
  isBlocking: boolean,
): Promise<void> {
  await pending.post(formatReviewServiceError(reason));
  fail(`The skill review did not complete: ${reason}`, isBlocking);
}

export async function runReview(): Promise<void> {
  const config = getReviewConfig();
  const octokit = github.getOctokit(config.githubToken);

  const comment = makeReviewCommenter(octokit, config.owner, config.repo, config.prNumber);
  const pending = makeReviewPendingCommenter(octokit, config.owner, config.repo, config.prNumber);

  let files: ChangedFile[];
  try {
    files = inScope(await getChangedFiles(octokit, config.owner, config.repo, config.prNumber));
  } catch (error) {
    await reportUnavailable(`the changed-file list could not be read (${String(error)})`, pending, config.isBlocking);
    return;
  }

  if (files.length === 0) {
    core.info('Skipping the skill review — no reviewed content changed in this PR.');
    await pending.clear();
    return;
  }

  // Not `assertWixAuthor`: it throws, which would turn a lookup blip into a red check.
  let authorEmail: string | undefined;
  try {
    authorEmail = await getFirstCommitAuthorEmail(octokit, config.owner, config.repo, config.prNumber);
  } catch (error) {
    await reportUnavailable(`the PR author could not be resolved (${String(error)})`, pending, config.isBlocking);
    return;
  }
  if (!isWixAuthorEmail(authorEmail)) {
    const reason = 'the PR author is not a wix author';
    core.info(`Skipping the skill review — ${reason}`);
    await comment(formatReviewSkipped(reason));
    await pending.clear();
    return;
  }

  // The verdict comment is left untouched: overwriting it would lose findings worth acting on.
  if (!shouldReview()) {
    core.info('The skill review is manual after the first look. Comment `/review` to review this commit.');
    await pending.post(formatReviewPending(config.headSha));
    fail(
      `Commit ${config.headSha.slice(0, 7)} has not been reviewed. Comment \`/review\` on the PR to review it.`,
      config.isBlocking,
    );
    return;
  }

  const workspace = workspaceRoot();
  const promptPath = join(workspace, config.promptPath);
  if (!existsSync(promptPath)) {
    await reportUnavailable(`the review prompt was not found at \`${config.promptPath}\``, pending, config.isBlocking);
    return;
  }

  core.info(`Reviewing ${files.length} file(s) at ${config.headSha.slice(0, 7)} with ${config.model} at ${config.effort} effort.`);

  const outcome = await runReviewAgent({
    cwd: workspace,
    promptPath,
    task: buildTask(config, files),
    apiKey: config.anthropicApiKey,
    baseUrl: config.anthropicBaseUrl,
    model: config.model,
    effort: config.effort,
    timeoutSeconds: config.timeoutSeconds,
  });

  if (!outcome.ok) {
    await reportUnavailable(outcome.reason, pending, config.isBlocking);
    return;
  }

  const summary = {
    headSha: config.headSha,
    filesReviewed: files.length,
    discarded: outcome.discarded,
  };

  const findings: ReviewFinding[] = outcome.findings;
  await comment(findings.length === 0
    ? formatReviewClean(summary)
    : formatReviewFindings(findings, summary));
  await pending.clear();

  const blocking = findings.filter(finding => finding.severity === 'blocking').length;
  const reasons: string[] = [];
  if (blocking > 0) reasons.push(`${blocking} blocking finding(s)`);
  if (outcome.discarded > 0) reasons.push(`${outcome.discarded} malformed finding(s)`);
  if (reasons.length > 0) {
    fail(`The skill review reported ${reasons.join(' and ')}. See the PR comment.`, config.isBlocking);
  }
}
