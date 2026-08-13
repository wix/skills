import * as core from '@actions/core';
import { EvalForgeClient, type Commenter } from '@wix/evalforge-core';
import { HALTED, describeError, guardedCall, type Guarded } from './report';
import type { GateConfig } from './config';

export type ComparisonArms = {
  prRunId: string;
  /**
   * The base arm's run id, or `undefined` when it could not be started. A promise because its
   * creation is deliberately off the verdict's critical path; it never rejects.
   */
  baseRun: Promise<string | undefined>;
};

/**
 * Starts the two runs of a change-impact comparison: the PR arm pins the skill to
 * `prVersionId`, the base arm omits `capabilityVersions` entirely so the evaluator
 * live-fetches the git-linked capability at `main`. Both share `comparisonGroupId`
 * and `scenarioIds` so EvalForge can label each scenario fixed/newly-broken/etc.
 *
 * The PR arm's failure is the verdict: it is reported on the PR and halts the gate through the
 * usual guarded path. The base arm is annotation only — its creation is neither awaited nor
 * allowed to fail the gate, so a slow or broken base create cannot delay the PR arm's first poll.
 */
export async function startComparisonArms(
  client: EvalForgeClient,
  config: GateConfig,
  scenarioIds: string[],
  prVersionId: string,
  comment: Commenter,
): Promise<Guarded<ComparisonArms>> {
  const runLabel = `${config.repoFullName} PR #${config.prNumber} (${config.versionLabel})`;
  const shared = {
    projectId: config.projectId,
    agentId: config.agentId,
    scenarioIds,
    capabilityIds: [config.capabilityId],
    comparisonGroupId: config.comparisonGroupId,
    runsPerScenario: config.runsPerScenario,
  };

  const prRun = await guardedCall(
    () => client.createAndRunEvalRun(config.projectId, {
      ...shared,
      name: `${runLabel} — pr arm`,
      description: `Change-impact PR arm: skill pinned to ${config.versionLabel}`,
      comparisonLabel: 'pr',
      capabilityVersions: { [config.capabilityId]: prVersionId },
    }),
    { message: 'Could not start the eval run', label: 'Run Not Started' },
    comment, config.isBlocking,
  );
  if (!prRun.ok) return HALTED;

  const baseRun = client.createAndRunEvalRun(config.projectId, {
    ...shared,
    name: `${runLabel} — base arm`,
    // The base arm pins no version, so this description is the only place that records what
    // "main" actually meant at run time — the base arm's own EvalForge page is where an operator
    // comparing the two arms will look for it.
    description: `Change-impact base arm: skill unpinned, evaluated live at main (base commit ${config.baseSha.slice(0, 7)})`,
    comparisonLabel: 'base',
  })
    .then(created => created.id)
    .catch((error: unknown) => {
      core.warning(`Base comparison arm: could not be started: ${describeError(error)}`);
      return undefined;
    });

  return { ok: true, value: { prRunId: prRun.value.id, baseRun } };
}
