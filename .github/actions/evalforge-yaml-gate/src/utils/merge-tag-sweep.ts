import { uniqueRemoteScenarios, foldScenarioIterations, type RemoteScenario, type EvalRunResultRow } from '@wix/evalforge-core';
import type { LoadedScenario } from './evals';
import { scenariosToRun } from './gate';
import type { AttemptOutcome } from './confirm';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { EvalForgeClient, pollUntilDone, EvalRunTimeoutError, evalRunUrl, type EvalRunInput } from '@wix/evalforge-core';
import { getMergeSweepConfig, type MergeSweepConfig, type PrSweepContext } from './config';
import { loadEvals } from './evals';
import { canonicalDocUrl } from './doc-url';
import { computeCoverage } from './coverage';
import { classifyChanges, parseChangedFiles } from './github';
import { workspaceRoot } from './workspace';
import { confirmOnFail, type ConfirmResult } from './confirm';
import { resolveMergedBy, type MergedBy } from './merged-by';
import { reportMergeVerdict } from './sweep-report';
import type { SweepVerdict } from './sweep-verdict';

/** Above this many tag-matched scenarios, the sweep samples rather than running everything —
 * a broad tag would otherwise mean dozens of scenarios re-running on every merge that touches it. */
export const MAX_SWEEP_SCENARIOS = 20;

/** Tags carried by whatever the PR-time gate would itself run for this push: scenarios whose
 * own YAML changed, unioned with scenarios covering a changed doc. */
export function tagsOfDirectlyAffected(
  headScenarios: Map<string, LoadedScenario>,
  changedEvalPaths: Set<string>,
  coveredBy: Map<string, string[]>,
): Set<string> {
  const affected = scenariosToRun({ headScenarios, changedEvalPaths, coveredBy });
  const tags = new Set<string>();
  for (const ls of affected.values()) {
    for (const t of ls.scenario.tags) tags.add(t);
  }
  return tags;
}

/** The slice of EvalForgeClient this module needs — declared structurally so tests need no client. */
export type SweepSetClient = {
  listTestScenariosByTag(projectId: string, tag: string): Promise<RemoteScenario[]>;
};

/**
 * Resolves the sweep set from EvalForge itself, not the local repo — a scenario that exists
 * only in EvalForge (hand-authored, drafted from traffic mining) is swept in too, as long as
 * its tag matches. Caps deterministically: sorted by name, so an overflowing tag samples the
 * same subset every time rather than an unstable truncation.
 */
export async function resolveSweepSet(
  client: SweepSetClient,
  projectId: string,
  tags: Set<string>,
): Promise<{ selected: RemoteScenario[]; excludedCount: number; totalMatched: number }> {
  if (tags.size === 0) return { selected: [], excludedCount: 0, totalMatched: 0 };
  const all: RemoteScenario[] = [];
  for (const tag of tags) {
    all.push(...await client.listTestScenariosByTag(projectId, tag));
  }
  const unique = uniqueRemoteScenarios(all).sort((a, b) => a.name.localeCompare(b.name));
  const selected = unique.slice(0, MAX_SWEEP_SCENARIOS);
  return {
    selected,
    excludedCount: Math.max(0, unique.length - MAX_SWEEP_SCENARIOS),
    totalMatched: unique.length,
  };
}

/** Turns one EvalRun's per-scenario result rows into confirm.ts's generic AttemptOutcome shape.
 * There's no with/without pair here as in a PR-time comparison — just "did main pass this
 * scenario" — so the rows fold straight into an outcome per scenario. */
export function rowsToOutcomes(rows: EvalRunResultRow[]): AttemptOutcome[] {
  return foldScenarioIterations(rows).map(outcome => ({
    scenarioId: outcome.scenarioId,
    scenarioName: outcome.scenarioName,
    failed: outcome.failed > 0 || outcome.errors > 0,
    reasons: outcome.failingAssertionNames ?? [],
  }));
}

/** A capability version to evaluate against instead of whatever the capability resolves to now. */
export type PinnedCapability = { capabilityId: string; versionId: string };

/**
 * Builds one sweep attempt's eval run. `capabilityIds` is what attaches the MCP — it is not
 * inherited from the agent, so omitting it evaluates a tool-less agent and fails every docs
 * assertion. A merge sweep pins no version: it checks `main` against the production MCP. A PR
 * sweep pins the PR's own MCP version, so the docs under evaluation are the PR's, not `main`'s.
 */
export function buildEvalRunInput(
  config: Pick<MergeSweepConfig, 'projectId' | 'agentId' | 'prodMcpId'>,
  name: string,
  description: string,
  scenarioIds: string[],
  pinned?: PinnedCapability,
): EvalRunInput {
  const shared = { name, description, projectId: config.projectId, agentId: config.agentId, scenarioIds };
  if (pinned) {
    return {
      ...shared,
      capabilityIds: [pinned.capabilityId],
      capabilityVersions: { [pinned.capabilityId]: pinned.versionId },
    };
  }
  return { ...shared, capabilityIds: [config.prodMcpId] };
}

/** The PR's MCP version label, shared with the gate so a sweep reuses the version the gate built. */
export function prVersionLabel(pr: Pick<PrSweepContext, 'number' | 'headSha'>): string {
  return `pr-${pr.number}-${pr.headSha.slice(0, 7)}`;
}

/**
 * The merge sweep. Wraps `sweep` so that anything thrown before the run's own error handling — bad
 * config, a malformed workspace, an octokit constructor failure — still reaches the `infra-error`
 * output. Without this the job would only go red, and a red check on a `main` commit is not a
 * signal anyone is watching for; the Slack message is the whole point of this mode.
 */
export async function runMergeTagSweep(): Promise<void> {
  let config: MergeSweepConfig;
  try {
    config = getMergeSweepConfig();
  } catch (e) {
    const message = `Sweep failed before it could report a verdict: ${e instanceof Error ? e.message : String(e)}`;
    core.setOutput('infra-error', message);
    core.setFailed(message);
    return;
  }

  const octokit = github.getOctokit(config.githubToken);
  let verdict: SweepVerdict;
  try {
    verdict = await sweep(config);
  } catch (e) {
    verdict = {
      kind: 'infra-error',
      message: `Sweep failed before it could report a verdict: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  await reportMergeVerdict(verdict, core, () => mergedByForPush(octokit, config));
}

async function mergedByForPush(
  octokit: ReturnType<typeof github.getOctokit>,
  config: Pick<MergeSweepConfig, 'owner' | 'repo'>,
): Promise<MergedBy> {
  const fallback: MergedBy = {
    name: github.context.payload.head_commit?.author?.name ?? 'unknown',
    url: `https://github.com/${config.owner}/${config.repo}/commit/${github.context.sha}`,
  };
  try {
    return await resolveMergedBy(octokit, config.owner, config.repo, github.context.sha, fallback);
  } catch (e) {
    core.warning(`Could not resolve merging PR author, using commit author instead: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

/**
 * One sweep: resolve the tags this change touches, run the tag-matched scenarios, confirm any
 * failures. With `config.pr` set it pins the PR's MCP version; otherwise it takes the production MCP.
 * Returns the verdict and reports nothing — the caller decides between Slack outputs and a PR comment.
 */
/**
 * The tags a sweep would run, from the diff and the checked-out scenario YAML alone — no EvalForge
 * call, so it is cheap enough to decide scope before anything is spent. Returns a reason instead
 * when there is nothing to sweep. Scenario load problems are passed to `warn` when given.
 */
export function resolveSweepTags(
  changedFilesRaw: string,
  workspace: string,
  what: string,
  warn?: (message: string) => void,
): { tags: string[] } | { reason: string } {
  if (changedFilesRaw.trim() === '') {
    return { reason: `no changed files reported for ${what} (e.g. first push on this ref)` };
  }
  const classified = classifyChanges(parseChangedFiles(changedFilesRaw));
  const { scenarios: headScenarios, errors: loadErrors } = loadEvals(workspace);
  if (warn) for (const e of loadErrors) warn(`Scenario load issue (${e.path}): ${e.message}`);
  const cov = computeCoverage(classified.mdFiles, headScenarios, (f) => canonicalDocUrl(f, workspace));
  const changedEvalPaths = new Set<string>([
    ...classified.evalsAdded.map(f => f.filename),
    ...classified.evalsModified.map(f => f.filename),
  ]);
  const tags = tagsOfDirectlyAffected(headScenarios, changedEvalPaths, cov.coveredBy);
  if (tags.size === 0) return { reason: `no eval-relevant tags in ${what}` };
  return { tags: [...tags].sort() };
}

export async function sweep(config: MergeSweepConfig): Promise<SweepVerdict> {
  const workspace = workspaceRoot();
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const what = config.pr ? `PR #${config.pr.number}` : 'this push';

  const resolved = resolveSweepTags(config.changedFilesRaw, workspace, what, core.warning);
  if ('reason' in resolved) return { kind: 'nothing-to-run', reason: resolved.reason };
  const sortedTags = resolved.tags;
  const tags = new Set(sortedTags);
  core.setOutput('matched-tags', sortedTags.join(', '));

  const runName = config.pr
    ? `pr-sweep-${config.pr.number}-${config.pr.headSha.slice(0, 7)}`
    : `merge-sweep-${github.context.sha.slice(0, 7)}`;
  const description = `${config.pr ? `PR sweep for #${config.pr.number}` : 'Merge-tag sweep'} for tags: ${sortedTags.join(', ')}`;

  // Everything from here on talks to EvalForge — wrapped so an infra failure (unreachable,
  // 5xx, auth) surfaces as a distinct report rather than a bare failed job nobody sees,
  // same "no silent failure" rule the PR-time gate applies via PR comments.
  let initial: { id: string; status: Awaited<ReturnType<typeof pollUntilDone>> };
  let scope: { sampled: number; total: number };
  let runOnce: (name: string, scenarioIds: string[]) => Promise<typeof initial>;
  try {
    // The PR's own MCP version — the gate creates it and this reuses it, so the sweep evaluates
    // the PR's docs. A merge sweep has no version to pin and takes the production MCP.
    const pinned: PinnedCapability | undefined = config.pr
      ? {
        capabilityId: config.pr.mcpId,
        versionId: (await evalforge.ensureMcpVersion(
          config.pr.mcpId, config.projectId, prVersionLabel(config.pr),
          config.pr.number, config.pr.headSha, config.pr.mcpSkillsRepo,
        )).id,
      }
      : undefined;
    runOnce = async (name, scenarioIds) => {
      const created = await evalforge.createAndRunEvalRun(
        config.projectId,
        buildEvalRunInput(config, name, description, scenarioIds, pinned),
      );
      await evalforge.triggerEvalRun(config.projectId, created.id);
      const status = await pollUntilDone(evalforge, config.projectId, created.id, { log: core.info, warn: core.warning });
      return { id: created.id, status };
    };

    const { selected, excludedCount, totalMatched } = await resolveSweepSet(evalforge, config.projectId, tags);
    scope = { sampled: selected.length, total: totalMatched };
    core.setOutput('sweep-matched-total', String(totalMatched));
    core.setOutput('sweep-sampled-count', String(selected.length));
    if (excludedCount > 0) {
      core.warning(`Sweep: sampled ${selected.length} of ${totalMatched} tag-matched scenarios (${excludedCount} excluded by the cap)`);
    }
    if (selected.length === 0) {
      return { kind: 'nothing-to-run', reason: 'the tag match resolved to zero scenarios' };
    }
    initial = await runOnce(runName, selected.map(s => s.id));
  } catch (e) {
    const message = e instanceof EvalRunTimeoutError
      ? `Sweep timed out: ${e.message}`
      : `Sweep could not run: ${e instanceof Error ? e.message : String(e)}`;
    return { kind: 'infra-error', message };
  }
  // The link is part of every verdict from here: a run that was created and then failed or was
  // cancelled is exactly the case where the reader most wants it.
  const runUrl = evalRunUrl(config.projectId, initial.id);

  if (initial.status.status !== 'completed' || initial.status.aggregateMetrics.totalAssertions === 0) {
    const reason = initial.status.status !== 'completed'
      ? `the eval run ${initial.status.status === 'cancelled' ? 'was cancelled' : `ended as "${initial.status.status}"`}`
      : 'the run produced no assertions, so nothing was verified';
    return { kind: 'infra-error', message: `Sweep run did not complete reliably: ${reason}`, runUrl };
  }

  const initialOutcomes = rowsToOutcomes(initial.status.results);
  const initialFailures = initialOutcomes.filter(o => o.failed);
  if (initialFailures.length === 0) {
    return { kind: 'passed', tags: sortedTags, ...scope, runUrl };
  }

  let confirmResult: ConfirmResult;
  try {
    confirmResult = await confirmOnFail(initialOutcomes, async (ids) => {
      const retry = await runOnce(`${runName}-retry`, ids);
      return rowsToOutcomes(retry.status.results);
    });
  } catch (e) {
    core.error(`Sweep retry failed: ${e instanceof Error ? e.message : String(e)}`);
    confirmResult = {
      verdicts: initialFailures.map(o => ({
        scenarioId: o.scenarioId, scenarioName: o.scenarioName,
        attempts: 1, failures: 1, confirmed: true, reasons: o.reasons,
      })),
      retriesRun: 0,
      skipReason: 'rerun-error',
    };
  }

  // When retries were skipped, every verdict stands on a single attempt. Saying "confirmed"
  // without saying that would promise a majority-of-three vote the run never took.
  const skipNote = confirmResult.skipReason === 'broad-failure'
    ? `no retries run — ${initialFailures.length} scenarios failed at once, treated as signal rather than noise`
    : confirmResult.skipReason === 'rerun-error'
      ? 'no retries run — the retry itself failed, so the first attempt stands'
      : '';

  const confirmed = confirmResult.verdicts.filter(v => v.confirmed);
  const recovered = confirmResult.verdicts.filter(v => !v.confirmed);
  if (confirmed.length === 0) {
    // Every initial failure recovered on retry: the skip note cannot apply, since retries ran.
    return { kind: 'passed', tags: sortedTags, ...scope, runUrl, recovered };
  }
  return { kind: 'failed', tags: sortedTags, ...scope, runUrl, confirmed, recovered, skipNote };
}
