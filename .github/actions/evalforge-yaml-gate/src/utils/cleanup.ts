import * as core from '@actions/core';
import { posix } from 'node:path';
import { getSimpleConfig } from './config';
import { EvalForgeClient, draftTagFor, withManagedTags, type RemoteScenario, type ScenarioBody } from './evalforge';
import { deletePrMcpVersions } from './pr-cleanup';
import { loadEvals, type LoadedScenario } from './evals';
import { toScenarioBody } from './sync';
import { workspaceRoot } from './workspace';
import { BASE_WORKSPACE_SUBDIR } from './paths';

export type CleanupRestoreAction = {
  kind: 'RESTORE';
  id: string;
  name: string;
  body: ScenarioBody;
  tags: string[];
};
export type CleanupDeleteAction = { kind: 'DELETE'; id: string; name: string };
export type CleanupAction = CleanupRestoreAction | CleanupDeleteAction;

// Pure: decide what to do with each draft-tagged scenario on PR close-without-merge.
// If the scenario's name matches one in the base SHA's evals, it pre-existed our PR — RESTORE
// it from the base YAML's state. Otherwise it was a PR-only draft — DELETE it.
export function planCleanup(
  remote: RemoteScenario[],
  baseEvals: Map<string, LoadedScenario>,
  draftTag: string,
  repo: string,
): CleanupAction[] {
  const actions: CleanupAction[] = [];
  for (const s of remote) {
    if (!s.tags.includes(draftTag)) continue;
    const baseLs = baseEvals.get(s.name);
    actions.push(baseLs
      ? { kind: 'RESTORE', id: s.id, name: s.name, body: toScenarioBody(baseLs.scenario), tags: withManagedTags(baseLs.scenario.tags, repo) }
      : { kind: 'DELETE', id: s.id, name: s.name });
  }
  return actions;
}

export async function runCleanup(): Promise<void> {
  const config = getSimpleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  await deletePrMcpVersions(evalforge, config.mcpId, config.projectId, config.prNumber);

  let remote: RemoteScenario[];
  try {
    remote = await evalforge.listTestScenarios(config.projectId, { tags: [draftTag] });
  } catch (e) {
    core.warning(`listTestScenarios failed: ${errMsg(e)}`);
    return;
  }

  const baseRoot = posix.join(workspaceRoot(), BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseEvals, errors: baseErrs } = loadEvals(baseRoot);
  for (const e of baseErrs) core.warning(`Base SHA eval issue at ${baseRoot}/${e.path}: ${e.message}`);

  const plan = planCleanup(remote, baseEvals, draftTag, `${config.owner}/${config.repo}`);
  const summary = plan.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {} as Record<string, number>);
  core.info(`Cleanup plan: ${plan.length} action(s) — RESTORE=${summary.RESTORE ?? 0} DELETE=${summary.DELETE ?? 0}`);

  for (const a of plan) await execute(evalforge, config.projectId, a);
}

async function execute(client: EvalForgeClient, projectId: string, a: CleanupAction): Promise<void> {
  try {
    if (a.kind === 'RESTORE') {
      await client.updateTestScenario(projectId, a.id, a.body, a.tags);
      core.info(`Restored ${a.name} from base SHA (pre-PR state)`);
    } else {
      await client.deleteTestScenario(projectId, a.id);
      core.info(`Deleted draft ${a.name}`);
    }
  } catch (e) {
    const verb = a.kind === 'RESTORE' ? 'Restore' : 'Delete draft';
    core.warning(`${verb} failed for ${a.name}: ${errMsg(e)}`);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
