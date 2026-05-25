import * as core from '@actions/core';
import { getSimpleConfig } from './config';
import { EvalForgeClient, draftTagFor } from './evalforge';
import { deletePrMcpVersions } from './pr-cleanup';

export async function runCleanup(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  await deletePrMcpVersions(evalforge, config.mcpId, config.projectId, config.prNumber);

  let remote;
  try {
    remote = await evalforge.listTestScenarios(config.projectId);
  } catch (e) {
    core.warning(`listTestScenarios failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  for (const s of remote.filter(x => x.tags.includes(draftTag))) {
    try {
      await evalforge.deleteTestScenario(config.projectId, s.id);
      core.info(`Deleted draft ${s.name}`);
    } catch (e) {
      core.warning(`Delete draft ${s.name} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
