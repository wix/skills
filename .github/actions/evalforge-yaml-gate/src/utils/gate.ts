import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import { getEvalConfig, type Config } from './config';
import { fail, getChangedFiles, classifyChanges, makeCommenter, type ChangedFile } from './github';
import { loadEvals, type LoadedScenario } from './evals';
import { canonicalDocUrl } from './doc-url';
import { computeCoverage } from './coverage';
import { loadQuarantine } from './quarantine';
import {
  EvalForgeClient, assertWixAuthor, diffSyncPlan, draftTagFor, evalRunUrl,
  listRemoteScenariosForGate, parseDraftTag, remoteScenarioFiltersForGate,
  stripInactiveForeignDraftTags, type RemoteScenario,
} from '@wix/evalforge-core';
import { EvalPipelineClient, pollUntilComparisonDone, ComparisonTimeoutError } from './eval-pipeline';
import type { ComparisonGroupResult, ScenarioComparison } from './eval-pipeline';
import { workspaceRoot } from './workspace';
import { BASE_WORKSPACE_SUBDIR } from './paths';
import {
  formatForeignDraftConflicts,
  formatLoadErrors, formatNoChanges, formatOrphanedMds, formatServiceError, formatUncovered,
  formatComparisonResult, formatComparisonTimeout, formatTooManyNewSkills,
  formatLintViolations, formatQuarantineSkipped, composeSections,
  noWinnerReason, formatConfirmOnFail,
} from './comment';
import { findTokenBudgetViolations } from './token-budget';
import { lintChangedScenarios } from './scenario-lint';
import { confirmOnFail, type AttemptOutcome, type ConfirmResult } from './confirm';

type Commenter = ReturnType<typeof makeCommenter>;

function allScenariosRequired(result: ComparisonGroupResult): boolean {
  return result.scenarios.length > 0 && result.scenarios.every(s => s.required);
}

/** Reduces one comparison run to a pass/fail verdict, folding in both llm-judge and token-budget failures. */
export function toAttemptOutcomes(
  comparisons: ScenarioComparison[],
  headScenarios: Map<string, LoadedScenario>,
): AttemptOutcome[] {
  const overBudget = new Set(
    findTokenBudgetViolations(comparisons, headScenarios).map(v => v.scenarioName),
  );
  return comparisons.map(c => {
    const reasons: string[] = [];
    if (noWinnerReason(c)) reasons.push('llm-judge');
    if (overBudget.has(c.scenarioName)) reasons.push('token-budget');
    return { scenarioId: c.scenarioId, scenarioName: c.scenarioName, failed: reasons.length > 0, reasons };
  });
}

/**
 * Head scenarios to sync and run: those whose YAML changed, plus those covering a
 * changed skill doc (so editing a skill re-runs the scenarios that exercise it).
 *
 * Quarantine only filters coverage-sourced additions — a scenario whose own YAML
 * changed in this PR always runs, since its fix must prove itself.
 */
export function scenariosToRun(input: {
  headScenarios: Map<string, LoadedScenario>;
  changedEvalPaths: Set<string>;
  coveredBy: Map<string, string[]>;
  quarantined: Set<string>;
}): { selected: Map<string, LoadedScenario>; quarantineSkipped: string[] } {
  const selected = new Map<string, LoadedScenario>();
  const skipped = new Set<string>();
  for (const [name, ls] of input.headScenarios) {
    if (input.changedEvalPaths.has(ls.path)) selected.set(name, ls);
  }
  for (const coveringNames of input.coveredBy.values()) {
    for (const name of coveringNames) {
      const ls = input.headScenarios.get(name);
      if (!ls || selected.has(name)) continue;
      if (input.quarantined.has(name)) { skipped.add(name); continue; }
      selected.set(name, ls);
    }
  }
  return { selected, quarantineSkipped: [...skipped].sort() };
}

export function scenarioIdsToRun(
  scenarios: Map<string, LoadedScenario>,
  nameToId: Map<string, string>,
): string[] {
  const missing: string[] = [];
  const ids: string[] = [];
  for (const name of scenarios.keys()) {
    const id = nameToId.get(name);
    if (id) ids.push(id);
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`Missing EvalForge scenario IDs for: ${missing.join(', ')}`);
  }
  return ids;
}

async function isDraftTagActive(
  octokit: ReturnType<typeof github.getOctokit>,
  tag: string,
): Promise<boolean> {
  const draft = parseDraftTag(tag);
  if (!draft) return true;

  const [owner, repo] = draft.repo.split('/', 2);
  if (!owner || !repo) return true;

  try {
    const pull = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: draft.prNumber,
    });
    return pull.data.state === 'open';
  } catch (e) {
    core.warning(`Could not resolve draft tag ${tag}: ${e instanceof Error ? e.message : String(e)}`);
    return true;
  }
}

export async function runGate(): Promise<void> {
  const config = getEvalConfig();
  const octokit = github.getOctokit(config.githubToken);
  await assertWixAuthor(octokit, config.owner, config.repo, config.prNumber, core.info);
  const comment = makeCommenter(octokit, config.owner, config.repo, config.prNumber);
  const workspace = workspaceRoot();
  const draftTag = draftTagFor(`${config.owner}/${config.repo}`, config.prNumber);

  core.info(`EvalForge YAML gate — PR #${config.prNumber}`);
  core.info(`MCP params — skillsRepo: ${config.mcpSkillsRepo}, headSha: ${config.headSha}`);

  const { scenarios: headScenarios, errors: loadErrors } = loadEvals(workspace);
  if (loadErrors.length > 0) {
    await comment(formatLoadErrors(loadErrors));
    fail(`Invalid YAML or duplicate names: ${loadErrors.length}`, config.blocking);
    return;
  }

  const allChanged = await guardedCall(
    () => getChangedFiles(octokit, config.owner, config.repo, config.prNumber),
    'Could not retrieve PR file list', comment, config,
  );
  if (!allChanged) return;
  const classifiedChanges = classifyChanges(allChanged);

  if (classifiedChanges.mdFiles.length === 0 && classifiedChanges.evalsAdded.length === 0 && classifiedChanges.evalsModified.length === 0 && classifiedChanges.evalsRemoved.length === 0) {
    core.info('No gated changes');
    await comment(formatNoChanges());
    return;
  }

  const orphanedMds = classifiedChanges.mdFiles.filter(f => canonicalDocUrl(f.filename, workspace) === null);
  if (orphanedMds.length > 0) {
    await comment(formatOrphanedMds(orphanedMds.map(f => f.filename)));
    fail(`${orphanedMds.length} changed .md file(s) not registered in documentation.yaml`, config.blocking);
    return;
  }

  const newSkillFiles = classifiedChanges.mdFiles
    .filter(f => f.status === 'added')
    .map(f => f.filename)
    .sort();
  if (newSkillFiles.length > config.maxNewSkills) {
    await comment(formatTooManyNewSkills(newSkillFiles.length, config.maxNewSkills, newSkillFiles));
    fail(`Cannot create more than ${config.maxNewSkills} new skill .md files per PR (${newSkillFiles.length} found)`, config.blocking);
    return;
  }

  const cov = computeCoverage(classifiedChanges.mdFiles, headScenarios, (f) => canonicalDocUrl(f, workspace));
  if (cov.uncovered.length > 0) {
    await comment(formatUncovered(cov.uncovered));
    fail(`Missing coverage for ${cov.uncovered.length} file(s)`, config.blocking);
    return;
  }

  const baseWorkspace = posix.join(workspace, BASE_WORKSPACE_SUBDIR);
  const { scenarios: baseScenarios, errors: baseErrors } = loadEvals(baseWorkspace);
  for (const e of baseErrors) core.warning(`Base SHA eval issue (${e.path}): ${e.message}`);

  const changedEvalPaths = new Set<string>([
    ...classifiedChanges.evalsAdded.map(f => f.filename),
    ...classifiedChanges.evalsModified.map(f => f.filename),
  ]);
  const lintViolations = lintChangedScenarios(headScenarios, changedEvalPaths);
  if (lintViolations.length > 0) {
    await comment(formatLintViolations(lintViolations, config.blocking));
    fail(`${lintViolations.length} scenario lint violation(s)`, config.blocking);
    return;
  }

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const versionLabel = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;
  const mcpVersion = await guardedCall(
    () => evalforge.ensureMcpVersion(config.mcpId, config.projectId, versionLabel, config.prNumber, config.headSha, config.mcpSkillsRepo),
    'Could not create MCP version', comment, config,
  );
  if (!mcpVersion) return;

  // Quarantine entries are read from the base-branch checkout, never the PR's own
  // head — otherwise a PR could quarantine its own covering scenario and skip it
  // in the same run. An entry only takes effect once merged to the base branch.
  const quarantine = loadQuarantine(baseWorkspace);
  for (const err of quarantine.errors) core.warning(`Quarantine file issue: ${err}`);

  const { selected: changedHeadScenarios, quarantineSkipped } = scenariosToRun({
    headScenarios, changedEvalPaths, coveredBy: cov.coveredBy, quarantined: quarantine.names,
  });
  const quarantineSkippedBody = quarantineSkipped.length > 0 ? formatQuarantineSkipped(quarantineSkipped) : '';
  if (quarantineSkippedBody) {
    core.info(`Quarantined scenarios skipped: ${quarantineSkipped.join(', ')}`);
    await comment(quarantineSkippedBody);
  }

  const filters = remoteScenarioFiltersForGate({ changedHead: changedHeadScenarios, head: headScenarios, base: baseScenarios, draftTag });
  const remote = await guardedCall(
    () => listRemoteScenariosForGate(evalforge, config.projectId, filters),
    'Could not reach EvalForge', comment, config,
  );
  if (!remote) return;
  const normalizedRemote = await stripInactiveForeignDraftTags(
    remote,
    draftTag,
    (tag) => isDraftTagActive(octokit, tag),
  );

  const plan = diffSyncPlan({ changedHead: changedHeadScenarios, head: headScenarios, base: baseScenarios, remote: normalizedRemote, draftTag, repo: `${config.owner}/${config.repo}` });
  if (plan.errors.length > 0) {
    await comment(formatForeignDraftConflicts(plan.errors, { owner: config.owner, repo: config.repo }));
    fail(`Scenario(s) held by other PRs: ${plan.errors.map(e => e.name).join(', ')}`, config.blocking);
    return;
  }

  const nameToId = new Map(normalizedRemote.map(r => [r.name, r.id]));
  for (const a of plan.actions) {
    try {
      if (a.kind === 'CREATE') {
        const created = await evalforge.createTestScenario(config.projectId, a.body, a.tags);
        nameToId.set(a.name, created.id);
        core.info(`Created scenario ${a.name} (${created.id})`);
      } else if (a.kind === 'UPDATE') {
        await evalforge.updateTestScenario(config.projectId, a.id, a.body, a.tags);
        core.info(`Updated scenario ${a.name} (${a.id})`);
      } else if (a.kind === 'DELETE') {
        await evalforge.deleteTestScenario(config.projectId, a.id);
        nameToId.delete(a.name);
        core.info(`Deleted draft scenario ${a.name} (${a.id})`);
      } else if (a.kind === 'DEFER_DELETE') {
        core.info(`Deferring DELETE of "${a.name}" — will be handled at PR merge`);
      }
    } catch (e) {
      core.error(`Sync action ${a.kind} for ${a.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      await comment(formatServiceError(`Sync failed for "${a.name}"`, config.blocking));
      fail(`Sync failed for ${a.name}`, config.blocking);
      return;
    }
  }

  const hasUpserts = plan.actions.some(a => a.kind === 'CREATE' || a.kind === 'UPDATE');
  if (!hasUpserts) {
    core.info('No scenarios created or updated — skipping eval pipeline comparison');
    return;
  }

  if (!config.triggerEvalCompare) {
    core.info('Eval compare disabled (TRIGGER_EVAL_COMPARE=false) — skipping comparison');
    return;
  }

  const pipeline = new EvalPipelineClient(config.evalPipelineUrl, config.appId, config.appSecret);
  const comparison = await guardedCall(
    () => pipeline.runComparison([draftTag], config.agentName, config.headSha, config.mcpSkillsRepo, scenarioIdsToRun(changedHeadScenarios, nameToId)),
    'Could not start eval pipeline comparison', comment, config,
  );
  if (!comparison) return;
  core.info(`Eval pipeline comparison started: comparisonGroupId=${comparison.comparisonGroupId}`);

  try {
    const done = await pollUntilComparisonDone(pipeline, comparison.comparisonGroupId);
    for (const s of (done.result.scenarios ?? [])) {
      if (s.with.runId) core.info(`${s.scenarioName} [PR]: ${evalRunUrl(config.projectId, s.with.runId, s.with.name)}`);
      if (s.without.runId) core.info(`${s.scenarioName} [prod]: ${evalRunUrl(config.projectId, s.without.runId, s.without.name)}`);
    }
    const comparisonBody = formatComparisonResult(done, config.projectId);
    await comment(composeSections(comparisonBody, quarantineSkippedBody));

    const initialOutcomes = toAttemptOutcomes(done.result.scenarios ?? [], headScenarios);
    const initialFailures = initialOutcomes.filter(o => o.failed);

    if (initialFailures.length > 0) {
      core.info(`Confirm-on-fail: ${initialFailures.length} scenario(s) failed the first attempt — rerunning to confirm`);
      let confirmResult: ConfirmResult;
      try {
        confirmResult = await confirmOnFail(initialOutcomes, async (ids) => {
          const retry = await pipeline.runComparison([draftTag], config.agentName, config.headSha, config.mcpSkillsRepo, ids);
          const retryDone = await pollUntilComparisonDone(pipeline, retry.comparisonGroupId);
          return toAttemptOutcomes(retryDone.result.scenarios ?? [], headScenarios);
        });
      } catch (e) {
        // Retry infrastructure failed — fall back to the first attempt's verdict.
        core.error(`Confirm-on-fail rerun failed: ${e instanceof Error ? e.message : String(e)}`);
        confirmResult = {
          verdicts: initialFailures.map(o => ({
            scenarioId: o.scenarioId, scenarioName: o.scenarioName,
            attempts: 1, failures: 1, confirmed: true, reasons: o.reasons,
          })),
          retriesRun: 0,
          skipReason: 'rerun-error',
        };
      }

      const confirmBody = formatConfirmOnFail(confirmResult, config.blocking);
      await comment(composeSections(comparisonBody, confirmBody, quarantineSkippedBody));
      const confirmed = confirmResult.verdicts.filter(v => v.confirmed);
      if (confirmed.length > 0) {
        fail(`${confirmed.length} scenario(s) failed after confirm-on-fail (${confirmed.map(v => v.scenarioName).join(', ')})`, config.blocking);
        return;
      }
      core.info('All first-attempt failures recovered on retry — not blocking');
    }

    if (config.autoApprove && allScenariosRequired(done.result) && initialFailures.length === 0) {
      await octokit.rest.pulls.createReview({
        owner: config.owner,
        repo: config.repo,
        pull_number: config.prNumber,
        event: 'APPROVE',
        body: 'All required eval scenarios passed — auto-approved.',
      });
      core.info('PR auto-approved: all required scenarios passed');
    }
  } catch (e) {
    if (e instanceof ComparisonTimeoutError) {
      await comment(formatComparisonTimeout(comparison.comparisonGroupId, config.blocking));
      fail(e.message, config.blocking);
      return;
    }
    core.error(`compare-group failed: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError('Eval pipeline comparison failed', config.blocking));
    fail('Eval pipeline comparison failed', config.blocking);
  }

}

async function guardedCall<T>(
  fn: () => Promise<T>,
  userMessage: string,
  comment: Commenter,
  config: Pick<Config, 'blocking'>,
): Promise<T | undefined> {
  try { return await fn(); }
  catch (e) {
    core.error(`${userMessage}: ${e instanceof Error ? e.message : String(e)}`);
    await comment(formatServiceError(userMessage, config.blocking));
    fail(userMessage, config.blocking);
    return undefined;
  }
}
