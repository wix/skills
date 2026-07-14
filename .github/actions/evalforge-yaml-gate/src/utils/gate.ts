import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import { getEvalConfig, type Config } from './config';
import { fail, getChangedFiles, classifyChanges, makeCommenter, type ChangedFile } from './github';
import { assertWixAuthor } from './author-gate';
import { loadEvals, type LoadedScenario } from './evals';
import { canonicalDocUrl } from './doc-url';
import { computeCoverage } from './coverage';
import { diffSyncPlan } from './sync';
import { EvalForgeClient, draftTagFor, evalRunUrl, uniqueRemoteScenarios, type RemoteScenario } from './evalforge';
import { EvalPipelineClient, pollUntilComparisonDone, ComparisonTimeoutError } from './eval-pipeline';
import { workspaceRoot } from './workspace';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import type { ComparisonGroupResult } from './eval-pipeline';
import {
  formatForeignDraftConflicts,
  formatLoadErrors, formatNoChanges, formatOrphanedMds, formatServiceError, formatUncovered,
  formatComparisonResult, formatComparisonTimeout, formatTokenBudgetExceeded, formatTooManyNewSkills,
} from './comment';
import { findTokenBudgetViolations, formatTokenBudgetFailureMessage } from './token-budget';

type Commenter = ReturnType<typeof makeCommenter>;

function allScenariosRequired(result: ComparisonGroupResult): boolean {
  return result.scenarios.length > 0 && result.scenarios.every(s => s.required);
}

export type RemoteScenarioFilters = {
  names: string[];
  tags: string[];
};

/**
 * Computes the smallest remote scenario lookup needed to sync this PR.
 */
export function remoteScenarioFiltersForGate(input: {
  changedHead: Map<string, LoadedScenario>;
  head: Map<string, LoadedScenario>;
  base: Map<string, LoadedScenario>;
  draftTag: string;
}): RemoteScenarioFilters {
  const names = new Set<string>(input.changedHead.keys());
  for (const [name] of input.base) {
    if (!input.head.has(name)) names.add(name);
  }
  return { names: [...names].sort(), tags: [input.draftTag] };
}

export async function runGate(): Promise<void> {
  const config = getEvalConfig();
  const octokit = github.getOctokit(config.githubToken);
  await assertWixAuthor(octokit, config.owner, config.repo, config.prNumber);
  const comment = makeCommenter(octokit, config.owner, config.repo, config.prNumber);
  const workspace = workspaceRoot();
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  core.info(`EvalForge YAML gate — PR #${config.prNumber}`);
  core.info(`MCP params — skillsRepo: ${config.mcpSkillsRepo}, headSha: ${config.headSha}`);

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const versionLabel = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;
  const mcpVersion = await guardedCall(
    () => evalforge.ensureMcpVersion(config.mcpId, config.projectId, versionLabel, config.prNumber, config.headSha, config.mcpSkillsRepo),
    'Could not create MCP version', comment, config,
  );
  if (!mcpVersion) return;

  const { scenarios: headScenarios, errors: loadErrors } = loadEvals(workspace);
  if (loadErrors.length > 0) {
    await comment(formatLoadErrors(loadErrors));
    fail(`Invalid YAML or duplicate names: ${loadErrors.length}`, config.blocking);
    return;
  }

  const allChanged = await guardedCall(
    () => getChangedFiles(octokit, config.owner, config.repo, config.prNumber),
    'Could not retrieve PR file list', comment, config,
  );
  if (!allChanged) return;
  const classifiedChanges = classifyChanges(allChanged);

  if (classifiedChanges.mdFiles.length === 0 && classifiedChanges.evalsAdded.length === 0 && classifiedChanges.evalsModified.length === 0 && classifiedChanges.evalsRemoved.length === 0) {
    core.info('No gated changes');
    await comment(formatNoChanges());
    return;
  }

  const orphanedMds = classifiedChanges.mdFiles.filter(f => canonicalDocUrl(f.filename, workspace) === null);
  if (orphanedMds.length > 0) {
    await comment(formatOrphanedMds(orphanedMds.map(f => f.filename)));
    fail(`${orphanedMds.length} changed .md file(s) not registered in documentation.yaml`, config.blocking);
    return;
  }

  const newSkillFiles = classifiedChanges.mdFiles
    .filter(f => f.status === 'added')
    .map(f => f.filename)
    .sort();
  if (newSkillFiles.length > config.maxNewSkills) {
    await comment(formatTooManyNewSkills(newSkillFiles.length, config.maxNewSkills, newSkillFiles));
    fail(`Cannot create more than ${config.maxNewSkills} new skill .md files per PR (${newSkillFiles.length} found)`, config.blocking);
    return;
  }

  const cov = computeCoverage(classifiedChanges.mdFiles, headScenarios, (f) => canonicalDocUrl(f, workspace));
  if (cov.uncovered.length > 0) {
    await comment(formatUncovered(cov.uncovered));
    fail(`Missing coverage for ${cov.uncovered.length} file(s)`, config.blocking);
    return;
  }

  const baseWorkspace = posix.join(workspace, BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseScenarios, errors: baseErrors } = loadEvals(baseWorkspace);
  for (const e of baseErrors) core.warning(`Base SHA eval issue (${e.path}): ${e.message}`);

  // Restrict head to scenarios authored or modified in THIS PR — avoids spurious PUTs on every push.
  const changedEvalPaths = new Set<string>([
    ...classifiedChanges.evalsAdded.map(f => f.filename),
    ...classifiedChanges.evalsModified.map(f => f.filename),
  ]);
  const changedHeadScenarios = new Map<string, LoadedScenario>();
  for (const [name, ls] of headScenarios) {
    if (changedEvalPaths.has(ls.path)) changedHeadScenarios.set(name, ls);
  }

  const filters = remoteScenarioFiltersForGate({ changedHead: changedHeadScenarios, head: headScenarios, base: baseScenarios, draftTag });
  const remote = await guardedCall(
    () => listRemoteScenariosForGate(evalforge, config.projectId, filters),
    'Could not reach EvalForge', comment, config,
  );
  if (!remote) return;

  const plan = diffSyncPlan({ changedHead: changedHeadScenarios, head: headScenarios, base: baseScenarios, remote, draftTag, repo: `${config.owner}/${config.repo}` });
  if (plan.errors.length > 0) {
    await comment(formatForeignDraftConflicts(plan.errors, { owner: config.owner, repo: config.repo }));
    fail(`Scenario(s) held by other PRs: ${plan.errors.map(e => e.name).join(', ')}`, config.blocking);
    return;
  }

  const nameToId = new Map(remote.map(r => [r.name, r.id]));
  for (const a of plan.actions) {
    try {
      if (a.kind === 'CREATE') {
        const created = await evalforge.createTestScenario(config.projectId, a.body, a.tags);
        nameToId.set(a.name, created.id);
        core.info(`Created scenario ${a.name} (${created.id})`);
      } else if (a.kind === 'UPDATE') {
        await evalforge.updateTestScenario(config.projectId, a.id, a.body, a.tags);
        core.info(`Updated scenario ${a.name} (${a.id})`);
      } else if (a.kind === 'DELETE') {
        await evalforge.deleteTestScenario(config.projectId, a.id);
        nameToId.delete(a.name);
        core.info(`Deleted draft scenario ${a.name} (${a.id})`);
      } else if (a.kind === 'DEFER_DELETE') {
        core.info(`Deferring DELETE of "${a.name}" — will be handled at PR merge`);
      }
    } catch (e) {
      core.error(`Sync action ${a.kind} for ${a.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      await comment(formatServiceError(`Sync failed for "${a.name}"`, config.blocking));
      fail(`Sync failed for ${a.name}`, config.blocking);
      return;
    }
  }

  const hasUpserts = plan.actions.some(a => a.kind === 'CREATE' || a.kind === 'UPDATE');
  if (!hasUpserts) {
    core.info('No scenarios created or updated — skipping eval pipeline comparison');
    return;
  }

  if (!config.triggerEvalCompare) {
    core.info('Eval compare disabled (TRIGGER_EVAL_COMPARE=false) — skipping comparison');
    return;
  }

  const pipeline = new EvalPipelineClient(config.evalPipelineUrl, config.appId, config.appSecret);
  const comparison = await guardedCall(
    () => pipeline.runComparison([draftTag], config.agentName, config.headSha, config.mcpSkillsRepo),
    'Could not start eval pipeline comparison', comment, config,
  );
  if (!comparison) return;
  core.info(`Eval pipeline comparison started: comparisonGroupId=${comparison.comparisonGroupId}`);

  try {
    const done = await pollUntilComparisonDone(pipeline, comparison.comparisonGroupId);
    for (const s of (done.result.scenarios ?? [])) {
      if (s.with.runId) core.info(`${s.scenarioName} [PR]: ${evalRunUrl(config.projectId, s.with.runId, s.with.name)}`);
      if (s.without.runId) core.info(`${s.scenarioName} [prod]: ${evalRunUrl(config.projectId, s.without.runId, s.without.name)}`);
    }
    await comment(formatComparisonResult(done, config.projectId));
    const tokenBudgetViolations = findTokenBudgetViolations(done.result.scenarios ?? [], headScenarios);
    if (tokenBudgetViolations.length > 0) {
      await comment(formatTokenBudgetExceeded(tokenBudgetViolations, config.projectId));
      fail(formatTokenBudgetFailureMessage(tokenBudgetViolations), config.blocking);
      return;
    }
    if (config.autoApprove && allScenariosRequired(done.result)) {
      await octokit.rest.pulls.createReview({
        owner: config.owner,
        repo: config.repo,
        pull_number: config.prNumber,
        event: 'APPROVE',
        body: 'All required eval scenarios passed — auto-approved.',
      });
      core.info('PR auto-approved: all required scenarios passed');
    }
  } catch (e) {
    if (e instanceof ComparisonTimeoutError) {
      await comment(formatComparisonTimeout(comparison.comparisonGroupId, config.blocking));
      fail(e.message, config.blocking);
      return;
    }
    core.error(`compare-group failed: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError('Eval pipeline comparison failed', config.blocking));
    fail('Eval pipeline comparison failed', config.blocking);
  }

}

async function listRemoteScenariosForGate(
  evalforge: EvalForgeClient,
  projectId: string,
  filters: RemoteScenarioFilters,
): Promise<RemoteScenario[]> {
  const [byName, byDraftTag] = await Promise.all([
    filters.names.length > 0 ? evalforge.listTestScenarios(projectId, { names: filters.names }) : Promise.resolve([]),
    evalforge.listTestScenarios(projectId, { tags: filters.tags }),
  ]);
  return uniqueRemoteScenarios([...byName, ...byDraftTag]);
}

async function guardedCall<T>(
  fn: () => Promise<T>,
  userMessage: string,
  comment: Commenter,
  config: Pick<Config, 'blocking'>,
): Promise<T | undefined> {
  try { return await fn(); }
  catch (e) {
    core.error(`${userMessage}: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError(userMessage, config.blocking));
    fail(userMessage, config.blocking);
    return undefined;
  }
}
