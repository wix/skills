import * as core from '@actions/core';
import { getSimpleConfig } from './config';
import { EvalForgeClient, pendingTagFor } from './evalforge';

export async function runPromotion(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const tag = pendingTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  let scenarios;
  try {
    scenarios = await evalforge.listScenarios(config.projectId);
  } catch (e) {
    core.error(`Failed to list scenarios: ${e instanceof Error ? e.message : String(e)}`);
    core.setFailed('Could not list scenarios for promotion');
    return;
  }

  const pending = scenarios.filter(s => (s.tags ?? []).includes(tag));
  if (pending.length === 0) {
    core.info(`No scenarios tagged "${tag}" — nothing to promote`);
    return;
  }

  core.info(`Promoting ${pending.length} scenario(s) — removing tag "${tag}"`);
  await Promise.all(pending.map(async s => {
    try {
      await evalforge.removeScenarioTag(config.projectId, s.id, tag);
      core.info(`Removed "${tag}" from scenario ${s.id}`);
    } catch (e) {
      core.warning(`Failed to remove tag from scenario ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
}
