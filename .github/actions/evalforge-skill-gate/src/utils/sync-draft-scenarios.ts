import * as core from '@actions/core';
import * as github from '@actions/github';
import { posix } from 'node:path';
import {
  EvalForgeClient, diffSyncPlan, formatForeignDraftConflicts, listRemoteScenariosForGate,
  loadScenarios, remoteScenarioFiltersForGate, semanticPlusDraftTags, stripInactiveForeignDraftTags,
  type Commenter, type LoadedScenario,
} from '@wix/evalforge-core';
import { BASE_WORKSPACE_SUBDIR, type GateConfig } from './config';
import { HALTED, fail, guardedCall, type Guarded } from './report';
import { isDraftTagActive } from './pr-lookups';
import { applySyncPlan } from './apply-sync-plan';
import type { GateScope } from './gate-scope';

/**
 * Reconciles the PR's scenario edits into EvalForge as draft-tagged scenarios, yielding the
 * name→id map the run selects from. A halted result means the reason is already on the PR.
 */
export async function syncDraftScenarios(
  client: EvalForgeClient,
  octokit: ReturnType<typeof github.getOctokit>,
  config: GateConfig,
  scope: GateScope,
  draftTag: string,
  workspace: string,
  comment: Commenter,
): Promise<Guarded<Map<string, string>>> {
  const baseScenarios = loadBaseScenarios(workspace, config);
  const changedHead = new Map(
    [...scope.headScenarios].filter(([, loaded]) => scope.touchedPaths.has(loaded.path)),
  );
  const shared = { changedHead, head: scope.headScenarios, base: baseScenarios, draftTag };

  const remote = await guardedCall(
    () => listRemoteScenariosForGate(client, config.projectId, remoteScenarioFiltersForGate({
      ...shared, extraTags: scope.derived.tags, all: scope.derived.broadImpact,
    })),
    { message: 'Could not reach EvalForge', label: 'EvalForge Unreachable' },
    comment, config.isBlocking,
  );
  if (!remote.ok) return HALTED;

  const normalizedRemote = await stripInactiveForeignDraftTags(
    remote.value, draftTag, tag => isDraftTagActive(octokit, tag),
  );
  const plan = diffSyncPlan({
    ...shared,
    remote: normalizedRemote,
    repo: config.repoFullName,
    // Semantic tags must survive the draft sync — the gate selects by them.
    tagStrategy: semanticPlusDraftTags,
  });
  if (plan.errors.length > 0) {
    await comment(formatForeignDraftConflicts(plan.errors, config.isBlocking));
    fail(`Scenario(s) held by other PRs: ${plan.errors.map(error => error.name).join(', ')}`, config.isBlocking);
    return HALTED;
  }

  const nameToId = new Map(normalizedRemote.map(entry => [entry.name, entry.id]));
  const applied = await applySyncPlan(client, config, plan.actions, nameToId, comment);
  return applied ? { ok: true, value: nameToId } : HALTED;
}

/** Warns rather than fails: the base SHA's YAML is not this PR's to fix. */
function loadBaseScenarios(workspace: string, config: GateConfig): Map<string, LoadedScenario> {
  const baseWorkspace = posix.join(workspace, BASE_WORKSPACE_SUBDIR);
  const { scenarios, errors } = loadScenarios(baseWorkspace, config.evalsGlob);
  for (const error of errors) {
    core.warning(`Base SHA scenario issue (${error.path}): ${error.message}`);
  }
  return scenarios;
}
