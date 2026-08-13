import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  EvalForgeClient, evalRunUrl, formatAnalysisComment, formatAnalysisUnavailable,
} from '@wix/evalforge-core';
import { getAnalyzeConfig } from './config';
import { describeError, makeAnalysisCommenter } from './report';

/** Caps the reason echoed into the public comment; the full detail still reaches the log via `core.warning`. */
const MAX_COMMENT_REASON_LENGTH = 500;

/**
 * Posts EvalForge's AI investigation of a completed run to its own PR comment.
 *
 * Past the config read, nothing here calls `core.setFailed`: the investigation is advisory and
 * runs in its own job, so a red check beside a green gate would misrepresent the PR. A missing
 * input is the exception — it leaves no comment channel to report through, so it fails loudly
 * rather than going silently green.
 */
export async function runAnalyze(): Promise<void> {
  const config = getAnalyzeConfig();
  const octokit = github.getOctokit(config.githubToken);
  const comment = makeAnalysisCommenter(octokit, config);
  const runUrl = evalRunUrl(config.projectId, config.evalRunId);
  const client = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  const body = await buildBody(client, config, runUrl);
  try {
    await comment(body);
  } catch (error) {
    // `makeCommenter` already degrades to the job summary; this catches anything it cannot.
    core.warning(`Could not post the AI investigation comment: ${describeError(error)}`);
  }
}

async function buildBody(
  client: EvalForgeClient,
  config: { projectId: string; evalRunId: string },
  runUrl: string,
): Promise<string> {
  const unavailable = (reason: string) =>
    formatAnalysisUnavailable({ reason, runId: config.evalRunId, runUrl });

  try {
    const analysis = await client.analyzeEvalRun(config.projectId, config.evalRunId);
    if (analysis.summary.trim() === '' && analysis.findings.length === 0) {
      core.warning('EvalForge returned an empty analysis for this run.');
      return unavailable('EvalForge returned an empty analysis');
    }
    return formatAnalysisComment({ analysis, runId: config.evalRunId, runUrl });
  } catch (error) {
    const detail = describeError(error);
    core.warning(`The AI investigation failed: ${detail}`);
    return unavailable(detail.slice(0, MAX_COMMENT_REASON_LENGTH));
  }
}
