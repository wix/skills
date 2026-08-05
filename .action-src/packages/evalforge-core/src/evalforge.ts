import { TokenProvider } from './auth';
import type { EvalForgeBody } from './evalforge-mapper';

export type HttpError = Error & { status: number };

const MCP_URL = 'https://mcp.wix.com/mcp';
const MCP_CONFIG_KEY = 'wix-mcp-remote';

// Cap on concurrent per-name scenario queries, so a PR touching many scenarios
// doesn't fire an unbounded burst at the V1 gateway (which may rate-limit).
const MAX_QUERY_CONCURRENCY = 8;

// OAuth token endpoint — a fixed public Wix endpoint, independent of the EvalForge
// API base (the internal `/_api/evalforge-backend` gateway). The token is minted
// here, then used as a Bearer credential against the V1 API at `baseUrl`.
const OAUTH_TOKEN_URL = 'https://www.wixapis.com/oauth2/token';

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type RunStatus = 'pending' | 'running' | typeof TERMINAL_RUN_STATUSES[number];

export type CapabilityVersion = { id: string; capabilityId: string; version: string };

/** One file of a skill capability version; `path` is relative to the skill root. */
export type SkillFileContent = { path: string; content: string };

/** The entity-typed content of a capability version — the seam shared by skills, mcp, and (later) rules/tools. */
export type CapabilityContent =
  | { kind: 'skill'; files: SkillFileContent[] }
  | { kind: 'mcp'; url: string };

/** One entry of an MCP capability version's remote config, keyed by `MCP_CONFIG_KEY`. */
type McpRemoteConfigEntry = {
  url: string;
  type: 'http';
  headers: {
    Authorization: string;
    'wix-account-id': string;
  };
};

type SkillContentBody = { skillContent: { files: SkillFileContent[] } };
type McpContentBody = { mcpContent: { config: Record<string, McpRemoteConfigEntry> } };

function contentBody(content: CapabilityContent): SkillContentBody | McpContentBody {
  if (content.kind === 'skill') return { skillContent: { files: content.files } };
  // V1 capability content is a oneof — MCP capabilities use `mcpContent`.
  return {
    mcpContent: {
      config: {
        [MCP_CONFIG_KEY]: {
          url: content.url,
          type: 'http',
          headers: {
            Authorization: '{{wix-auth-token}}',
            'wix-account-id': '{{wix-auth-user-id}}',
          },
        },
      },
    },
  };
}

export type RemoteScenario = { id: string; name: string; tags: string[] };
export type ScenarioBody = EvalForgeBody;

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  agentId: string;
  scenarioIds?: string[];
  filter?: {
    tag: string;
  };
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

// ── Raw V1 wire shapes (camelCase JSON from www.wixapis.com) ──────────────────
type RawCapabilityVersion = { id: string; capabilityId: string; version: string };
type RawScenario = { id: string; name: string; tags?: string[] };
type RawPagingMetadata = { total?: number; count?: number; cursors?: { next?: string } };

function assertNotTruncated(received: number, meta: RawPagingMetadata | undefined, path: string): void {
  if (!meta) return;
  const total = typeof meta.total === 'number' ? meta.total : undefined;
  const truncated = Boolean(meta.cursors?.next) || (total !== undefined && total > received);
  if (!truncated) return;
  throw new Error(
    `EvalForge ${path} returned a truncated page (received ${received}` +
    `${total !== undefined ? ` of ${total}` : ''}${meta.cursors?.next ? ', more pages available' : ''}). ` +
    `Reconciling against a partial list would re-create the scenarios it could not see. ` +
    `Add cursor paging to listTestScenarios before syncing this project.`,
  );
}
type RawMetrics = Partial<EvalRunStatus['aggregateMetrics']>;
type RawEvalRun = { id: string; status: string; progress?: number; aggregateMetrics?: RawMetrics };

// V1's EvalStatus enum is UPPERCASE (COMPLETED/FAILED/…); the rest of the action
// works in lowercase. The enum NAMES match, so a lowercase is the full mapping.
function normalizeStatus(s: string): RunStatus {
  return String(s).toLowerCase() as RunStatus;
}

// V1 `pass_rate` already arrives as a percentage (0–100), verified against 8 real runs in the
// App Builder project: 4/5 reports 80, 26/30 reports 86.667. Multiplying by 100 here rendered
// every comment as "10000%".
function toPercent(passRate: number | undefined): number {
  return Math.round(passRate ?? 0);
}

// Client for the EvalForge V1 REST API (`${baseUrl}/v1/...`, e.g.
// https://manage.wix.com/_api/evalforge-backend/v1/...), authenticated with an
// OAuth client-credentials Bearer token minted at the fixed public token
// endpoint. This class is the translation boundary: it speaks V1 on the wire
// (Bearer auth, `/v1` paths, wrapped envelopes, UPPERCASE status, 0–1 pass rate)
// but returns the action's stable internal types (bare RemoteScenario[]/
// EvalRunStatus, lowercase status, 0–100 pass rate) so callers are unaffected.
export class EvalForgeClient {
  private readonly tokens: TokenProvider;

  constructor(
    private readonly baseUrl: string, // EvalForge API base (EVALFORGE_URL), e.g. https://manage.wix.com/_api/evalforge-backend
    clientId: string,                 // Wix app def id (OAuth client_id)
    clientSecret: string,             // Wix app secret (OAuth client_secret)
  ) {
    // Token is minted at the fixed public endpoint, NOT under `baseUrl`.
    this.tokens = new TokenProvider(OAUTH_TOKEN_URL, clientId, clientSecret);
  }

  private send(method: string, path: string, body: unknown, token: string): Promise<Response> {
    return fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.tokens.getToken();
    let res = await this.send(method, path, body, token);
    if (res.status === 401) {
      // Token rejected before its computed expiry — mint a fresh one and retry once.
      res = await this.send(method, path, body, await this.tokens.forceRefresh(token));
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string; details?: unknown };
      const msg = err.message ?? err.error ?? '';
      const detail = err.details !== undefined ? ` details=${JSON.stringify(err.details)}` : '';
      throw Object.assign(
        new Error(`EvalForge ${method} /v1${path} → ${res.status}: ${msg}${detail}`),
        { status: res.status },
      ) as HttpError;
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return res.json().catch((e: unknown) => {
      throw new Error(`EvalForge ${method} /v1${path} → ${res.status} but invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }) as Promise<T>;
  }

  // Content-agnostic: this endpoint lists versions of any capability, whether their content
  // is `mcpContent` or `skillContent`.
  async listCapabilityVersions(capabilityId: string, projectId: string): Promise<CapabilityVersion[]> {
    const res = await this.request<{ capabilityVersions?: RawCapabilityVersion[] }>(
      'GET',
      `/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/versions`,
    );
    return (res.capabilityVersions ?? []).map(version => ({
      id: version.id, capabilityId: version.capabilityId, version: version.version,
    }));
  }

  private buildMcpUrl(skillsRepo: string, headSha: string): string {
    const url = new URL(MCP_URL);
    url.searchParams.set('skillsRepo', skillsRepo);
    url.searchParams.set('skillsPr', headSha);
    return url.toString();
  }

  private async createCapabilityVersion(
    capabilityId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    content: CapabilityContent,
  ): Promise<CapabilityVersion> {
    const res = await this.request<{ capabilityVersion: RawCapabilityVersion }>(
      'POST',
      `/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/versions`,
      {
        capabilityVersion: {
          capabilityId,
          version: versionLabel,
          origin: 'pr',
          notes: `Auto-created for PR #${prNumber}`,
          ...contentBody(content),
        },
      },
    );
    const created = res.capabilityVersion;
    return { id: created.id, capabilityId: created.capabilityId, version: created.version };
  }

  async createOrReuseCapabilityVersion(
    capabilityId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    content: CapabilityContent,
  ): Promise<CapabilityVersion> {
    try {
      return await this.createCapabilityVersion(capabilityId, projectId, versionLabel, prNumber, content);
    } catch (error) {
      // Duplicate labels should be 409, but the backend transcodes "already exists" to 500.
      if (!isHttpError(error) || (error.status !== 409 && error.status !== 500)) throw error;
      const versions = await this.listCapabilityVersions(capabilityId, projectId);
      const existing = versions.find(candidate => candidate.version === versionLabel);
      if (!existing) throw error;
      return existing;
    }
  }

  async createOrReuseSkillVersion(
    capabilityId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    files: SkillFileContent[],
  ): Promise<CapabilityVersion> {
    return this.createOrReuseCapabilityVersion(
      capabilityId, projectId, versionLabel, prNumber, { kind: 'skill', files },
    );
  }

  async ensureMcpVersion(
    mcpId: string,
    projectId: string,
    versionLabel: string,
    prNumber: number,
    headSha: string,
    skillsRepo: string,
  ): Promise<CapabilityVersion> {
    return this.createOrReuseCapabilityVersion(
      mcpId, projectId, versionLabel, prNumber,
      { kind: 'mcp', url: this.buildMcpUrl(skillsRepo, headSha) },
    );
  }

  // Without `names`: lists ALL scenarios via an empty-filter query (used by
  // promote / cleanup / run-all). With `names`: fetches only those scenarios —
  // the V1 `name` filter is a substring match, so each name is queried and then
  // narrowed to exact hits (deduped by id). EvalForge omits `tags` for untagged
  // scenarios — normalize so callers can assume `string[]`.
  async listTestScenarios(projectId: string, names?: string[]): Promise<RemoteScenario[]> {
    if (names === undefined) {
      const path = `/projects/${enc(projectId)}/test-scenarios/query`;
      const res = await this.request<{ testScenarios?: RawScenario[]; pagingMetadata?: RawPagingMetadata }>(
        'POST',
        path,
        { filter: {} },
      );
      const scenarios = res.testScenarios ?? [];
      assertNotTruncated(scenarios.length, res.pagingMetadata, path);
      return scenarios.map(s => ({ id: s.id, name: s.name, tags: s.tags ?? [] }));
    }
    const unique = [...new Set(names)];
    if (unique.length === 0) return [];
    // Query names in bounded-concurrency batches rather than all at once.
    const byId = new Map<string, RemoteScenario>();
    for (let i = 0; i < unique.length; i += MAX_QUERY_CONCURRENCY) {
      const batch = unique.slice(i, i + MAX_QUERY_CONCURRENCY);
      const pages = await Promise.all(batch.map(name =>
        this.request<{ testScenarios?: RawScenario[] }>(
          'POST',
          `/projects/${enc(projectId)}/test-scenarios/query`,
          { filter: { name } },
        ).then(res => (res.testScenarios ?? []).filter(s => s.name === name)),
      ));
      for (const page of pages) {
        for (const s of page) byId.set(s.id, { id: s.id, name: s.name, tags: s.tags ?? [] });
      }
    }
    return [...byId.values()];
  }

  // Fetch only the scenarios carrying a given tag (e.g. this PR's draft tag) —
  // used by promote/cleanup, which operate on the PR's draft-tagged scenarios.
  async listTestScenariosByTag(projectId: string, tag: string): Promise<RemoteScenario[]> {
    const res = await this.request<{ testScenarios?: RawScenario[] }>(
      'POST',
      `/projects/${enc(projectId)}/test-scenarios/query`,
      { filter: { tags: [tag] } },
    );
    return (res.testScenarios ?? []).map(s => ({ id: s.id, name: s.name, tags: s.tags ?? [] }));
  }

  async createTestScenario(projectId: string, body: ScenarioBody, tags: string[]): Promise<{ id: string }> {
    const res = await this.request<{ testScenario: { id: string } }>(
      'POST',
      `/projects/${enc(projectId)}/test-scenarios`,
      { testScenario: { ...body, tags } },
    );
    return { id: res.testScenario.id };
  }

  async updateTestScenario(projectId: string, id: string, body: ScenarioBody, tags: string[]): Promise<void> {
    // No explicit field mask: the gateway derives it from the fields present in
    // `testScenario`. The gate always sends its full managed field set, and the
    // body always carries an explicit siteSetup (TEMPLATE or NONE) — site_setup is
    // always applied when present, so a dropped site setup is cleared via NONE.
    await this.request<void>(
      'PATCH',
      `/projects/${enc(projectId)}/test-scenarios/${enc(id)}`,
      { testScenario: { id, ...body, tags } },
    );
  }

  async deleteTestScenario(projectId: string, id: string): Promise<void> {
    await this.request<void>('DELETE', `/projects/${enc(projectId)}/test-scenarios/${enc(id)}`);
  }

  // V1 `RunEvaluation` creates AND queues the run in a single call, so this maps
  // to that endpoint. `triggerEvalRun` below is kept as a no-op for caller
  // compatibility (the express API needed a separate trigger; V1 does not).
  async createAndRunEvalRun(projectId: string, input: EvalRunInput): Promise<EvalRunCreated> {
    const res = await this.request<{ evalRun: { id: string; status: string } }>(
      'POST',
      `/projects/${enc(projectId)}/eval-runs/run`,
      {
        evalRun: {
          name: input.name,
          description: input.description,
          agentId: input.agentId,
          scenarioIds: input.scenarioIds,
          filter: input.filter,
          capabilityIds: input.capabilityIds,
          capabilityVersions: input.capabilityVersions,
        },
      },
    );
    return { id: res.evalRun.id, status: normalizeStatus(res.evalRun.status) };
  }

  // No-op: V1's RunEvaluation (in createEvalRun) already queued the run. Retained
  // so callers that follow create-then-trigger keep working unchanged.
  async triggerEvalRun(_projectId: string, runId: string): Promise<{ evalRunId: string }> {
    return { evalRunId: runId };
  }

  async getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus> {
    const res = await this.request<{ evalRun: RawEvalRun }>(
      'GET',
      `/projects/${enc(projectId)}/eval-runs/${enc(runId)}`,
    );
    const r = res.evalRun;
    const m = r.aggregateMetrics ?? {};
    return {
      status: normalizeStatus(r.status),
      progress: r.progress ?? 0,
      aggregateMetrics: {
        totalAssertions: m.totalAssertions ?? 0,
        passed: m.passed ?? 0,
        failed: m.failed ?? 0,
        skipped: m.skipped ?? 0,
        errors: m.errors ?? 0,
        passRate: toPercent(m.passRate),
        avgDuration: m.avgDuration ?? 0,
        totalDuration: m.totalDuration ?? 0,
      },
    };
  }

  async deleteCapabilityVersion(capabilityId: string, projectId: string, versionId: string): Promise<void> {
    await this.request<void>('DELETE', `/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/versions/${enc(versionId)}`);
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
