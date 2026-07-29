import * as core from '@actions/core';
import * as github from '@actions/github';
import { GATE_COMMENT_MARKER, formatGateServiceError, makeCommenter, type Commenter } from '@wix/evalforge-core';

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** During the soak period (`blocking: false`) a failure warns and the check still passes. */
export function fail(message: string, blocking: boolean): void {
  if (blocking) core.setFailed(message);
  else core.warning(message);
}

/** Runs an EvalForge call, reporting a user-facing comment and gate failure if it throws. */
export async function guardedCall<T>(
  operation: () => Promise<T>,
  userMessage: string,
  comment: Commenter,
  blocking: boolean,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    core.error(`${userMessage}: ${describeError(error)}`);
    await comment(formatGateServiceError(userMessage, blocking));
    fail(userMessage, blocking);
    return undefined;
  }
}

export function makeGateCommenter(
  octokit: ReturnType<typeof github.getOctokit>,
  target: { owner: string; repo: string; prNumber: number },
): Commenter {
  return makeCommenter(octokit, { ...target, marker: GATE_COMMENT_MARKER }, {
    warn: core.warning,
    writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
  });
}
