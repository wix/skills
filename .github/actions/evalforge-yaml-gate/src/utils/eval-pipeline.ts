import * as core from '@actions/core';

export type ComparisonResult = { comparisonGroupId: string };

export type ScenarioAssertion = {
  name: string;
  type: string;
  status: string;
  score?: number;
  verdict?: string;
  message?: string;
};

export type ScenarioRunResult = {
  runId?: string;
  name?: string;
  passed: number;
  failed: number;
  totalCostUsd: number;
  totalTokens: number;
  durationMs: number;
  assertions: ScenarioAssertion[];
};

export type ScenarioComparison = {
  scenarioId: string;
  scenarioName: string;
  required: boolean;
  reason: string;
  with: ScenarioRunResult;
  without: ScenarioRunResult;
  pairwiseJudgement: {
    winner: 'tie' | 'with' | 'without';
    confidence: string;
    reasoning: string;
    dimensions?: Record<string, { winner: string; reasoning: string }>;
  };
};

export type ComparisonGroupResult = {
  comparisonGroupId: string;
  verdict: string;
  tag: string;
  scenarios: ScenarioComparison[];
};

export type CompareGroupComplete = {
  status: 'complete';
  completedRuns: number;
  totalRuns: number;
  result: ComparisonGroupResult;
};

export type CompareGroupStatus =
  | { status: 'running'; completedRuns: number; totalRuns: number }
  | CompareGroupComplete;

const POLL_INTERVAL_MS = 2 * 60_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const RETRY_LIMIT = 5;
const RETRY_DELAY_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function isRetriable(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  if (status && status >= 500) return true;
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return true;
  return false;
}

export class EvalPipelineClient {
  private readonly headers: Record<string, string>;

  constructor(
    private readonly baseUrl: string,
    appId: string,
    appSecret: string,
  ) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-app-id': appId,
      'x-app-secret': appSecret,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(
        new Error(`EvalPipeline POST ${path} → ${res.status}: ${err.error ?? ''}`),
        { status: res.status },
      );
    }
    return res.json() as Promise<T>;
  }

  async runComparison(tags: string[], agentName: string, commitSha?: string, skillsRepo?: string): Promise<ComparisonResult> {
    return this.post<ComparisonResult>('/run-comparison', { tags, agentName, commitSha, skillsRepo });
  }

  async compareGroup(comparisonGroupId: string): Promise<CompareGroupStatus> {
    return this.post<CompareGroupStatus>('/compare-group', { comparisonGroupId });
  }
}

export async function pollUntilComparisonDone(
  client: EvalPipelineClient,
  comparisonGroupId: string,
): Promise<CompareGroupComplete> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let result: CompareGroupStatus | undefined;

    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      try {
        result = await client.compareGroup(comparisonGroupId);
        break;
      } catch (e) {
        if (isRetriable(e) && attempt < RETRY_LIMIT) {
          core.warning(`compare-group poll failed (retry ${attempt + 1}/${RETRY_LIMIT}): ${e instanceof Error ? e.message : String(e)}`);
          await delay(RETRY_DELAY_MS);
        } else {
          throw e;
        }
      }
    }

    if (result!.status === 'complete') {
      core.info(`compare-group complete response: ${JSON.stringify(result)}`);
      return result as CompareGroupComplete;
    }

    const r = result as Extract<CompareGroupStatus, { status: 'running' }>;
    core.info(`Comparison ${comparisonGroupId}: ${r.completedRuns}/${r.totalRuns} runs complete...`);
    await delay(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }

  throw new ComparisonTimeoutError(`Comparison ${comparisonGroupId} timed out after 30 minutes`);
}

export class ComparisonTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonTimeoutError';
  }
}
