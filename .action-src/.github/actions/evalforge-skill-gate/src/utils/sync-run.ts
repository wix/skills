import * as core from '@actions/core';
import * as github from '@actions/github';
import { EvalForgeClient, getFirstCommitAuthorEmail, isWixAuthorEmail, loadScenarios, planScenarioSync, type ScenarioSyncAction, type ScenarioSyncSkip } from '@wix/evalforge-core';
import { getSyncConfig } from './config';
import { workspaceRoot } from './workspace';

export type ApplyPlanResult = { hasFailures: boolean };

/**
 * Applies a sync plan against EvalForge: CREATE/UPDATE/DELETE per action.
 * Per-action failures are surfaced as warnings and tracked in the returned flag rather than
 * aborting the loop, so a partial failure doesn't skip unrelated actions.
 */
export async function applyPlan(
  client: EvalForgeClient,
  projectId: string,
  plan: { actions: ScenarioSyncAction[]; skipped: ScenarioSyncSkip[] },
): Promise<ApplyPlanResult> {
  let hasFailures = false;

  for (const action of plan.actions) {
    try {
      if (action.kind === 'CREATE') {
        const created = await client.createTestScenario(projectId, action.body, action.tags);
        core.info(`Created scenario ${action.name} (${created.id})`);
      } else if (action.kind === 'UPDATE') {
        await client.updateTestScenario(projectId, action.id, action.body, action.tags);
        core.info(`Updated scenario ${action.name} (${action.id})`);
      } else {
        await client.deleteTestScenario(projectId, action.id);
        core.info(`Deleted scenario ${action.name} (${action.id})`);
      }
    } catch (e) {
      core.warning(`Sync action ${action.kind} for "${action.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
      hasFailures = true;
    }
  }

  return { hasFailures };
}

export async function runSync(): Promise<void> {
  const config = getSyncConfig();

  const octokit = github.getOctokit(config.githubToken);
  const [owner, repoName] = config.repo.split('/', 2);
  const authorEmail = await getFirstCommitAuthorEmail(octokit, owner, repoName, config.prNumber);
  if (!isWixAuthorEmail(authorEmail)) {
    core.info('Skipping wix-app sync — PR author is not a @wix.com address');
    return;
  }

  const workspace = workspaceRoot();

  const { scenarios, errors } = loadScenarios(workspace, config.evalsGlob);
  if (errors.length > 0) {
    for (const e of errors) core.error(`${e.path}: ${e.message}`);
    core.setFailed(`Invalid YAML or duplicate names: ${errors.length}`);
    return;
  }

  const local = Array.from(scenarios.values()).map(loaded => loaded.scenario);
  const client = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const remote = await client.listTestScenarios(config.projectId);
  const plan = planScenarioSync({ local, remote, repo: config.repo });

  const createCount = plan.actions.filter(a => a.kind === 'CREATE').length;
  const updateCount = plan.actions.filter(a => a.kind === 'UPDATE').length;
  const deleteCount = plan.actions.filter(a => a.kind === 'DELETE').length;
  core.info(
    `Sync plan for ${config.repo}: ${createCount} create, ${updateCount} update, ${deleteCount} delete, `
    + `${plan.skipped.length} skipped (unmanaged)`,
  );
  for (const action of plan.actions) core.info(`  ${action.kind} ${action.name}`);
  for (const skip of plan.skipped) core.info(`  SKIP ${skip.name} (${skip.reason})`);

  const result = await applyPlan(client, config.projectId, plan);
  if (result.hasFailures) {
    core.setFailed('One or more sync actions failed — see warnings above; re-run to retry');
  }
}
