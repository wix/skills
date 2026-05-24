import * as core from '@actions/core';
import { getSimpleConfig } from './config';
import { EvalForgeClient } from './evalforge';

export async function runCleanup(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  let versions;
  try {
    versions = await evalforge.listMcpVersions(config.mcpId, config.projectId);
  } catch (e) {
    core.error(`Failed to list MCP versions: ${e instanceof Error ? e.message : String(e)}`);
    core.setFailed('Could not list MCP versions for cleanup');
    return;
  }

  const prefix = `pr-${config.prNumber}-`;
  const prVersions = versions.filter(v => v.version.startsWith(prefix));

  if (prVersions.length === 0) {
    core.info(`No MCP versions found for PR #${config.prNumber} — nothing to clean up`);
    return;
  }

  core.info(`Found ${prVersions.length} MCP version(s) to delete for PR #${config.prNumber}`);

  await Promise.all(prVersions.map(async v => {
    try {
      await evalforge.deleteMcpVersion(config.mcpId, config.projectId, v.id);
      core.info(`Deleted MCP version ${v.version} (${v.id})`);
    } catch (e) {
      core.warning(`Failed to delete MCP version ${v.version}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
}
