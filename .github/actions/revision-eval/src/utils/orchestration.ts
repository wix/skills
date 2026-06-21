import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getEvalConfig,
  getCleanupConfig,
  loadFixture,
  type Fixture,
} from "./config";
import {
  EvalForgeClient,
  EvalRunStatusStatus,
  OpenApiResolverClient,
} from "./clients";
import { changedScenarioFiles, collectScenarioTags } from "./scenarios";
import {
  getErrorMessage,
  getChangedFilesOrReport,
  upsertComment,
  fail,
  reportServiceFailure,
  formatValidationErrors,
  formatServiceError,
  formatEvalPassed,
  formatEvalFailed,
  formatEvalTimeout,
  formatNoScenarios,
  ErrorMessage,
  MAINTAINER_SUFFIX,
  getErrorStatus,
  isTimeoutError,
} from "./reporting";
import type { ChangedFile, Octokit, PrContext } from "./reporting";
import type { EvalRunStatus } from "./clients";

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const RETRY_LIMIT = 5;
const RETRY_DELAY_MS = 10_000;

export async function collectScenarioTagsOrReport(
  octokit: Octokit,
  pr: PrContext,
  changedScenarios: ChangedFile[],
  workspaceRoot: string,
): Promise<string[] | null> {
  try {
    return collectScenarioTags(changedScenarios, workspaceRoot);
  } catch (e) {
    const message = getErrorMessage(e);
    core.error(`Invalid scenario: ${message}`);
    await upsertComment(
      octokit,
      pr,
      formatValidationErrors([{ entryTitle: "Scenario", message }]),
    );
    core.setFailed(message);
    return null;
  }
}

export async function loadFixtureOrReport(
  octokit: Octokit,
  pr: PrContext,
  workspaceRoot: string,
  blocking: boolean,
): Promise<Fixture | null> {
  try {
    return loadFixture(workspaceRoot);
  } catch (e) {
    await reportServiceFailure(octokit, pr, {
      log: `Failed to load entity fixture: ${getErrorMessage(e)}`,
      comment: `Could not load entity fixture ${MAINTAINER_SUFFIX}`,
      failReason: "Could not load entity fixture",
      blocking,
    });
    return null;
  }
}

export async function stageRevisionOrReport(
  octokit: Octokit,
  pr: PrContext,
  fixture: Fixture,
  commitHash: string,
  blocking: boolean,
): Promise<string | null> {
  const resolver = new OpenApiResolverClient();
  try {
    const { resourceId } = await resolver.entityToRevision(
      fixture.entity,
      commitHash,
    );
    core.info(
      `Staged revision for ${fixture.path} → resourceId ${resourceId} (commitHash ${commitHash})`,
    );
    return resourceId;
  } catch (e) {
    await reportServiceFailure(octokit, pr, {
      log: `Failed to stage revision for ${fixture.path}: ${getErrorMessage(e)}`,
      comment: `${ErrorMessage.RevisionStageFailed} \`${fixture.path}\` ${MAINTAINER_SUFFIX}`,
      failReason: `${ErrorMessage.RevisionStageFailed} ${fixture.path}`,
      blocking,
    });
    return null;
  }
}

export async function createMcpVersionOrReport(
  octokit: Octokit,
  pr: PrContext,
  evalforge: EvalForgeClient,
  mcpId: string,
  projectId: string,
  commitHash: string,
  prNumber: number,
  blocking: boolean,
): Promise<string | null> {
  try {
    const mcpVersion = await evalforge.createMcpVersion(
      mcpId,
      projectId,
      commitHash,
      prNumber,
    );
    core.info(`Created MCP version ${commitHash} (${mcpVersion.id})`);
    return mcpVersion.id;
  } catch (e) {
    const status = getErrorStatus(e);
    if (status === 409) {
      core.warning(
        `MCP version ${commitHash} already exists — looking up existing version`,
      );
      try {
        const versions = await evalforge.listMcpVersions(mcpId, projectId);
        const existing = versions.find((v) => v.version === commitHash);
        if (!existing)
          throw new Error(`Version ${commitHash} not found after 409`);
        core.info(
          `Reusing existing MCP version ${commitHash} (${existing.id})`,
        );
        return existing.id;
      } catch (lookupErr) {
        await reportServiceFailure(octokit, pr, {
          log: `Failed to look up existing MCP version: ${getErrorMessage(lookupErr)}`,
          comment: `${ErrorMessage.McpVersionLookupFailed} ${MAINTAINER_SUFFIX}`,
          failReason: ErrorMessage.McpVersionLookupFailed,
          blocking,
        });
        return null;
      }
    }

    await reportServiceFailure(octokit, pr, {
      log: `Failed to create MCP version: ${getErrorMessage(e)}`,
      comment: `${ErrorMessage.McpVersionCreateFailed} ${MAINTAINER_SUFFIX}`,
      failReason: ErrorMessage.McpVersionCreateFailed,
      blocking,
    });
    return null;
  }
}

export async function reportEvalResult(
  octokit: Octokit,
  pr: PrContext,
  finalStatus: EvalRunStatus,
  runId: string,
  blocking: boolean,
): Promise<void> {
  const { aggregateMetrics: m } = finalStatus;

  switch (finalStatus.status) {
    case EvalRunStatusStatus.Completed:
      if (m.failed === 0 && m.errors === 0) {
        await upsertComment(octokit, pr, formatEvalPassed(m, runId));
        core.info(
          `Eval passed — ${m.passed}/${m.totalAssertions} assertions passed (pass rate: ${m.passRate}%, run ID: ${runId})`,
        );
      } else {
        await upsertComment(octokit, pr, formatEvalFailed(m, runId, blocking));
        core.info(
          `Eval result — ${m.failed} assertions failed, ${m.errors} errors, ${m.passed}/${m.totalAssertions} passed (pass rate: ${m.passRate}%, run ID: ${runId})`,
        );
        fail(
          `${ErrorMessage.RevisionEvaluationFailed} (pass rate: ${m.passRate}%)`,
          blocking,
        );
      }
      return;
    case EvalRunStatusStatus.Failed:
      await upsertComment(
        octokit,
        pr,
        formatServiceError(
          `${ErrorMessage.EvalRunFailed} ${MAINTAINER_SUFFIX} (run ID: ${runId})`,
          blocking,
        ),
      );
      fail(`${ErrorMessage.EvalRunFailed} (run ID: ${runId})`, blocking);
      return;
    case EvalRunStatusStatus.Cancelled:
      await upsertComment(
        octokit,
        pr,
        formatServiceError(
          `${ErrorMessage.EvalRunCancelled} (run ID: ${runId})`,
          blocking,
        ),
      );
      fail(`${ErrorMessage.EvalRunCancelled} (run ID: ${runId})`, blocking);
      return;
    default:
      await upsertComment(
        octokit,
        pr,
        formatServiceError(
          `${ErrorMessage.EvalRunUnexpectedStatus} ${finalStatus.status} (run ID: ${runId})`,
          blocking,
        ),
      );
      fail(
        `${ErrorMessage.EvalRunUnexpectedStatus} ${finalStatus.status}`,
        blocking,
      );
  }
}

export async function createEvalRunOrReport(
  octokit: Octokit,
  pr: PrContext,
  evalforge: EvalForgeClient,
  projectId: string,
  prNumber: number,
  tags: string[],
  agentId: string,
  mcpId: string,
  mcpVersionId: string,
  blocking: boolean,
): Promise<string | null> {
  try {
    const run = await evalforge.createEvalRun(projectId, {
      name: `PR #${prNumber} revision eval`,
      description: `Revision eval for PR #${prNumber}`,
      projectId,
      tags,
      agentId,
      capabilityIds: [mcpId],
      capabilityVersions: { [mcpId]: mcpVersionId },
    });
    core.info(
      `Created EvalForge run: https://bo.wix.com/pages/evalforge/${projectId}/results?runId=${run.id}`,
    );

    return run.id;
  } catch (e) {
    await reportServiceFailure(octokit, pr, {
      log: `Failed to create eval run: ${getErrorMessage(e)}`,
      comment: `${ErrorMessage.EvalRunCreateFailed} ${MAINTAINER_SUFFIX}`,
      failReason: ErrorMessage.EvalRunCreateFailed,
      blocking,
    });
    return null;
  }
}

export async function triggerEvalRunOrReport(
  octokit: Octokit,
  pr: PrContext,
  evalforge: EvalForgeClient,
  projectId: string,
  runId: string,
  blocking: boolean,
): Promise<boolean> {
  try {
    await evalforge.triggerEvalRun(projectId, runId);
    core.info(`Triggered eval run ${runId}`);
    return true;
  } catch (e) {
    await reportServiceFailure(octokit, pr, {
      log: `Failed to trigger eval run: ${getErrorMessage(e)}`,
      comment: `${ErrorMessage.EvalRunTriggerFailed} ${MAINTAINER_SUFFIX}`,
      failReason: ErrorMessage.EvalRunTriggerFailed,
      blocking,
    });
    return false;
  }
}

export async function pollEvalRunOrReport(
  octokit: Octokit,
  pr: PrContext,
  evalforge: EvalForgeClient,
  projectId: string,
  runId: string,
  blocking: boolean,
): Promise<EvalRunStatus | null> {
  core.info(`Polling eval run ${runId}...`);
  try {
    return await pollUntilDone(evalforge, projectId, runId);
  } catch (e) {
    if (isTimeoutError(e)) {
      await upsertComment(octokit, pr, formatEvalTimeout(runId, blocking));
      fail(
        ErrorMessage.EvalRunPollingTimedOut.replace("{runId}", runId),
        blocking,
      );
      return null;
    }
    await reportServiceFailure(octokit, pr, {
      log: `Eval run polling failed: ${getErrorMessage(e)}`,
      comment: `${ErrorMessage.EvalRunPollingFailed} ${MAINTAINER_SUFFIX}`,
      failReason: ErrorMessage.EvalRunPollingFailed,
      blocking,
    });
    return null;
  }
}

export async function runEval(): Promise<void> {
  const {
    githubToken,
    scenariosDir,
    evalforgeUrl,
    projectId,
    agentId,
    mcpId,
    appId,
    appSecret,
    prNumber,
    headSha,
    owner,
    repo,
    blocking,
  } = getEvalConfig();
  const octokit = github.getOctokit(githubToken);
  const pr = { owner, repo, prNumber };

  core.info(`Revision eval — PR #${prNumber}`);

  const changedFiles = await getChangedFilesOrReport(octokit, pr);
  if (!changedFiles) {
    return;
  }

  const changedScenarios = changedScenarioFiles(changedFiles, scenariosDir);
  if (changedScenarios.length === 0) {
    return;
  }

  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const tags = await collectScenarioTagsOrReport(
    octokit,
    pr,
    changedScenarios,
    workspaceRoot,
  );
  if (!tags) {
    return;
  }

  const fixture = await loadFixtureOrReport(
    octokit,
    pr,
    workspaceRoot,
    blocking,
  );
  if (!fixture) {
    return;
  }

  const commitHash = `pr-${prNumber}-${headSha.slice(0, 7)}`;
  core.info(
    `Eval tags: ${tags.join(", ")}\nFixture: ${fixture.path}\ncommitHash: ${commitHash}`,
  );

  const resourceId = await stageRevisionOrReport(
    octokit,
    pr,
    fixture,
    commitHash,
    blocking,
  );
  if (!resourceId) {
    return;
  }

  const evalforge = new EvalForgeClient(evalforgeUrl, appId, appSecret);

  const mcpVersionId = await createMcpVersionOrReport(
    octokit,
    pr,
    evalforge,
    mcpId,
    projectId,
    commitHash,
    prNumber,
    blocking,
  );
  if (!mcpVersionId) {
    return;
  }

  const runId = await createEvalRunOrReport(
    octokit,
    pr,
    evalforge,
    projectId,
    prNumber,
    tags,
    agentId,
    mcpId,
    mcpVersionId,
    blocking,
  );
  if (!runId) {
    return;
  }

  const triggered = await triggerEvalRunOrReport(
    octokit,
    pr,
    evalforge,
    projectId,
    runId,
    blocking,
  );
  if (!triggered) {
    return;
  }

  const finalStatus = await pollEvalRunOrReport(
    octokit,
    pr,
    evalforge,
    projectId,
    runId,
    blocking,
  );
  if (!finalStatus) {
    return;
  }

  await reportEvalResult(octokit, pr, finalStatus, runId, blocking);
}

function isRetriable(e: unknown): boolean {
  const status = getErrorStatus(e);
  if (status && status >= 500) return true;
  if (
    e instanceof Error &&
    (e.name === "AbortError" || e.name === "TimeoutError")
  )
    return true;
  return false;
}

function isTerminalRunStatus(status: EvalRunStatus["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export async function pollUntilDone(
  client: EvalForgeClient,
  projectId: string,
  runId: string,
): Promise<EvalRunStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let status: EvalRunStatus | undefined;

    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      try {
        status = await client.getEvalRun(projectId, runId);
        break;
      } catch (e) {
        if (isRetriable(e) && attempt < RETRY_LIMIT) {
          core.warning(
            `Poll attempt failed (retry ${attempt + 1}/${RETRY_LIMIT}): ${getErrorMessage(e)}`,
          );
          await delay(RETRY_DELAY_MS);
        } else {
          throw e;
        }
      }
    }

    const terminalStatus = isTerminalRunStatus(status!.status);
    if (terminalStatus) return status!;

    core.info(`Eval run ${runId}: ${status!.status}...`);
    await delay(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }

  throw Object.assign(new Error("Eval run timed out after 30 minutes"), {
    timeout: true,
  });
}

export async function runCleanup(): Promise<void> {
  const { evalforgeUrl, appId, appSecret, mcpId, projectId, prNumber } =
    getCleanupConfig();
  const evalforge = new EvalForgeClient(evalforgeUrl, appId, appSecret);

  let versions;
  try {
    versions = await evalforge.listMcpVersions(mcpId, projectId);
  } catch (e) {
    core.setFailed(
      `Could not list MCP versions for cleanup: ${getErrorMessage(e)}`,
    );
    return;
  }

  const prefix = `pr-${prNumber}-`;
  const prVersions = versions.filter((v) => v.version.startsWith(prefix));

  if (prVersions.length === 0) {
    core.info(
      `No MCP versions found for PR #${prNumber} — nothing to clean up`,
    );
    return;
  }

  core.info(
    `Found ${prVersions.length} MCP version(s) to delete for PR #${prNumber}`,
  );

  for (const version of prVersions) {
    try {
      await evalforge.deleteMcpVersion(mcpId, projectId, version.id);
      core.info(`Deleted MCP version ${version.version} (${version.id})`);
    } catch (e) {
      core.warning(
        `Failed to delete MCP version ${version.version}: ${getErrorMessage(e)}`,
      );
    }
  }
}
