export type HttpError = Error & { status: number };

const MCP_URL = 'https://mcp.wix.com/mcp';
const MCP_CONFIG_KEY = 'wix-mcp-remote';
const MAX_TEST_SCENARIO_NAMES_PER_REQUEST = 50;

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type RunStatus = 'pending' | 'running' | typeof TERMINAL_RUN_STATUSES[number];

export type CapabilityVersion = { id: string; capabilityId: string; version: string };

import type { EvalForgeBody } from './evalforge-mapper';

export type RemoteScenario = { id: string; name: string; tags: string[] };
export type ScenarioBody = EvalForgeBody;
export type ListTestScenarioFilters = {
  names?: string[];
  tags?: string[];
};

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

// Human-facing EvalForge results page (distinct from the REST `baseUrl` the client calls).
const UI_BASE = 'https://bo.wix.com/pages/evalforge';

export function evalRunUrl(projectId: string, runId: string, name?: string): string {
  const nameParam = name ? `&name=${encodeURIComponent(name)}` : '';
  return `${UI_BASE}/${projectId}/results?runId=${runId}${nameParam}`;
}

export function draftTagFor(repo: string, prNumber: number): string {
  return `${DRAFT_PREFIX}${repo}#${prNumber}`;
}

export function parseDraftTag(tag: string): { repo: string; prNumber: number } | null {
  const m = tag.match(/^draft:([^#]+)#(\d+)$/);
  return m ? { repo: m[1], prNumber: Number(m[2]) } : null;
}

// Tags the action stamps on every scenario it manages — they record that a scenario was authored
// in code and which repo it came from, and (unlike draft tags) they survive promotion. Reserved:
// authors can't set them in YAML (see schema) since the action owns them.
export const CODE_TAG = 'created-via-code';
export const REPO_PREFIX = 'repo:';

/** Repo-origin tag for a code-managed scenario, e.g. `repo:wix/skills`. */
export function repoTagFor(repo: string): string {
  return `${REPO_PREFIX}${repo}`;
}

/** The managed tags stamped on every scenario authored from `repo` via code. */
export function managedTagsFor(repo: string): string[] {
  return [CODE_TAG, repoTagFor(repo)];
}

/** Returns `tags` with the managed code-origin tags ensured present — order-preserving and deduped. */
export function withManagedTags(tags: string[], repo: string): string[] {
  const result = [...tags];
  for (const tag of managedTagsFor(repo)) {
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof Error && typeof (e as { status?: unknown }).status === 'number';
}

/**
 * Deduplicates scenarios returned by multiple filtered EvalForge list calls.
 */
export function uniqueRemoteScenarios(scenarios: RemoteScenario[]): RemoteScenario[] {
  const byId = new Map<string, RemoteScenario>();
  for (const scenario of scenarios) byId.set(scenario.id, scenario);
  return [...byId.values()];
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

  /**
   * Lists test scenarios, optionally narrowing the REST response by scenario name and/or tag.
   */
  async listTestScenarios(projectId: string, filters: ListTestScenarioFilters = {}): Promise<RemoteScenario[]> {
    if ((filters.names?.length ?? 0) > MAX_TEST_SCENARIO_NAMES_PER_REQUEST) {
      const chunks = chunk(filters.names!, MAX_TEST_SCENARIO_NAMES_PER_REQUEST);
      const batches = await Promise.all(
        chunks.map(names => this.listTestScenarios(projectId, { ...filters, names })),
      );
      return uniqueRemoteScenarios(batches.flat());
    }
    // EvalForge returns `tags: undefined` for untagged scenarios — normalize so callers can assume `string[]`.
    const raw = await this.request<RemoteScenario[]>('GET', testScenariosPath(projectId, filters));
    return raw.map(s => ({ ...s, tags: s.tags ?? [] }));
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

function testScenariosPath(projectId: string, filters: ListTestScenarioFilters): string {
  const params = new URLSearchParams();
  for (const name of filters.names ?? []) params.append('name', name);
  for (const tag of filters.tags ?? []) params.append('tags', tag);
  const query = params.toString();
  return `/projects/${enc(projectId)}/test-scenarios${query ? `?${query}` : ''}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
