export type HttpError = Error & { status: number };

const MCP_URL = 'https://mcp.wix.com/mcp';
const MCP_CONFIG_KEY = 'wix-mcp-remote';

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type RunStatus = 'pending' | 'running' | typeof TERMINAL_RUN_STATUSES[number];

export type CapabilityVersion = { id: string; capabilityId: string; version: string };

import type { RemoteScenario, ScenarioBody } from './sync';
export type { RemoteScenario, ScenarioBody };

export type PrContext = { repo: string; prNumber: number; headSha: string };

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  agentId: string;
  scenarioIds: string[];
  capabilityIds?: string[];
  capabilityVersions?: Record<string, string>;
  prContext?: PrContext;
};

export type EvalRunCreated = { id: string; status: RunStatus };

export type EvalRunStatus = {
  status: RunStatus;
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

export const DRAFT_PREFIX = 'draft:';

export function draftTagFor(repo: string, prNumber: number): string {
  return `${DRAFT_PREFIX}${repo}#${prNumber}`;
}

export function parseDraftTag(tag: string): { repo: string; prNumber: number } | null {
  const m = tag.match(/^draft:([^#]+)#(\d+)$/);
  return m ? { repo: m[1], prNumber: Number(m[2]) } : null;
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof Error && typeof (e as { status?: unknown }).status === 'number';
}

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
      const err = await res.json().catch(() => ({})) as { error?: string; details?: unknown };
      const detail = err.details !== undefined ? ` details=${JSON.stringify(err.details)}` : '';
      throw Object.assign(
        new Error(`EvalForge ${method} ${path} → ${res.status}: ${err.error ?? ''}${detail}`),
        { status: res.status },
      ) as HttpError;
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return res.json().catch((e: unknown) => {
      throw new Error(`EvalForge ${method} ${path} → ${res.status} but invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }) as Promise<T>;
  }

  async listMcpVersions(mcpId: string, projectId: string): Promise<CapabilityVersion[]> {
    return this.request<CapabilityVersion[]>('GET', `/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions`);
  }

  private buildMcpUrl(skillsRepo: string, headSha: string): string {
    const url = new URL(MCP_URL);
    url.searchParams.set('skillsRepo', skillsRepo);
    url.searchParams.set('skillsPr', headSha);
    return url.toString();
  }

  async createMcpVersion(
    mcpId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    headSha: string,
    skillsRepo: string,
  ): Promise<CapabilityVersion> {
    return this.request<CapabilityVersion>('POST', `/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions`, {
      version: versionLabel,
      origin: 'pr',
      notes: `Auto-created for PR #${prNumber}`,
      content: {
        config: {
          [MCP_CONFIG_KEY]: {
            url: this.buildMcpUrl(skillsRepo, headSha),
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

  async ensureMcpVersion(
    mcpId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    headSha: string,
    skillsRepo: string,
  ): Promise<CapabilityVersion> {
    try {
      return await this.createMcpVersion(mcpId, projectId, versionLabel, prNumber, headSha, skillsRepo);
    } catch (e) {
      if (!isHttpError(e) || e.status !== 409) throw e;
      const versions = await this.listMcpVersions(mcpId, projectId);
      const existing = versions.find(v => v.version === versionLabel);
      if (!existing) throw new Error(`Version ${versionLabel} not found after 409`);
      return existing;
    }
  }

  async listTestScenarios(projectId: string): Promise<RemoteScenario[]> {
    return this.request<RemoteScenario[]>('GET', `/projects/${enc(projectId)}/test-scenarios`);
  }

  async createTestScenario(projectId: string, body: ScenarioBody, tags: string[]): Promise<{ id: string }> {
    return this.request<{ id: string }>('POST', `/projects/${enc(projectId)}/test-scenarios`, { ...body, projectId, tags });
  }

  async updateTestScenario(projectId: string, id: string, body: ScenarioBody, tags: string[]): Promise<void> {
    await this.request<void>('PUT', `/projects/${enc(projectId)}/test-scenarios/${enc(id)}`, { ...body, projectId, tags });
  }

  async deleteTestScenario(projectId: string, id: string): Promise<void> {
    await this.request<void>('DELETE', `/projects/${enc(projectId)}/test-scenarios/${enc(id)}`);
  }

  async createEvalRun(projectId: string, input: EvalRunInput): Promise<EvalRunCreated> {
    return this.request<EvalRunCreated>('POST', `/projects/${enc(projectId)}/eval-runs`, input);
  }

  async triggerEvalRun(projectId: string, runId: string): Promise<{ evalRunId: string }> {
    return this.request<{ evalRunId: string }>('POST', `/projects/${enc(projectId)}/eval-runs/${enc(runId)}/run`);
  }

  async getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus> {
    return this.request<EvalRunStatus>('GET', `/projects/${enc(projectId)}/eval-runs/${enc(runId)}`);
  }

  async deleteMcpVersion(mcpId: string, projectId: string, versionId: string): Promise<void> {
    await this.request<void>('DELETE', `/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions/${enc(versionId)}`);
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
