import * as core from '@actions/core';
import { CODE_TAG, EvalForgeClient, evalRunUrl } from '@wix/evalforge-core';
import { getScheduleConfig } from './config';
import { pollUntilDone, EvalRunTimeoutError } from './eval-run';

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

  // `/eval-runs/run` creates AND starts the run in one call — no separate trigger.
  const { id: evalRunId } = await evalforge.createAndRunEvalRun(config.projectId, {
    name: config.runName,
    description: `Scheduled eval run for scenarios tagged ${CODE_TAG}`,
    projectId: config.projectId,
    agentId: config.agentId,
    tags: [CODE_TAG],
    scenarioIds,
    capabilityIds: [config.mcpId],
  });
  core.info(`Created eval run: ${evalRunId}`);

  const runUrl = evalRunUrl(config.projectId, evalRunId);
  core.setOutput('run-id', evalRunId);
  core.setOutput('run-url', runUrl);

  let result;
  try {
    result = await pollUntilDone(evalforge, config.projectId, evalRunId);
  } catch (e) {
    if (e instanceof EvalRunTimeoutError) {
      core.setOutput('status', 'timeout');
      core.setOutput('summary', `Eval run timed out after 3.5 hours. View: ${runUrl}`);
      core.setFailed(e.message);
      return;
    }
    throw e;
  }

  const { passed, failed, totalAssertions, passRate } = result.aggregateMetrics;
  const pct = Math.round(passRate);

  core.setOutput('status', result.status);
  core.setOutput('passed', String(passed));
  core.setOutput('failed', String(failed));
  core.setOutput('total', String(totalAssertions));
  core.setOutput('pass-rate', String(pct));
  core.setOutput('run-url', runUrl);
  core.setOutput('summary', `${pct}% pass rate — ${passed}/${totalAssertions} assertions passed, ${failed} failed`);

  if (result.status === 'failed' || failed > 0) {
    core.setFailed(`${failed} assertion(s) failed (${pct}% pass rate)`);
  }
}
