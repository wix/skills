import * as core from '@actions/core';
import {
  classifyChangeImpact, EvalForgeClient, evalRunUrl, evaluateRunResult, foldScenarioIterations,
  formatAnalysisSuperseded, formatGateResult, formatGateServiceError, selectScenarios,
  type Commenter, type ScenarioSelection,
} from '@wix/evalforge-core';
import { HALTED, fail, type Guarded } from './report';
import { pollToCompletion } from './run-eval';
import { startComparisonArms } from './comparison-arms';
import { startBaseAttribution } from './base-attribution';
import type { GateConfig } from './config';
import type { GateScope } from './gate-scope';

export async function runAndReport(
  client: EvalForgeClient,
  config: GateConfig,
  scope: GateScope,
  nameToId: Map<string, string>,
  /** The version's **id**, not its label. */
  versionId: string,
  comment: Commenter,
  /** Update-only, so a PR that never failed gets no investigation comment to retract. */
  supersedeAnalysis: Commenter,
): Promise<void> {
  const selected = await resolveScenarioIds(config, scope, nameToId, comment);
  if (!selected.ok) return;
  const selection = selected.value;

  const arms = await startComparisonArms(client, config, selection.ids, versionId, comment);
  if (!arms.ok) return;

  const runUrl = evalRunUrl(config.projectId, arms.value.prRunId);
  core.info(`Eval run started: ${runUrl}`);

  // Runs concurrently with the PR arm's own poll below rather than adding a wait after it. The
  // `finally` is what keeps the base arm from outliving the verdict on the paths that return
  // early — a PR-arm timeout or poll failure never reaches `collect`.
  const attribution = startBaseAttribution(client, config, arms.value.baseRun);
  try {
    const prStatusGuard = await pollToCompletion(client, config, arms.value.prRunId, runUrl, comment);
    if (!prStatusGuard.ok) return;
    const prStatus = prStatusGuard.value;

    const baseStatus = await attribution.collect();

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
      runId: arms.value.prRunId,
      runUrl,
      selection,
      maxScenarios: config.maxScenarios,
      warnings: scope.guard.warnings,
      unmapped: scope.derived.unmapped,
      broadImpact: scope.derived.broadImpact,
      blocking: config.isBlocking,
      impact,
      runsPerScenario: config.runsPerScenario,
    }));

    // The analyze job's whole trigger condition. Emitted only when there is something to
    // investigate, so a green run starts no runner and adds no second comment. Keyed on the
    // assertion counts rather than the verdict: in soak mode a run with real failures still
    // passes, and those are the runs most worth investigating.
    const { failed, errors } = prStatus.aggregateMetrics;
    if (failed > 0 || errors > 0) {
      core.setOutput('analyze-run-id', arms.value.prRunId);
    } else if (verdict.passed) {
      // Nothing else clears the investigation: it is only ever written on failure, and its job does
      // not start for a clean run. Without this the fixing push leaves a green verdict sitting above
      // the findings of the run it fixed.
      //
      // Guarded on the verdict, not just the counts: a cancelled run and a run that produced no
      // assertions both fail the verdict with `failed` and `errors` at zero. Retracting there would
      // claim the failures were gone beside a red check, and delete the findings that still apply.
      await supersedeAnalysis(formatAnalysisSuperseded({ runId: arms.value.prRunId, runUrl }));
    }

    if (!verdict.passed) {
      fail(`Eval gate failed: ${verdict.reasons.join('; ')}`, config.isBlocking);
    }
  } finally {
    attribution.cancel();
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
