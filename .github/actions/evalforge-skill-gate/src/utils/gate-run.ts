import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import {
  EvalForgeClient,
  collectSkillFiles, deriveTags, diffSyncPlan, draftTagFor, evalRunUrl, evaluateRunResult,
  formatForeignDraftConflicts, formatGateResult, formatGateServiceError,
  formatGateSkipped, formatGuardFailure, formatNoGatedChanges, formatYamlErrors,
  getChangedFiles, guardScenarios,
  listRemoteScenariosForGate, loadScenarios, remoteScenarioFiltersForGate, selectScenarios,
  semanticPlusDraftTags, stripInactiveForeignDraftTags, touchedScenarioPaths,
} from '@wix/evalforge-core';
import { getGateConfig, BASE_WORKSPACE_SUBDIR } from './config';
import { workspaceRoot } from './workspace';
import { fail, guardedCall, makeGateCommenter } from './report';
import { isDraftTagActive, skipReasonForAuthor } from './pr-lookups';
import { applySyncPlan } from './apply-sync-plan';
import { pollToCompletion, startEvalRun } from './run-eval';

export async function runGate(): Promise<void> {
  const config = getGateConfig();
  const octokit = github.getOctokit(config.githubToken);

  const comment = makeGateCommenter(octokit, config);

  // First, so a fork PR costs nothing. Skips rather than fails, including when the lookup
  // errors — a GitHub blip must not turn into a red check. Says so on the PR, since otherwise
  // a green check would look like a pass.
  const skip = await skipReasonForAuthor(octokit, config);
  if (skip) {
    const log = skip.unexpected ? core.warning : core.info;
    log(`Skipping wix-app eval gate — ${skip.reason}`);
    await comment(formatGateSkipped(skip.reason));
    return;
  }

  const workspace = workspaceRoot();
  const draftTag = draftTagFor(config.repoFullName, config.prNumber);
  core.info(
    `EvalForge skill gate — PR #${config.prNumber}, version ${config.versionLabel} `
    + `(evaluating ${config.evaluatedSha.slice(0, 7)}, the merge of head ${config.headSha.slice(0, 7)} into base)`,
  );

  const { scenarios: headScenarios, errors: loadErrors } = loadScenarios(workspace, config.evalsGlob);
  if (loadErrors.length > 0) {
    await comment(formatYamlErrors(loadErrors));
    fail(`Invalid scenario YAML or duplicate names: ${loadErrors.length}`, config.blocking);
    return;
  }

  const changedFiles = await guardedCall(
    () => getChangedFiles(octokit, config.owner, config.repo, config.prNumber),
    'Could not retrieve the PR file list', comment, config.blocking,
  );
  if (!changedFiles) return;

  const derived = deriveTags(changedFiles.map(file => file.filename), {
    skillDir: config.skillDir,
    referenceDir: config.referenceDir,
    ignoreGlobs: config.ignoreGlobs,
    broadImpactGlobs: config.broadImpactGlobs,
  });
  const touchedPaths = new Set(touchedScenarioPaths(
    changedFiles.map(file => ({ path: file.filename, status: file.status })),
    config.evalsGlob,
  ));

  for (const path of derived.unmapped) {
    core.warning(`Unmapped path under ${config.skillDir}: ${path}`);
  }

  if (derived.tags.length === 0 && !derived.broadImpact && touchedPaths.size === 0) {
    core.info('No gated changes');
    await comment(formatNoGatedChanges(derived.unmapped));
    return;
  }

  // Local YAML only, before any version or run, so a coverage failure costs nothing.
  const guard = guardScenarios({
    tags: derived.tags,
    scenarios: headScenarios,
    touchedScenarioPaths: touchedPaths,
  });
  if (guard.violations.length > 0) {
    await comment(formatGuardFailure({ ...guard, blocking: config.blocking }));
    fail(`Eval coverage guard failed: ${guard.violations.length} violation(s)`, config.blocking);
    return;
  }

  const skillFiles = await guardedCall(
    // Whole dir: references send the agent to sibling paths like `<SKILL_ROOT>/scripts/…`.
    async () => collectSkillFiles(workspace, config.skillDir, { warn: core.warning }),
    `Could not read the skill directory ${config.skillDir}`, comment, config.blocking,
  );
  if (!skillFiles) return;
  core.info(`Collected ${skillFiles.length} skill file(s) from ${config.skillDir}`);

  const client = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const version = await guardedCall(
    () => client.createOrReuseSkillVersion(
      config.capabilityId, config.projectId, config.versionLabel, config.prNumber, skillFiles,
    ),
    'Could not create the PR skill capability version', comment, config.blocking,
  );
  if (!version) return;

  const baseWorkspace = posix.join(workspace, BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseScenarios, errors: baseErrors } = loadScenarios(baseWorkspace, config.evalsGlob);
  for (const error of baseErrors) {
    core.warning(`Base SHA scenario issue (${error.path}): ${error.message}`);
  }

  const changedHeadScenarios = new Map(
    [...headScenarios].filter(([, loaded]) => touchedPaths.has(loaded.path)),
  );

  const filters = remoteScenarioFiltersForGate({
    changedHead: changedHeadScenarios,
    head: headScenarios,
    base: baseScenarios,
    draftTag,
    extraTags: derived.tags,
    all: derived.broadImpact,
  });
  const remote = await guardedCall(
    () => listRemoteScenariosForGate(client, config.projectId, filters),
    'Could not reach EvalForge', comment, config.blocking,
  );
  if (!remote) return;

  const normalizedRemote = await stripInactiveForeignDraftTags(
    remote, draftTag, tag => isDraftTagActive(octokit, tag),
  );

  const plan = diffSyncPlan({
    changedHead: changedHeadScenarios,
    head: headScenarios,
    base: baseScenarios,
    remote: normalizedRemote,
    draftTag,
    repo: config.repoFullName,
    // Semantic tags must survive the draft sync — the gate selects by them.
    tagStrategy: semanticPlusDraftTags,
  });
  if (plan.errors.length > 0) {
    await comment(formatForeignDraftConflicts(plan.errors, config.blocking));
    fail(`Scenario(s) held by other PRs: ${plan.errors.map(error => error.name).join(', ')}`, config.blocking);
    return;
  }

  const nameToId = new Map(normalizedRemote.map(entry => [entry.name, entry.id]));
  const applied = await applySyncPlan(client, config, plan.actions, nameToId, comment);
  if (!applied) return;

  const selection = selectScenarios({
    broadImpact: derived.broadImpact,
    tags: derived.tags,
    localScenarios: headScenarios,
    nameToId,
    touchedScenarioPaths: touchedPaths,
    maxScenarios: config.maxScenarios,
  });
  for (const name of selection.missingIds) {
    core.warning(`No EvalForge scenario found for "${name}" — it is in the repo YAML but not in EvalForge`);
  }

  // A gate that resolved nothing to run must not report a green check.
  if (selection.ids.length === 0) {
    const message = 'No eval scenarios could be resolved to run, so nothing was verified';
    await comment(formatGateServiceError(message, config.blocking));
    fail(message, config.blocking);
    return;
  }

  const run = await startEvalRun(client, config, selection.ids, version.id, comment);
  if (!run) return;

  const runUrl = evalRunUrl(config.projectId, run.id);
  core.info(`Eval run started: ${runUrl}`);

  const status = await pollToCompletion(client, config, run.id, runUrl, comment);
  if (!status) return;

  const verdict = evaluateRunResult(status);
  await comment(formatGateResult({
    metrics: status.aggregateMetrics,
    verdict,
    runId: run.id,
    runUrl,
    selection,
    maxScenarios: config.maxScenarios,
    warnings: guard.warnings,
    unmapped: derived.unmapped,
    broadImpact: derived.broadImpact,
    blocking: config.blocking,
  }));

  if (!verdict.passed) {
    fail(`Eval gate failed: ${verdict.reasons.join('; ')}`, config.blocking);
  }
}
