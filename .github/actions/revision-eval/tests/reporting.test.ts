import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import {
  formatValidationErrors,
  COMMENT_MARKER,
  formatEvalPassed,
  formatEvalFailed,
  formatEvalTimeout,
  formatNoScenarios,
  formatServiceError,
  upsertComment,
  fail,
} from "../src/utils/reporting";
import type { Config } from "../src/utils/config";

const config: Config = {
  githubToken: "token",
  scenariosDir: "yaml/wix-manage-evals",
  evalforgeUrl: "https://evalforge.example.com",
  projectId: "proj-1",
  agentId: "agent-1",
  mcpId: "mcp-1",
  appId: "app-id",
  appSecret: "secret",
  prNumber: 42,
  baseSha: "abc123",
  headSha: "def456",
  owner: "wix",
  repo: "skills",
  blocking: true,
};

vi.mock("@actions/core", () => ({
  error: vi.fn(),
  setFailed: vi.fn(),
  warning: vi.fn(),
  summary: {
    addRaw: vi
      .fn()
      .mockReturnValue({ write: vi.fn().mockResolvedValue(undefined) }),
  },
}));

describe("formatValidationErrors", () => {
  it("includes the comment marker", () => {
    const result = formatValidationErrors([
      { entryTitle: "T", message: "msg" },
    ]);
    expect(result).toContain(COMMENT_MARKER);
  });

  it("formats a single error", () => {
    const result = formatValidationErrors([
      { entryTitle: ".github/fixtures/a.json", message: "missing tags" },
    ]);
    expect(result).toContain("**.github/fixtures/a.json**: missing tags");
  });

  it("formats multiple errors as separate lines", () => {
    const result = formatValidationErrors([
      { entryTitle: "a.json", message: "missing tags" },
      { entryTitle: "b.json", message: "missing `entity.info.fqdn`" },
    ]);
    expect(result).toContain("**a.json**: missing tags");
    expect(result).toContain("**b.json**: missing `entity.info.fqdn`");
  });
});

describe("eval result formatters", () => {
  const metrics = {
    totalAssertions: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    errors: 0,
    passRate: 100,
    avgDuration: 500,
    totalDuration: 5000,
  };

  it("formatEvalPassed includes pass rate and run ID", () => {
    const body = formatEvalPassed({ ...metrics }, "run-123");
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("✅");
    expect(body).toContain("Revision Evaluation: Passed");
    expect(body).toContain("100%");
    expect(body).toContain("run-123");
  });

  it("formatEvalFailed includes pass rate and run ID", () => {
    const body = formatEvalFailed(
      { ...metrics, passed: 8, failed: 2, passRate: 80 },
      "run-123",
      true,
    );
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("❌");
    expect(body).toContain("80%");
    expect(body).toContain("run-123");
  });

  it("formatEvalTimeout includes run ID", () => {
    const body = formatEvalTimeout("run-123", true);
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("⏱");
    expect(body).toContain("run-123");
  });

  it("formatNoScenarios includes tags", () => {
    const body = formatNoScenarios(["stores", "calendar"], true);
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("❌");
    expect(body).toContain("stores");
    expect(body).toContain("calendar");
  });
});

describe("non-blocking comment formatters", () => {
  const metrics = {
    totalAssertions: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    errors: 0,
    passRate: 80,
    avgDuration: 500,
    totalDuration: 5000,
  };

  it("formatServiceError uses ⚠️ heading when non-blocking", () => {
    const body = formatServiceError("timeout", false);
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("⚠️");
    expect(body).toContain("Revision Evaluation: Warning");
    expect(body).not.toContain("❌");
  });

  it("formatServiceError uses ❌ heading when blocking", () => {
    const body = formatServiceError("timeout", true);
    expect(body).toContain("❌");
    expect(body).toContain("Revision Evaluation: Error");
    expect(body).not.toContain("⚠️");
  });

  it("formatEvalFailed uses ⚠️ heading when non-blocking", () => {
    const body = formatEvalFailed(metrics, "run-123", false);
    expect(body).toContain("⚠️");
    expect(body).toContain("Revision Evaluation: Warning");
    expect(body).not.toContain("❌");
  });

  it("formatEvalFailed uses ❌ heading when blocking", () => {
    const body = formatEvalFailed(metrics, "run-123", true);
    expect(body).toContain("❌");
    expect(body).toContain("Revision Evaluation: Failed");
    expect(body).not.toContain("⚠️");
  });

  it("formatEvalTimeout uses ⚠️ when non-blocking", () => {
    const body = formatEvalTimeout("run-123", false);
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("⚠️");
    expect(body).toContain("run-123");
  });

  it("formatEvalTimeout uses ⏱ when blocking", () => {
    const body = formatEvalTimeout("run-123", true);
    expect(body).toContain("⏱");
    expect(body).not.toContain("⚠️");
  });

  it("formatNoScenarios uses ⚠️ when non-blocking", () => {
    const body = formatNoScenarios(["stores"], false);
    expect(body).toContain("⚠️");
    expect(body).not.toContain("❌");
  });

  it("formatNoScenarios uses ❌ when blocking", () => {
    const body = formatNoScenarios(["stores"], true);
    expect(body).toContain("❌");
    expect(body).not.toContain("⚠️");
  });
});

function makeOctokit(comments: { id: number; body: string }[]) {
  return {
    paginate: vi.fn().mockResolvedValue(comments),
    rest: {
      issues: {
        listComments: {},
        updateComment: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

describe("fail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls core.setFailed when blocking is true", () => {
    fail("something broke", true);
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith("something broke");
    expect(vi.mocked(core.warning)).not.toHaveBeenCalled();
  });

  it("calls core.warning when blocking is false", () => {
    fail("something broke", false);
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith("something broke");
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });
});

describe("upsertComment", () => {
  it("updates existing comment when marker is found", async () => {
    const octokit = makeOctokit([
      { id: 101, body: `${COMMENT_MARKER}\n## ✅ old result` },
    ]);
    await upsertComment(octokit as never, config, "new body");
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 101, body: "new body" }),
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("creates new comment when no marker found", async () => {
    const octokit = makeOctokit([{ id: 99, body: "unrelated comment" }]);
    await upsertComment(octokit as never, config, "new body");
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, body: "new body" }),
    );
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("updates only the comment with the marker when multiple comments exist", async () => {
    const octokit = makeOctokit([
      { id: 1, body: "some other comment" },
      { id: 2, body: `${COMMENT_MARKER}\n## ✅ old result` },
      { id: 3, body: "another comment" },
    ]);
    await upsertComment(octokit as never, config, "new body");
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2 }),
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
