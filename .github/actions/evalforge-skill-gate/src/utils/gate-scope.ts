import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  collectSkillFiles, deriveTags, formatGuardFailure, formatNoGatedChanges, formatYamlErrors,
  getChangedFiles, guardScenarios, loadScenarios, scenarioDirFromGlob, touchedScenarioPaths,
  type ChangedFile, type Commenter, type DerivedTags, type GuardViolation, type GuardWarning,
  type LoadedScenario, type SkillFileContent,
} from '@wix/evalforge-core';
import { HALTED, fail, guardedCall, type Guarded } from './report';
import type { GateConfig } from './config';

type GuardResult = { violations: GuardViolation[]; warnings: GuardWarning[] };

export type GateScope = {
  headScenarios: Map<string, LoadedScenario>;
  derived: DerivedTags;
  touchedPaths: Set<string>;
  guard: GuardResult;
  skillFiles: SkillFileContent[];
};

/**
 * Everything up to the first EvalForge write, so a coverage failure costs no call.
 * A halted result means the reason is already on the PR, and already failed if it failed.
 */
export async function resolveGateScope(
  octokit: ReturnType<typeof github.getOctokit>,
  config: GateConfig,
  workspace: string,
  comment: Commenter,
): Promise<Guarded<GateScope>> {
  const loaded = await loadHeadScenarios(workspace, config, comment);
  if (!loaded.ok) return HALTED;
  const headScenarios = loaded.value;

  const changedFiles = await guardedCall(
    () => getChangedFiles(octokit, config.owner, config.repo, config.prNumber),
    { message: 'Could not retrieve the PR file list', label: 'GitHub Lookup Failed' },
    comment, config.isBlocking,
  );
  if (!changedFiles.ok) return HALTED;

  const { derived, touchedPaths } = deriveChangeScope(changedFiles.value, config);
  for (const path of derived.unmapped) {
    core.warning(`Unmapped path under ${config.skillDir}: ${path}`);
  }
  if (derived.tags.length === 0 && !derived.broadImpact && touchedPaths.size === 0) {
    core.info('No gated changes');
    await comment(formatNoGatedChanges(derived.unmapped));
    return HALTED;
  }

  const guard = await runCoverageGuard(derived, headScenarios, touchedPaths, config, comment);
  if (!guard.ok) return HALTED;

  const skillFiles = await collectSkill(workspace, config, comment);
  if (!skillFiles.ok) return HALTED;

  return {
    ok: true,
    value: { headScenarios, derived, touchedPaths, guard: guard.value, skillFiles: skillFiles.value },
  };
}

async function loadHeadScenarios(
  workspace: string,
  config: GateConfig,
  comment: Commenter,
): Promise<Guarded<Map<string, LoadedScenario>>> {
  const { scenarios, errors } = loadScenarios(workspace, config.evalsGlob);
  if (errors.length === 0) return { ok: true, value: scenarios };
  await comment(formatYamlErrors(errors, config.isBlocking));
  fail(`Invalid scenario YAML or duplicate names: ${errors.length}`, config.isBlocking);
  return HALTED;
}

function deriveChangeScope(
  changedFiles: ChangedFile[],
  config: GateConfig,
): { derived: DerivedTags; touchedPaths: Set<string> } {
  const derived = deriveTags(changedFiles.map(file => file.filename), {
    skillDir: config.skillDir,
    referenceDir: config.referenceDir,
    ignoreGlobs: config.ignoreGlobs,
    broadImpactGlobs: config.broadImpactGlobs,
  });
  const touchedPaths = new Set(touchedScenarioPaths(
    changedFiles.map(file => ({ path: file.filename, status: file.status })),
    config.evalsGlob,
  ));
  return { derived, touchedPaths };
}

/** Local YAML alone — no version and no run exist yet. */
async function runCoverageGuard(
  derived: DerivedTags,
  headScenarios: Map<string, LoadedScenario>,
  touchedPaths: Set<string>,
  config: GateConfig,
  comment: Commenter,
): Promise<Guarded<GuardResult>> {
  const guard = guardScenarios({
    tags: derived.tags,
    scenarios: headScenarios,
    touchedScenarioPaths: touchedPaths,
  });
  if (guard.violations.length === 0) return { ok: true, value: guard };
  await comment(formatGuardFailure({
    ...guard,
    blocking: config.isBlocking,
    scenarioDir: scenarioDirFromGlob(config.evalsGlob),
  }));
  fail(`Eval coverage guard failed: ${guard.violations.length} violation(s)`, config.isBlocking);
  return HALTED;
}

async function collectSkill(
  workspace: string,
  config: GateConfig,
  comment: Commenter,
): Promise<Guarded<SkillFileContent[]>> {
  const skillFiles = await guardedCall(
    // Whole dir: references send the agent to sibling paths like `<SKILL_ROOT>/scripts/…`.
    async () => collectSkillFiles(workspace, config.skillDir, { warn: core.warning }),
    { message: `Could not read the skill directory ${config.skillDir}`, label: 'Skill Content Unreadable' },
    comment, config.isBlocking,
  );
  if (skillFiles.ok) {
    core.info(`Collected ${skillFiles.value.length} skill file(s) from ${config.skillDir}`);
  }
  return skillFiles;
}
