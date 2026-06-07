import * as core from '@actions/core';
import { TERMINAL_RUN_STATUSES, type EvalForgeClient, type EvalRunStatus, type RunStatus } from './evalforge';

function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const RETRY_LIMIT = 5;
const RETRY_DELAY_MS = 10_000;

function isRetriable(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  if (status && status >= 500) return true;
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
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
          core.warning(`Poll attempt failed (retry ${attempt + 1}/${RETRY_LIMIT}): ${e instanceof Error ? e.message : String(e)}`);
          await delay(RETRY_DELAY_MS);
        } else {
          throw e;
        }
      }
    }

    if (isTerminal(status!.status)) return status!;

    core.info(`Eval run ${runId}: ${status!.status}...`);
    await delay(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }

  throw new EvalRunTimeoutError('Eval run timed out after 30 minutes');
}

export class EvalRunTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalRunTimeoutError';
  }
}
