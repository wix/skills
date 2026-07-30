import * as core from '@actions/core';
import { EvalForgeClient, SyncActionKind, formatGateServiceError, type Commenter, type SyncAction } from '@wix/evalforge-core';
import { describeError, fail } from './report';
import type { GateConfig } from './config';

/**
 * Applies the plan, recording ids CREATE returns. Stops on failure: a half-synced set would
 * report on the wrong content.
 */
export async function applySyncPlan(
  client: EvalForgeClient,
  config: GateConfig,
  actions: SyncAction[],
  nameToId: Map<string, string>,
  comment: Commenter,
): Promise<boolean> {
  for (const action of actions) {
    try {
      if (action.kind === SyncActionKind.CREATE) {
        const created = await client.createTestScenario(config.projectId, action.body, action.tags);
        nameToId.set(action.name, created.id);
        core.info(`Created scenario ${action.name} (${created.id})`);
      } else if (action.kind === SyncActionKind.UPDATE) {
        await client.updateTestScenario(config.projectId, action.id, action.body, action.tags);
        core.info(`Updated scenario ${action.name} (${action.id})`);
      } else if (action.kind === SyncActionKind.DELETE) {
        await client.deleteTestScenario(config.projectId, action.id);
        nameToId.delete(action.name);
        core.info(`Deleted draft scenario ${action.name} (${action.id})`);
      } else {
        core.info(`Deferring DELETE of "${action.name}" — handled at merge`);
      }
    } catch (error) {
      core.error(`Sync action ${action.kind} for ${action.name} failed: ${describeError(error)}`);
      await comment(formatGateServiceError(
        `Sync failed for "${action.name}"`, config.isBlocking, 'Scenario Sync Failed',
      ));
      fail(`Sync failed for ${action.name}`, config.isBlocking);
      return false;
    }
  }
  return true;
}
