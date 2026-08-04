import * as core from '@actions/core';
import { EvalForgeClient, type EvalRunCreated } from '@wix/evalforge-core';
import { describeError } from './report';
import type { GateConfig } from './config';

/**
 * Starts the two runs of a change-impact comparison: the PR arm pins the skill to
 * `prVersionId`, the base arm omits `capabilityVersions` entirely so the evaluator
 * live-fetches the git-linked capability at `main`. Both share `comparisonGroupId`
 * and `scenarioIds` so EvalForge can label each scenario fixed/newly-broken/etc.
 *
 * The PR arm's failure is the verdict and propagates. The base arm is annotation
 * only: a failure there warns and yields no `baseRunId`, never fails the gate.
 */
export async function startComparisonArms(
  client: EvalForgeClient,
  config: GateConfig,
  scenarioIds: string[],
  prVersionId: string,
): Promise<{ prRunId: string; baseRunId?: string }> {
  const runLabel = `${config.repoFullName} PR #${config.prNumber} (${config.versionLabel})`;
  const shared = {
    projectId: config.projectId,
    agentId: config.agentId,
    scenarioIds,
    capabilityIds: [config.capabilityId],
    comparisonGroupId: config.comparisonGroupId,
    runsPerScenario: config.runsPerScenario,
  };

  const prRun: EvalRunCreated = await client.createAndRunEvalRun(config.projectId, {
    ...shared,
    name: `${runLabel} — pr arm`,
    description: `Change-impact PR arm: skill pinned to ${config.versionLabel}`,
    comparisonLabel: 'pr',
    capabilityVersions: { [config.capabilityId]: prVersionId },
  });

  try {
    const baseRun: EvalRunCreated = await client.createAndRunEvalRun(config.projectId, {
      ...shared,
      name: `${runLabel} — base arm`,
      description: 'Change-impact base arm: skill unpinned, evaluated live at main',
      comparisonLabel: 'base',
    });
    return { prRunId: prRun.id, baseRunId: baseRun.id };
  } catch (error) {
    core.warning(`Could not start the base comparison arm: ${describeError(error)}`);
    return { prRunId: prRun.id };
  }
}
