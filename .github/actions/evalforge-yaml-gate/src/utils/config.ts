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

export type MergeSweepConfig = {
  evalforgeUrl: string;
  projectId: string;
  agentId: string;
  prodMcpId: string;
  appId: string;
  appSecret: string;
  githubToken: string;
  owner: string;
  repo: string;
  changedFilesRaw: string;
};

export function getMergeSweepConfig(): MergeSweepConfig {
  return {
    evalforgeUrl: coreEnsureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    agentId: core.getInput('evalforge-agent-id', { required: true }),
    prodMcpId: core.getInput('evalforge-prod-mcp-id', { required: true }),
    appId: coreSafeGetSecret(core, 'evalforge-app-id'),
    appSecret: coreSafeGetSecret(core, 'evalforge-app-secret'),
    githubToken: coreSafeGetSecret(core, 'github-token'),
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    changedFilesRaw: core.getInput('changed-files'),
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

/**
 * The prompt as the PR has it, not the base copy, so a prompt change is testable in the PR that
 * makes it. The tradeoff: a PR can edit the rules it is judged by. Revisit before `blocking` is on.
 */
export const DEFAULT_REVIEW_PROMPT_PATH = '.github/prompts/skill-review.md';
/**
 * The Wix AI Gateway, which is Anthropic-API-compatible. Not optional in practice: direct
 * api.anthropic.com egress is IP-allowlisted at the Wix org level, so a native key from a
 * GitHub-hosted runner gets a 403 whatever its value.
 *
 * No trailing `/v1` — the CLI appends `/v1/messages` itself, and `…/anthropic/v1` here would
 * request `…/v1/v1/messages` and 404. Public, documented for third-party developers, so it lives in
 * a variable rather than a secret.
 */
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://www.wixapis.com/anthropic';

/**
 * The `[1m]` suffix is load-bearing against the gateway: it always serves the 1M context window,
 * while the SDK assumes 200K and fails with `Prompt is too long` without it.
 */
export const DEFAULT_REVIEW_MODEL = 'claude-sonnet-5[1m]';

export const DEFAULT_REVIEW_EFFORT = 'medium';

export const DEFAULT_REVIEW_TIMEOUT_SECONDS = 600;

/** The job's own timeout is 20 minutes; leave room for checkout, install, and reporting. */
export const MAX_REVIEW_TIMEOUT_SECONDS = 900;

/** Review mode reaches no EvalForge service, so it shares only the GitHub half of `SimpleConfig`. */
export type ReviewConfig = {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  promptPath: string;
  model: string;
  effort: string;
  timeoutSeconds: number;
  isBlocking: boolean;
};

export function getReviewConfig(): ReviewConfig {
  const pr = github.context.payload.pull_request;
  const headSha = (pr?.head as { sha?: string } | undefined)?.sha;
  if (!headSha) throw new Error('PR payload missing head.sha');
  const baseSha = (pr?.base as { sha?: string } | undefined)?.sha;
  if (!baseSha) throw new Error('PR payload missing base.sha');

  return {
    githubToken: coreSafeGetSecret(core, 'github-token'),
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    prNumber: coreGetPrNumber(github.context.payload),
    headSha,
    baseSha,
    anthropicApiKey: coreSafeGetSecret(core, 'anthropic-api-key'),
    anthropicBaseUrl: core.getInput('anthropic-base-url') || DEFAULT_ANTHROPIC_BASE_URL,
    promptPath: core.getInput('prompt-path') || DEFAULT_REVIEW_PROMPT_PATH,
    model: core.getInput('review-model') || DEFAULT_REVIEW_MODEL,
    effort: core.getInput('review-effort') || DEFAULT_REVIEW_EFFORT,
    // Clamped rather than thrown: config loads before `isBlocking` is known, so a typo'd repo
    // variable must not fail a check that promises it cannot fail during soak.
    timeoutSeconds: getClampedReviewTimeout(),
    isBlocking: core.getInput('blocking') === 'true',
  };
}

function getClampedReviewTimeout(): number {
  const raw = core.getInput('review-timeout-seconds');
  if (raw === '') return DEFAULT_REVIEW_TIMEOUT_SECONDS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 60) {
    core.warning(`review-timeout-seconds: "${raw}" is not an integer >= 60, using ${DEFAULT_REVIEW_TIMEOUT_SECONDS}.`);
    return DEFAULT_REVIEW_TIMEOUT_SECONDS;
  }
  if (value <= MAX_REVIEW_TIMEOUT_SECONDS) return value;
  core.warning(`review-timeout-seconds: ${value} exceeds the ceiling of ${MAX_REVIEW_TIMEOUT_SECONDS}, using ${MAX_REVIEW_TIMEOUT_SECONDS}.`);
  return MAX_REVIEW_TIMEOUT_SECONDS;
}
