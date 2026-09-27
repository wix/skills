import { describe, it, expect } from 'vitest';
import { formatPrSweep, PR_SWEEP_MARKER, COMMENT_MARKER } from '../src/utils/comment';
import type { ConfirmVerdict } from '../src/utils/confirm';

const verdict = (name: string, confirmed: boolean, reasons: string[] = []): ConfirmVerdict => ({
  scenarioId: `id-${name}`, scenarioName: name, attempts: 3, failures: confirmed ? 2 : 1, confirmed, reasons,
});

const base = { tags: ['blog', 'bookings'], sampled: 5, total: 5, runUrl: 'https://evalforge/run/1' };
const opts = { blocking: false, versionLabel: 'pr-42-abc1234' };

describe('formatPrSweep', () => {
  it('carries its own marker, so it never overwrites the gate comment', () => {
    const body = formatPrSweep({ kind: 'passed', ...base }, opts);
    expect(body).toContain(PR_SWEEP_MARKER);
    expect(body).not.toContain(COMMENT_MARKER);
  });

  it('reports a clean sweep with the tags, the sample, the version and the run link', () => {
    const body = formatPrSweep({ kind: 'passed', ...base }, opts);
    expect(body).toContain('✅');
    expect(body).toContain('`blog`, `bookings`');
    expect(body).toContain('5 / 5');
    expect(body).toContain('https://evalforge/run/1');
    expect(body).toContain('pr-42-abc1234');
  });

  it('names the flaky scenarios on a pass where every failure recovered on retry', () => {
    const body = formatPrSweep({ kind: 'passed', ...base, recovered: [verdict('bookings/list', false)] }, opts);
    expect(body).toContain('✅');
    expect(body).toContain('bookings/list');
    expect(body).toMatch(/recovered/i);
  });

  it('says when the tag match was sampled rather than run in full', () => {
    const body = formatPrSweep({ kind: 'passed', ...base, sampled: 20, total: 33 }, opts);
    expect(body).toContain('20 / 33');
    expect(body).toMatch(/sampl/i);
  });

  it('lists each confirmed failure with its reasons and each recovered flake', () => {
    const body = formatPrSweep({
      kind: 'failed', ...base,
      confirmed: [verdict('blog/create-post', true, ['correctness', 'tool_called'])],
      recovered: [verdict('bookings/list', false)],
      skipNote: '',
    }, opts);
    expect(body).toContain('blog/create-post');
    expect(body).toContain('correctness, tool_called');
    expect(body).toContain('bookings/list');
    expect(body).toMatch(/recovered/i);
  });

  it('warns rather than fails while the sweep is not blocking', () => {
    const body = formatPrSweep({
      kind: 'failed', ...base, confirmed: [verdict('x', true, ['r'])], recovered: [], skipNote: '',
    }, opts);
    expect(body).toContain('⚠️');
    expect(body).not.toContain('❌');
  });

  it('fails once the sweep is blocking', () => {
    const body = formatPrSweep({
      kind: 'failed', ...base, confirmed: [verdict('x', true, ['r'])], recovered: [], skipNote: '',
    }, { ...opts, blocking: true });
    expect(body).toContain('❌');
  });

  it('surfaces the skipped-retries caveat so a single-attempt verdict is not read as a majority', () => {
    const note = 'no retries run — 12 scenarios failed at once, treated as signal rather than noise';
    const body = formatPrSweep({
      kind: 'failed', ...base, confirmed: [verdict('x', true, ['r'])], recovered: [], skipNote: note,
    }, opts);
    expect(body).toContain(note);
  });

  it('explains a sweep that had nothing to run', () => {
    const body = formatPrSweep({ kind: 'nothing-to-run', reason: 'no eval-relevant tags in this PR' }, opts);
    expect(body).toContain('no eval-relevant tags in this PR');
    expect(body).toContain('ℹ️');
  });

  it('reports an infra error as distinct from a scenario failure, with the run link when there is one', () => {
    const body = formatPrSweep({ kind: 'infra-error', message: 'EvalForge unreachable', runUrl: 'https://evalforge/run/2' }, opts);
    expect(body).toContain('EvalForge unreachable');
    expect(body).toContain('https://evalforge/run/2');
    expect(body).not.toContain('✅');
  });
});
