import { describe, it, expect } from 'vitest';
import {
  GATE_COMMENT_MARKER, formatYamlErrors, formatNoGatedChanges, formatGuardFailure,
  formatForeignDraftConflicts, formatGateResult, formatGateTimeout, formatGateServiceError,
} from '../src/format-gate-comment';
import type { EvalRunStatus } from '../src/evalforge';

const metrics = (overrides: Partial<EvalRunStatus['aggregateMetrics']> = {}): EvalRunStatus['aggregateMetrics'] => ({
  totalAssertions: 5, passed: 5, failed: 0, skipped: 0,
  errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0,
  ...overrides,
});

const baseResult = {
  metrics: metrics(),
  verdict: { passed: true, reasons: [] },
  runId: 'run-1',
  runUrl: 'https://bo.wix.com/pages/evalforge/P/results?runId=run-1',
  selection: { ids: ['id-a'], selected: ['covers'], dropped: [], missingIds: [] },
  maxScenarios: 25,
  warnings: [],
  unmapped: [],
  broadImpact: false,
  blocking: false,
};

describe('every gate comment', () => {
  it('carries the marker so the upserter can find and edit it', () => {
    for (const body of [
      formatYamlErrors([{ path: 'a.yml', message: 'bad' }]),
      formatNoGatedChanges([]),
      formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true }),
      formatForeignDraftConflicts([{ kind: 'FOREIGN_DRAFT', name: 'n', foreignTags: ['draft:o/r#1'] }], true),
      formatGateResult(baseResult),
      formatGateTimeout('run-1', 'https://x', false),
      formatGateServiceError('boom', false),
    ]) {
      expect(body).toContain(GATE_COMMENT_MARKER);
    }
  });
});

describe('formatYamlErrors', () => {
  it('lists each offending file and message', () => {
    const body = formatYamlErrors([{ path: 'yaml/wix-app-evals/a.yml', message: 'tags required' }]);
    expect(body).toContain('yaml/wix-app-evals/a.yml');
    expect(body).toContain('tags required');
  });
});

describe('formatNoGatedChanges', () => {
  it('says nothing gated changed', () => {
    expect(formatNoGatedChanges([])).toMatch(/no gated changes/i);
  });

  it('still lists unmapped paths so a new kind of file is visible', () => {
    const body = formatNoGatedChanges(['skills/wix-app/NOTES.txt']);
    expect(body).toContain('skills/wix-app/NOTES.txt');
  });
});

describe('formatGuardFailure', () => {
  it('names an uncovered tag and says a scenario is needed', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [], blocking: true,
    });
    expect(body).toContain('backend-api');
    expect(body).toMatch(/scenario/i);
  });

  it('distinguishes a weak tag from an uncovered one, naming the weak scenarios', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'WEAK_TAG', tag: 'dashboard-page', scenarios: ['thin'] }],
      warnings: [], blocking: true,
    });
    expect(body).toContain('dashboard-page');
    expect(body).toContain('thin');
  });

  it('reports a touched scenario below the bar with its reasons', () => {
    const body = formatGuardFailure({
      violations: [{
        kind: 'WEAK_TOUCHED_SCENARIO', name: 'thin',
        path: 'yaml/wix-app-evals/thin.yml', reasons: ['has 1 assertion (needs at least 3)'],
      }],
      warnings: [], blocking: true,
    });
    expect(body).toContain('yaml/wix-app-evals/thin.yml');
    expect(body).toContain('has 1 assertion');
  });

  it('states that the run was skipped, since a guard failure costs no run', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true,
    });
    expect(body).toMatch(/no eval run|skipped|not run/i);
  });

  it('renders as a warning rather than a failure when not blocking', () => {
    const blocked = formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true });
    const soaking = formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: false });
    expect(blocked).not.toBe(soaking);
    expect(soaking).toContain('⚠️');
    expect(blocked).toContain('❌');
  });

  it('includes carried-forward warnings alongside the violations', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [{
        kind: 'WEAK_UNTOUCHED_SCENARIO', name: 'old', path: 'yaml/wix-app-evals/old.yml',
        tags: ['dashboard-page'], reasons: ['has no llm_judge assertion'],
      }],
      blocking: true,
    });
    expect(body).toContain('old');
    expect(body).toContain('llm_judge');
  });
});

describe('formatForeignDraftConflicts', () => {
  it('links the PR holding each scenario', () => {
    const body = formatForeignDraftConflicts([
      { kind: 'FOREIGN_DRAFT', name: 'held', foreignTags: ['draft:wix/skills#99'], path: 'a.yml' },
    ], true);
    expect(body).toContain('held');
    expect(body).toContain('https://github.com/wix/skills/pull/99');
  });

  it('falls back to the raw tag when it is not a parseable draft tag', () => {
    const body = formatForeignDraftConflicts([
      { kind: 'FOREIGN_DRAFT', name: 'held', foreignTags: ['draft:garbage'], path: 'a.yml' },
    ], true);
    expect(body).toContain('draft:garbage');
  });
});

describe('formatGateResult', () => {
  it('reports a pass with the pass rate, the run link and the scenarios that ran', () => {
    const body = formatGateResult(baseResult);
    expect(body).toContain('✅');
    expect(body).toContain('100%');
    expect(body).toContain(baseResult.runUrl);
    expect(body).toContain('covers');
  });

  it('reports failure reasons on a failing run', () => {
    const body = formatGateResult({
      ...baseResult,
      metrics: metrics({ failed: 2, passed: 3, passRate: 60 }),
      verdict: { passed: false, reasons: ['2 assertions failed'] },
    });
    expect(body).toContain('2 assertions failed');
    expect(body).toContain('60%');
  });

  it('names the dropped scenarios and the cap when the run was truncated', () => {
    const body = formatGateResult({
      ...baseResult,
      selection: { ids: ['id-a'], selected: ['ran'], dropped: ['cut-one', 'cut-two'], missingIds: [] },
      maxScenarios: 1,
    });
    expect(body).toContain('cut-one');
    expect(body).toContain('cut-two');
    expect(body).toContain('max-scenarios');
  });

  it('flags scenarios with no EvalForge id rather than hiding the sync gap', () => {
    const body = formatGateResult({
      ...baseResult,
      selection: { ids: ['id-a'], selected: ['ran'], dropped: [], missingIds: ['unsynced'] },
    });
    expect(body).toContain('unsynced');
  });

  it('says the whole suite was in play on broad impact', () => {
    const body = formatGateResult({ ...baseResult, broadImpact: true });
    expect(body).toMatch(/whole suite|cross-cutting/i);
  });

  it('lists unmapped paths and carried warnings on an otherwise passing run', () => {
    const body = formatGateResult({
      ...baseResult,
      unmapped: ['skills/wix-app/NOTES.txt'],
      warnings: [{
        kind: 'WEAK_UNTOUCHED_SCENARIO', name: 'old', path: 'yaml/wix-app-evals/old.yml',
        tags: ['dashboard-page'], reasons: ['has no llm_judge assertion'],
      }],
    });
    expect(body).toContain('NOTES.txt');
    expect(body).toContain('old');
  });

  it('renders a failing run as a warning during the soak period', () => {
    const body = formatGateResult({
      ...baseResult,
      verdict: { passed: false, reasons: ['1 assertion failed'] },
      blocking: false,
    });
    expect(body).toContain('⚠️');
    expect(body).toMatch(/soak/i);
  });

  it('renders a failing run as a failure when blocking', () => {
    const body = formatGateResult({
      ...baseResult,
      verdict: { passed: false, reasons: ['1 assertion failed'] },
      blocking: true,
    });
    expect(body).toContain('❌');
    expect(body).not.toMatch(/soak/i);
  });
});

describe('formatGateTimeout and formatGateServiceError', () => {
  it('links the run that timed out', () => {
    expect(formatGateTimeout('run-1', 'https://x/run-1', true)).toContain('https://x/run-1');
  });

  it('surfaces the service error message', () => {
    expect(formatGateServiceError('Could not reach EvalForge', false))
      .toContain('Could not reach EvalForge');
  });
});
