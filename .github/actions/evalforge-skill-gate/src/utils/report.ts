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

/**
 * A guarded step's outcome. `ok: false` means the step already reported the reason and already
 * called `fail`, so the caller has nothing left to do but return.
 *
 * Not `T | undefined`: every caller tests the result for truth, so a step legitimately yielding
 * `0`, `''`, `false` or an empty value would read as a failure and the gate would return without
 * commenting and without failing — a green check that verified nothing.
 */
export type Guarded<T> = { ok: true; value: T } | { ok: false };

export const HALTED: Guarded<never> = { ok: false };

/**
 * Runs an EvalForge call, reporting a user-facing comment and gate failure if it throws.
 *
 * `label` becomes the comment heading, so a reader can tell which stage broke without parsing the
 * body — every one of these used to render the same bare "Service Error".
 */
export async function guardedCall<T>(
  operation: () => Promise<T>,
  failure: { message: string; label: string },
  comment: Commenter,
  blocking: boolean,
): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    core.error(`${failure.message}: ${describeError(error)}`);
    await comment(formatGateServiceError(failure.message, blocking, failure.label));
    fail(failure.message, blocking);
    return HALTED;
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
