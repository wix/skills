import { describe, it, expect } from 'vitest';
import {
  GATE_COMMENT_MARKER, formatYamlErrors, formatNoGatedChanges, formatGuardFailure,
  formatForeignDraftConflicts, formatGateResult, formatGatePollFailure, formatGateTimeout,
  formatGateServiceError, formatGateSkipped,
} from '../src/format-gate-comment';
import type { EvalRunStatus } from '../src/evalforge';
import type { ChangeImpact, ScenarioImpact } from '../src/classify-change-impact';

const metrics = (overrides: Partial<EvalRunStatus['aggregateMetrics']> = {}): EvalRunStatus['aggregateMetrics'] => ({
  totalAssertions: 5, passed: 5, failed: 0, skipped: 0,
  errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0,
  ...overrides,
});

const scenarioImpact = (overrides: Partial<ScenarioImpact> = {}): ScenarioImpact => ({
  scenarioId: 'id-a', scenarioName: 'covers', impact: 'still-passing', prPassed: true,
  ...overrides,
});

/** Mirrors `classifyChangeImpact`'s own aggregation, so fixtures do not drift from real counts. */
const changeImpact = (scenarios: ScenarioImpact[]): ChangeImpact => {
  const countOf = (impact: ScenarioImpact['impact']): number =>
    scenarios.filter(scenario => scenario.impact === impact).length;
  const fixed = countOf('fixed');
  const newlyBroken = countOf('newly-broken');
  return {
    scenarios,
    fixed,
    newlyBroken,
    stillPassing: countOf('still-passing'),
    stillFailing: countOf('still-failing'),
    unattributed: countOf('unattributed'),
    netEffect: fixed - newlyBroken,
    attributionAvailable: scenarios.some(scenario => scenario.impact !== 'unattributed'),
  };
};

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

describe('formatGateResult impact reporting', () => {
  // The exact string produced before `impact` existed, captured from the unmodified function.
  // A regression here means an old caller — one that never learned about `impact` — now sees a
  // different comment than before, breaking the back-compat contract for this optional field.
  const PRE_IMPACT_BODY = '<!-- evalforge-skill-gate-action -->\n## ✅ EvalForge Skill Gate: Passed'
    + '\n\n**Pass rate:** 100% — 5/5 assertions passed'
    + '\n**Run:** [run-1](https://bo.wix.com/pages/evalforge/P/results?runId=run-1)'
    + '\n\n**Scope:** 1 scenario ran.'
    + '\n\n- `covers`';

  it('is byte-identical to the pre-`impact` output when `impact` is not passed', () => {
    expect(formatGateResult(baseResult)).toBe(PRE_IMPACT_BODY);
  });

  it('says attribution is unavailable when the base arm produced nothing, rather than staying silent', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([scenarioImpact({ impact: 'unattributed' })]),
    });
    expect(body).toMatch(/unavailable/i);
    expect(body).not.toContain('| Scenario | Impact | Meaning |');
  });

  it('renders a per-scenario table with an icon, the scenario name, the class as code, and a meaning', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'fixed-one', impact: 'fixed' }),
        scenarioImpact({ scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false }),
      ]),
    });
    expect(body).toContain('| Scenario | Impact | Meaning |');
    expect(body).toContain('`fixed-one`');
    expect(body).toContain('`fixed`');
    expect(body).toContain('`broken-one`');
    expect(body).toContain('`newly-broken`');
  });

  it('reads newly-broken as caused by this PR and still-failing as pre-existing, in words', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false }),
        scenarioImpact({ scenarioName: 'flaky-one', impact: 'still-failing', prPassed: false }),
      ]),
    });
    expect(body).toMatch(/newly-broken.*caused by this change/i);
    expect(body).toMatch(/still-failing.*pre-existing, not caused by this change/i);
  });

  it('names the failing assertions for a row that has them', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({
          scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false,
          failingAssertionNames: ['checks-total', 'checks-tax'],
        }),
      ]),
    });
    expect(body).toContain('`checks-total`');
    expect(body).toContain('`checks-tax`');
  });

  it('does not render an empty failing-assertions list for a row without the field', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([scenarioImpact({ scenarioName: 'fixed-one', impact: 'fixed' })]),
    });
    expect(body).not.toContain('Failing: .');
    expect(body).not.toMatch(/Failing:\s*\|/);
  });

  it('carries the four counts and the net effect in a summary line', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'fixed-one', impact: 'fixed' }),
        scenarioImpact({ scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false }),
        scenarioImpact({ scenarioName: 'flaky-one', impact: 'still-failing', prPassed: false }),
        scenarioImpact({ scenarioName: 'gap-one', impact: 'unattributed' }),
      ]),
    });
    expect(body).toContain('1 scenario fixed');
    expect(body).toContain('1 scenario newly broken');
    expect(body).toContain('1 scenario still failing');
    expect(body).toContain('1 scenario unattributed');
    expect(body).toContain('net effect 0');
  });

  it('signs a positive net effect but not a negative one, which already carries its own minus', () => {
    const gain = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'fixed-one', impact: 'fixed' }),
        scenarioImpact({ scenarioName: 'fixed-two', impact: 'fixed' }),
      ]),
    });
    const loss = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false }),
      ]),
    });
    expect(gain).toContain('net effect +2');
    expect(loss).toContain('net effect -1');
  });

  it('says the change moved nothing measurable when every scenario is still-passing, instead of a uniform table', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'one', impact: 'still-passing' }),
        scenarioImpact({ scenarioName: 'two', impact: 'still-passing' }),
      ]),
    });
    expect(body).toMatch(/moved nothing measurable/i);
    expect(body).not.toContain('| Scenario | Impact | Meaning |');
  });

  // Finding 7: a scenarios-only PR legitimately produces an all-still-passing result, since both
  // arms then evaluate identical skill content. Without this sentence that reads as a suspicious
  // no-op rather than the expected outcome.
  it('explains that an all-still-passing result is expected for a scenarios-only PR', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([scenarioImpact({ scenarioName: 'one', impact: 'still-passing' })]),
    });
    expect(body).toMatch(/scenario YAML/i);
  });

  // Finding 5: the summary used to omit still-passing, so the counts did not sum to the row count.
  it('includes still-passing in the summary counts, alongside the other three', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({ scenarioName: 'fixed-one', impact: 'fixed' }),
        scenarioImpact({ scenarioName: 'broken-one', impact: 'newly-broken', prPassed: false }),
        scenarioImpact({ scenarioName: 'passing-one', impact: 'still-passing' }),
        scenarioImpact({ scenarioName: 'flaky-one', impact: 'still-failing', prPassed: false }),
        scenarioImpact({ scenarioName: 'gap-one', impact: 'unattributed' }),
      ]),
    });
    expect(body).toContain('1 scenario fixed');
    expect(body).toContain('1 scenario newly broken');
    expect(body).toContain('1 scenario still passing');
    expect(body).toContain('1 scenario still failing');
    expect(body).toContain('1 scenario unattributed');
    expect(body).toContain('net effect 0');
  });

  // Finding 4: an author-controlled scenario name or an API-provided assertion name containing a
  // `|` would otherwise shift every subsequent cell in its row.
  it('escapes a `|` in the scenario name and in failing-assertion names', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([
        scenarioImpact({
          scenarioName: 'checkout | tax spi', impact: 'newly-broken', prPassed: false,
          failingAssertionNames: ['checks | total'],
        }),
      ]),
    });
    const row = body.split('\n').find(line => line.includes('checkout'));
    expect(row).toBeDefined();
    expect(row).toContain('checkout \\| tax spi');
    expect(row).toContain('checks \\| total');
    // Split on a `|` not preceded by `\` — the markdown-escaped pipes must not count as cell
    // boundaries, only the three real ones bordering and separating the row's cells.
    const unescapedPipeSplit = /(?<!\\)\|/;
    expect(row?.split(unescapedPipeSplit)).toHaveLength('| Scenario | Impact | Meaning |'.split(unescapedPipeSplit).length);
  });

  // Finding 1: `attributionAvailable` is false both when the base arm produced nothing and when
  // the PR arm itself scored nothing. Blaming the base run unconditionally sends the contributor
  // to investigate the wrong side on a blocking comment.
  it('does not blame the base run when it was the PR arm that produced no comparable results', () => {
    const body = formatGateResult({
      ...baseResult,
      // No `prPassed` at all — exactly how `classifyChangeImpact` appends a scenario the PR arm
      // never measured, as opposed to a measured scenario the base arm could not match.
      impact: changeImpact([{ scenarioId: 'id-a', scenarioName: 'covers', impact: 'unattributed' }]),
    });
    expect(body).toMatch(/unavailable/i);
    expect(body).not.toMatch(/base run produced no comparable/i);
  });

  it('still names the base run when it is the base arm that produced no comparable results', () => {
    const body = formatGateResult({
      ...baseResult,
      impact: changeImpact([scenarioImpact({ impact: 'unattributed' })]),
    });
    expect(body).toMatch(/unavailable/i);
    expect(body).toMatch(/base run produced no comparable/i);
  });
});

describe('formatGateResult runs-per-scenario reporting', () => {
  // Finding 2: with no way to tell from the comment whether a scenario ran once or several times,
  // a `newly-broken` verdict caused by one flaky iteration is indistinguishable from a real
  // regression.
  it('reports runs-per-scenario when above 1, naming that a failing iteration counts as a failure', () => {
    const body = formatGateResult({ ...baseResult, runsPerScenario: 5 });
    expect(body).toContain('5');
    expect(body).toMatch(/each scenario ran 5 times per arm/i);
    expect(body).toMatch(/failing iteration counts as a failure/i);
  });

  it('renders nothing when runs-per-scenario is 1', () => {
    const body = formatGateResult({ ...baseResult, runsPerScenario: 1 });
    expect(body).not.toMatch(/runs per scenario/i);
  });

  it('renders nothing when runs-per-scenario is absent', () => {
    const body = formatGateResult(baseResult);
    expect(body).not.toMatch(/runs per scenario/i);
  });
});
