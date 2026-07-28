import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  DEFAULT_BROAD_IMPACT_GLOBS, DEFAULT_IGNORE_GLOBS,
  ensureHttps, safeGetSecret, getPrNumber,
} from '@wix/evalforge-core';

/** Subdirectory the base-SHA checkout lands in, matching the yaml-gate workflows. */
export const BASE_WORKSPACE_SUBDIR = '.action-src';

export type SyncConfig = {
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  evalsGlob: string;
  repo: string;
  githubToken: string;
  prNumber: number;
};

export function getSyncConfig(): SyncConfig {
  return {
    evalforgeUrl: ensureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret(core, 'evalforge-app-id'),
    appSecret: safeGetSecret(core, 'evalforge-app-secret'),
    evalsGlob: core.getInput('evals-glob', { required: true }),
    repo: `${github.context.repo.owner}/${github.context.repo.repo}`,
    githubToken: core.getInput('github-token', { required: true }),
    prNumber: getPrNumber(github.context.payload),
  };
}

export type GateConfig = {
  githubToken: string;
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  capabilityId: string;
  agentId: string;
  evalsGlob: string;
  skillDir: string;
  referenceDir: string;
  ignoreGlobs: string[];
  broadImpactGlobs: string[];
  maxScenarios: number;
  blocking: boolean;
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  versionLabel: string;
};

export type CleanupConfig = {
  githubToken: string;
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  capabilityId: string;
  evalsGlob: string;
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
};

/** Newline-separated list input, falling back to `fallback` when blank. */
function getMultilineList(name: string, fallback: string[]): string[] {
  const raw = core.getInput(name);
  if (raw.trim() === '') return fallback;
  const entries = raw.split('\n').map(line => line.trim()).filter(line => line !== '');
  return entries.length > 0 ? entries : fallback;
}

function getPositiveIntegerInput(name: string, fallback: number): number {
  const raw = core.getInput(name) || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (received: ${raw})`);
  }
  return value;
}

function getHeadSha(): string {
  const pullRequest = github.context.payload.pull_request;
  const headSha = (pullRequest?.head as { sha?: string } | undefined)?.sha;
  if (!headSha) throw new Error('PR payload missing head.sha');
  return headSha;
}

export function getGateConfig(): GateConfig {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const prNumber = getPrNumber(github.context.payload);
  const headSha = getHeadSha();

  return {
    githubToken: safeGetSecret(core, 'github-token'),
    evalforgeUrl: ensureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret(core, 'evalforge-app-id'),
    appSecret: safeGetSecret(core, 'evalforge-app-secret'),
    capabilityId: core.getInput('capability-id', { required: true }),
    agentId: core.getInput('agent-id', { required: true }),
    evalsGlob: core.getInput('evals-glob', { required: true }),
    skillDir: core.getInput('skill-dir', { required: true }),
    referenceDir: core.getInput('reference-dir') || 'references',
    ignoreGlobs: getMultilineList('ignore-globs', DEFAULT_IGNORE_GLOBS),
    broadImpactGlobs: getMultilineList('broad-impact-globs', DEFAULT_BROAD_IMPACT_GLOBS),
    maxScenarios: getPositiveIntegerInput('max-scenarios', 25),
    blocking: core.getInput('blocking') === 'true',
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    prNumber,
    headSha,
    versionLabel: `pr-${prNumber}-${headSha.slice(0, 7)}`,
  };
}

export function getCleanupConfig(): CleanupConfig {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  return {
    githubToken: safeGetSecret(core, 'github-token'),
    evalforgeUrl: ensureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret(core, 'evalforge-app-id'),
    appSecret: safeGetSecret(core, 'evalforge-app-secret'),
    capabilityId: core.getInput('capability-id', { required: true }),
    evalsGlob: core.getInput('evals-glob', { required: true }),
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    prNumber: getPrNumber(github.context.payload),
  };
}
