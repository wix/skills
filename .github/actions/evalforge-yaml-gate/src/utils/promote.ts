import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, DRAFT_PREFIX, draftTagFor, type RemoteScenario } from './evalforge';
import { loadEvals, type LoadedScenario } from './evals';
import { toScenarioBody } from './sync';
import { deletePrMcpVersions } from './pr-cleanup';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import { workspaceRoot } from './workspace';
import { errMsg } from './errors';

export async function runPromote(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);
  const workspace = workspaceRoot();

  // Cleanup workflow no longer fires on merged PRs — promote owns MCP version teardown.
  await deletePrMcpVersions(evalforge, config.mcpId, config.projectId, config.prNumber);

  let drafts: RemoteScenario[];
  try {
    drafts = await evalforge.listScenariosByTag(config.projectId, draftTag);
  } catch (e) {
    core.warning(`listScenariosByTag (draftTag) failed: ${errMsg(e)}`);
    return;
  }

  const headScenarios = loadEvalsWithWarnings(workspace);
  let promoted = 0;
  let stillDraft = 0;
  let lookupFailures = 0;

  for (const s of drafts) {
    const ls = headScenarios.get(s.name);
    if (!ls) { stillDraft++; continue; }
    try {
      await evalforge.updateTestScenario(config.projectId, s.id, toScenarioBody(ls.scenario), ls.scenario.tags);
      promoted++;
      core.info(`Promoted ${s.name}: tags = ${JSON.stringify(ls.scenario.tags)}`);
    } catch (e) {
      core.warning(`Promote failed for ${s.name}: ${errMsg(e)}`);
    }
  }

  const baseEvals = loadEvalsWithWarnings(posix.join(workspace, BASE_WORKSPACE_SUBDIR));
  const removedNames = [...baseEvals.keys()].filter(n => !headScenarios.has(n));
  const lookups = await Promise.all(removedNames.map(async n => {
    try { return { ok: true as const, scenario: await evalforge.findScenarioByExactName(config.projectId, n) }; }
    catch (e) {
      core.warning(`findScenarioByExactName "${n}" failed: ${errMsg(e)}`);
      return { ok: false as const };
    }
  }));
  for (let i = 0; i < removedNames.length; i++) {
    const name = removedNames[i];
    const lookup = lookups[i];
    if (!lookup.ok) { lookupFailures++; continue; }
    const r = lookup.scenario;
    if (!r) continue;
    if (r.tags.some(t => t.startsWith(DRAFT_PREFIX))) continue;
    try {
      await evalforge.deleteTestScenario(config.projectId, r.id);
      core.info(`Deleted YAML-removed scenario ${name} (${r.id})`);
    } catch (e) {
      core.warning(`Delete-on-merge failed for ${name}: ${errMsg(e)}`);
    }
  }

  if (promoted > 0) core.info(`Promoted ${promoted} scenarios`);
  if (stillDraft > 0) core.info(`Skipped ${stillDraft} (YAML missing in merged head)`);
  if (lookupFailures > 0) core.warning(`${lookupFailures} scenario lookup(s) failed during promote — YAML-removed scenarios may not have been cleaned up. Re-run the workflow to retry.`);
}

function loadEvalsWithWarnings(root: string): Map<string, LoadedScenario> {
  const { scenarios, errors } = loadEvals(root);
  for (const e of errors) core.warning(`Eval load issue at ${root}/${e.path}: ${e.message}`);
  return scenarios;
}
