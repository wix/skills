import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, deletePrCapabilityVersions, draftTagFor, planCleanup, type CleanupAction, type RemoteScenario } from '@wix/evalforge-core';
import { loadEvals } from './evals';

import { workspaceRoot } from './workspace';
import { BASE_WORKSPACE_SUBDIR } from './paths';

export async function runCleanup(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  await deletePrCapabilityVersions(evalforge, config.mcpId, config.projectId, config.prNumber, {
    log: core.info,
    warn: core.warning,
  });

  let remote: RemoteScenario[];
  try {
    remote = await evalforge.listTestScenariosByTag(config.projectId, draftTag);
  } catch (e) {
    core.warning(`listTestScenariosByTag failed: ${errMsg(e)}`);
    return;
  }

  const baseRoot = posix.join(workspaceRoot(), BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseEvals, errors: baseErrs } = loadEvals(baseRoot);
  for (const e of baseErrs) core.warning(`Base SHA eval issue at ${baseRoot}/${e.path}: ${e.message}`);

  const plan = planCleanup(remote, baseEvals, draftTag, `${config.owner}/${config.repo}`);
  const summary = plan.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {} as Record<string, number>);
  core.info(`Cleanup plan: ${plan.length} action(s) — RESTORE=${summary.RESTORE ?? 0} DELETE=${summary.DELETE ?? 0}`);

  for (const a of plan) await execute(evalforge, config.projectId, a);
}

async function execute(client: EvalForgeClient, projectId: string, a: CleanupAction): Promise<void> {
  try {
    if (a.kind === 'RESTORE') {
      await client.updateTestScenario(projectId, a.id, a.body, a.tags);
      core.info(`Restored ${a.name} from base SHA (pre-PR state)`);
    } else {
      await client.deleteTestScenario(projectId, a.id);
      core.info(`Deleted draft ${a.name}`);
    }
  } catch (e) {
    const verb = a.kind === 'RESTORE' ? 'Restore' : 'Delete draft';
    core.warning(`${verb} failed for ${a.name}: ${errMsg(e)}`);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
