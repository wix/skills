import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import { getEvalConfig, type Config } from './config';
import { fail, getChangedFiles, classifyChanges, makeCommenter, type ChangedFile } from './github';
import { loadEvals, type LoadedScenario } from './evals';
import { canonicalDocUrl } from './doc-url';
import { computeCoverage } from './coverage';
import { diffSyncPlan } from './sync';
import { EvalForgeClient, draftTagFor } from './evalforge';
import { workspaceRoot } from './workspace';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import { pollUntilDone, EvalRunTimeoutError } from './eval-run';
import {
  formatEvalFailed, formatEvalPassed, formatEvalTimeout, formatForeignDraftConflicts,
  formatLoadErrors, formatNoChanges, formatOrphanedMds, formatServiceError, formatUncovered,
} from './comment';

type Commenter = ReturnType<typeof makeCommenter>;

export async function runGate(): Promise<void> {
  const config = getEvalConfig();
  const octokit = github.getOctokit(config.githubToken);
  const comment = makeCommenter(octokit, config.owner, config.repo, config.prNumber);
  const workspace = workspaceRoot();
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  core.info(`EvalForge YAML gate — PR #${config.prNumber}`);

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

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const remote = await guardedCall(
    () => evalforge.listTestScenarios(config.projectId),
    'Could not reach EvalForge', comment, config,
  );
  if (!remote) return;

  const plan = diffSyncPlan({ head: changedHeadScenarios, base: baseScenarios, remote, draftTag });
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

  const mcpVersionId = config.mcpVersionId;
  if (!mcpVersionId) {
    core.warning('No MCP version ID provided — skipping eval run');
    return;
  }

  const selected = new Set<string>();
  for (const names of cov.coveredBy.values()) {
    for (const n of names) {
      const id = nameToId.get(n);
      if (id) selected.add(id);
    }
  }
  const scenarioByPath = new Map<string, LoadedScenario>();
  for (const ls of headScenarios.values()) scenarioByPath.set(ls.path, ls);
  for (const f of [...classifiedChanges.evalsAdded, ...classifiedChanges.evalsModified]) {
    const ls = scenarioByPath.get(f.filename);
    if (!ls) continue;
    const id = nameToId.get(ls.scenario.name);
    if (id) selected.add(id);
  }

  if (selected.size === 0) {
    core.info('Nothing to run');
    return;
  }

  const run = await guardedCall(
    () => evalforge.createEvalRun(config.projectId, {
      name: `PR #${config.prNumber} YAML-gate`,
      description: `Gate for PR #${config.prNumber} (${selected.size} scenarios)`,
      projectId: config.projectId,
      agentId: config.agentId,
      scenarioIds: [...selected],
      // capabilityIds is REQUIRED — without it the agent has no MCP bound at run time. Don't drop it.
      capabilityIds: [config.mcpId],
      capabilityVersions: { [config.mcpId]: mcpVersionId },
    }),
    'Could not create eval run', comment, config,
  );
  if (!run) return;

  const triggered = await guardedCall(
    () => evalforge.triggerEvalRun(config.projectId, run.id),
    'Could not trigger eval run', comment, config,
  );
  if (!triggered) return;

  let finalStatus;
  try {
    finalStatus = await pollUntilDone(evalforge, config.projectId, run.id);
  } catch (e) {
    if (e instanceof EvalRunTimeoutError) {
      await comment(formatEvalTimeout(run.id, config.blocking));
      fail(`Eval timed out (run ID: ${run.id})`, config.blocking);
      return;
    }
    core.error(`Eval polling failed: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError('Eval polling failed', config.blocking));
    fail('Eval polling failed', config.blocking);
    return;
  }

  const m = finalStatus.aggregateMetrics;
  if (finalStatus.status === 'completed' && m.failed === 0 && m.errors === 0) {
    await comment(formatEvalPassed(m, run.id));
    core.info(`Eval passed — ${m.passed}/${m.totalAssertions} (run ID: ${run.id})`);
  } else {
    await comment(formatEvalFailed(m, run.id, config.blocking));
    fail(`Eval failed (${m.passRate}%)`, config.blocking);
  }
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

