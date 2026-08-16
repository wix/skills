import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import type { EvalForgeClient, EvalRunCreated, EvalRunResultRow, EvalRunStatus } from '@wix/evalforge-core';
import type { GateConfig } from '../src/utils/config';
import type { GateScope } from '../src/utils/gate-scope';

const createAndRunEvalRun = vi.fn<EvalForgeClient['createAndRunEvalRun']>();
const client = { createAndRunEvalRun } as unknown as EvalForgeClient;

const pollUntilDone = vi.fn();

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return {
    ...actual,
    pollUntilDone,
    // Wrapped rather than replaced: tests read the real rendered comment (for "unavailable" /
    // "unattributed" / "newly-broken" wording) while still asserting on the exact `impact` the
    // action handed it — in particular, that it is never `undefined`.
    formatGateResult: vi.fn(actual.formatGateResult),
  };
});

const CONFIG: GateConfig = {
  githubToken: 'gh-token',
  evalforgeUrl: 'https://evalforge.example.com',
  projectId: 'proj',
  appId: 'app',
  appSecret: 'secret',
  capabilityId: 'cap-1',
  agentId: 'agent',
  evalsGlob: 'yaml/wix-app-evals/**/*.{yml,yaml}',
  skillDir: 'skills/wix-app',
  referenceDir: 'references',
  ignoreGlobs: ['scripts/**'],
  broadImpactGlobs: ['SKILL.md'],
  maxScenarios: 25,
  isBlocking: true,
  owner: 'wix',
  repo: 'skills',
  repoFullName: 'wix/skills',
  prNumber: 42,
  headSha: 'abc1234deadbeef',
  evaluatedSha: 'merge99feedface',
  versionLabel: 'pr-42-merge99',
  baseSha: 'base1234567890',
  comparisonGroupId: 'group-1',
  runsPerScenario: 1,
  baseArmGraceMs: 60_000,
};

const SCOPE: GateScope = {
  headScenarios: new Map([['covers', {
    path: 'yaml/wix-app-evals/covers.yml',
    scenario: {
      name: 'covers', description: '', triggerPrompt: 'build a dashboard page', tags: ['dashboard-page'],
      assertions: [
        { type: 'skill_was_called' as const, skillNames: ['wix-app'] },
        { type: 'build_passed' as const, command: 'npm run build' },
        { type: 'llm_judge' as const, prompt: 'good?', minScore: 7 },
      ],
    },
  }]]),
  derived: { tags: ['dashboard-page'], broadImpact: false, unmapped: [] },
  touchedPaths: new Set(),
  guard: { violations: [], warnings: [] },
  skillFiles: [],
};

const NAME_TO_ID = new Map([['covers', 'remote-id']]);

const runCreated = (id: string): EvalRunCreated => ({ id, status: 'pending' });

const assertionRow = (status: 'PASSED' | 'FAILED'): EvalRunResultRow => ({
  scenarioId: 'remote-id',
  scenarioName: 'covers',
  passed: status === 'PASSED' ? 1 : 0,
  failed: status === 'PASSED' ? 0 : 1,
  partial: false,
  iterationIndex: 0,
  assertions: [{ assertionName: 'judge', assertionType: 'llm_judge', status }],
});

const partialRow: EvalRunResultRow = {
  scenarioId: 'remote-id',
  scenarioName: 'covers',
  passed: 0,
  failed: 0,
  partial: true,
  iterationIndex: 0,
  assertions: [],
};

function runStatus(
  results: EvalRunResultRow[],
  overrides: Partial<EvalRunStatus['aggregateMetrics']> = {},
): EvalRunStatus {
  const passed = results.reduce((total, row) => total + row.passed, 0);
  const failed = results.reduce((total, row) => total + row.failed, 0);
  return {
    status: 'completed',
    progress: 100,
    aggregateMetrics: {
      totalAssertions: passed + failed, passed, failed, skipped: 0, errors: 0,
      passRate: passed + failed === 0 ? 0 : Math.round((100 * passed) / (passed + failed)),
      avgDuration: 0, totalDuration: 0,
      ...overrides,
    },
    results,
  };
}

const greenRun = (): EvalRunStatus => runStatus([assertionRow('PASSED')]);
const redRun = (): EvalRunStatus => runStatus([assertionRow('FAILED')]);
/** Every row `partial` — `foldScenarioIterations` drops it, so this arm measured nothing. */
const partialRun = (): EvalRunStatus => runStatus([partialRow], { totalAssertions: 0, passed: 0, passRate: 0 });
/** No rows at all for the requested scenario — the "requested but never measured" case. */
const emptyRun = (): EvalRunStatus => runStatus([], { totalAssertions: 0, passed: 0, passRate: 0 });
/** `pollUntilDone` treats `cancelled` as terminal, so this reaches the verdict with zero failures. */
const cancelledRun = (): EvalRunStatus => ({ ...runStatus([assertionRow('PASSED')]), status: 'cancelled' });

const statusWith = (
  metrics: { passed: number; failed: number; errors: number },
): EvalRunStatus => ({
  status: 'completed',
  progress: 100,
  aggregateMetrics: {
    totalAssertions: metrics.passed + metrics.failed + metrics.errors,
    passed: metrics.passed,
    failed: metrics.failed,
    skipped: 0,
    errors: metrics.errors,
    passRate: 0,
    avgDuration: 0,
    totalDuration: 0,
  },
  results: [assertionRow(metrics.failed > 0 ? 'FAILED' : 'PASSED')],
});

/** Never settles — models a base arm that the grace period must not wait out. */
const NEVER_SETTLES = new Promise<EvalRunStatus>(() => {});

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The slice of `PollOptions` these fakes read. */
type PollSleep = { sleep: (ms: number) => Promise<void> };

const upsertComment = vi.fn().mockResolvedValue(undefined);
const lastComment = (): string => upsertComment.mock.calls.at(-1)?.[0] as string;

/** Update-only in production, so a green PR that never failed gets no analysis comment at all. */
const supersedeAnalysis = vi.fn().mockResolvedValue(undefined);

beforeEach(async () => {
  vi.clearAllMocks();
  // Installed once here rather than per-test: `redRun()` now has a failed assertion, so every
  // test that reaches the emit calls the real `core.setOutput` unless it is always mocked —
  // otherwise it falls back to printing the deprecated `::set-output` workflow command.
  vi.spyOn(core, 'setOutput').mockImplementation(() => undefined);
  // Loaded before any test installs fake timers: a dynamic import that first has to reach the
  // loader mid-test cannot make progress while the clock is frozen.
  await import('../src/utils/run-and-report');
  await import('../src/utils/base-attribution');
  createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockResolvedValueOnce(runCreated('run-base'));
});

afterEach(() => {
  vi.useRealTimers();
});

async function run(config: GateConfig = CONFIG) {
  const { runAndReport } = await import('../src/utils/run-and-report');
  await runAndReport(client, config, SCOPE, NAME_TO_ID, 'ver-1', upsertComment, supersedeAnalysis);
}

async function lastImpact() {
  const evalforge = await import('@wix/evalforge-core');
  const calls = vi.mocked(evalforge.formatGateResult).mock.calls;
  return calls.at(-1)?.[0].impact;
}

describe('runAndReport — the base arm cannot move or delay the verdict', () => {
  it('passes a green PR arm when the base arm never finishes, without waiting out the grace period', async () => {
    vi.useFakeTimers();
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      (runId === 'run-pr' ? Promise.resolve(greenRun()) : NEVER_SETTLES));

    const done = run();
    await vi.advanceTimersByTimeAsync(CONFIG.baseArmGraceMs);
    await done;

    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(lastComment()).toMatch(/unavailable/i);
    expect(await lastImpact()).not.toBeUndefined();
  });

  it('still blocks a red PR arm when the base arm never finishes', async () => {
    vi.useFakeTimers();
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      (runId === 'run-pr' ? Promise.resolve(redRun()) : NEVER_SETTLES));

    const done = run();
    await vi.advanceTimersByTimeAsync(CONFIG.baseArmGraceMs);
    await done;

    expect(setFailedSpy).toHaveBeenCalled();
    expect(await lastImpact()).not.toBeUndefined();
  });

  // If the grace clock started when the runs started rather than when the PR arm finished, a PR
  // arm this slow would leave the base arm with no time at all and the attribution would be gone.
  it('still attributes when the PR arm takes longer than the grace period and the base lands just after', async () => {
    vi.useFakeTimers();
    pollUntilDone.mockImplementation(async (_client: unknown, _projectId: unknown, runId: string) => {
      if (runId === 'run-pr') {
        await delay(CONFIG.baseArmGraceMs + 5_000);
        return greenRun();
      }
      await delay(CONFIG.baseArmGraceMs + 10_000);
      return redRun();
    });

    const done = run();
    await vi.advanceTimersByTimeAsync(CONFIG.baseArmGraceMs * 3);
    await done;

    const impact = await lastImpact();
    expect(impact?.fixed).toBe(1);
    expect(impact?.attributionAvailable).toBe(true);
    expect(lastComment()).toContain('`fixed`');
  });

  // Proves the grace comes from config, not a leftover module constant: the base arm here lands
  // comfortably inside CONFIG's 60-second grace, but this run configures a 5-second grace, so it
  // must still miss. A stray hardcoded 60_000ms would let this test pass for the wrong reason.
  it('uses the configured grace, not the 60-second default, to decide when the base arm misses', async () => {
    vi.useFakeTimers();
    const shortGraceConfig: GateConfig = { ...CONFIG, baseArmGraceMs: 5_000 };
    pollUntilDone.mockImplementation(async (_client: unknown, _projectId: unknown, runId: string) => {
      if (runId === 'run-pr') return greenRun();
      await delay(shortGraceConfig.baseArmGraceMs + 1_000);
      return redRun();
    });

    const done = run(shortGraceConfig);
    await vi.advanceTimersByTimeAsync(shortGraceConfig.baseArmGraceMs);
    await done;

    expect(lastComment()).toMatch(/unavailable/i);
    expect(await lastImpact()).not.toBeUndefined();
  });

  // Finding 1: stopping the *wait* on the base poll left the poll itself running for its own
  // 30 minutes, holding the job step open long after the verdict was published.
  it('cancels the base arm poll once the grace period expires, and it stays cancelled', async () => {
    vi.useFakeTimers();
    // Cancellation at grace expiry is the expected path, not a failure — it is annotated with
    // `core.info`, not `core.warning`.
    const infoSpy = vi.spyOn(core, 'info').mockImplementation(() => undefined);
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => undefined);
    let baseSleeps = 0;
    let basePollEndedWith: unknown;
    pollUntilDone.mockImplementation(
      async (_client: unknown, _projectId: unknown, runId: string, options: PollSleep) => {
        if (runId === 'run-pr') return greenRun();
        // Models the real loop, which only ever stops because its injected sleep rejects.
        try {
          for (;;) {
            baseSleeps += 1;
            await options.sleep(30_000);
          }
        } catch (error) {
          basePollEndedWith = error;
          throw error;
        }
      },
    );

    const done = run();
    await vi.advanceTimersByTimeAsync(CONFIG.baseArmGraceMs);
    await done;
    await vi.advanceTimersByTimeAsync(0);

    expect((basePollEndedWith as Error | undefined)?.name).toBe('BaseArmCancelledError');
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/cancelled/i));
    expect(warningSpy).not.toHaveBeenCalled();

    // Nothing keeps polling after the verdict: half an hour of virtual time adds no attempt.
    const sleepsAtCancellation = baseSleeps;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(baseSleeps).toBe(sleepsAtCancellation);
  });

  // The early returns are where the base arm used to run wholly unbounded: `collect` is never
  // reached, so only the `finally` can stop it.
  it('cancels the base arm poll when the PR arm itself times out', async () => {
    vi.useFakeTimers();
    const evalforge = await import('@wix/evalforge-core');
    vi.spyOn(core, 'warning').mockImplementation(() => undefined);
    vi.spyOn(core, 'setFailed').mockImplementation(() => undefined);
    let basePollEndedWith: unknown;
    pollUntilDone.mockImplementation(
      async (_client: unknown, _projectId: unknown, runId: string, options: PollSleep) => {
        if (runId === 'run-pr') {
          await delay(1_000);
          throw new evalforge.EvalRunTimeoutError('Eval run timed out after 30 minutes');
        }
        try {
          for (;;) await options.sleep(30_000);
        } catch (error) {
          basePollEndedWith = error;
          throw error;
        }
      },
    );

    const done = run();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    await vi.advanceTimersByTimeAsync(0);

    expect(lastComment()).toMatch(/timed out/i);
    expect((basePollEndedWith as Error | undefined)?.name).toBe('BaseArmCancelledError');
  });

  it('degrades quietly when the base arm rejects — verdict unchanged, comment still rendered', async () => {
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => undefined);
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      (runId === 'run-pr' ? Promise.resolve(greenRun()) : Promise.reject(new Error('base arm 500'))));

    await run();

    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledTimes(1);
    expect(lastComment()).toMatch(/unavailable/i);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('base arm 500'));
    expect(await lastImpact()).not.toBeUndefined();
  });

  it('labels base-red PR-green as fixed and passes', async () => {
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      Promise.resolve(runId === 'run-pr' ? greenRun() : redRun()));

    await run();

    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(lastComment()).toContain('`fixed`');
    expect((await lastImpact())?.fixed).toBe(1);
  });

  it('labels red-on-both as still-failing and blocks', async () => {
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    pollUntilDone.mockResolvedValue(redRun());

    await run();

    expect(setFailedSpy).toHaveBeenCalled();
    expect(lastComment()).toContain('`still-failing`');
    expect((await lastImpact())?.stillFailing).toBe(1);
  });

  it('labels base-green PR-red as newly-broken and blocks', async () => {
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      Promise.resolve(runId === 'run-pr' ? redRun() : greenRun()));

    await run();

    expect(setFailedSpy).toHaveBeenCalled();
    expect(lastComment()).toContain('`newly-broken`');
    expect((await lastImpact())?.newlyBroken).toBe(1);
  });

  it('never labels a partial base row as newly-broken', async () => {
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      Promise.resolve(runId === 'run-pr' ? redRun() : partialRun()));

    await run();

    expect(lastComment()).toMatch(/unavailable/i);
    expect(lastComment()).not.toContain('newly-broken');
    const impact = await lastImpact();
    expect(impact?.scenarios[0].impact).toBe('unattributed');
    expect(impact?.scenarios.every(scenario => scenario.impact !== 'newly-broken')).toBe(true);
  });

  it('renders a scenario the PR arm never measured as unattributed, never newly-broken', async () => {
    // If the PR outcome were synthesised as a zero-assertion row and fed through the classifier
    // against a passing base, this would wrongly come back `newly-broken` — the trap the third
    // `classifyChangeImpact` argument exists to avoid.
    pollUntilDone.mockImplementation((_client: unknown, _projectId: unknown, runId: string) =>
      Promise.resolve(runId === 'run-pr' ? emptyRun() : greenRun()));

    await run();

    const impact = await lastImpact();
    expect(impact?.scenarios).toHaveLength(1);
    expect(impact?.scenarios[0]).toMatchObject({ scenarioId: 'remote-id', impact: 'unattributed' });
    expect(lastComment()).not.toContain('newly-broken');
  });

  it('emits analyze-run-id when the PR arm has failed assertions', async () => {
    pollUntilDone.mockResolvedValue(statusWith({ passed: 1, failed: 2, errors: 0 }));

    await run();

    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('analyze-run-id', 'run-pr');
  });

  it('leaves the investigation comment alone when there is something to investigate', async () => {
    pollUntilDone.mockResolvedValue(statusWith({ passed: 1, failed: 2, errors: 0 }));

    await run();

    expect(supersedeAnalysis).not.toHaveBeenCalled();
  });

  // Otherwise a fixed PR shows a green verdict directly above the sticky investigation of the run
  // that failed — the state a merging reviewer sees most often.
  // A retraction that falsely claims the run was clean is worse than a stale investigation: it
  // reassures the reader beside a red check *and* destroys the findings. Both of these fail the
  // verdict while leaving `failed` and `errors` at zero, so the counts alone cannot gate it.
  it('never retracts the investigation when the run produced no assertions', async () => {
    pollUntilDone.mockResolvedValue(emptyRun());

    await run();

    expect(supersedeAnalysis).not.toHaveBeenCalled();
  });

  it('never retracts the investigation when the run was cancelled', async () => {
    pollUntilDone.mockResolvedValue(cancelledRun());

    await run();

    expect(supersedeAnalysis).not.toHaveBeenCalled();
  });

  it('retracts a superseded investigation when the run comes back clean', async () => {
    const { ANALYSIS_COMMENT_MARKER } = await import('@wix/evalforge-core');
    pollUntilDone.mockResolvedValue(statusWith({ passed: 3, failed: 0, errors: 0 }));

    await run();

    expect(supersedeAnalysis).toHaveBeenCalledOnce();
    expect(supersedeAnalysis.mock.calls[0][0]).toContain(ANALYSIS_COMMENT_MARKER);
    expect(supersedeAnalysis.mock.calls[0][0]).toContain('no longer applies');
    expect(vi.mocked(core.setOutput)).not.toHaveBeenCalledWith('analyze-run-id', expect.anything());
  });

  it('emits analyze-run-id when assertions errored but none failed', async () => {
    pollUntilDone.mockResolvedValue(statusWith({ passed: 1, failed: 0, errors: 1 }));

    await run();

    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('analyze-run-id', 'run-pr');
  });

  it('emits no analyze-run-id for a fully green run', async () => {
    pollUntilDone.mockResolvedValue(statusWith({ passed: 3, failed: 0, errors: 0 }));

    await run();

    expect(vi.mocked(core.setOutput)).not.toHaveBeenCalledWith('analyze-run-id', expect.anything());
  });

  it('still emits analyze-run-id in soak mode, where a run with real failures still passes', async () => {
    pollUntilDone.mockResolvedValue(statusWith({ passed: 0, failed: 3, errors: 0 }));

    await run({ ...CONFIG, isBlocking: false });

    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('analyze-run-id', 'run-pr');
  });
});
