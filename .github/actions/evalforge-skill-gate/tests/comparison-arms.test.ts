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
};

const runCreated = (id: string): EvalRunCreated => ({ id, status: 'pending' });

beforeEach(() => {
  vi.clearAllMocks();
  createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockResolvedValueOnce(runCreated('run-base'));
});

describe('startComparisonArms', () => {
  it('gives both arms the same scenario ids and the same runsPerScenario', async () => {
    await startComparisonArms(client, CONFIG, ['sc-1', 'sc-2'], 'ver-pr');
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.scenarioIds).toEqual(baseInput.scenarioIds);
    expect(prInput.runsPerScenario).toBe(baseInput.runsPerScenario);
  });

  it('shares one comparison group and distinguishes the arms by label', async () => {
    await startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr');
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.comparisonGroupId).toBe(baseInput.comparisonGroupId);
    expect([prInput.comparisonLabel, baseInput.comparisonLabel]).toEqual(['pr', 'base']);
  });

  it('pins the PR version on the PR arm and nothing on the base arm', async () => {
    await startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr');
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.capabilityVersions).toEqual({ 'cap-1': 'ver-pr' });
    expect(baseInput.capabilityVersions).toBeUndefined();
    expect(baseInput.capabilityIds).toEqual(['cap-1']);
  });

  it('returns the PR run even when the base arm fails to start', async () => {
    createAndRunEvalRun.mockReset();
    createAndRunEvalRun.mockResolvedValueOnce(runCreated('run-pr')).mockRejectedValueOnce(new Error('nope'));
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => undefined);

    await expect(startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr'))
      .resolves.toEqual({ prRunId: 'run-pr' });
    expect(warningSpy).toHaveBeenCalled();
  });

  it('propagates a PR-arm failure — that one is the verdict', async () => {
    createAndRunEvalRun.mockReset();
    createAndRunEvalRun.mockRejectedValueOnce(new Error('nope'));

    await expect(startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr')).rejects.toThrow('nope');
  });

  it('names each run so the two are tellable apart in the EvalForge run list', async () => {
    await startComparisonArms(client, CONFIG, ['sc-1'], 'ver-pr');
    const [prInput, baseInput] = createAndRunEvalRun.mock.calls.map(call => call[1]);
    expect(prInput.name).not.toBe(baseInput.name);
  });
});
