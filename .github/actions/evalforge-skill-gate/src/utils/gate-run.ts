import * as core from '@actions/core';
import * as github from '@actions/github';
import { AuthorAssociationError, EvalForgeClient, draftTagFor, formatGateSkipped } from '@wix/evalforge-core';
import { getCommentTarget, getGateConfig, type GateConfig } from './config';
import { workspaceRoot } from './workspace';
import { guardedCall, makeAnalysisUpdater, makeGateCommenter } from './report';
import { checkPrAuthor } from './pr-lookups';
import { resolveGateScope } from './gate-scope';
import { syncDraftScenarios } from './sync-draft-scenarios';
import { runAndReport } from './run-and-report';

/** Comments on the PR without a `GateConfig`, for the path where building one failed. */
async function commentWithoutConfig(body: string): Promise<void> {
  const target = getCommentTarget();
  await makeGateCommenter(github.getOctokit(target.githubToken), target)(body);
}

export async function runGate(): Promise<void> {
  // The author gate must never redden a check, so an unresolvable author is recovered here
  // rather than escaping to `index.ts`, which turns any throw into `setFailed` — and does so
  // regardless of `blocking`, which is the guarantee the soak period depends on. Every other
  // config error still fails, because a missing input is a real misconfiguration.
  let config: GateConfig;
  try {
    config = getGateConfig();
  } catch (error) {
    if (!(error instanceof AuthorAssociationError)) throw error;
    const reason = `could not resolve the PR author: ${error.message}`;
    core.warning(`Skipping wix-app eval gate — ${reason}`);
    await commentWithoutConfig(formatGateSkipped(reason));
    return;
  }

  const octokit = github.getOctokit(config.githubToken);
  const comment = makeGateCommenter(octokit, config);

  // First, so a fork PR costs nothing. Skips rather than fails, and says so on the PR,
  // since otherwise a green check would look like a pass.
  const author = checkPrAuthor(config);
  if (!author.allowed) {
    core.info(`Skipping wix-app eval gate — ${author.reason}`);
    await comment(formatGateSkipped(author.reason));
    return;
  }

  const workspace = workspaceRoot();
  const draftTag = draftTagFor(config.repoFullName, config.prNumber);
  core.info(
    `EvalForge skill gate — PR #${config.prNumber}, version ${config.versionLabel} `
    + `(evaluating ${config.evaluatedSha.slice(0, 7)}, the merge of head ${config.headSha.slice(0, 7)} `
    + `into base ${config.baseSha.slice(0, 7)})`,
  );

  const scope = await resolveGateScope(octokit, config, workspace, comment);
  if (!scope.ok) return;

  const client = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const version = await guardedCall(
    () => client.createOrReuseSkillVersion(
      config.capabilityId, config.projectId, config.versionLabel, config.prNumber,
      scope.value.skillFiles,
    ),
    { message: 'Could not create the PR skill capability version', label: 'Version Not Created' },
    comment, config.isBlocking,
  );
  if (!version.ok) return;

  const nameToId = await syncDraftScenarios(
    client, octokit, config, scope.value, draftTag, workspace, comment,
  );
  if (!nameToId.ok) return;

  await runAndReport(
    client, config, scope.value, nameToId.value, version.value.id, comment,
    makeAnalysisUpdater(octokit, config),
  );
}
