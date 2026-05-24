import * as core from '@actions/core';
import * as github from '@actions/github';
import { getEvalConfig, type Config } from './config';
import { fail, getChangedFiles, makeCommenter } from './github';
import { EvalForgeClient } from './evalforge';
import { loadManifests } from './manifest';
import { computeCoverage } from './coverage';
import { pollUntilDone } from './eval-run';
import {
  formatEvalFailed, formatEvalPassed, formatEvalTimeout, formatManifestErrors,
  formatNoScenarios, formatServiceError, formatStaleScenarios, formatUncovered,
} from './comment';

type Commenter = ReturnType<typeof makeCommenter>;

export async function runEval(): Promise<void> {
  const config = getEvalConfig();
  const octokit = github.getOctokit(config.githubToken);
  const comment = makeCommenter(octokit, config.owner, config.repo, config.prNumber);
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  core.info(`EvalForge gate — PR #${config.prNumber}`);

  const { manifests, errors: manifestErrors } = await loadManifests(workspace);
  if (manifestErrors.length > 0) {
    await comment(formatManifestErrors(manifestErrors));
    fail(`Invalid manifest(s): ${manifestErrors.map(e => e.manifestPath).join(', ')}`, config.blocking);
    return;
  }
  if (manifests.length === 0) {
    core.info('No .evalforge.yml manifests found — nothing to gate');
    return;
  }
  core.info(`Manifests: ${manifests.map(m => m.manifestPath).join(', ')}`);

  const changedFiles = await guardedCall(
    () => getChangedFiles(octokit, config.owner, config.repo, config.prNumber),
    'Could not retrieve PR file list', comment, config,
  );
  if (!changedFiles) return;

  const coverage = computeCoverage(changedFiles, manifests);

  if (coverage.uncoveredFiles.length > 0) {
    await comment(formatUncovered(coverage.uncoveredFiles));
    fail(
      `Missing coverage for ${coverage.uncoveredFiles.length} file(s): ${coverage.uncoveredFiles.map(u => u.file).join(', ')}`,
      config.blocking,
    );
    return;
  }

  if (coverage.scenarioIds.length === 0) {
    core.info('No changed files fall under a manifest — skipping eval');
    await comment(formatNoScenarios());
    return;
  }

  core.info(`Coverage: ${coverage.scenarioIds.join(', ')}`);

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  const scenarios = await guardedCall(
    () => evalforge.listScenarios(config.projectId),
    'Could not reach EvalForge — contact a repository maintainer if this persists', comment, config,
  );
  if (!scenarios) return;

  const knownIds = new Set(scenarios.map(s => s.id));
  const stale = coverage.scenarioIds.filter(id => !knownIds.has(id));
  if (stale.length > 0) {
    await comment(formatStaleScenarios(stale));
    fail(`Stale scenario references: ${stale.join(', ')}`, config.blocking);
    return;
  }

  const versionLabel = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;
  const mcpVersion = await guardedCall(
    () => evalforge.ensureMcpVersion(
      config.mcpId, config.projectId, versionLabel, config.prNumber, config.headSha, config.mcpSkillsRepo,
    ),
    'Could not create MCP version', comment, config,
  );
  if (!mcpVersion) return;
  core.info(`MCP version ${versionLabel} (${mcpVersion.id})`);

  const run = await guardedCall(
    () => evalforge.createEvalRun(config.projectId, {
      name: `PR #${config.prNumber} EvalForge gate`,
      description: `Coverage gate for PR #${config.prNumber} (${coverage.scenarioIds.length} scenario(s))`,
      projectId: config.projectId,
      agentId: config.agentId,
      scenarioIds: coverage.scenarioIds,
      capabilityVersions: { [config.mcpId]: mcpVersion.id },
      prContext: {
        repo: `${config.owner}/${config.repo}`,
        prNumber: config.prNumber,
        headSha: config.headSha,
      },
    }),
    'Could not create eval run', comment, config,
  );
  if (!run) return;
  const runId = run.id;
  core.info(`Created eval run ${runId}`);
  core.info(`EvalForge run: https://bo.wix.com/pages/evalforge/${config.projectId}/results?runId=${runId}`);

  const triggered = await guardedCall(
    () => evalforge.triggerEvalRun(config.projectId, runId),
    'Could not trigger eval run', comment, config,
  );
  if (!triggered) return;

  core.info(`Polling eval run ${runId}...`);

  let finalStatus;
  try {
    finalStatus = await pollUntilDone(evalforge, config.projectId, runId);
  } catch (e) {
    if ((e as { timeout?: boolean }).timeout) {
      await comment(formatEvalTimeout(runId, config.blocking));
      fail(`Eval timed out (run ID: ${runId})`, config.blocking);
      return;
    }
    core.error(`Eval run polling failed: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError('Eval run polling failed', config.blocking));
    fail('Eval run polling failed', config.blocking);
    return;
  }

  const { aggregateMetrics: m, status } = finalStatus;
  switch (status) {
    case 'completed':
      if (m.failed === 0 && m.errors === 0) {
        await comment(formatEvalPassed(m, runId));
        core.info(`Eval passed — ${m.passed}/${m.totalAssertions} (run ID: ${runId})`);
      } else {
        await comment(formatEvalFailed(m, runId, config.blocking));
        fail(`Eval failed (pass rate: ${m.passRate}%)`, config.blocking);
      }
      return;
    case 'failed':
      await comment(formatServiceError(`Eval run failed (run ID: ${runId})`, config.blocking));
      fail(`Eval run failed (run ID: ${runId})`, config.blocking);
      return;
    case 'cancelled':
      await comment(formatServiceError(`Eval run cancelled (run ID: ${runId})`, config.blocking));
      fail(`Eval run cancelled (run ID: ${runId})`, config.blocking);
      return;
  }
}

async function guardedCall<T>(
  fn: () => Promise<T>,
  userMessage: string,
  comment: Commenter,
  config: Pick<Config, 'blocking'>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    core.error(`${userMessage}: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError(userMessage, config.blocking));
    fail(userMessage, config.blocking);
    return undefined;
  }
}
