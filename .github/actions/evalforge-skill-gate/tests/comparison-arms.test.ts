import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import type { EvalForgeClient, EvalRunCreated } from '@wix/evalforge-core';
import type { GateConfig } from '../src/utils/config';
import { startComparisonArms } from '../src/utils/comparison-arms';

const createAndRunEvalRun = vi.fn<EvalForgeClient['createAndRunEvalRun']>();
const client = { createAndRunEvalRun } as unknown as EvalForgeClient;

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
  runsPerScenario: 3,
  baseArmGraceMs: 60_000,
};

const runCreated = (id: string): EvalRunCreated => ({ id, status: 'pending' });

const comment = vi.fn().mockResolvedValue(undefined);

/** Unwraps the guarded result, failing the test rather than the type system if it halted. */
async function startArms(scenarioIds: string[] = ['sc-1']) {
  const arms = await startComparisonArms(client, CONFIG, scenarioIds, 'ver-pr', comment);
  if (!arms.ok) throw new Error('expected the arms to start');
  return arms.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockResolvedValueOnce(runCreated('run-base'));
});

describe('startComparisonArms', () => {
  it('gives both arms the same scenario ids and the same runsPerScenario', async () => {
    await startArms(['sc-1', 'sc-2']);
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.scenarioIds).toEqual(baseInput.scenarioIds);
    expect(prInput.runsPerScenario).toBe(baseInput.runsPerScenario);
  });

  it('shares one comparison group and distinguishes the arms by label', async () => {
    await startArms();
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.comparisonGroupId).toBe(baseInput.comparisonGroupId);
    expect([prInput.comparisonLabel, baseInput.comparisonLabel]).toEqual(['pr', 'base']);
  });

  it('pins the PR version on the PR arm and nothing on the base arm', async () => {
    await startArms();
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.capabilityVersions).toEqual({ 'cap-1': 'ver-pr' });
    expect(baseInput.capabilityVersions).toBeUndefined();
    expect(baseInput.capabilityIds).toEqual(['cap-1']);
  });

  it('returns the PR run even when the base arm fails to start', async () => {
    createAndRunEvalRun.mockReset();
    createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockRejectedValueOnce(new Error('nope'));
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => undefined);

    const arms = await startArms();

    expect(arms.prRunId).toBe('run-pr');
    await expect(arms.baseRun).resolves.toBeUndefined();
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('Base comparison arm'));
  });

  // Finding 3: a base create that hangs must not sit between the PR arm starting and its first
  // poll, so the returned base id is a promise this function never awaits.
  it('returns before the base arm has been created', async () => {
    createAndRunEvalRun.mockReset();
    let releaseBaseCreate: (created: EvalRunCreated) => void = () => undefined;
    createAndRunEvalRun
      .mockResolvedValueOnce(runCreated('run-pr'))
      .mockReturnValueOnce(new Promise<EvalRunCreated>((resolve) => { releaseBaseCreate = resolve; }));

    const arms = await startArms();

    expect(arms.prRunId).toBe('run-pr');
    releaseBaseCreate(runCreated('run-base'));
    await expect(arms.baseRun).resolves.toBe('run-base');
  });

  // Finding 2: a create failure on the verdict's arm has to reach the PR as a comment and go
  // through `fail(…, isBlocking)`, not escape as a bare throw.
  it('reports a PR-arm failure on the PR and halts instead of throwing', async () => {
    createAndRunEvalRun.mockReset();
    createAndRunEvalRun.mockRejectedValueOnce(new Error('nope'));
    vi.spyOn(core, 'error').mockImplementation(() => undefined);
    const setFailedSpy = vi.spyOn(core, 'setFailed').mockImplementation(() => undefined);

    const arms = await startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr', comment);

    expect(arms.ok).toBe(false);
    expect(comment).toHaveBeenCalledWith(expect.stringContaining('Run Not Started'));
    expect(setFailedSpy).toHaveBeenCalled();
    // The base arm is never started once the verdict's arm could not be.
    expect(createAndRunEvalRun).toHaveBeenCalledTimes(1);
  });

  it('warns instead of failing a PR-arm create failure while the gate is non-blocking', async () => {
    createAndRunEvalRun.mockReset();
    createAndRunEvalRun.mockRejectedValueOnce(new Error('nope'));
    vi.spyOn(core, 'error').mockImplementation(() => undefined);
    const setFailedSpy = vi.spyOn(core, 'setFailed').mockImplementation(() => undefined);
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => undefined);

    const arms = await startComparisonArms(
      client, { ...CONFIG, isBlocking: false }, ['sc-1'], 'ver-pr', comment,
    );

    expect(arms.ok).toBe(false);
    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalled();
  });

  it('names each run so the two are tellable apart in the EvalForge run list', async () => {
    await startArms();
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.name).not.toBe(baseInput.name);
  });
});
