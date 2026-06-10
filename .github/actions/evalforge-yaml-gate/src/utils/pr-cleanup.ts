import * as core from '@actions/core';
import type { EvalForgeClient } from './evalforge';

export async function deletePrMcpVersions(
  client: EvalForgeClient,
  mcpId: string,
  projectId: string,
  prNumber: number,
): Promise<void> {
  let versions;
  try {
    versions = await client.listMcpVersions(mcpId, projectId);
  } catch (e) {
    core.warning(`listMcpVersions failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const prefix = `pr-${prNumber}-`;
  for (const v of versions.filter(x => x.version.startsWith(prefix))) {
    try {
      await client.deleteMcpVersion(mcpId, projectId, v.id);
      core.info(`Deleted MCP version ${v.version}`);
    } catch (e) {
      core.warning(`Delete MCP version ${v.version} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
