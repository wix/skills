export type HttpError = Error & { status: number };

const MCP_URL = 'https://mcp.wix.com/mcp';
const MCP_CONFIG_KEY = 'wix-mcp-remote';

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type RunStatus = 'pending' | 'running' | typeof TERMINAL_RUN_STATUSES[number];

export type CapabilityVersion = { id: string; capabilityId: string; version: string };

import type { EvalForgeBody } from './evalforge-mapper';
import { signWixToken } from './wix-signer';
import { errMsg } from './errors';

export type RemoteScenario = { id: string; name: string; tags: string[] };
export type ScenarioBody = EvalForgeBody;

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  agentId: string;
  scenarioIds: string[];
  capabilityIds?: string[];
  capabilityVersions?: Record<string, string>;
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
  // Cached once per client; CI runs are minutes, default token TTL is 15min.
  private readonly authHeader: string;

  constructor(
    private readonly baseUrl: string,
    appId: string,
    appSecret: string,
  ) {
    this.authHeader = signWixToken(appId, appSecret);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
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
      throw new Error(`EvalForge ${method} ${path} → ${res.status} but invalid JSON: ${errMsg(e)}`);
    }) as Promise<T>;
  }

  async listMcpVersions(mcpId: string, projectId: string): Promise<CapabilityVersion[]> {
    const res = await this.request<{ capabilityVersions?: CapabilityVersion[] }>(
      'GET',
      `/v1/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions`,
    );
    return res.capabilityVersions ?? [];
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
    const res = await this.request<{ capabilityVersion: CapabilityVersion }>(
      'POST',
      `/v1/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions`,
      {
        projectId,
        capabilityId: mcpId,
        capabilityVersion: {
          version: versionLabel,
          origin: 'pr',
          notes: `Auto-created for PR #${prNumber}`,
          mcpContent: {
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
        },
      },
    );
    return res.capabilityVersion;
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

  private async queryTestScenarios(
    projectId: string,
    filter: { tags?: string[]; name?: string },
  ): Promise<RemoteScenario[]> {
    const res = await this.request<{ testScenarios?: RemoteScenario[] }>(
      'POST',
      `/v1/projects/${enc(projectId)}/test-scenarios/query`,
      { projectId, filter },
    );
    return (res.testScenarios ?? []).map(s => ({ ...s, tags: s.tags ?? [] }));
  }

  listScenariosByTag(projectId: string, tag: string): Promise<RemoteScenario[]> {
    return this.queryTestScenarios(projectId, { tags: [tag] });
  }

  // Server's `name` filter is SQL LIKE %name% — exact-match client-side to avoid substring hits.
  async findScenarioByExactName(projectId: string, name: string): Promise<RemoteScenario | undefined> {
    const matches = await this.queryTestScenarios(projectId, { name });
    return matches.find(s => s.name === name);
  }

  async createTestScenario(projectId: string, body: ScenarioBody, tags: string[]): Promise<{ id: string }> {
    const res = await this.request<{ testScenario: { id: string } }>(
      'POST',
      `/v1/projects/${enc(projectId)}/test-scenarios`,
      { projectId, testScenario: { ...body, tags } },
    );
    return { id: res.testScenario.id };
  }

  async updateTestScenario(projectId: string, id: string, body: ScenarioBody, tags: string[]): Promise<void> {
    await this.request<void>(
      'PATCH',
      `/v1/projects/${enc(projectId)}/test-scenarios/${enc(id)}`,
      { projectId, testScenario: { id, ...body, tags } },
    );
  }

  async deleteTestScenario(projectId: string, id: string): Promise<void> {
    await this.request<void>('DELETE', `/v1/projects/${enc(projectId)}/test-scenarios/${enc(id)}`);
  }

  async runEvaluation(projectId: string, input: EvalRunInput): Promise<EvalRunCreated> {
    const res = await this.request<{ evalRun: EvalRunCreated }>(
      'POST',
      `/v1/projects/${enc(projectId)}/eval-runs/run`,
      { projectId, evalRun: input },
    );
    return res.evalRun;
  }

  async getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus> {
    const res = await this.request<{ evalRun: EvalRunStatus }>(
      'GET',
      `/v1/projects/${enc(projectId)}/eval-runs/${enc(runId)}`,
    );
    return res.evalRun;
  }

  async deleteMcpVersion(mcpId: string, projectId: string, versionId: string): Promise<void> {
    await this.request<void>('DELETE', `/v1/projects/${enc(projectId)}/capabilities/${enc(mcpId)}/versions/${enc(versionId)}`);
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
