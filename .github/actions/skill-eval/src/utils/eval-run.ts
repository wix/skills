import * as core from '@actions/core';
import type { EvalForgeClient, EvalRunStatus } from './evalforge';

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const RETRY_LIMIT = 5;
const RETRY_DELAY_MS = 10_000;

type McpVersionConfig = {
  projectId: string;
  mcpId: string;
  prNumber: number;
  headSha: string;
};

function isRetriable(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  if (status && status >= 500) return true;
  if (e instanceof Error && e.name === 'AbortError') return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

export async function ensureMcpVersion(
  client: EvalForgeClient,
  config: McpVersionConfig,
): Promise<string | null> {
  const mcp = await client.getMcp(config.projectId, config.mcpId);
  if (!mcp.source) return null;

  const versionString = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;

  try {
    const version = await client.createMcpVersion(config.projectId, config.mcpId, {
      version: versionString,
      source: { ...mcp.source, ref: config.headSha },
      origin: 'pr',
    });
    core.info(`Created MCP version ${version.version} (${version.id})`);
    return version.id;
  } catch (e) {
    if ((e as { status?: number }).status !== 409) throw e;

    core.info(`MCP version ${versionString} already exists — recovering`);
    const versions = await client.getMcpVersions(config.projectId, config.mcpId);
    const existing = versions.find(v => v.version === versionString);
    if (!existing) throw new Error(`Version ${versionString} not found after 409`);
    return existing.id;
  }
}

export async function pollUntilDone(
  client: EvalForgeClient,
  projectId: string,
  runId: string,
): Promise<EvalRunStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let status: EvalRunStatus | undefined;
    let retries = 0;

    while (retries <= RETRY_LIMIT) {
      try {
        status = await client.getEvalRun(projectId, runId);
        break;
      } catch (e) {
        if (isRetriable(e) && retries < RETRY_LIMIT) {
          retries++;
          core.info(`Poll attempt failed (retry ${retries}/${RETRY_LIMIT}): ${e instanceof Error ? e.message : String(e)}`);
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw e;
      }
    }

    if (!status) throw new Error('Poll failed — no status returned');

    const terminal = status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled';
    if (terminal) return status;

    core.info(`Eval run ${runId}: ${status.status} (${status.progress}%)...`);
    await delay(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }

  throw Object.assign(new Error('Eval run timed out after 30 minutes'), { timeout: true });
}
