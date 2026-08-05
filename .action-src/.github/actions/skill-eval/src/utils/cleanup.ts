import * as core from '@actions/core';
import { getCleanupConfig } from './config';
import { EvalForgeClient } from './evalforge';

export async function runCleanup(): Promise<void> {
  const config = getCleanupConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  let versions;
  try {
    versions = await evalforge.listMcpVersions(config.mcpId, config.projectId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Failed to list MCP versions: ${message}`);
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

  for (const version of prVersions) {
    try {
      await evalforge.deleteMcpVersion(config.mcpId, config.projectId, version.id);
      core.info(`Deleted MCP version ${version.version} (${version.id})`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      core.warning(`Failed to delete MCP version ${version.version}: ${message}`);
    }
  }
}
