import * as core from '@actions/core';
import {
  EvalForgeClient, EvalRunTimeoutError, formatGateServiceError, formatGateTimeout, pollUntilDone,
  type Commenter, type EvalRunCreated, type EvalRunStatus,
} from '@wix/evalforge-core';
import { describeError, fail, guardedCall } from './report';
import type { GateConfig } from './config';

export function startEvalRun(
  client: EvalForgeClient,
  config: GateConfig,
  scenarioIds: string[],
  /** The version's **id**, not its label — the evaluator resolves capabilityVersions by id. */
  versionId: string,
  comment: Commenter,
): Promise<EvalRunCreated | undefined> {
  return guardedCall(
    () => client.createAndRunEvalRun(config.projectId, {
      name: `${config.repoFullName} PR #${config.prNumber} (${config.versionLabel})`,
      description: `Skill gate run for PR #${config.prNumber}`,
      projectId: config.projectId,
      agentId: config.agentId,
      scenarioIds,
      capabilityIds: [config.capabilityId],
      capabilityVersions: { [config.capabilityId]: versionId },
    }),
    'Could not start the eval run', comment, config.blocking,
  );
}

/** Timeout gets its own comment; anything else is a generic service failure. */
export async function pollToCompletion(
  client: EvalForgeClient,
  config: GateConfig,
  runId: string,
  runUrl: string,
  comment: Commenter,
): Promise<EvalRunStatus | undefined> {
  try {
    return await pollUntilDone(client, config.projectId, runId, {
      log: core.info,
      warn: core.warning,
    });
  } catch (error) {
    if (error instanceof EvalRunTimeoutError) {
      await comment(formatGateTimeout(runId, runUrl, config.blocking));
      fail(error.message, config.blocking);
      return undefined;
    }
    core.error(`Polling the eval run failed: ${describeError(error)}`);
    await comment(formatGateServiceError('Polling the eval run failed', config.blocking));
    fail('Polling the eval run failed', config.blocking);
    return undefined;
  }
}
