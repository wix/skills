import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, DRAFT_PREFIX, draftTagFor, type RemoteScenario } from './evalforge';
import { loadEvals, type LoadedScenario } from './evals';
import { toScenarioBody } from './sync';
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

  let drafts: RemoteScenario[];
  try {
    drafts = await evalforge.queryTestScenarios(config.projectId, { tags: [draftTag] });
  } catch (e) {
    core.warning(`queryTestScenarios (by draftTag) failed: ${e instanceof Error ? e.message : String(e)}`);
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
      core.warning(`Promote failed for ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const baseEvals = loadEvalsWithWarnings(posix.join(workspace, BASE_WORKSPACE_SUBDIR));
  for (const [name] of baseEvals) {
    if (headScenarios.has(name)) continue;
    const lookup = await lookupByName(evalforge, config.projectId, name);
    if (lookup.error) { lookupFailures++; continue; }
    const r = lookup.scenario;
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
  if (lookupFailures > 0) core.warning(`${lookupFailures} scenario lookup(s) failed during promote — YAML-removed scenarios may not have been cleaned up. Re-run the workflow to retry.`);
}

function loadEvalsWithWarnings(root: string): Map<string, LoadedScenario> {
  const { scenarios, errors } = loadEvals(root);
  for (const e of errors) core.warning(`Eval load issue at ${root}/${e.path}: ${e.message}`);
  return scenarios;
}

// Server-side filter is SQL LIKE %name% (substring) — exact-match client-side.
// Returns { scenario, error: false } on success (scenario may be undefined if no exact match).
// Returns { error: true } on transport failure so callers can tally distinct from "not found".
type LookupResult = { scenario: RemoteScenario | undefined; error: false } | { error: true };
async function lookupByName(client: EvalForgeClient, projectId: string, name: string): Promise<LookupResult> {
  try {
    const matches = await client.queryTestScenarios(projectId, { name });
    return { scenario: matches.find(s => s.name === name), error: false };
  } catch (e) {
    core.warning(`queryTestScenarios (by name "${name}") failed: ${e instanceof Error ? e.message : String(e)}`);
    return { error: true };
  }
}
