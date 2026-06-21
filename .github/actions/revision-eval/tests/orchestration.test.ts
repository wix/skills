import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@actions/core";
import { getCleanupConfig } from "../src/utils/config";
import { EvalForgeClient, EvalRunStatusStatus } from "../src/utils/clients";
import { pollUntilDone, runCleanup } from "../src/utils/orchestration";
import type { EvalRunStatus } from "../src/utils/clients";

const CLEANUP_CONFIG = {
  evalforgeUrl: "https://ef.example.com/api",
  projectId: "proj-1",
  mcpId: "mcp-1",
  appId: "app-1",
  appSecret: "secret-1",
  prNumber: 42,
};

const ALL_VERSIONS = [
  { id: "ver-1", capabilityId: "mcp-1", version: "pr-42-abc1234" },
  { id: "ver-2", capabilityId: "mcp-1", version: "pr-42-def5678" },
  { id: "ver-3", capabilityId: "mcp-1", version: "1.0.0" },
  { id: "ver-4", capabilityId: "mcp-1", version: "pr-99-abc1234" },
];

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  setFailed: vi.fn(),
}));
vi.mock("../src/utils/config");
vi.mock("../src/utils/clients");

function makeClient(): EvalForgeClient {
  return {
    getEvalRun: vi.fn(),
  } as unknown as EvalForgeClient;
}

describe("pollUntilDone", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns status when completed immediately", async () => {
    const client = makeClient();
    const completedStatus: EvalRunStatus = {
      status: EvalRunStatusStatus.Completed,
      progress: 100,
      aggregateMetrics: {
        totalAssertions: 5,
        passed: 5,
        failed: 0,
        errors: 0,
        passRate: 100,
      },
    };
    vi.mocked(client.getEvalRun).mockResolvedValue(completedStatus);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe(EvalRunStatusStatus.Completed);
  });

  it("polls multiple times before completing", async () => {
    const client = makeClient();
    const running: EvalRunStatus = {
      status: EvalRunStatusStatus.Running,
      progress: 50,
      aggregateMetrics: {
        totalAssertions: 5,
        passed: 2,
        failed: 0,
        errors: 0,
        passRate: 40,
      },
    };
    const done: EvalRunStatus = {
      status: EvalRunStatusStatus.Completed,
      progress: 100,
      aggregateMetrics: {
        totalAssertions: 5,
        passed: 5,
        failed: 0,
        errors: 0,
        passRate: 100,
      },
    };
    vi.mocked(client.getEvalRun)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(done);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(client.getEvalRun).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(EvalRunStatusStatus.Completed);
  });

  it("throws timeout error after 30 minutes", async () => {
    const client = makeClient();
    const running: EvalRunStatus = {
      status: EvalRunStatusStatus.Running,
      progress: 10,
      aggregateMetrics: {
        totalAssertions: 5,
        passed: 1,
        failed: 0,
        errors: 0,
        passRate: 20,
      },
    };
    vi.mocked(client.getEvalRun).mockResolvedValue(running);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await Promise.all([
      expect(promise).rejects.toMatchObject({ timeout: true }),
      vi.runAllTimersAsync(),
    ]);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const client = makeClient();
    const done: EvalRunStatus = {
      status: EvalRunStatusStatus.Completed,
      progress: 100,
      aggregateMetrics: {
        totalAssertions: 5,
        passed: 5,
        failed: 0,
        errors: 0,
        passRate: 100,
      },
    };
    vi.mocked(client.getEvalRun)
      .mockRejectedValueOnce(
        Object.assign(new Error("server error"), { status: 500 }),
      )
      .mockResolvedValueOnce(done);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe(EvalRunStatusStatus.Completed);
  });

  it("throws after exhausting all 5xx retries", async () => {
    const client = makeClient();
    const serverError = Object.assign(new Error("server error"), {
      status: 500,
    });
    vi.mocked(client.getEvalRun).mockRejectedValue(serverError);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await Promise.all([
      expect(promise).rejects.toMatchObject({ status: 500 }),
      vi.runAllTimersAsync(),
    ]);
  });

  it("throws immediately on non-retriable 4xx without retrying", async () => {
    const client = makeClient();
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    vi.mocked(client.getEvalRun).mockRejectedValueOnce(notFound);
    const promise = pollUntilDone(client, "proj-1", "run-1");
    await Promise.all([
      expect(promise).rejects.toMatchObject({ status: 404 }),
      vi.runAllTimersAsync(),
    ]);
    expect(client.getEvalRun).toHaveBeenCalledTimes(1);
  });

  it.each([EvalRunStatusStatus.Failed, EvalRunStatusStatus.Cancelled] as const)(
    'returns immediately on terminal status "%s"',
    async (terminalStatus) => {
      const client = makeClient();
      const terminal: EvalRunStatus = {
        status: terminalStatus,
        progress: 0,
        aggregateMetrics: {
          totalAssertions: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          passRate: 0,
        },
      };
      vi.mocked(client.getEvalRun).mockResolvedValue(terminal);
      const promise = pollUntilDone(client, "proj-1", "run-1");
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.status).toBe(terminalStatus);
    },
  );
});

describe("runCleanup", () => {
  let mockListMcpVersions: ReturnType<typeof vi.fn>;
  let mockDeleteMcpVersion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCleanupConfig).mockReturnValue(CLEANUP_CONFIG);
    mockListMcpVersions = vi.fn().mockResolvedValue(ALL_VERSIONS);
    mockDeleteMcpVersion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(EvalForgeClient).mockImplementation(
      () =>
        ({
          listMcpVersions: mockListMcpVersions,
          deleteMcpVersion: mockDeleteMcpVersion,
        }) as unknown as EvalForgeClient,
    );
  });

  it("deletes only versions matching the PR prefix", async () => {
    await runCleanup();

    expect(mockListMcpVersions).toHaveBeenCalledWith("mcp-1", "proj-1");
    expect(mockDeleteMcpVersion).toHaveBeenCalledTimes(2);
    expect(mockDeleteMcpVersion).toHaveBeenCalledWith(
      "mcp-1",
      "proj-1",
      "ver-1",
    );
    expect(mockDeleteMcpVersion).toHaveBeenCalledWith(
      "mcp-1",
      "proj-1",
      "ver-2",
    );
    expect(mockDeleteMcpVersion).not.toHaveBeenCalledWith(
      "mcp-1",
      "proj-1",
      "ver-3",
    );
    expect(mockDeleteMcpVersion).not.toHaveBeenCalledWith(
      "mcp-1",
      "proj-1",
      "ver-4",
    );
  });

  it("logs info for each successfully deleted version", async () => {
    await runCleanup();

    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      expect.stringContaining("pr-42-abc1234"),
    );
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      expect.stringContaining("pr-42-def5678"),
    );
  });

  it("warns on individual delete failure but does not fail the job", async () => {
    mockDeleteMcpVersion
      .mockRejectedValueOnce(new Error("Not found"))
      .mockResolvedValueOnce(undefined);

    await runCleanup();

    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining("pr-42-abc1234"),
    );
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it("exits cleanly when no versions match the PR prefix", async () => {
    mockListMcpVersions.mockResolvedValue([
      { id: "ver-3", capabilityId: "mcp-1", version: "1.0.0" },
      { id: "ver-4", capabilityId: "mcp-1", version: "pr-99-abc1234" },
    ]);

    await runCleanup();

    expect(mockDeleteMcpVersion).not.toHaveBeenCalled();
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it("calls setFailed when listMcpVersions throws", async () => {
    mockListMcpVersions.mockRejectedValue(new Error("API unavailable"));

    await runCleanup();

    expect(vi.mocked(core.setFailed)).toHaveBeenCalled();
    expect(mockDeleteMcpVersion).not.toHaveBeenCalled();
  });
});
