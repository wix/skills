import * as core from '@actions/core';
import * as github from '@actions/github';
import { EvalForgeClient, deletePrCapabilityVersions, draftTagFor, formatGateSkipped } from '@wix/evalforge-core';
import { getGateConfig } from './config';
import { workspaceRoot } from './workspace';
import { guardedCall, makeAnalysisUpdater, makeGateCommenter } from './report';
import { checkPrAuthor } from './pr-lookups';
import { resolveGateScope } from './gate-scope';
import { syncDraftScenarios } from './sync-draft-scenarios';
import { runAndReport } from './run-and-report';

export async function runGate(): Promise<void> {
  const config = getGateConfig();
  const octokit = github.getOctokit(config.githubToken);
  const comment = makeGateCommenter(octokit, config);

  // First, so a fork PR costs nothing. Skips rather than fails, including when the lookup
  // errors — a GitHub blip must not turn into a red check. Says so on the PR, since otherwise
  // a green check would look like a pass.
  const author = await checkPrAuthor(octokit, config);
  if (!author.allowed) {
    const log = author.isUnexpected ? core.warning : core.info;
    log(`Skipping wix-app eval gate — ${author.reason}`);
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

  // Keep only the current commit's version live. Each push mints a fresh pr-<n>-<sha>, and a
  // superseded run is cancelled mid-flight, leaving its version behind — prune those now so a
  // long-lived PR stops accumulating one version per commit. Best-effort: never fails the gate,
  // and close-time cleanup still sweeps the rest.
  await deletePrCapabilityVersions(
    client, config.capabilityId, config.projectId, config.prNumber,
    { log: core.info, warn: core.warning },
    { keepVersionId: version.value.id },
  );

  const nameToId = await syncDraftScenarios(
    client, octokit, config, scope.value, draftTag, workspace, comment,
  );
  if (!nameToId.ok) return;

  await runAndReport(
    client, config, scope.value, nameToId.value, version.value.id, comment,
    makeAnalysisUpdater(octokit, config),
  );
}
