import * as core from '@actions/core';
import {
  classifyChangeImpact, EvalForgeClient, evalRunUrl, evaluateRunResult, foldScenarioIterations,
  formatGateResult, formatGateServiceError, pollUntilDone, selectScenarios,
  type Commenter, type EvalRunStatus, type ScenarioSelection,
} from '@wix/evalforge-core';
import { HALTED, describeError, fail, type Guarded } from './report';
import { pollToCompletion } from './run-eval';
import { startComparisonArms } from './comparison-arms';
import type { GateConfig } from './config';
import type { GateScope } from './gate-scope';

/**
 * How long to wait for the base arm once the PR arm has already completed. The base arm is
 * annotation only — it must never move or delay the verdict — so once this elapses we degrade to
 * no attribution rather than keep the job open for it.
 */
export const BASE_ARM_GRACE_MS = 60_000;

/**
 * Resolves with whatever `promise` resolves to, or `undefined` once `graceMs` elapses —
 * whichever comes first. Clears its timer either way, so a `promise` that wins early leaves
 * nothing pending behind it.
 */
function withGracePeriod<T>(promise: Promise<T>, graceMs: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), graceMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/**
 * Polls the base comparison arm to completion without ever commenting on the PR or failing the
 * gate — unlike `pollToCompletion`, whose job is exactly that. Any failure, including a timeout,
 * degrades to `undefined` rather than propagating.
 */
async function pollBaseArmSilently(
  client: EvalForgeClient,
  config: GateConfig,
  baseRunId: string | undefined,
): Promise<EvalRunStatus | undefined> {
  if (baseRunId === undefined) return undefined;
  try {
    return await pollUntilDone(client, config.projectId, baseRunId, { log: core.info, warn: core.warning });
  } catch (error) {
    core.warning(`Base comparison arm did not complete: ${describeError(error)}`);
    return undefined;
  }
}

export async function runAndReport(
  client: EvalForgeClient,
  config: GateConfig,
  scope: GateScope,
  nameToId: Map<string, string>,
  /** The version's **id**, not its label. */
  versionId: string,
  comment: Commenter,
): Promise<void> {
  const selected = await resolveScenarioIds(config, scope, nameToId, comment);
  if (!selected.ok) return;
  const selection = selected.value;

  const arms = await startComparisonArms(client, config, selection.ids, versionId);

  const runUrl = evalRunUrl(config.projectId, arms.prRunId);
  core.info(`Eval run started: ${runUrl}`);

  // Starts alongside the PR arm's own poll below, so it runs concurrently rather than adding its
  // own wait afterwards. Its bounded grace period is applied only once the PR arm is done.
  const basePoll = pollBaseArmSilently(client, config, arms.baseRunId);

  const prStatusGuard = await pollToCompletion(client, config, arms.prRunId, runUrl, comment);
  if (!prStatusGuard.ok) return;
  const prStatus = prStatusGuard.value;

  const baseStatus = await withGracePeriod(basePoll, BASE_ARM_GRACE_MS);

  // The verdict comes from the PR arm alone — unchanged from before comparison existed.
  const verdict = evaluateRunResult(prStatus);
  const prOutcomes = foldScenarioIterations(prStatus.results);
  const baseOutcomes = baseStatus === undefined ? undefined : foldScenarioIterations(baseStatus.results);
  // Never undefined: a base arm that produced nothing still classifies against `undefined`,
  // which comes back fully unattributed — that is what makes the comment say so out loud instead
  // of silently omitting the whole section.
  const impact = classifyChangeImpact(
    prOutcomes,
    baseOutcomes,
    selection.ids.map((id, index) => ({ id, name: selection.selected[index] ?? id })),
  );

  await comment(formatGateResult({
    metrics: prStatus.aggregateMetrics,
    verdict,
    runId: arms.prRunId,
    runUrl,
    selection,
    maxScenarios: config.maxScenarios,
    warnings: scope.guard.warnings,
    unmapped: scope.derived.unmapped,
    broadImpact: scope.derived.broadImpact,
    blocking: config.isBlocking,
    impact,
  }));

  if (!verdict.passed) {
    fail(`Eval gate failed: ${verdict.reasons.join('; ')}`, config.isBlocking);
  }
}

async function resolveScenarioIds(
  config: GateConfig,
  scope: GateScope,
  nameToId: Map<string, string>,
  comment: Commenter,
): Promise<Guarded<ScenarioSelection>> {
  const selection = selectScenarios({
    broadImpact: scope.derived.broadImpact,
    tags: scope.derived.tags,
    localScenarios: scope.headScenarios,
    nameToId,
    touchedScenarioPaths: scope.touchedPaths,
    maxScenarios: config.maxScenarios,
  });
  for (const name of selection.missingIds) {
    core.warning(`No EvalForge scenario found for "${name}" — it is in the repo YAML but not in EvalForge`);
  }
  if (selection.ids.length > 0) return { ok: true, value: selection };

  // A gate that resolved nothing to run must not report a green check.
  const message = 'No eval scenarios could be resolved to run, so nothing was verified';
  await comment(formatGateServiceError(message, config.isBlocking, 'Nothing Verified'));
  fail(message, config.isBlocking);
  return HALTED;
}
