import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, DRAFT_PREFIX, draftTagFor } from './evalforge';
import { loadEvals, type LoadedScenario } from './evals';
import { stripTags } from './sync';
import { deletePrMcpVersions } from './pr-cleanup';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import { workspaceRoot } from './workspace';

export async function runPromote(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);
  const workspace = workspaceRoot();

  // Cleanup workflow no longer fires on merged PRs — promote owns MCP version teardown.
  await deletePrMcpVersions(evalforge, config.mcpId, config.projectId, config.prNumber);

  let remote;
  try {
    remote = await evalforge.listTestScenarios(config.projectId);
  } catch (e) {
    core.warning(`listTestScenarios failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const remoteByName = new Map(remote.map(r => [r.name, r]));

  const headScenarios = loadEvalsWithWarnings(workspace);
  let promoted = 0;
  let stillDraft = 0;

  for (const s of remote) {
    if (!s.tags.includes(draftTag)) continue;
    const ls = headScenarios.get(s.name);
    if (!ls) { stillDraft++; continue; }
    try {
      await evalforge.updateTestScenario(config.projectId, s.id, stripTags(ls.scenario), ls.scenario.tags);
      promoted++;
      core.info(`Promoted ${s.name}: tags = ${JSON.stringify(ls.scenario.tags)}`);
    } catch (e) {
      core.warning(`Promote failed for ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const baseEvals = loadEvalsWithWarnings(posix.join(workspace, BASE_WORKSPACE_SUBDIR));
  for (const [name] of baseEvals) {
    if (headScenarios.has(name)) continue;
    const r = remoteByName.get(name);
    if (!r) continue;
    if (r.tags.some(t => t.startsWith(DRAFT_PREFIX))) continue;
    try {
      await evalforge.deleteTestScenario(config.projectId, r.id);
      core.info(`Deleted YAML-removed scenario ${name} (${r.id})`);
    } catch (e) {
      core.warning(`Delete-on-merge failed for ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (promoted > 0) core.info(`Promoted ${promoted} scenarios`);
  if (stillDraft > 0) core.info(`Skipped ${stillDraft} (YAML missing in merged head)`);
}

function loadEvalsWithWarnings(root: string): Map<string, LoadedScenario> {
  const { scenarios, errors } = loadEvals(root);
  for (const e of errors) core.warning(`Eval load issue at ${root}/${e.path}: ${e.message}`);
  return scenarios;
}
