type HttpError = Error & { status: number };

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  tags: string[];
  agentId: string;
};

export type EvalRunCreated = { id: string; status: string; scenarioIds: string[] };

export type EvalRunStatus = {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  aggregateMetrics: {
    totalAssertions: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    passRate: number;
    avgDuration: number;
    totalDuration: number;
  };
};

export class EvalForgeClient {
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(
        new Error(`EvalForge ${method} ${path} → ${res.status}: ${err.error ?? ''}`),
        { status: res.status } satisfies Pick<HttpError, 'status'>,
      );
    }
    return res.json().catch((e: unknown) => {
      throw new Error(`EvalForge ${method} ${path} → 200 but invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }) as Promise<T>;
  }

  async getTags(projectId: string): Promise<Set<string>> {
    const tags = await this.request<string[]>('GET', `/projects/${projectId}/tags`);
    return new Set(tags);
  }

  async createEvalRun(projectId: string, input: EvalRunInput): Promise<EvalRunCreated> {
    return this.request<EvalRunCreated>('POST', `/projects/${projectId}/eval-runs`, input);
  }

  async triggerEvalRun(projectId: string, runId: string): Promise<{ evalRunId: string }> {
    return this.request<{ evalRunId: string }>('POST', `/projects/${projectId}/eval-runs/${runId}/run`);
  }

  async getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus> {
    return this.request<EvalRunStatus>('GET', `/projects/${projectId}/eval-runs/${runId}`);
  }
}
