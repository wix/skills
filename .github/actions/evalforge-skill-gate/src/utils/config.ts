import { randomUUID } from 'node:crypto';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  DEFAULT_BASE_ARM_GRACE_SECONDS, DEFAULT_BROAD_IMPACT_GLOBS, DEFAULT_IGNORE_GLOBS, DEFAULT_MAX_SCENARIOS,
  DEFAULT_REFERENCE_DIR, DEFAULT_RUNS_PER_SCENARIO, ensureHttps, safeGetSecret, getPrNumber,
} from '@wix/evalforge-core';

/** Subdirectory the base-SHA checkout lands in, matching the yaml-gate workflows. */
export const BASE_WORKSPACE_SUBDIR = '.action-src';

/**
 * Per-input ceiling for `max-scenarios`. On its own this does not bound total cost: each scenario
 * execution is multiplied by `runs-per-scenario` and by the unconditional second (base) arm — see
 * `MAX_TOTAL_SCENARIO_EXECUTIONS` for the ceiling on that product.
 */
export const MAX_SCENARIOS_CEILING = 100;

/** EvalForge's documented maximum for runsPerScenario. */
export const MAX_RUNS_PER_SCENARIO = 20;

/**
 * A misconfigured repo variable should not hold the job open indefinitely waiting on base-arm
 * attribution. Lowered from 900 to 300: a live run measured the base arm landing 124s after the PR
 * arm, so 300s covers the observed lag with headroom while leaving the job's `timeout-minutes: 60`
 * margin intact (see `PR_ARM_POLL_TIMEOUT_MS` + this ceiling vs. the workflow timeout).
 */
export const MAX_BASE_ARM_GRACE_SECONDS = 300;

/**
 * Ceiling on `maxScenarios × runsPerScenario × 2` (the two comparison arms) — the actual number of
 * live agent builds a gated PR can trigger. `MAX_SCENARIOS_CEILING` and `MAX_RUNS_PER_SCENARIO`
 * each bound their own input, but neither bounds their product: at both ceilings that product is
 * 100 × 20 × 2 = 4000. 1000 stays comfortably above the current defaults (25 × 1 × 2 = 50, 20x
 * headroom) while still cutting the unclamped worst case by 4x.
 */
export const MAX_TOTAL_SCENARIO_EXECUTIONS = 1000;

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
  /** The action input stays `blocking` — that name is the public contract and reads right in YAML. */
  isBlocking: boolean;
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
  /** Reported only; the label comes from `evaluatedSha`. */
  headSha: string;
  /** The commit actually uploaded and evaluated. */
  evaluatedSha: string;
  versionLabel: string;
  /** The base arm pins no version, so this is the only record of what it actually compared
   * against; surfaced in the startup log and the base arm's own run description. */
  baseSha: string;
  comparisonGroupId: string;
  runsPerScenario: number;
  /** Milliseconds, converted once here from the `base-arm-grace-seconds` input — see `getBaseArmGraceSeconds`. */
  baseArmGraceMs: number;
};

/** No `githubToken`, `owner` or `repo`: cleanup makes no GitHub API call — `getPrNumber` reads the event payload. */
export type CleanupConfig = {
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  capabilityId: string;
  evalsGlob: string;
  repoFullName: string;
  prNumber: number;
};

/** Newline-separated list input, falling back to `fallback` when blank. */
function getMultilineList(name: string, fallback: string[]): string[] {
  const entries = core.getInput(name).split('\n').map(line => line.trim()).filter(line => line !== '');
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

/**
 * Never throws, unlike `getPositiveIntegerInput`: `getGateConfig` runs before `isBlocking` is
 * known, so a throw here would fail the check even during the soak period. A blank input falls
 * back silently (the normal unset case); anything else that fails to parse as an integer `>=
 * floor` — a typo'd repo variable, most likely — falls back with a `core.warning` instead of
 * failing the run outright. Exceeding `ceiling` clamps the same way `getMaxScenarios` does.
 */
function getClampedIntegerInput(name: string, fallback: number, ceiling: number, floor = 1): number {
  const raw = core.getInput(name);
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < floor) {
    core.warning(`${name}: "${raw}" is not an integer >= ${floor}, using the default of ${fallback}.`);
    return fallback;
  }
  if (value <= ceiling) return value;
  core.warning(`${name}: ${value} exceeds the ceiling of ${ceiling}, using ${ceiling}.`);
  return ceiling;
}

/**
 * Clamps rather than throws. `getGateConfig` runs before `isBlocking` is known, so a throw here
 * would fail the check even during the soak period, when the gate promises it cannot — the same
 * bug the author gate had. A clamp keeps the cost bounded and stays visible: `selectScenarios`
 * reports what the cap dropped, and the PR comment names it.
 */
function getMaxScenarios(): number {
  const requested = getPositiveIntegerInput('max-scenarios', DEFAULT_MAX_SCENARIOS);
  if (requested <= MAX_SCENARIOS_CEILING) return requested;
  core.warning(
    `max-scenarios: ${requested} exceeds the ceiling of ${MAX_SCENARIOS_CEILING}, running `
    + `${MAX_SCENARIOS_CEILING}. Every scenario is a live agent build, so the cap bounds real cost.`,
  );
  return MAX_SCENARIOS_CEILING;
}

/**
 * The assertion narrows rather than widens: `@actions/github` declares the payload as
 * `[key: string]: any`, so `pull_request.head` arrives as `any`. The precise `PullRequestEvent`
 * type lives in `@octokit/webhooks-types`, which is not a dependency of either action — adding it
 * would move all three lockfiles through the `portal:` link to type one property.
 */
function getHeadSha(): string {
  const head = github.context.payload.pull_request?.head as { sha?: string } | undefined;
  if (!head?.sha) throw new Error('PR payload missing head.sha');
  return head.sha;
}

function getBaseSha(): string {
  const base = github.context.payload.pull_request?.base as { sha?: string } | undefined;
  if (!base?.sha) throw new Error('PR payload missing base.sha');
  return base.sha;
}

function getRunsPerScenario(): number {
  return getClampedIntegerInput('runs-per-scenario', DEFAULT_RUNS_PER_SCENARIO, MAX_RUNS_PER_SCENARIO);
}

/**
 * Bounds `maxScenarios × runsPerScenario × 2` (see `MAX_TOTAL_SCENARIO_EXECUTIONS`) by clamping
 * `runsPerScenario` down — `maxScenarios` stays as configured, since it is what the author actually
 * asked to run; `runsPerScenario` is the flakiness-detection multiplier and the one meant to give
 * ground first.
 */
function clampTotalScenarioExecutions(maxScenarios: number, runsPerScenario: number): number {
  const executions = maxScenarios * runsPerScenario * 2;
  if (executions <= MAX_TOTAL_SCENARIO_EXECUTIONS) return runsPerScenario;
  const clamped = Math.max(1, Math.floor(MAX_TOTAL_SCENARIO_EXECUTIONS / (maxScenarios * 2)));
  core.warning(
    `runs-per-scenario: ${maxScenarios} scenarios × ${runsPerScenario} runs × 2 arms = ${executions} `
    + `executions exceeds the ceiling of ${MAX_TOTAL_SCENARIO_EXECUTIONS}, clamping runs-per-scenario `
    + `to ${clamped}.`,
  );
  return clamped;
}

/** `0` is a legitimate value here, not an error: it means "don't wait for the base arm at all" —
 * collect whatever has already resolved and move straight to the verdict comment. That is why the
 * floor is 0, unlike every other clamped input. */
function getBaseArmGraceSeconds(): number {
  return getClampedIntegerInput(
    'base-arm-grace-seconds', DEFAULT_BASE_ARM_GRACE_SECONDS, MAX_BASE_ARM_GRACE_SECONDS, 0,
  );
}

/**
 * The commit the version label is content-addressed to. It must be the commit actually checked out,
 * not `head.sha`: the same head yields different merge content as base advances, so
 * `createOrReuseSkillVersion` would reuse a version built from stale content.
 *
 * `GITHUB_SHA` names the merge commit on `pull_request` — but on a **re-run** it names the merge
 * commit from the *original* event, while `actions/checkout` resolves `refs/pull/<n>/merge` fresh.
 * If base advanced in between, those differ. So the workflow passes `git rev-parse HEAD` and this
 * prefers it. The `GITHUB_SHA` fallback warns rather than staying silent: it is the pre-existing
 * bug, so a future gate-mode caller that forgets the input should say so in its own log instead of
 * quietly relabelling a re-run's version.
 */
function getEvaluatedSha(): string {
  const provided = core.getInput('evaluated-sha');
  if (provided) return provided;

  const sha = process.env.GITHUB_SHA;
  if (!sha) {
    throw new Error(
      'Neither the evaluated-sha input nor GITHUB_SHA is set, so the skill version cannot be '
      + 'labelled for the commit actually evaluated. This action expects to run in GitHub Actions.',
    );
  }
  core.warning(
    'evaluated-sha was not passed, so the version label falls back to GITHUB_SHA. On a re-run that '
    + 'names the original event\'s merge commit, which can differ from the commit checked out. Pass '
    + '`evaluated-sha: ${{ steps.<checkout-step>.outputs.sha }}` from `git rev-parse HEAD`.',
  );
  return sha;
}

export function getGateConfig(): GateConfig {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const prNumber = getPrNumber(github.context.payload);
  const headSha = getHeadSha();
  const baseSha = getBaseSha();
  const evaluatedSha = getEvaluatedSha();
  const maxScenarios = getMaxScenarios();
  const runsPerScenario = clampTotalScenarioExecutions(maxScenarios, getRunsPerScenario());

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
    referenceDir: core.getInput('reference-dir') || DEFAULT_REFERENCE_DIR,
    ignoreGlobs: getMultilineList('ignore-globs', DEFAULT_IGNORE_GLOBS),
    broadImpactGlobs: getMultilineList('broad-impact-globs', DEFAULT_BROAD_IMPACT_GLOBS),
    maxScenarios,
    isBlocking: core.getInput('blocking') === 'true',
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    prNumber,
    headSha,
    evaluatedSha,
    versionLabel: `pr-${prNumber}-${evaluatedSha.slice(0, 7)}`,
    baseSha,
    /** Fresh per gate execution: EvalForge's comparison-group read returns the group whole with no
     * paging, so a stable id would accumulate runs across re-runs of the same PR. */
    comparisonGroupId: randomUUID(),
    runsPerScenario,
    baseArmGraceMs: getBaseArmGraceSeconds() * 1_000,
  };
}

export function getCleanupConfig(): CleanupConfig {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  return {
    evalforgeUrl: ensureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret(core, 'evalforge-app-id'),
    appSecret: safeGetSecret(core, 'evalforge-app-secret'),
    capabilityId: core.getInput('capability-id', { required: true }),
    evalsGlob: core.getInput('evals-glob', { required: true }),
    repoFullName: `${owner}/${repo}`,
    prNumber: getPrNumber(github.context.payload),
  };
}
