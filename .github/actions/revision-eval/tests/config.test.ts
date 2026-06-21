import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMcpOverrideUrl } from "../src/utils/clients";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setSecret: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@actions/github", () => ({
  context: {
    payload: {
      pull_request: {
        number: 42,
        base: { sha: "base-sha-123" },
        head: { sha: "head-sha-456" },
      },
    },
    repo: { owner: "wix", repo: "skills" },
  },
}));
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

import * as core from "@actions/core";
import { readFileSync } from "node:fs";
import {
  getEvalConfig,
  getCleanupConfig,
  loadFixture,
} from "../src/utils/config";

const ALL_INPUTS: Record<string, string> = {
  "github-token": "ghs_token",
  "scenarios-dir": "",
  "evalforge-url": "https://ef.example.com/api",
  "evalforge-project-id": "proj-1",
  "evalforge-agent-id": "agent-1",
  "evalforge-mcp-id": "mcp-1",
  "evalforge-app-id": "app-1",
  "evalforge-app-secret": "secret-1",
  blocking: "true",
};

beforeEach(() => {
  vi.mocked(core.getInput).mockImplementation(
    (name: string) => ALL_INPUTS[name] ?? "",
  );
});

describe("buildMcpOverrideUrl", () => {
  it("sets skillsPr to the commitHash and never sets skillsRepo", () => {
    const url = buildMcpOverrideUrl("pr-42-abc1234");
    expect(url).toContain("skillsPr=pr-42-abc1234");
    expect(url).not.toContain("skillsRepo");
    expect(url.startsWith("https://mcp.wix.com/mcp?")).toBe(true);
  });
});

describe("getEvalConfig", () => {
  it("returns config with all fields populated", () => {
    const config = getEvalConfig();
    expect(config.githubToken).toBe("ghs_token");
    expect(config.scenariosDir).toBe("yaml/wix-manage-evals");
    expect(config.evalforgeUrl).toBe("https://ef.example.com/api");
    expect(config.projectId).toBe("proj-1");
    expect(config.agentId).toBe("agent-1");
    expect(config.mcpId).toBe("mcp-1");
    expect(config.appId).toBe("app-1");
    expect(config.appSecret).toBe("secret-1");
    expect(config.prNumber).toBe(42);
    expect(config.baseSha).toBe("base-sha-123");
    expect(config.headSha).toBe("head-sha-456");
    expect(config.owner).toBe("wix");
    expect(config.repo).toBe("skills");
  });

  it("masks all secret inputs", () => {
    getEvalConfig();
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith("ghs_token");
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith("app-1");
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith("secret-1");
  });

  it("blocking is true when input is absent (empty string)", () => {
    vi.mocked(core.getInput).mockImplementation(
      (name: string) => ({ ...ALL_INPUTS, blocking: "" })[name] ?? "",
    );
    expect(getEvalConfig().blocking).toBe(true);
  });

  it("throws when a URL input is not HTTPS", () => {
    vi.mocked(core.getInput).mockImplementation(
      (name: string) =>
        ({ ...ALL_INPUTS, "evalforge-url": "http://ef.example.com/api" })[
          name
        ] ?? "",
    );
    expect(() => getEvalConfig()).toThrow("evalforge-url must be an HTTPS URL");
  });

  it("throws when a required input is missing", () => {
    vi.mocked(core.getInput).mockImplementation((name, opts) => {
      if (name === "evalforge-agent-id") {
        if (opts?.required)
          throw new Error(
            "Input required and not supplied: evalforge-agent-id",
          );
        return "";
      }
      return ALL_INPUTS[name] ?? "";
    });
    expect(() => getEvalConfig()).toThrow("evalforge-agent-id");
  });
});

describe("getCleanupConfig", () => {
  it("returns cleanup config with required fields", () => {
    const config = getCleanupConfig();
    expect(config.evalforgeUrl).toBe("https://ef.example.com/api");
    expect(config.projectId).toBe("proj-1");
    expect(config.mcpId).toBe("mcp-1");
    expect(config.appId).toBe("app-1");
    expect(config.appSecret).toBe("secret-1");
    expect(config.prNumber).toBe(42);
  });

  it("does not include agentId, blocking, baseSha, headSha, owner, or repo", () => {
    const config = getCleanupConfig();
    expect(config).not.toHaveProperty("agentId");
    expect(config).not.toHaveProperty("blocking");
    expect(config).not.toHaveProperty("baseSha");
    expect(config).not.toHaveProperty("headSha");
    expect(config).not.toHaveProperty("owner");
    expect(config).not.toHaveProperty("repo");
  });

  it("masks app-id and app-secret", () => {
    vi.mocked(core.setSecret).mockReset();
    getCleanupConfig();
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith("app-1");
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith("secret-1");
  });
});

describe("loadFixture", () => {
  beforeEach(() => vi.mocked(readFileSync).mockReset());

  it("loads the example fixture entity (entity validity left to the resolver)", () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        entity: { info: { fqdn: "wix.example.app.v1.thing" } },
      }) as never,
    );
    const fixture = loadFixture("/ws");
    expect(fixture).toMatchObject({
      path: ".github/fixtures/example-settings.json",
      name: "example-settings",
    });
    expect(fixture.entity).toEqual({
      info: { fqdn: "wix.example.app.v1.thing" },
    });
  });

  it("throws a parse error on invalid JSON", () => {
    vi.mocked(readFileSync).mockReturnValue("{ not json" as never);
    expect(() => loadFixture("/ws")).toThrow("failed to parse JSON");
  });
});
