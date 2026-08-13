import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import { ANALYSIS_COMMENT_MARKER } from '@wix/evalforge-core';
import type { RunAnalysis } from '@wix/evalforge-core';

const analyzeEvalRun = vi.fn<(projectId: string, runId: string) => Promise<RunAnalysis>>();
vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return { ...actual, EvalForgeClient: class { analyzeEvalRun = analyzeEvalRun; } };
});

const upsert = vi.fn<(body: string) => Promise<void>>();
vi.mock('../src/utils/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/report')>();
  return { ...actual, makeAnalysisCommenter: () => upsert };
});

vi.mock('@actions/github', () => ({
  getOctokit: () => ({}),
  context: {
    repo: { owner: 'wix', repo: 'skills' },
    payload: { pull_request: { number: 42, head: { sha: 'abc' }, base: { sha: 'def' } } },
  },
}));

const ANALYZE_INPUTS: Record<string, string> = {
  'INPUT_GITHUB-TOKEN': 'gh-token',
  'INPUT_EVALFORGE-URL': 'https://evalforge.example.com',
  'INPUT_EVALFORGE-PROJECT-ID': 'proj',
  'INPUT_EVALFORGE-APP-ID': 'app',
  'INPUT_EVALFORGE-APP-SECRET': 'secret',
  'INPUT_EVAL-RUN-ID': 'run-123',
};

let setFailed: ReturnType<typeof vi.spyOn>;
let warning: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue(undefined);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key];
  }
  process.env.INPUT_MODE = 'analyze';
  for (const [key, value] of Object.entries(ANALYZE_INPUTS)) process.env[key] = value;

  setFailed = vi.spyOn(core, 'setFailed').mockImplementation(() => {});
  warning = vi.spyOn(core, 'warning').mockImplementation(() => undefined as never);
  // getAnalyzeConfig runs for real here, so safeGetSecret's core.setSecret calls would otherwise
  // print ::add-mask:: lines to the test output.
  vi.spyOn(core, 'setSecret').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const analysis = (over: Partial<RunAnalysis> = {}): RunAnalysis => ({
  summary: 'A summary.',
  findings: [{
    category: 'SKILL_MISGUIDANCE',
    severity: 'HIGH',
    description: 'The reference misleads.',
    affectedScenarios: ['scenario-a'],
  }],
  ...over,
});

describe('runAnalyze', () => {
  it('posts the analysis under the analysis marker', async () => {
    analyzeEvalRun.mockResolvedValue(analysis());
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(analyzeEvalRun).toHaveBeenCalledWith('proj', 'run-123');
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toContain(ANALYSIS_COMMENT_MARKER);
    expect(upsert.mock.calls[0][0]).toContain('Skill misguidance');
  });

  it('posts an unavailable note and never fails the job when the call throws', async () => {
    analyzeEvalRun.mockRejectedValue(
      Object.assign(new Error('EvalForge POST → 400: only available for completed runs'), { status: 400 }),
    );
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(setFailed).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    expect(upsert.mock.calls[0][0]).toContain('could not be generated');
  });

  // The client's message can fold in an upstream OAuth response body, and `core.setSecret` masks
  // logs but not comment bodies. The operator keeps the raw detail; the public comment does not.
  it('states a 400 in plain words, keeping the raw client message out of the comment', async () => {
    analyzeEvalRun.mockRejectedValue(
      Object.assign(new Error('EvalForge POST /v1/... → 400: only available for completed runs'), { status: 400 }),
    );
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(upsert.mock.calls[0][0]).toContain('had not finished');
    expect(upsert.mock.calls[0][0]).not.toContain('EvalForge POST');
    expect(upsert.mock.calls[0][0]).not.toContain('400');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('only available for completed runs'));
  });

  it('names a timeout as a timeout', async () => {
    analyzeEvalRun.mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    );
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(upsert.mock.calls[0][0]).toContain('timed out');
  });

  it('reports a 5xx as an unexpected EvalForge error', async () => {
    analyzeEvalRun.mockRejectedValue(
      Object.assign(new Error('EvalForge POST /v1/... → 503: upstream unavailable'), { status: 503 }),
    );
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(upsert.mock.calls[0][0]).toContain('unexpected');
    expect(upsert.mock.calls[0][0]).not.toContain('upstream unavailable');
  });

  // Observed against the live API: the gateway rejects an unpermitted app with an HTML error page,
  // so the client's own message carries nothing usable and the generic sentence would leave an
  // operator with no idea the grant was the problem.
  it.each([401, 403])('names the missing permission on a %i, and echoes no HTML', async (status) => {
    analyzeEvalRun.mockRejectedValue(
      Object.assign(new Error(`EvalForge POST /v1/... → ${status}: <!DOCTYPE html><html>...`), { status }),
    );
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(upsert.mock.calls[0][0]).toContain('analyze_eval_run');
    expect(upsert.mock.calls[0][0]).not.toContain('DOCTYPE');
  });

  it('never echoes an unrecognised error into the comment, however long it is', async () => {
    analyzeEvalRun.mockRejectedValue(new Error(`leaked-secret ${'x'.repeat(100_000)}`));
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(upsert.mock.calls[0][0].length).toBeLessThan(1_000);
    expect(upsert.mock.calls[0][0]).not.toContain('leaked-secret');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('leaked-secret'));
  });

  it('posts an unavailable note when the analysis is empty', async () => {
    analyzeEvalRun.mockResolvedValue({ summary: '   ', findings: [] });
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await runAnalyze();

    expect(setFailed).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0][0]).toContain('could not be generated');
  });

  it('never fails the job even when posting the comment throws', async () => {
    analyzeEvalRun.mockResolvedValue(analysis());
    upsert.mockRejectedValue(new Error('comment API down'));
    const { runAnalyze } = await import('../src/utils/analyze-run');

    await expect(runAnalyze()).resolves.toBeUndefined();
    expect(setFailed).not.toHaveBeenCalled();
  });
});
