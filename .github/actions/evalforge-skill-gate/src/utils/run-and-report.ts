import * as core from '@actions/core';
import {
  EvalForgeClient, evalRunUrl, evaluateRunResult, formatGateResult, formatGateServiceError,
  selectScenarios, type Commenter, type ScenarioSelection,
} from '@wix/evalforge-core';
import { HALTED, fail, type Guarded } from './report';
import { pollToCompletion, startEvalRun } from './run-eval';
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
): Promise<void> {
  const selected = await resolveScenarioIds(config, scope, nameToId, comment);
  if (!selected.ok) return;
  const selection = selected.value;

  const run = await startEvalRun(client, config, selection.ids, versionId, comment);
  if (!run.ok) return;

  const runUrl = evalRunUrl(config.projectId, run.value.id);
  core.info(`Eval run started: ${runUrl}`);

  const status = await pollToCompletion(client, config, run.value.id, runUrl, comment);
  if (!status.ok) return;

  const verdict = evaluateRunResult(status.value);
  await comment(formatGateResult({
    metrics: status.value.aggregateMetrics,
    verdict,
    runId: run.value.id,
    runUrl,
    selection,
    maxScenarios: config.maxScenarios,
    warnings: scope.guard.warnings,
    unmapped: scope.derived.unmapped,
    broadImpact: scope.derived.broadImpact,
    blocking: config.isBlocking,
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
