import { describe, it, expect, vi } from 'vitest';
import { reportMergeVerdict, reportPrVerdict, type ReportIo } from '../src/utils/sweep-report';
import { PR_SWEEP_MARKER } from '../src/utils/comment';
import type { SweepVerdict } from '../src/utils/sweep-verdict';
import type { ConfirmVerdict } from '../src/utils/confirm';

const io = (): ReportIo & { outputs: Record<string, string>; failed: string[] } => {
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  return {
    outputs, failed,
    setOutput: (name, value) => { outputs[name] = value; },
    setFailed: (message) => { failed.push(message); },
    warning: vi.fn(),
    info: vi.fn(),
  };
};

const cv = (name: string, confirmed: boolean, reasons: string[] = ['correctness']): ConfirmVerdict => ({
  scenarioId: `id-${name}`, scenarioName: name, attempts: 3, failures: confirmed ? 2 : 1, confirmed, reasons,
});

const scope = { tags: ['blog'], sampled: 3, total: 3, runUrl: 'https://evalforge/run/1' };
const FAILED: SweepVerdict = {
  kind: 'failed', ...scope, confirmed: [cv('blog/a', true), cv('blog/b', true, ['tool_called'])], recovered: [cv('blog/c', false)], skipNote: '',
};
const PASSED: SweepVerdict = { kind: 'passed', ...scope };
const INFRA: SweepVerdict = { kind: 'infra-error', message: 'EvalForge unreachable' };
const NOTHING: SweepVerdict = { kind: 'nothing-to-run', reason: 'no tags' };

const prOpts = { blocking: false, versionLabel: 'pr-42-abc1234' };

describe('reportPrVerdict', () => {
  it('posts the sweep comment on the PR', async () => {
    const comment = vi.fn().mockResolvedValue(undefined);
    await reportPrVerdict(FAILED, io(), comment, prOpts);
    expect(comment).toHaveBeenCalledTimes(1);
    expect(comment.mock.calls[0][0]).toContain(PR_SWEEP_MARKER);
    expect(comment.mock.calls[0][0]).toContain('blog/a');
  });

  it('keeps the job green on a confirmed failure while not blocking', async () => {
    const out = io();
    await reportPrVerdict(FAILED, out, vi.fn().mockResolvedValue(undefined), prOpts);
    expect(out.failed).toEqual([]);
  });

  it('fails the job on a confirmed failure once blocking', async () => {
    const out = io();
    await reportPrVerdict(FAILED, out, vi.fn().mockResolvedValue(undefined), { ...prOpts, blocking: true });
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toContain('blog/a');
  });

  it('keeps the job green on an infra error while not blocking, but still comments', async () => {
    const out = io();
    const comment = vi.fn().mockResolvedValue(undefined);
    await reportPrVerdict(INFRA, out, comment, prOpts);
    expect(out.failed).toEqual([]);
    expect(comment.mock.calls[0][0]).toContain('EvalForge unreachable');
  });

  it('fails the job on an infra error once blocking', async () => {
    const out = io();
    await reportPrVerdict(INFRA, out, vi.fn().mockResolvedValue(undefined), { ...prOpts, blocking: true });
    expect(out.failed).toEqual(['EvalForge unreachable']);
  });

  it('never fails the job on a pass or on nothing to run, blocking or not', async () => {
    for (const verdict of [PASSED, NOTHING]) {
      const out = io();
      await reportPrVerdict(verdict, out, vi.fn().mockResolvedValue(undefined), { ...prOpts, blocking: true });
      expect(out.failed).toEqual([]);
    }
  });

  it('still writes the counts as outputs, so a workflow can key steps off them', async () => {
    const out = io();
    await reportPrVerdict(FAILED, out, vi.fn().mockResolvedValue(undefined), prOpts);
    expect(out.outputs['confirmed-failed-count']).toBe('2');
    expect(out.outputs['recovered-count']).toBe('1');
  });
});

describe('reportMergeVerdict', () => {
  const mergedBy = vi.fn().mockResolvedValue({ name: 'octocat', url: 'https://github.com/wix/skills/pull/7' });

  it('writes the confirmed-failure outputs the Slack step reads and fails the job', async () => {
    const out = io();
    await reportMergeVerdict(FAILED, out, mergedBy);
    expect(out.outputs['confirmed-failed-count']).toBe('2');
    expect(out.outputs['recovered-count']).toBe('1');
    expect(out.outputs['confirmed-failed-scenarios']).toBe('blog/a (correctness)\nblog/b (tool_called)');
    expect(out.outputs['merged-by-name']).toBe('octocat');
    expect(out.outputs['merged-by-url']).toBe('https://github.com/wix/skills/pull/7');
    expect(out.failed).toHaveLength(1);
  });

  it('reports zero counts and stays green on a pass', async () => {
    const out = io();
    await reportMergeVerdict(PASSED, out, mergedBy);
    expect(out.outputs['confirmed-failed-count']).toBe('0');
    expect(out.outputs['recovered-count']).toBe('0');
    expect(out.failed).toEqual([]);
  });

  it('reports the recovered count when every failure recovered on retry, and stays green', async () => {
    const out = io();
    await reportMergeVerdict({ ...PASSED, recovered: [cv('blog/c', false)] }, out, mergedBy);
    expect(out.outputs['confirmed-failed-count']).toBe('0');
    expect(out.outputs['recovered-count']).toBe('1');
    expect(out.failed).toEqual([]);
  });

  it('writes infra-error and fails the job on an infra error', async () => {
    const out = io();
    await reportMergeVerdict(INFRA, out, mergedBy);
    expect(out.outputs['infra-error']).toBe('EvalForge unreachable');
    expect(out.failed).toEqual(['EvalForge unreachable']);
  });

  it('surfaces the skip note as an output and a warning', async () => {
    const out = io();
    await reportMergeVerdict({ ...FAILED, skipNote: 'no retries run — the retry itself failed, so the first attempt stands' }, out, mergedBy);
    expect(out.outputs['confirm-skip-reason']).toContain('no retries run');
    expect(out.warning).toHaveBeenCalled();
  });

  it('does not look up the merging author when nothing failed', async () => {
    const lookup = vi.fn();
    await reportMergeVerdict(PASSED, io(), lookup);
    expect(lookup).not.toHaveBeenCalled();
  });
});
