import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { getErrorMessage, ErrorMessage } from "./reporting";

export type Config = {
  githubToken: string;
  scenariosDir: string;
  evalforgeUrl: string;
  projectId: string;
  agentId: string;
  mcpId: string;
  appId: string;
  appSecret: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  owner: string;
  repo: string;
};

export type CleanupConfig = {
  evalforgeUrl: string;
  projectId: string;
  mcpId: string;
  appId: string;
  appSecret: string;
  prNumber: number;
};

export type ValidationError = {
  entryTitle: string;
  message: string;
};

export type Fixture = {
  path: string;
  name: string;
  entity: unknown;
};

type RawFixture = { entity?: unknown } | null;

// TODO: temporary — the entity will come from the API later.
const FIXTURE_PATH = ".github/fixtures/example-settings.json";

export function loadFixture(workspaceRoot: string): Fixture {
  let raw: RawFixture;
  try {
    raw = JSON.parse(
      readFileSync(join(workspaceRoot, FIXTURE_PATH), "utf-8"),
    ) as RawFixture;
  } catch (e) {
    throw new Error(`${ErrorMessage.JsonParseFailed}: ${getErrorMessage(e)}`);
  }

  return {
    path: FIXTURE_PATH,
    name: basename(FIXTURE_PATH, ".json"),
    entity: raw?.entity,
  };
}

function requiredInput(name: string): string {
  return core.getInput(name, { required: true });
}

function requireHttps(url: string, label: string): string {
  if (!url.startsWith("https://")) {
    throw new Error(`${label} must be an HTTPS URL, got: ${url}`);
  }
  return url;
}

function requiredSecret(name: string): string {
  const value = requiredInput(name);
  core.setSecret(value);
  return value;
}

function evalForgeInputs() {
  return {
    evalforgeUrl: requireHttps(requiredInput("evalforge-url"), "evalforge-url"),
    projectId: requiredInput("evalforge-project-id"),
    mcpId: requiredInput("evalforge-mcp-id"),
    appId: requiredSecret("evalforge-app-id"),
    appSecret: requiredSecret("evalforge-app-secret"),
  };
}

function pullRequest() {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    throw new Error(
      "No pull_request payload — action must be triggered by a pull_request event",
    );
  }
  return pr;
}

export function getEvalConfig(): Config {
  const pr = pullRequest();
  const prNumber = pr.number as number | undefined;
  const baseSha = (pr.base as { sha?: string } | undefined)?.sha;
  const headSha = (pr.head as { sha?: string } | undefined)?.sha;
  if (!prNumber || !baseSha || !headSha) {
    throw new Error(
      "PR payload is missing required fields (number, base.sha, or head.sha)",
    );
  }

  return {
    ...evalForgeInputs(),
    githubToken: requiredSecret("github-token"),
    scenariosDir: core.getInput("scenarios-dir") || "yaml/wix-manage-evals",
    agentId: requiredInput("evalforge-agent-id"),
    prNumber,
    baseSha,
    headSha,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}

export function getCleanupConfig(): CleanupConfig {
  const pr = pullRequest();
  const prNumber = pr.number as number | undefined;
  if (!prNumber) {
    throw new Error("PR payload is missing required field: number");
  }

  return {
    ...evalForgeInputs(),
    prNumber,
  };
}
