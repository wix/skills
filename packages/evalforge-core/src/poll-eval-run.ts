import { TERMINAL_RUN_STATUSES, type EvalRunStatus, type RunStatus } from './evalforge';

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const RETRY_LIMIT = 5;
const RETRY_DELAY_MS = 10_000;

/** The slice of EvalForgeClient this module needs — declared structurally so tests need no client. */
export type EvalRunPollClient = {
  getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus>;
};

export type PollOptions = {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
  /**
   * Defaults to a real setTimeout delay. Also the production cancellation seam: the base
   * comparison arm injects a `sleep` that rejects once cancelled, and `pollUntilDone` must keep
   * awaiting it at both the retry delay and the inter-attempt delay for that cancellation to
   * actually stop the loop — do not replace either `await sleep(...)` with a bare `setTimeout`.
   */
  sleep?: (ms: number) => Promise<void>;
};

export class EvalRunTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalRunTimeoutError';
  }
}

function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

function isRetriable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (status && status >= 500) return true;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return true;
  return false;
}

function realSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pollUntilDone(
  client: EvalRunPollClient,
  projectId: string,
  runId: string,
  options: PollOptions = {},
): Promise<EvalRunStatus> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? realSleep;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let current: EvalRunStatus | undefined;

    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      try {
        current = await client.getEvalRun(projectId, runId);
        break;
      } catch (error) {
        if (isRetriable(error) && attempt < RETRY_LIMIT) {
          options.warn?.(`Poll attempt failed (retry ${attempt + 1}/${RETRY_LIMIT}): ${describeError(error)}`);
          await sleep(RETRY_DELAY_MS);
        } else {
          throw error;
        }
      }
    }

    if (isTerminal(current!.status)) return current!;

    options.log?.(`Eval run ${runId}: ${current!.status}...`);
    await sleep(Math.min(intervalMs, deadline - Date.now()));
  }

  throw new EvalRunTimeoutError(
    `Eval run timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
  );
}
