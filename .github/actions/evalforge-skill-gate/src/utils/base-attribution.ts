import * as core from '@actions/core';
import { pollUntilDone, type EvalForgeClient, type EvalRunStatus } from '@wix/evalforge-core';
import { describeError } from './report';
import type { GateConfig } from './config';

/**
 * How long to wait for the base arm once the PR arm has already completed. The base arm is
 * annotation only — it must never move or delay the verdict — so once this elapses we degrade to
 * no attribution rather than keep the job open for it.
 */
export const BASE_ARM_GRACE_MS = 60_000;

/**
 * A ceiling on the base poll itself, independent of cancellation: the longest the gate could ever
 * wait is the PR arm's own 30-minute poll deadline plus the grace period, so a base poll that
 * somehow outlives cancellation still cannot outlive that.
 */
const BASE_ARM_POLL_TIMEOUT_MS = 30 * 60_000 + BASE_ARM_GRACE_MS;

class BaseArmCancelledError extends Error {
  constructor() {
    super('cancelled — the verdict was already decided without it');
    this.name = 'BaseArmCancelledError';
  }
}

type Cancellation = {
  /** Idempotent, and never throws: it is called from a `finally`. */
  cancel: () => void;
  cancelled: () => boolean;
  /** Resolves after `ms`, or rejects as soon as `cancel` is called — whichever comes first. */
  sleep: (ms: number) => Promise<void>;
};

/**
 * Real cancellation for the base arm's poll, injected as `PollOptions.sleep`.
 *
 * `pollUntilDone` awaits this between attempts, so a rejection here propagates out of the poll and
 * ends it. Merely stopping the *wait* on the poll is not enough: nothing else stops the loop, and
 * it would keep issuing `getEvalRun` calls and logging progress against its own deadline long after
 * the gate has published its verdict — holding the job step open, and the runner's Node process
 * with it, for a result nobody will read.
 */
function createCancellation(): Cancellation {
  let isCancelled = false;
  const pendingWakeups = new Set<() => void>();

  const cancel = (): void => {
    isCancelled = true;
    const wakeups = [...pendingWakeups];
    pendingWakeups.clear();
    for (const wakeUp of wakeups) wakeUp();
  };

  const sleep = (ms: number): Promise<void> => {
    if (isCancelled) return Promise.reject(new BaseArmCancelledError());
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const wakeUp = (): void => {
        clearTimeout(timer);
        reject(new BaseArmCancelledError());
      };
      timer = setTimeout(() => {
        pendingWakeups.delete(wakeUp);
        resolve();
      }, Math.max(0, ms));
      // Belt and braces: a cancel that never arrives still must not keep Node alive for the base
      // arm, so this timer never counts towards the event loop staying open.
      timer.unref?.();
      pendingWakeups.add(wakeUp);
    });
  };

  return { cancel, cancelled: () => isCancelled, sleep };
}

/**
 * Resolves with whatever `promise` settles to, or `undefined` once `graceMs` elapses — whichever
 * comes first. Clears its timer either way, and absorbs a rejection: this helper exists so the
 * base arm cannot reach the verdict, and an unhandled rejection would fail the job by the back
 * door.
 */
function withGracePeriod<T>(promise: Promise<T>, graceMs: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), graceMs);
    const settle = (value: T | undefined): void => {
      clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(undefined));
  });
}

/**
 * Polls the base comparison arm to completion without ever commenting on the PR or failing the
 * gate — unlike `pollToCompletion`, whose job is exactly that. Any failure, including a timeout or
 * cancellation, degrades to `undefined` rather than propagating.
 */
async function pollBaseArmSilently(
  client: EvalForgeClient,
  config: GateConfig,
  baseRun: Promise<string | undefined>,
  cancellation: Cancellation,
): Promise<EvalRunStatus | undefined> {
  try {
    const baseRunId = await baseRun;
    if (baseRunId === undefined || cancellation.cancelled()) return undefined;
    return await pollUntilDone(client, config.projectId, baseRunId, {
      log: (message: string) => core.info(`Base comparison arm: ${message}`),
      warn: (message: string) => core.warning(`Base comparison arm: ${message}`),
      timeoutMs: BASE_ARM_POLL_TIMEOUT_MS,
      sleep: cancellation.sleep,
    });
  } catch (error) {
    core.warning(`Base comparison arm did not complete: ${describeError(error)}`);
    return undefined;
  }
}

export type BaseAttribution = {
  /**
   * The base arm's outcome, or `undefined` if it did not arrive within `BASE_ARM_GRACE_MS` of this
   * call. Cancels the poll before returning either way — call it once the PR arm is done, so the
   * grace clock starts from the verdict rather than from the run's start.
   */
  collect: () => Promise<EvalRunStatus | undefined>;
  /** Safe to call any number of times, including from a `finally` and after `collect`. */
  cancel: () => void;
};

/**
 * Owns the base arm end to end: awaiting its creation, polling it, bounding that poll, and
 * cancelling it. Start it before the PR arm's poll so both arms run concurrently; `cancel` it on
 * every exit path so no part of the base arm can outlive the verdict.
 */
export function startBaseAttribution(
  client: EvalForgeClient,
  config: GateConfig,
  baseRun: Promise<string | undefined>,
): BaseAttribution {
  const cancellation = createCancellation();
  const basePoll = pollBaseArmSilently(client, config, baseRun, cancellation);

  return {
    collect: async () => {
      const status = await withGracePeriod(basePoll, BASE_ARM_GRACE_MS);
      cancellation.cancel();
      return status;
    },
    cancel: cancellation.cancel,
  };
}
