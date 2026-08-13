import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  EvalForgeClient, evalRunUrl, formatAnalysisComment, formatAnalysisUnavailable, isHttpError,
} from '@wix/evalforge-core';
import { getAnalyzeConfig } from './config';
import { describeError, makeAnalysisCommenter } from './report';

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
    core.warning(`The AI investigation failed: ${describeError(error)}`);
    return unavailable(describeUnavailable(error));
  }
}

/**
 * A plain sentence per case the comment can name, and a generic one otherwise. The client's own
 * message is never repeated on the PR: it reads like a stack trace for a routine refusal, and it
 * can carry upstream-authored text that `core.setSecret` masks in logs but not in a comment body.
 */
function describeUnavailable(error: unknown): string {
  if (isTimeout(error)) return 'EvalForge timed out';
  if (isHttpError(error)) {
    if (error.status === 400) return 'the eval run had not finished when the investigation ran';
    // Named rather than folded into the generic case: a permission the app was never granted is
    // the one failure that makes every run report the same thing forever, and the gateway rejects
    // it with an HTML page carrying no usable message of its own.
    if (error.status === 401 || error.status === 403) {
      return 'EvalForge refused the request — the pipeline app may be missing the '
        + '`evalforge:v1:eval_run:analyze_eval_run` permission';
    }
    if (error.status === 408 || error.status === 504) return 'EvalForge timed out';
    if (error.status >= 500) return 'EvalForge returned an unexpected error';
  }
  return 'EvalForge could not complete the investigation';
}

/** `AbortSignal.timeout` rejects with a `TimeoutError`, an explicit abort with an `AbortError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
