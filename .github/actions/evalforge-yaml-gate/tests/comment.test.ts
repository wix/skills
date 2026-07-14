import { describe, it, expect } from 'vitest';
import * as c from '../src/utils/comment';
import type { CompareGroupComplete, ScenarioComparison, ScenarioRunResult } from '../src/utils/eval-pipeline';

function run(over: Partial<ScenarioRunResult> = {}): ScenarioRunResult {
  return {
    runId: 'r1',
    name: 'scenario-a',
    passed: 1,
    failed: 0,
    totalCostUsd: 0.001,
    totalTokens: 1000,
    durationMs: 1000,
    assertions: [{ name: 'a', type: 'llm', status: 'passed' }],
    ...over,
  };
}

function scenario(over: Partial<ScenarioComparison> = {}): ScenarioComparison {
  return {
    scenarioId: 's1',
    scenarioName: 'scenario-a',
    required: true,
    reason: 'because',
    with: run({ runId: 'pr-run', name: 'scenario-a' }),
    without: run({ runId: 'prod-run', name: 'scenario-a' }),
    pairwiseJudgement: { winner: 'with', confidence: 'high', reasoning: 'PR is better' },
    ...over,
  };
}

function group(scenarios: ScenarioComparison[]): CompareGroupComplete {
  return {
    status: 'complete',
    completedRuns: scenarios.length,
    totalRuns: scenarios.length,
    result: { comparisonGroupId: 'cg1', verdict: 'not-required', tag: 'draft:wix/skills#1', scenarios },
  };
}

describe('comment formatters', () => {
  it('formatLoadErrors lists each error', () => {
    const out = c.formatLoadErrors([{ path: 'a/b.yml', message: 'bad' }]);
    expect(out).toContain('a/b.yml');
    expect(out).toContain('bad');
    expect(out).toContain(c.COMMENT_MARKER);
  });

  it('formatUncovered includes canonical URL hint and the expected evals path', () => {
    const out = c.formatUncovered([{ file: 'skills/wix-manage/references/events/x.md', canonicalUrl: 'https://example/x', area: 'events' }]);
    expect(out).toContain('https://example/x');
    expect(out).toContain('yaml/wix-manage-evals/events/');
  });

  it('formatForeignDraftConflicts resolves PR URLs from tag format', () => {
    const out = c.formatForeignDraftConflicts(
      [{ kind: 'FOREIGN_DRAFT', name: 'blog/x', foreignTags: ['draft:wix/skills#99'] }],
      { owner: 'wix', repo: 'skills' },
    );
    expect(out).toContain('https://github.com/wix/skills/pull/99');
  });

  it('formatForeignDraftConflicts falls back to raw tag if malformed', () => {
    const out = c.formatForeignDraftConflicts(
      [{ kind: 'FOREIGN_DRAFT', name: 'blog/x', foreignTags: ['draft:malformed'] }],
      { owner: 'wix', repo: 'skills' },
    );
    expect(out).toContain('draft:malformed');
  });

  it('formatOrphanedMds lists each file', () => {
    expect(c.formatOrphanedMds(['skills/wix-manage/references/blog/foo.md']))
      .toContain('skills/wix-manage/references/blog/foo.md');
  });

  it('formatServiceError icon switches by blocking flag', () => {
    expect(c.formatServiceError('boom', true)).toContain('❌');
    expect(c.formatServiceError('boom', false)).toContain('⚠️');
  });

  it('formatEvalPassed includes pass rate + run link', () => {
    const metrics = { totalAssertions: 1, passed: 1, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0 };
    const out = c.formatEvalPassed(metrics, 'run-1', 'https://bo.wix.com/pages/evalforge/proj-1/results?runId=run-1');
    expect(out).toContain('100%');
    expect(out).toContain('run-1');
    expect(out).toContain('(https://bo.wix.com/pages/evalforge/proj-1/results?runId=run-1)');
  });

  it('formatNoChanges signals success', () => {
    expect(c.formatNoChanges()).toContain('No Gated Changes');
  });

  it('formatComparisonResult adds a Runs column with PR + prod run links', () => {
    const out = c.formatComparisonResult(group([scenario()]), 'proj-1');
    expect(out).toContain('Runs (PR / prod)');
    // top-level table cell links (not only inside <details>)
    expect(out).toContain('[PR](https://bo.wix.com/pages/evalforge/proj-1/results?runId=pr-run&name=scenario-a)');
    expect(out).toContain('[prod](https://bo.wix.com/pages/evalforge/proj-1/results?runId=prod-run&name=scenario-a)');
  });

  it('formatComparisonResult falls back to — when projectId is missing', () => {
    const out = c.formatComparisonResult(group([scenario()]));
    expect(out).toContain('Runs (PR / prod)');
    expect(out).not.toContain('bo.wix.com');
    expect(out).toContain('| — / — |');
  });

  it('formatComparisonResult falls back to — for a run with no runId', () => {
    const s = scenario({ with: run({ runId: undefined, name: 'scenario-a' }), without: run({ runId: 'prod-run' }) });
    const out = c.formatComparisonResult(group([s]), 'proj-1');
    expect(out).toContain('— / [prod](https://bo.wix.com/pages/evalforge/proj-1/results?runId=prod-run');
  });

  it('formatComparisonResult renders View run links inside details for both modes', () => {
    const out = c.formatComparisonResult(group([scenario()]), 'proj-1');
    expect(out).toContain('[View run (PR)](https://bo.wix.com/pages/evalforge/proj-1/results?runId=pr-run');
    expect(out).toContain('[View run (prod)](https://bo.wix.com/pages/evalforge/proj-1/results?runId=prod-run');
  });
});
