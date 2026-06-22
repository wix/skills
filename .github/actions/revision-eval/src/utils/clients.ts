import { getErrorMessage, ErrorMessage } from "./reporting";

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Delete = "DELETE",
}

type HttpError = Error & { status: number };

const MCP_URL = "https://mcp.wix.com/mcp";
const MCP_CONFIG_KEY = "wix-mcp-remote";
const OPEN_API_RESOLVER_URL = "https://dev.wix.com/docs/api/v1/open-api-resolver";

export type EntityToRevisionResult = { resourceId: string };

export type CapabilityVersion = {
  id: string;
  capabilityId: string;
  version: string;
};

export type EvalRunInput = {
  name: string;
  description: string;
  projectId: string;
  tags: string[];
  agentId: string;
  capabilityIds?: string[];
  capabilityVersions?: Record<string, string>;
};

export type EvalRunCreated = {
  id: string;
  status: string;
  scenarioIds: string[];
};

export enum EvalRunStatusStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export type EvalRunStatus = {
  status: EvalRunStatusStatus;
  progress: number;
  aggregateMetrics: {
    totalAssertions: number;
    passed: number;
    failed: number;
    errors: number;
    passRate: number;
  };
};

export function buildMcpOverrideUrl(
  skillsRepo: string,
  skillsPr: string,
): string {
  const url = new URL(MCP_URL);
  url.searchParams.set("skillsRepo", skillsRepo);
  url.searchParams.set("skillsPr", skillsPr);
  return url.toString();
}

export class EvalForgeClient {
  private readonly headers: Record<string, string>;

  constructor(
    private readonly baseUrl: string,
    appId: string,
    appSecret: string,
  ) {
    this.headers = {
      "Content-Type": "application/json",
      "x-app-id": appId,
      "x-app-secret": appSecret,
    };
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw Object.assign(
        new Error(
          `EvalForge ${method} ${path} → ${res.status}: ${err.error ?? ""}`,
        ),
        { status: res.status } satisfies Pick<HttpError, "status">,
      );
    }
    return res.json().catch((e: unknown) => {
      throw new Error(
        `EvalForge ${method} ${path} → 200 but invalid JSON: ${getErrorMessage(e)}`,
      );
    }) as Promise<T>;
  }

  async listMcpVersions(
    mcpId: string,
    projectId: string,
  ): Promise<CapabilityVersion[]> {
    return this.request<CapabilityVersion[]>(
      HttpMethod.Get,
      `/projects/${projectId}/capabilities/${mcpId}/versions`,
    );
  }

  async createMcpVersion(
    mcpId: string,
    projectId: string,
    versionLabel: string,
    skillsRepo: string,
    skillsPr: string,
    prNumber: number,
  ): Promise<CapabilityVersion> {
    return this.request<CapabilityVersion>(
      HttpMethod.Post,
      `/projects/${projectId}/capabilities/${mcpId}/versions`,
      {
        version: versionLabel,
        origin: "pr",
        notes: `Auto-created for PR #${prNumber}`,
        content: {
          config: {
            [MCP_CONFIG_KEY]: {
              url: buildMcpOverrideUrl(skillsRepo, skillsPr),
              type: "http",
              headers: {
                Authorization: "{{wix-auth-token}}",
                "wix-account-id": "{{wix-auth-user-id}}",
              },
            },
          },
        },
      },
    );
  }

  async createEvalRun(
    projectId: string,
    input: EvalRunInput,
  ): Promise<EvalRunCreated> {
    return this.request<EvalRunCreated>(
      HttpMethod.Post,
      `/projects/${projectId}/eval-runs`,
      input,
    );
  }

  async triggerEvalRun(
    projectId: string,
    runId: string,
  ): Promise<{ evalRunId: string }> {
    return this.request<{ evalRunId: string }>(
      HttpMethod.Post,
      `/projects/${projectId}/eval-runs/${runId}/run`,
    );
  }

  async getEvalRun(projectId: string, runId: string): Promise<EvalRunStatus> {
    return this.request<EvalRunStatus>(
      HttpMethod.Get,
      `/projects/${projectId}/eval-runs/${runId}`,
    );
  }

  async deleteMcpVersion(
    mcpId: string,
    projectId: string,
    versionId: string,
  ): Promise<void> {
    await this.request<{ message: string }>(
      HttpMethod.Delete,
      `/projects/${projectId}/capabilities/${mcpId}/versions/${versionId}`,
    );
  }
}

export class OpenApiResolverClient {
  private readonly headers: Record<string, string>;

  constructor(
    appId: string,
    appSecret: string,
    private readonly baseUrl: string = OPEN_API_RESOLVER_URL,
  ) {
    this.headers = {
      "Content-Type": "application/json",
      "x-app-id": appId,
      "x-app-secret": appSecret,
    };
  }

  async entityToRevision(
    entity: unknown,
    commitHash: string,
  ): Promise<EntityToRevisionResult> {
    const path = "/entity-to-revision";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: HttpMethod.Post,
      headers: this.headers,
      body: JSON.stringify({ entity, commitHash }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw Object.assign(
        new Error(
          `${ErrorMessage.OpenApiResolverRequestFailed} ${path} → ${res.status}: ${err.error ?? ""}`,
        ),
        { status: res.status } satisfies Pick<HttpError, "status">,
      );
    }
    return res.json().catch((e: unknown) => {
      throw new Error(
        `${ErrorMessage.OpenApiResolverRequestFailed} ${path} → 200 but invalid JSON: ${getErrorMessage(e)}`,
      );
    }) as Promise<EntityToRevisionResult>;
  }
}
