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
  /** The PR's head commit — reported, but not what the label is built from. See `evaluatedSha`. */
  headSha: string;
  /** The commit whose content is actually uploaded and evaluated. */
  evaluatedSha: string;
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

/**
 * The commit whose content is actually evaluated.
 *
 * On `pull_request` the workflow's first checkout has no `ref:`, so it checks out the *merge*
 * commit — head merged into base — and `GITHUB_SHA` names exactly that. The version label has
 * to be built from this, not from `head.sha`: the same head produces different merge content
 * as base advances, so a head-based label would not uniquely identify what it labels, and
 * `ensureSkillVersion` would find the existing label and reuse a version built from stale
 * content.
 */
function getEvaluatedSha(): string {
  const sha = process.env.GITHUB_SHA;
  if (!sha) {
    throw new Error(
      'GITHUB_SHA is not set, so the skill version cannot be labelled for the commit actually '
      + 'evaluated. This action expects to run in GitHub Actions.',
    );
  }
  return sha;
}

export function getGateConfig(): GateConfig {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const prNumber = getPrNumber(github.context.payload);
  const headSha = getHeadSha();
  const evaluatedSha = getEvaluatedSha();

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
    evaluatedSha,
    versionLabel: `pr-${prNumber}-${evaluatedSha.slice(0, 7)}`,
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
