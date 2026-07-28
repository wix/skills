import * as core from '@actions/core';
import { posix } from 'node:path';
import {
  EvalForgeClient, deletePrCapabilityVersions, draftTagFor, loadScenarios, planCleanup,
  type CleanupAction, type RemoteScenario,
} from '@wix/evalforge-core';
import { getCleanupConfig, BASE_WORKSPACE_SUBDIR } from './config';
import { workspaceRoot } from './workspace';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * PR-close cleanup. Every failure is a warning: the PR is already closed, so failing the
 * workflow would only leave a red check nobody can act on, and the next run of this job
 * sweeps whatever was left behind.
 */
export async function runCleanup(): Promise<void> {
  const config = getCleanupConfig();
  const client = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(config.repoFullName, config.prNumber);

  await deletePrCapabilityVersions(client, config.capabilityId, config.projectId, config.prNumber, {
    log: core.info,
    warn: core.warning,
  });

  let remote: RemoteScenario[];
  try {
    remote = await client.listTestScenariosByTag(config.projectId, draftTag);
  } catch (error) {
    core.warning(`listTestScenariosByTag failed: ${describeError(error)}`);
    return;
  }

  const baseRoot = posix.join(workspaceRoot(), BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseScenarios, errors } = loadScenarios(baseRoot, config.evalsGlob);
  for (const error of errors) {
    core.warning(`Base SHA scenario issue at ${baseRoot}/${error.path}: ${error.message}`);
  }

  const plan = planCleanup(remote, baseScenarios, draftTag, config.repoFullName);
  const restoreCount = plan.filter(action => action.kind === 'RESTORE').length;
  const deleteCount = plan.filter(action => action.kind === 'DELETE').length;
  core.info(`Cleanup plan: ${plan.length} action(s) — RESTORE=${restoreCount} DELETE=${deleteCount}`);

  for (const action of plan) await execute(client, config.projectId, action);
}

async function execute(client: EvalForgeClient, projectId: string, action: CleanupAction): Promise<void> {
  try {
    if (action.kind === 'RESTORE') {
      await client.updateTestScenario(projectId, action.id, action.body, action.tags);
      core.info(`Restored ${action.name} to its pre-PR state`);
    } else {
      await client.deleteTestScenario(projectId, action.id);
      core.info(`Deleted draft ${action.name}`);
    }
  } catch (error) {
    const verb = action.kind === 'RESTORE' ? 'Restore' : 'Delete draft';
    core.warning(`${verb} failed for ${action.name}: ${describeError(error)}`);
  }
}
