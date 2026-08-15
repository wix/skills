import { uniqueRemoteScenarios, type RemoteScenario, type EvalRunResultRow } from '@wix/evalforge-core';
import type { LoadedScenario } from './evals';
import { scenariosToRun } from './gate';
import type { AttemptOutcome } from './confirm';

/** Above this many tag-matched scenarios, the sweep samples rather than running everything —
 * a broad tag would otherwise mean dozens of scenarios re-running on every merge that touches it. */
export const MAX_SWEEP_SCENARIOS = 20;

/** Only these assertion statuses count as actual failures — `SKIPPED` and `UNKNOWN` are excluded.
 * See evalforge-core/src/evalforge.ts for the rationale: `UNKNOWN` is a wire value not recognized,
 * and folding it into a failure would manufacture a failure nothing actually reports as failed. */
const NOT_PASSED = new Set(['FAILED', 'ERROR']);

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
 * Sibling to gate.ts's toAttemptOutcomes, not a reuse of it — there's no with/without pair here,
 * just "did main pass this scenario." */
export function rowsToOutcomes(rows: EvalRunResultRow[]): AttemptOutcome[] {
  return rows.map(row => ({
    scenarioId: row.scenarioId,
    scenarioName: row.scenarioName,
    failed: row.failed > 0,
    reasons: row.assertions.filter(a => NOT_PASSED.has(a.status)).map(a => a.assertionName),
  }));
}
