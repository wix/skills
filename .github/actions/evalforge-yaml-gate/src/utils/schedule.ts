import * as core from '@actions/core';
import { CODE_TAG, EvalForgeClient, evalRunUrl } from '@wix/evalforge-core';
import { getScheduleConfig } from './config';
import { pollUntilDone, EvalRunTimeoutError } from './eval-run';

export async function runSchedule(): Promise<void> {
  const config = getScheduleConfig();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  core.info(`EvalForge scheduled run — running scenarios tagged "${CODE_TAG}"`);

  const { id: evalRunId } = await evalforge.createAndRunEvalRun(config.projectId, {
    name: config.runName,
    description: `Scheduled eval run for scenarios tagged ${CODE_TAG}`,
    projectId: config.projectId,
    agentId: config.agentId,
    filter: {
      tag: CODE_TAG,
    },
  });
  core.info(`Created eval run: ${evalRunId}`);

  await evalforge.triggerEvalRun(config.projectId, evalRunId);
  core.info(`Triggered eval run: ${evalRunId}`);

  const runUrl = evalRunUrl(config.projectId, evalRunId);
  core.setOutput('run-id', evalRunId);
  core.setOutput('run-url', runUrl);

  let result;
  try {
    result = await pollUntilDone(evalforge, config.projectId, evalRunId);
  } catch (e) {
    if (e instanceof EvalRunTimeoutError) {
      core.setOutput('status', 'timeout');
      core.setOutput('summary', `Eval run timed out after 30 minutes. View: ${runUrl}`);
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
