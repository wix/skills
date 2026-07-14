import * as core from '@actions/core';
import * as github from '@actions/github';

export type SimpleConfig = {
  githubToken: string;
  evalforgeUrl: string;
  projectId: string;
  mcpId: string;
  appId: string;
  appSecret: string;
  prNumber: number;
  owner: string;
  repo: string;
};

export type Config = SimpleConfig & {
  agentId: string;
  headSha: string;
  mcpSkillsRepo: string;
  blocking: boolean;
  evalPipelineUrl: string;
  agentName: string;
  autoApprove: boolean;
  triggerEvalCompare: boolean;
  maxNewSkills: number;
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

function getPrNumber(): number {
  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');
  const n = pr.number as number | undefined;
  if (!n) throw new Error('PR payload missing number');
  return n;
}

function getPositiveIntegerInput(name: string, fallback: number): number {
  const raw = core.getInput(name) || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (received: ${raw})`);
  }
  return value;
}

export function getSimpleConfig(): SimpleConfig {
  return {
    githubToken: safeGetSecret('github-token'),
    evalforgeUrl: ensureHttps(core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    mcpId: core.getInput('evalforge-mcp-id', { required: true }),
    appId: safeGetSecret('evalforge-app-id'),
    appSecret: safeGetSecret('evalforge-app-secret'),
    prNumber: getPrNumber(),
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}

export function getEvalConfig(): Config {
  const pr = github.context.payload.pull_request!;
  const headSha = (pr.head as { sha?: string } | undefined)?.sha;
  if (!headSha) throw new Error('PR payload missing head.sha');

  const explicitRepo = core.getInput('mcp-skills-repo');
  const mcpSkillsRepo = explicitRepo
    || process.env.GITHUB_REPOSITORY
    || `${github.context.repo.owner}/${github.context.repo.repo}`;

  return {
    ...getSimpleConfig(),
    agentId: core.getInput('evalforge-agent-id', { required: true }),
    headSha,
    mcpSkillsRepo,
    blocking: core.getInput('blocking') === 'true',
    evalPipelineUrl: core.getInput('eval-pipeline-url') || 'https://www.wixapis.com/_api/eval-pipeline',
    agentName: core.getInput('agent-name') || 'agent',
    autoApprove: core.getInput('auto-approve') === 'true',
    triggerEvalCompare: core.getInput('eval-compare') !== 'false',
    maxNewSkills: getPositiveIntegerInput('max-new-skills', 1),
  };
}
