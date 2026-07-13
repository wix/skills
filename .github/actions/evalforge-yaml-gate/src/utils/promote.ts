import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, DRAFT_PREFIX, draftTagFor, uniqueRemoteScenarios, withManagedTags } from './evalforge';
import { loadEvals, type LoadedScenario } from './evals';
import { toScenarioBody } from './sync';
import { deletePrMcpVersions } from './pr-cleanup';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import { workspaceRoot } from './workspace';

export async function runPromote(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const repo = `${config.owner}/${config.repo}`;
  const draftTag = draftTagFor(repo, config.prNumber);
  const workspace = workspaceRoot();

  // Cleanup workflow no longer fires on merged PRs — promote owns MCP version teardown.
  await deletePrMcpVersions(evalforge, config.mcpId, config.projectId, config.prNumber);

  const headScenarios = loadEvalsWithWarnings(workspace);
  const baseEvals = loadEvalsWithWarnings(posix.join(workspace, BASE_WORKSPACE_SUBDIR));
  const deletedScenarioNames = [...baseEvals.keys()]
    .filter(name => !headScenarios.has(name))
    .sort();

  let remote;
  try {
    const [drafts, deleted] = await Promise.all([
      evalforge.listTestScenarios(config.projectId, { tags: [draftTag] }),
      deletedScenarioNames.length > 0
        ? evalforge.listTestScenarios(config.projectId, { names: deletedScenarioNames })
        : Promise.resolve([]),
    ]);
    remote = uniqueRemoteScenarios([...drafts, ...deleted]);
  } catch (e) {
    core.warning(`listTestScenarios failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const remoteByName = new Map(remote.map(r => [r.name, r]));

  let promoted = 0;
  let droppedDrafts = 0;

  for (const s of remote) {
    if (!s.tags.includes(draftTag)) continue;
    const ls = headScenarios.get(s.name);
    if (!ls) {
      // Scenario was created or stamped by this PR but no YAML survived to the merged head
      // (e.g. user added then removed the file, or force-pushed past the add). The merge
      // commit is the source of truth — delete the orphan rather than leaving it draft-tagged.
      try {
        await evalforge.deleteTestScenario(config.projectId, s.id);
        droppedDrafts++;
        core.info(`Deleted orphaned draft ${s.name} (${s.id}) — no matching YAML in merged head`);
      } catch (e) {
        core.warning(`Delete orphaned draft failed for ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    try {
      const tags = withManagedTags(ls.scenario.tags, repo);
      await evalforge.updateTestScenario(config.projectId, s.id, toScenarioBody(ls.scenario), tags);
      promoted++;
      core.info(`Promoted ${s.name}: tags = ${JSON.stringify(tags)}`);
    } catch (e) {
      core.warning(`Promote failed for ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
  if (droppedDrafts > 0) core.info(`Deleted ${droppedDrafts} orphaned draft scenario(s)`);
}

function loadEvalsWithWarnings(root: string): Map<string, LoadedScenario> {
  const { scenarios, errors } = loadEvals(root);
  for (const e of errors) core.warning(`Eval load issue at ${root}/${e.path}: ${e.message}`);
  return scenarios;
}
