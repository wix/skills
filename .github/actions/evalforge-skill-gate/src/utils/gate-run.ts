import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import {
  EvalForgeClient, EvalRunTimeoutError, GATE_COMMENT_MARKER,
  collectSkillFiles, deriveTags, diffSyncPlan, draftTagFor, evalRunUrl, evaluateRunResult,
  formatForeignDraftConflicts, formatGateResult, formatGateServiceError, formatGateTimeout,
  formatGuardFailure, formatNoGatedChanges, formatYamlErrors,
  getChangedFiles, getFirstCommitAuthorEmail, guardScenarios, isWixAuthorEmail,
  listRemoteScenariosForGate, loadScenarios, makeCommenter, parseDraftTag, pollUntilDone,
  remoteScenarioFiltersForGate, selectScenarios, semanticPlusDraftTags,
  stripInactiveForeignDraftTags, touchedScenarioPaths,
  type Commenter, type EvalRunStatus, type SyncAction,
} from '@wix/evalforge-core';
import { getGateConfig, BASE_WORKSPACE_SUBDIR, type GateConfig } from './config';
import { workspaceRoot } from './workspace';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string, blocking: boolean): void {
  if (blocking) core.setFailed(message);
  else core.warning(message);
}

/** Runs an EvalForge call, reporting a user-facing comment and gate failure if it throws. */
async function guardedCall<T>(
  operation: () => Promise<T>,
  userMessage: string,
  comment: Commenter,
  blocking: boolean,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    core.error(`${userMessage}: ${describeError(error)}`);
    await comment(formatGateServiceError(userMessage, blocking));
    fail(userMessage, blocking);
    return undefined;
  }
}

async function isDraftTagActive(
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

export async function runGate(): Promise<void> {
  const config = getGateConfig();
  const octokit = github.getOctokit(config.githubToken);

  // First, so a fork PR costs nothing.
  const authorEmail = await getFirstCommitAuthorEmail(octokit, config.owner, config.repo, config.prNumber);
  if (!isWixAuthorEmail(authorEmail)) {
    core.info('Skipping wix-app eval gate — PR author is not a @wix.com address');
    return;
  }

  const comment = makeCommenter(octokit, {
    owner: config.owner,
    repo: config.repo,
    prNumber: config.prNumber,
    marker: GATE_COMMENT_MARKER,
  }, {
    warn: core.warning,
    writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
  });

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
    () => client.ensureSkillVersion(
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

  const run = await guardedCall(
    () => client.createAndRunEvalRun(config.projectId, {
      name: `${config.repoFullName} PR #${config.prNumber} (${config.versionLabel})`,
      description: `Skill gate run for PR #${config.prNumber}`,
      projectId: config.projectId,
      agentId: config.agentId,
      scenarioIds: selection.ids,
      capabilityIds: [config.capabilityId],
      capabilityVersions: { [config.capabilityId]: config.versionLabel },
    }),
    'Could not start the eval run', comment, config.blocking,
  );
  if (!run) return;

  const runUrl = evalRunUrl(config.projectId, run.id);
  core.info(`Eval run started: ${runUrl}`);

  let status: EvalRunStatus;
  try {
    status = await pollUntilDone(client, config.projectId, run.id, {
      log: core.info,
      warn: core.warning,
    });
  } catch (error) {
    if (error instanceof EvalRunTimeoutError) {
      await comment(formatGateTimeout(run.id, runUrl, config.blocking));
      fail(error.message, config.blocking);
      return;
    }
    core.error(`Polling the eval run failed: ${describeError(error)}`);
    await comment(formatGateServiceError('Polling the eval run failed', config.blocking));
    fail('Polling the eval run failed', config.blocking);
    return;
  }

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

/** Applies the plan, recording ids CREATE returns. Stops on failure: a half-synced set would
 * report on the wrong content. */
async function applySyncPlan(
  client: EvalForgeClient,
  config: GateConfig,
  actions: SyncAction[],
  nameToId: Map<string, string>,
  comment: Commenter,
): Promise<boolean> {
  for (const action of actions) {
    try {
      if (action.kind === 'CREATE') {
        const created = await client.createTestScenario(config.projectId, action.body, action.tags);
        nameToId.set(action.name, created.id);
        core.info(`Created scenario ${action.name} (${created.id})`);
      } else if (action.kind === 'UPDATE') {
        await client.updateTestScenario(config.projectId, action.id, action.body, action.tags);
        core.info(`Updated scenario ${action.name} (${action.id})`);
      } else if (action.kind === 'DELETE') {
        await client.deleteTestScenario(config.projectId, action.id);
        nameToId.delete(action.name);
        core.info(`Deleted draft scenario ${action.name} (${action.id})`);
      } else {
        core.info(`Deferring DELETE of "${action.name}" — handled at merge`);
      }
    } catch (error) {
      core.error(`Sync action ${action.kind} for ${action.name} failed: ${describeError(error)}`);
      await comment(formatGateServiceError(`Sync failed for "${action.name}"`, config.blocking));
      fail(`Sync failed for ${action.name}`, config.blocking);
      return false;
    }
  }
  return true;
}
