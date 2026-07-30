import { describe, it, expect } from 'vitest';
import {
  GATE_COMMENT_MARKER, formatYamlErrors, formatNoGatedChanges, formatGuardFailure,
  formatForeignDraftConflicts, formatGateResult, formatGatePollFailure, formatGateTimeout,
  formatGateServiceError, formatGateSkipped,
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
      formatYamlErrors([{ path: 'a.yml', message: 'bad' }], true),
      formatNoGatedChanges([]),
      formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true, scenarioDir: 'd' }),
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
    const body = formatYamlErrors([{ path: 'yaml/wix-app-evals/a.yml', message: 'tags required' }], true);
    expect(body).toContain('yaml/wix-app-evals/a.yml');
    expect(body).toContain('tags required');
  });

  // It used to render ❌ unconditionally while `fail` only warned, so a soaking PR showed a hard
  // failure next to a green check with nothing explaining the mismatch.
  it('renders as a warning and says why the check is green when soaking', () => {
    const body = formatYamlErrors([{ path: 'a.yml', message: 'bad' }], false);
    expect(body).toContain('⚠️');
    expect(body).not.toContain('❌');
    expect(body).toContain('soak period');
  });

  it('renders as a hard failure with no soak note when blocking', () => {
    const body = formatYamlErrors([{ path: 'a.yml', message: 'bad' }], true);
    expect(body).toContain('❌');
    expect(body).not.toContain('soak period');
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
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toContain('backend-api');
    expect(body).toMatch(/scenario/i);
  });

  it('distinguishes a weak tag from an uncovered one, naming the weak scenarios', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'WEAK_TAG', tag: 'dashboard-page', scenarios: ['thin'] }],
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
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
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toContain('yaml/wix-app-evals/thin.yml');
    expect(body).toContain('has 1 assertion');
  });

  it('states that the run was skipped, since a guard failure costs no run', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toMatch(/no eval run|skipped|not run/i);
  });

  it('renders as a warning rather than a failure when not blocking', () => {
    const blocked = formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: true, scenarioDir: 'd' });
    const soaking = formatGuardFailure({ violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [], blocking: false, scenarioDir: 'd' });
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
      blocking: true, scenarioDir: 'yaml/wix-app-evals',
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

describe('formatGateSkipped', () => {
  it('says the PR was not evaluated and why', () => {
    const body = formatGateSkipped('the PR author is not a @wix.com address');
    expect(body).toContain(GATE_COMMENT_MARKER);
    expect(body).toMatch(/not \*\*evaluated\*\*|not evaluated/);
    expect(body).toContain('not a @wix.com address');
  });

  it('spells out that green does not mean the scenarios passed', () => {
    expect(formatGateSkipped('reason')).toMatch(/did not run, not because the scenarios passed/);
  });
  it('names the scenario directory, so the author knows where to add the file', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toContain('`yaml/wix-app-evals/`');
  });

  it('falls back to generic wording rather than an empty path', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [], blocking: true, scenarioDir: '',
    });
    expect(body).toContain('the scenario directory');
    expect(body).not.toContain('`/`');
  });

  // An uncovered tag has no scenario, so nothing can be below the bar. Leading with the bar read
  // as though an existing scenario was too weak.
  it('omits the quality bar note when nothing is about quality', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).not.toContain('quality bar');
  });

  it('keeps the quality bar note for a weak tag', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'WEAK_TAG', tag: 'dashboard-page', scenarios: ['thin'] }],
      warnings: [], blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toContain('quality bar');
  });

  it('keeps the quality bar note when only the carried-forward warnings concern quality', () => {
    const body = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 'backend-api' }],
      warnings: [{
        kind: 'WEAK_UNTOUCHED_SCENARIO', name: 'old', path: 'yaml/wix-app-evals/old.yml',
        tags: ['dashboard-page'], reasons: ['has no llm_judge assertion'],
      }],
      blocking: true, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(body).toContain('quality bar');
  });
});

describe('gate result presentation', () => {
  const verdict = { passed: true, reasons: [] };
  const base = {
    runId: 'run-1', runUrl: 'https://example.com/run-1', maxScenarios: 25,
    warnings: [], unmapped: [], broadImpact: false, blocking: false, verdict,
  };

  // The API sends a fraction of a percent — 26/30 arrives as 86.667, which rendered in full.
  it('rounds the pass rate rather than printing the API fraction', () => {
    const body = formatGateResult({
      ...base,
      metrics: metrics({ totalAssertions: 30, passed: 26, failed: 4, passRate: 86.667 }),
      selection: { ids: ['i'], selected: ['one'], dropped: [], missingIds: [] },
    });
    expect(body).toContain('87%');
    expect(body).not.toContain('86.667');
  });

  it('says "1 scenario" and "2 scenarios", not "scenario(s)"', () => {
    const one = formatGateResult({
      ...base, metrics: metrics(),
      selection: { ids: ['i'], selected: ['one'], dropped: [], missingIds: [] },
    });
    const two = formatGateResult({
      ...base, metrics: metrics(),
      selection: { ids: ['i', 'j'], selected: ['one', 'two'], dropped: [], missingIds: [] },
    });
    expect(one).toContain('1 scenario ran');
    expect(two).toContain('2 scenarios ran');
    expect(one + two).not.toContain('scenario(s)');
  });
});

describe('formatGateServiceError', () => {
  it('names the stage rather than heading a bare "Failed"', () => {
    expect(formatGateServiceError('Could not reach EvalForge', true)).toContain('Service Error');
  });

  // Nothing broke in the zero-selection case; the gate just had nothing to run.
  it('takes a caller label, so "nothing verified" does not read as a service outage', () => {
    const body = formatGateServiceError('nothing was verified', false, 'Nothing Verified');
    expect(body).toContain('Nothing Verified');
    expect(body).not.toContain('Service Error');
  });
});

describe('formatGatePollFailure', () => {
  const input = {
    runId: '1a3d3e51-4fd3-4838-94fa-57f213d9c3b5',
    runUrl: 'https://bo.wix.com/pages/evalforge/proj/results?runId=1a3d3e51',
    detail: 'EvalForge GET /v1/projects/proj/eval-runs/1a3d3e51 → 403: ',
    blocking: false,
  };

  // Seen on #773: the run had been executing for six minutes and the comment named nothing, so
  // there was no way to reach it from the PR.
  it('links the run, since that is the whole point of the comment', () => {
    const body = formatGatePollFailure(input);
    expect(body).toContain(input.runId);
    expect(body).toContain(input.runUrl);
  });

  it('carries the underlying error, so the reader knows what broke', () => {
    expect(formatGatePollFailure(input)).toContain('403');
  });

  it('says the result is unverified rather than passing', () => {
    expect(formatGatePollFailure(input)).toMatch(/unverified|could not verify/i);
  });

  it('is distinguishable from a timeout, which is a different outcome', () => {
    const polled = formatGatePollFailure(input);
    const timedOut = formatGateTimeout(input.runId, input.runUrl, input.blocking);
    expect(polled).not.toBe(timedOut);
    expect(polled).toContain('Run Status Unavailable');
    expect(timedOut).toContain('Timed Out');
  });

  it('respects soak, like every other failure path', () => {
    expect(formatGatePollFailure(input)).toContain('soak period');
    expect(formatGatePollFailure({ ...input, blocking: true })).not.toContain('soak period');
  });
});

describe('retry guidance', () => {
  const run = { runId: 'run-1', runUrl: 'https://example.com/run-1', blocking: false };

  // Nothing was verified in any of these, so the reader needs to know how to get a verdict.
  it('tells the reader how to re-run, on every outcome that verified nothing', () => {
    expect(formatGatePollFailure({ ...run, detail: '403' })).toMatch(/run the gate again/i);
    expect(formatGateTimeout(run.runId, run.runUrl, false)).toMatch(/run the gate again/i);
    expect(formatGateServiceError('Could not reach EvalForge', false)).toMatch(/run the gate again/i);
  });

  // A verdict exists in these, so re-running is not the next step.
  it('does not suggest re-running when the gate actually reached a verdict', () => {
    const passed = formatGateResult({
      metrics: metrics(), verdict: { passed: true, reasons: [] },
      runId: 'run-1', runUrl: 'https://example.com/run-1', maxScenarios: 25,
      selection: { ids: ['i'], selected: ['one'], dropped: [], missingIds: [] },
      warnings: [], unmapped: [], broadImpact: false, blocking: false,
    });
    const guard = formatGuardFailure({
      violations: [{ kind: 'UNCOVERED_TAG', tag: 't' }], warnings: [],
      blocking: false, scenarioDir: 'yaml/wix-app-evals',
    });
    expect(passed).not.toMatch(/run the gate again/i);
    expect(guard).not.toMatch(/run the gate again/i);
  });
});

describe('the retry note', () => {
  it('offers /re-eval in every outcome where nothing was verified', () => {
    const bodies = [
      formatGateTimeout('run-1', 'https://example.com/run-1', false),
      formatGatePollFailure({ runId: 'run-1', runUrl: 'https://example.com/run-1', detail: '403', blocking: false }),
      formatGateServiceError('Could not start the eval run', false, 'Run Not Started'),
    ];

    for (const body of bodies) {
      expect(body).toContain('/re-eval');
    }
  });
});
