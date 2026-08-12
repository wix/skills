import * as core from '@actions/core';
import {
  EvalForgeClient, EvalRunTimeoutError, formatGatePollFailure, formatGateTimeout, pollUntilDone,
  type Commenter, type EvalRunStatus,
} from '@wix/evalforge-core';
import { HALTED, describeError, fail, type Guarded } from './report';
import type { GateConfig } from './config';

/** Timeout gets its own comment; anything else is a generic service failure. */
export async function pollToCompletion(
  client: EvalForgeClient,
  config: GateConfig,
  runId: string,
  runUrl: string,
  comment: Commenter,
): Promise<Guarded<EvalRunStatus>> {
  try {
    return {
      ok: true,
      value: await pollUntilDone(client, config.projectId, runId, { log: core.info, warn: core.warning }),
    };
  } catch (error) {
    if (error instanceof EvalRunTimeoutError) {
      await comment(formatGateTimeout(runId, runUrl, config.isBlocking));
      fail(error.message, config.isBlocking);
      return HALTED;
    }
    // Names the run: it started, it may have finished, and without the link there is no way
    // to find out from the PR.
    const detail = describeError(error);
    core.error(`Polling the eval run failed: ${detail}`);
    await comment(formatGatePollFailure({ runId, runUrl, detail, blocking: config.isBlocking }));
    fail(`Polling the eval run failed: ${detail}`, config.isBlocking);
    return HALTED;
  }
}
