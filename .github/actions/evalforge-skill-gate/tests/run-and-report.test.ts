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

/** Never settles — models a base arm that the grace period must not wait out. */
const NEVER_SETTLES = new Promise<EvalRunStatus>(() => {});

const upsertComment = vi.fn().mockResolvedValue(undefined);
const lastComment = (): string => upsertComment.mock.calls.at(-1)?.[0] as string;

beforeEach(() => {
  vi.clearAllMocks();
  createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockResolvedValueOnce(runCreated('run-base'));
});

afterEach(() => {
  vi.useRealTimers();
});

async function run() {
  const { runAndReport } = await import('../src/utils/run-and-report');
  await runAndReport(client, CONFIG, SCOPE, NAME_TO_ID, 'ver-1', upsertComment);
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

    const { BASE_ARM_GRACE_MS } = await import('../src/utils/run-and-report');
    const done = run();
    await vi.advanceTimersByTimeAsync(BASE_ARM_GRACE_MS);
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

    const { BASE_ARM_GRACE_MS } = await import('../src/utils/run-and-report');
    const done = run();
    await vi.advanceTimersByTimeAsync(BASE_ARM_GRACE_MS);
    await done;

    expect(setFailedSpy).toHaveBeenCalled();
    expect(await lastImpact()).not.toBeUndefined();
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
});
