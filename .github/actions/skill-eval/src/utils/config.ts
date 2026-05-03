import * as core from '@actions/core';
import * as github from '@actions/github';

export type Config = {
  githubToken: string;
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
  blocking: boolean;
};

function ensureHttps(url: string): string {
  if (url.startsWith('https://')) return url;
  const upgraded = 'https://' + url.replace(/^https?:\/\//, '');
  core.warning(`evalforge-url was not HTTPS — upgraded to: ${upgraded}`);
  return upgraded;
}

function safeGetSecret(name: string): string {
  const value = core.getInput(name, { required: true });
  core.setSecret(value);
  return value;
}

export function getEvalConfig(): Config {
  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');

  const prNumber = pr.number as number | undefined;
  const baseSha = (pr.base as { sha?: string } | undefined)?.sha;
  const headSha = (pr.head as { sha?: string } | undefined)?.sha;
  if (!prNumber || !baseSha || !headSha) throw new Error('PR payload is missing required fields (number, base.sha, or head.sha)');

  return {
    githubToken: safeGetSecret('github-token'),
    evalforgeUrl: ensureHttps(core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    agentId: core.getInput('evalforge-agent-id', { required: true }),
    mcpId: core.getInput('evalforge-mcp-id', { required: true }),
    appId: safeGetSecret('evalforge-app-id'),
    appSecret: safeGetSecret('evalforge-app-secret'),
    prNumber,
    baseSha,
    headSha,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    blocking: core.getInput('blocking') !== 'false',
  };
}

export type CleanupConfig = {
  evalforgeUrl: string;
  projectId: string;
  mcpId: string;
  appId: string;
  appSecret: string;
  prNumber: number;
};

export function getCleanupConfig(): CleanupConfig {
  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');

  const prNumber = pr.number as number | undefined;
  if (!prNumber) throw new Error('PR payload is missing required field: number');

  return {
    evalforgeUrl: ensureHttps(core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    mcpId: core.getInput('evalforge-mcp-id', { required: true }),
    appId: safeGetSecret('evalforge-app-id'),
    appSecret: safeGetSecret('evalforge-app-secret'),
    prNumber,
  };
}
