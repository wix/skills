import * as core from "@actions/core";
import * as github from "@actions/github";
import type { Config, ValidationError } from "./config";
import type { EvalRunStatus } from "./clients";

export type Octokit = ReturnType<typeof github.getOctokit>;
export type PrContext = Pick<Config, "owner" | "repo" | "prNumber">;

export type ChangedFile = {
  filename: string;
  status: string;
  previousFilename?: string;
};

export interface ServiceFailure {
  log: string;
  comment: string;
  failReason: string;
}

export const COMMENT_MARKER = "<!-- revision-eval-action -->";

export enum ErrorMessage {
  ChangedFilesFetchFailed = "Could not retrieve PR file list",
  YamlParseFailed = "failed to parse YAML",
  JsonParseFailed = "failed to parse JSON",
  MissingTags = "missing `tags` — the scenario must declare at least one string tag",
  OpenApiResolverRequestFailed = "OpenApiResolver POST",
  RevisionStageFailed = "Could not stage preview revision for",
  McpVersionCreateFailed = "Could not create MCP version",
  McpVersionLookupFailed = "Could not look up existing MCP version",
  EvalRunCreateFailed = "Could not create eval run",
  EvalRunTriggerFailed = "Could not trigger eval run",
  EvalRunPollingFailed = "Could not poll eval run",
  EvalRunPollingTimedOut = "Revision evaluation timed out (run ID: {runId})",
  EvalRunFailed = "Eval run failed",
  EvalRunCancelled = "Eval run was cancelled",
  EvalRunUnexpectedStatus = "Eval run ended with unexpected status:",
  RevisionEvaluationFailed = "Revision evaluation failed",
}

export const MAINTAINER_SUFFIX =
  "— contact a repository maintainer if this persists";

export function getErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${err.message}: ${cause.message}`;
  }
  return err.message;
}

export function getErrorStatus(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

export function isTimeoutError(err: unknown): boolean {
  return Boolean((err as { timeout?: boolean }).timeout);
}

export function fail(message: string): void {
  core.setFailed(message);
}

export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors
    .map((e) => `- **${e.entryTitle}**: ${e.message}`)
    .join("\n");
  return [COMMENT_MARKER, "## ❌ Revision Validation: Failed", "", lines].join(
    "\n",
  );
}

export function formatServiceError(message: string): string {
  return `${COMMENT_MARKER}\n## ❌ Revision Evaluation: Error\n\n${message}`;
}

export async function reportServiceFailure(
  octokit: Octokit,
  pr: PrContext,
  opts: ServiceFailure,
): Promise<void> {
  core.error(opts.log);
  await upsertComment(octokit, pr, formatServiceError(opts.comment));
  fail(opts.failReason);
}

export function formatEvalPassed(
  metrics: EvalRunStatus["aggregateMetrics"],
  runId: string,
): string {
  return [
    COMMENT_MARKER,
    `## ✅ Revision Evaluation: Passed`,
    "",
    `Pass rate: ${metrics.passRate}%`,
    `Run ID: ${runId}`,
  ].join("\n");
}

export function formatEvalFailed(
  metrics: EvalRunStatus["aggregateMetrics"],
  runId: string,
): string {
  return [
    COMMENT_MARKER,
    `## ❌ Revision Evaluation: Failed`,
    "",
    `Pass rate: ${metrics.passRate}%`,
    `Run ID: ${runId}`,
  ].join("\n");
}

export function formatEvalTimeout(runId: string): string {
  return [
    COMMENT_MARKER,
    `## ⏱ Revision Evaluation: Timed Out`,
    "",
    `Run ID: ${runId}`,
  ].join("\n");
}

export function formatNoScenarios(tags: string[]): string {
  return [
    COMMENT_MARKER,
    `## ❌ Revision Evaluation: No Matching Scenarios`,
    "",
    `No scenarios matched tags: ${tags.map((t) => `\`${t}\``).join(", ")}`,
  ].join("\n");
}

export async function getChangedFiles(
  octokit: Octokit,
  pr: PrContext,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.prNumber,
    per_page: 100,
  });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    previousFilename: f.previous_filename,
  }));
}

export async function getChangedFilesOrReport(
  octokit: Octokit,
  pr: PrContext,
): Promise<ChangedFile[] | null> {
  try {
    return await getChangedFiles(octokit, pr);
  } catch {
    await upsertComment(
      octokit,
      pr,
      formatServiceError(ErrorMessage.ChangedFilesFetchFailed),
    );
    core.setFailed(ErrorMessage.ChangedFilesFetchFailed);
    return null;
  }
}

export async function upsertComment(
  octokit: Octokit,
  pr: PrContext,
  body: string,
): Promise<void> {
  try {
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.prNumber,
      per_page: 100,
    });
    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: pr.owner,
        repo: pr.repo,
        comment_id: existing.id,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.prNumber,
        body,
      });
    }
  } catch (e) {
    core.error(`Failed to post PR comment: ${getErrorMessage(e)}`);
    await core.summary.addRaw(body).write();
  }
}
