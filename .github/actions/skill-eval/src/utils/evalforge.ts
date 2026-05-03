type HttpError = Error & { status: number };

const MCP_URL = 'https://mcp.wix.com/mcp';
const MCP_SKILLS_REPO = 'wix/skills';
const MCP_CONFIG_KEY = 'wix-mcp-remote';

export type CapabilityVersion = { id: string; capabilityId: string; version: string };

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  tags: string[];
  agentId: string;
  capabilityVersions?: Record<string, string>;
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

  async listMcpVersions(mcpId: string, projectId: string): Promise<CapabilityVersion[]> {
    return this.request<CapabilityVersion[]>('GET', `/projects/${projectId}/capabilities/${mcpId}/versions`);
  }

  async createMcpVersion(mcpId: string, projectId: string, versionLabel: string, prNumber: number, headSha: string): Promise<CapabilityVersion> {
    return this.request<CapabilityVersion>('POST', `/projects/${projectId}/capabilities/${mcpId}/versions`, {
      version: versionLabel,
      origin: 'pr',
      notes: `Auto-created for PR #${prNumber}`,
      content: {
        config: {
          [MCP_CONFIG_KEY]: {
            url: `${MCP_URL}?skillsRepo=${MCP_SKILLS_REPO}&skillsPr=${headSha}`,
            type: 'http',
            headers: {
              Authorization: '{{wix-auth-token}}',
              'wix-account-id': '{{wix-auth-user-id}}',
            },
          },
        },
      },
    });
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

  async deleteMcpVersion(mcpId: string, projectId: string, versionId: string): Promise<void> {
    await this.request<{ message: string }>('DELETE', `/projects/${projectId}/capabilities/${mcpId}/versions/${versionId}`);
  }
}
