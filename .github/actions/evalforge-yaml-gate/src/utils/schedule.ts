import * as core from '@actions/core';
import {
  CODE_TAG,
  EvalForgeClient,
  evalRunUrl,
  type EvalRunStatus,
  type RunStatus,
} from '@wix/evalforge-core';
import { getScheduleConfig, type ScheduleConfig } from './config';
import { pollUntilDone, EvalRunTimeoutError } from './eval-run';

const BATCH_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

type BatchMetrics = EvalRunStatus['aggregateMetrics'];

type BatchOutcome =
  | { kind: 'done'; label: string; runId: string; runUrl: string; status: RunStatus; metrics: BatchMetrics }
  | { kind: 'timeout'; label: string; runId: string; runUrl: string }
  | { kind: 'error'; label: string; message: string };

async function runBatch(
  evalforge: EvalForgeClient,
  config: ScheduleConfig,
  scenarioIds: string[],
  index: number,
  total: number,
): Promise<BatchOutcome> {
  const label = `batch ${index + 1}/${total}`;

  let evalRunId: string;
  try {
    // `/eval-runs/run` creates AND starts the run in one call — no separate trigger.
    ({ id: evalRunId } = await evalforge.createAndRunEvalRun(config.projectId, {
      name: `${config.runName} batch (${index + 1}/${total})`,
      description: `Scheduled eval run (${label}) for scenarios tagged ${CODE_TAG}`,
      projectId: config.projectId,
      agentId: config.agentId,
      tags: [CODE_TAG],
      scenarioIds,
      capabilityIds: [config.mcpId],
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.error(`${label}: failed to create eval run — ${message}`);
    return { kind: 'error', label, message };
  }

  const runUrl = evalRunUrl(config.projectId, evalRunId);
  core.info(`Created eval run for ${label}: ${evalRunId} (${scenarioIds.length} scenario(s))`);

  try {
    const result = await pollUntilDone(evalforge, config.projectId, evalRunId);
    core.info(`${label} finished: ${result.status}`);
    return { kind: 'done', label, runId: evalRunId, runUrl, status: result.status, metrics: result.aggregateMetrics };
  } catch (e) {
    if (e instanceof EvalRunTimeoutError) {
      core.error(`${label} timed out. View: ${runUrl}`);
      return { kind: 'timeout', label, runId: evalRunId, runUrl };
    }
    const message = e instanceof Error ? e.message : String(e);
    core.error(`${label}: polling failed — ${message}`);
    return { kind: 'error', label, message };
  }
}

export async function runSchedule(): Promise<void> {
  const config = getScheduleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  core.info(`EvalForge scheduled run — running scenarios tagged "${CODE_TAG}"`);

  // Tags are not expanded server-side; resolve them to explicit scenario ids.
  // A tags-only run would evaluate nothing.
  const scenarios = await evalforge.listTestScenariosByTag(config.projectId, CODE_TAG);
  const scenarioIds = scenarios.map(s => s.id);
  if (scenarioIds.length === 0) {
    core.info(`No scenarios tagged "${CODE_TAG}" — nothing to run.`);
    core.setOutput('status', 'skipped');
    core.setOutput('passed', '0');
    core.setOutput('failed', '0');
    core.setOutput('total', '0');
    core.setOutput('pass-rate', '0');
    core.setOutput('summary', `No scenarios tagged ${CODE_TAG}.`);
    return;
  }
  core.info(`Resolved ${scenarioIds.length} scenario(s) tagged "${CODE_TAG}".`);

  // Split into batches of BATCH_SIZE and run them all in parallel. We wait for
  // every batch to finish (successes, timeouts, and errors alike) so a single
  // Slack notification can report the aggregate across the whole run.
  const batches = chunk(scenarioIds, BATCH_SIZE);
  core.info(`Split into ${batches.length} batch(es) of up to ${BATCH_SIZE} scenario(s) — running in parallel.`);

  const outcomes = await Promise.all(
    batches.map((ids, i) => runBatch(evalforge, config, ids, i, batches.length)),
  );

  const done = outcomes.filter((o): o is Extract<BatchOutcome, { kind: 'done' }> => o.kind === 'done');
  const timedOut = outcomes.filter(o => o.kind === 'timeout');
  const errored = outcomes.filter((o): o is Extract<BatchOutcome, { kind: 'error' }> => o.kind === 'error');

  // Aggregate assertion counts across every batch that produced results.
  const agg = done.reduce(
    (acc, o) => ({
      passed: acc.passed + o.metrics.passed,
      failed: acc.failed + o.metrics.failed,
      total: acc.total + o.metrics.totalAssertions,
    }),
    { passed: 0, failed: 0, total: 0 },
  );
  // Recompute the rate from totals — averaging per-batch rates would misweight
  // batches with different assertion counts.
  const pct = agg.total > 0 ? Math.round((agg.passed / agg.total) * 100) : 0;

  // A single results link for the Slack button; point at the first batch that has one.
  const firstRunUrl = outcomes.find(o => o.kind !== 'error')?.runUrl ?? '';
  if (firstRunUrl) core.setOutput('run-url', firstRunUrl);

  // If no batch produced any results at all, there is nothing to report — stay
  // quiet in Slack (status is neither 'completed' nor 'failed') and fail the job.
  if (done.length === 0) {
    core.setOutput('status', 'error');
    core.setOutput('summary', `All ${batches.length} batch(es) failed to produce results.`);
    core.setFailed(`No batch produced results (${timedOut.length} timed out, ${errored.length} errored).`);
    return;
  }

  const hasFailures = agg.failed > 0 || done.some(o => o.status === 'failed');
  const hasProblems = hasFailures || timedOut.length > 0 || errored.length > 0;

  core.setOutput('status', hasProblems ? 'failed' : 'completed');
  core.setOutput('passed', String(agg.passed));
  core.setOutput('failed', String(agg.failed));
  core.setOutput('total', String(agg.total));
  core.setOutput('pass-rate', String(pct));

  const parts = [`${pct}% pass rate — ${agg.passed}/${agg.total} assertions passed, ${agg.failed} failed`];
  parts.push(`across ${done.length}/${batches.length} batch(es)`);
  if (timedOut.length > 0) parts.push(`${timedOut.length} timed out`);
  if (errored.length > 0) parts.push(`${errored.length} errored`);
  core.setOutput('summary', parts.join(' · '));

  if (hasProblems) {
    const reasons = [];
    if (hasFailures) reasons.push(`${agg.failed} assertion(s) failed (${pct}% pass rate)`);
    if (timedOut.length > 0) reasons.push(`${timedOut.length} batch(es) timed out`);
    if (errored.length > 0) reasons.push(`${errored.length} batch(es) errored`);
    core.setFailed(reasons.join('; '));
  }
}