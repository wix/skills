import * as core from '@actions/core';
import * as github from '@actions/github';
import { ensureHttps as coreEnsureHttps, safeGetSecret as coreSafeGetSecret, getPrNumber as coreGetPrNumber } from '@wix/evalforge-core';

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
    githubToken: coreSafeGetSecret(core, 'github-token'),
    evalforgeUrl: coreEnsureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    mcpId: core.getInput('evalforge-mcp-id', { required: true }),
    appId: coreSafeGetSecret(core, 'evalforge-app-id'),
    appSecret: coreSafeGetSecret(core, 'evalforge-app-secret'),
    prNumber: coreGetPrNumber(github.context.payload),
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}

export type ScheduleConfig = {
  evalforgeUrl: string;
  projectId: string;
  agentId: string;
  appId: string;
  appSecret: string;
  runName: string;
};

export function getScheduleConfig(): ScheduleConfig {
  return {
    evalforgeUrl: coreEnsureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    agentId: core.getInput('evalforge-agent-id', { required: true }),
    appId: coreSafeGetSecret(core, 'evalforge-app-id'),
    appSecret: coreSafeGetSecret(core, 'evalforge-app-secret'),
    runName: core.getInput('run-name') || 'scheduled-run',
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
