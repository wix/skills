import * as core from '@actions/core';
import { getEvalConfig } from './config';
import { EvalForgeClient } from './evalforge';

export async function runCreateVersion(): Promise<void> {
  const config = getEvalConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const versionLabel = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;

  let version;
  try {
    version = await evalforge.ensureMcpVersion(
      config.mcpId, config.projectId, versionLabel,
      config.prNumber, config.headSha, config.mcpSkillsRepo,
    );
  } catch (e) {
    core.setFailed(`Could not create MCP version: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  core.setOutput('mcp-version-id', version.id);
  core.info(`MCP version ready: ${versionLabel} (${version.id})`);
}
