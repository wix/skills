import { uniqueRemoteScenarios, foldScenarioIterations, type RemoteScenario, type EvalRunResultRow } from '@wix/evalforge-core';
import type { LoadedScenario } from './evals';
import { scenariosToRun } from './gate';
import type { AttemptOutcome } from './confirm';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { EvalForgeClient, pollUntilDone, EvalRunTimeoutError, evalRunUrl } from '@wix/evalforge-core';
import { getMergeSweepConfig } from './config';
import { loadEvals } from './evals';
import { canonicalDocUrl } from './doc-url';
import { computeCoverage } from './coverage';
import { classifyChanges, parseChangedFiles } from './github';
import { workspaceRoot } from './workspace';
import { confirmOnFail, type ConfirmResult } from './confirm';
import { resolveMergedBy, type MergedBy } from './merged-by';

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

export async function runMergeTagSweep(): Promise<void> {
  const config = getMergeSweepConfig();
  const workspace = workspaceRoot();
  const octokit = github.getOctokit(config.githubToken);
  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  if (config.changedFilesRaw.trim() === '') {
    core.info('Merge-tag sweep: no changed files reported for this push (e.g. first push on this ref) — nothing to run');
    return;
  }

  const changedFiles = parseChangedFiles(config.changedFilesRaw);
  const classified = classifyChanges(changedFiles);
  const { scenarios: headScenarios } = loadEvals(workspace);
  const cov = computeCoverage(classified.mdFiles, headScenarios, (f) => canonicalDocUrl(f, workspace));
  const changedEvalPaths = new Set<string>([
    ...classified.evalsAdded.map(f => f.filename),
    ...classified.evalsModified.map(f => f.filename),
  ]);
  const tags = tagsOfDirectlyAffected(headScenarios, changedEvalPaths, cov.coveredBy);

  if (tags.size === 0) {
    core.info('Merge-tag sweep: no eval-relevant tags in this push — nothing to run');
    return;
  }
  const sortedTags = [...tags].sort();
  core.setOutput('matched-tags', sortedTags.join(', '));

  const runName = `merge-sweep-${github.context.sha.slice(0, 7)}`;
  const runOnce = async (name: string, scenarioIds: string[]) => {
    const created = await evalforge.createAndRunEvalRun(config.projectId, {
      name,
      description: `Merge-tag sweep for tags: ${sortedTags.join(', ')}`,
      projectId: config.projectId,
      agentId: config.agentId,
      scenarioIds,
    });
    await evalforge.triggerEvalRun(config.projectId, created.id);
    const status = await pollUntilDone(evalforge, config.projectId, created.id, { log: core.info, warn: core.warning });
    return { id: created.id, status };
  };

  // Everything from here on talks to EvalForge — wrapped so an infra failure (unreachable,
  // 5xx, auth) surfaces as a distinct Slack message rather than a bare failed job nobody sees,
  // same "no silent failure" rule the PR-time gate applies via PR comments.
  let initial: Awaited<ReturnType<typeof runOnce>> | undefined;
  try {
    const { selected, excludedCount, totalMatched } = await resolveSweepSet(evalforge, config.projectId, tags);
    core.setOutput('sweep-matched-total', String(totalMatched));
    core.setOutput('sweep-sampled-count', String(selected.length));
    if (excludedCount > 0) {
      core.warning(`Merge-tag sweep: sampled ${selected.length} of ${totalMatched} tag-matched scenarios (${excludedCount} excluded by the cap)`);
    }
    if (selected.length === 0) {
      core.info('Merge-tag sweep: tag match resolved to zero scenarios — nothing to run');
      return;
    }
    initial = await runOnce(runName, selected.map(s => s.id));
  } catch (e) {
    const message = e instanceof EvalRunTimeoutError
      ? `Merge-tag sweep timed out: ${e.message}`
      : `Merge-tag sweep could not run: ${e instanceof Error ? e.message : String(e)}`;
    core.setOutput('infra-error', message);
    core.setFailed(message);
    return;
  }
  if (initial.status.status !== 'completed' || initial.status.aggregateMetrics.totalAssertions === 0) {
    const reason = initial.status.status !== 'completed'
      ? `the eval run ${initial.status.status === 'cancelled' ? 'was cancelled' : `ended as "${initial.status.status}"`}`
      : 'the run produced no assertions, so nothing was verified';
    const message = `Merge-tag sweep run did not complete reliably: ${reason}`;
    core.setOutput('infra-error', message);
    core.setFailed(message);
    return;
  }

  core.setOutput('run-url', evalRunUrl(config.projectId, initial.id));

  const initialOutcomes = rowsToOutcomes(initial.status.results);
  const initialFailures = initialOutcomes.filter(o => o.failed);
  if (initialFailures.length === 0) {
    core.info('Merge-tag sweep: all sampled scenarios passed');
    core.setOutput('confirmed-failed-count', '0');
    core.setOutput('recovered-count', '0');
    return;
  }

  let confirmResult: ConfirmResult;
  let retriesFailed = false;
  try {
    confirmResult = await confirmOnFail(initialOutcomes, async (ids) => {
      const retry = await runOnce(`${runName}-retry`, ids);
      return rowsToOutcomes(retry.status.results);
    });
  } catch (e) {
    core.error(`Merge-tag sweep retry failed: ${e instanceof Error ? e.message : String(e)}`);
    retriesFailed = true;
    confirmResult = {
      verdicts: initialFailures.map(o => ({
        scenarioId: o.scenarioId, scenarioName: o.scenarioName,
        attempts: 1, failures: 1, confirmed: true, reasons: o.reasons,
      })),
      retriesRun: 0,
      skipReason: 'rerun-error',
    };
  }

  const confirmed = confirmResult.verdicts.filter(v => v.confirmed);
  const recovered = confirmResult.verdicts.filter(v => !v.confirmed);
  core.setOutput('confirmed-failed-count', String(confirmed.length));
  core.setOutput('recovered-count', String(recovered.length));
  core.setOutput(
    'confirmed-failed-scenarios',
    confirmed.map(v => `${v.scenarioName} (${v.reasons.join(', ')})`).join('\n'),
  );
  if (retriesFailed) core.warning('Merge-tag sweep: retry infrastructure failed — first-attempt failures stand');

  if (confirmed.length > 0) {
    const fallback: MergedBy = {
      name: github.context.payload.head_commit?.author?.name ?? 'unknown',
      url: `https://github.com/${config.owner}/${config.repo}/commit/${github.context.sha}`,
    };
    let mergedBy: MergedBy;
    try {
      mergedBy = await resolveMergedBy(octokit, config.owner, config.repo, github.context.sha, fallback);
    } catch (e) {
      core.warning(`Could not resolve merging PR author, using commit author instead: ${e instanceof Error ? e.message : String(e)}`);
      mergedBy = fallback;
    }
    core.setOutput('merged-by-name', mergedBy.name);
    core.setOutput('merged-by-url', mergedBy.url);
    core.setFailed(`${confirmed.length} scenario(s) confirmed failed in merge-tag sweep (${confirmed.map(v => v.scenarioName).join(', ')})`);
  }
}
