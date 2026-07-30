import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/config', () => ({
  getCleanupConfig: vi.fn(),
  BASE_WORKSPACE_SUBDIR: '.action-src',
}));

const listTestScenariosByTag = vi.fn().mockResolvedValue([]);
const updateTestScenario = vi.fn().mockResolvedValue(undefined);
const deleteTestScenario = vi.fn().mockResolvedValue(undefined);
const listCapabilityVersions = vi.fn().mockResolvedValue([]);
const deleteCapabilityVersion = vi.fn().mockResolvedValue(undefined);

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return {
    ...actual,
    loadScenarios: vi.fn().mockReturnValue({ scenarios: new Map(), errors: [] }),
    EvalForgeClient: vi.fn().mockImplementation(() => ({
      listTestScenariosByTag, updateTestScenario, deleteTestScenario,
      listCapabilityVersions, deleteCapabilityVersion,
    })),
  };
});

const CONFIG = {
  githubToken: 'gh-token',
  evalforgeUrl: 'https://evalforge.example.com',
  projectId: 'proj',
  appId: 'app',
  appSecret: 'secret',
  capabilityId: 'cap',
  evalsGlob: 'yaml/wix-app-evals/**/*.yml',
  owner: 'wix',
  repo: 'skills',
  repoFullName: 'wix/skills',
  prNumber: 42,
};

const DRAFT_TAG = 'draft:wix/skills#42';

beforeEach(() => {
  vi.clearAllMocks();
  listTestScenariosByTag.mockResolvedValue([]);
  listCapabilityVersions.mockResolvedValue([]);
  deleteTestScenario.mockResolvedValue(undefined);
  updateTestScenario.mockResolvedValue(undefined);
  deleteCapabilityVersion.mockResolvedValue(undefined);
});

async function harness() {
  const { getCleanupConfig } = await import('../src/utils/config');
  const coreModule = await import('@actions/core');
  const evalforge = await import('@wix/evalforge-core');
  const { runCleanup } = await import('../src/utils/cleanup-run');
  vi.mocked(getCleanupConfig).mockReturnValue(CONFIG);
  return { runCleanup, core: coreModule, evalforge };
}

describe('runCleanup', () => {
  it('sweeps only this PR capability versions', async () => {
    const { runCleanup } = await harness();
    listCapabilityVersions.mockResolvedValueOnce([
      { id: 'v1', capabilityId: 'cap', version: 'pr-42-abc1234' },
      { id: 'v2', capabilityId: 'cap', version: 'main' },
    ]);

    await runCleanup();

    expect(deleteCapabilityVersion).toHaveBeenCalledTimes(1);
    expect(deleteCapabilityVersion).toHaveBeenCalledWith('cap', 'proj', 'v1');
  });

  it('DELETEs a PR-only draft scenario', async () => {
    const { runCleanup } = await harness();
    listTestScenariosByTag.mockResolvedValueOnce([{ id: 'id-1', name: 'pr-only', tags: [DRAFT_TAG] }]);

    await runCleanup();

    expect(deleteTestScenario).toHaveBeenCalledTimes(1);
    expect(deleteTestScenario).toHaveBeenCalledWith('proj', 'id-1');
    expect(updateTestScenario).not.toHaveBeenCalled();
  });

  it('RESTOREs a scenario that pre-existed the PR from the base YAML', async () => {
    const { runCleanup, evalforge } = await harness();
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['kept', {
        path: 'yaml/wix-app-evals/kept.yml',
        scenario: {
          name: 'kept', description: '', triggerPrompt: 'build a dashboard page',
          tags: ['dashboard-page'],
          assertions: [{ type: 'llm_judge' as const, prompt: 'good?', minScore: 7 }],
        },
      }]]),
      errors: [],
    });
    listTestScenariosByTag.mockResolvedValueOnce([{ id: 'id-1', name: 'kept', tags: [DRAFT_TAG] }]);

    await runCleanup();

    expect(updateTestScenario).toHaveBeenCalledTimes(1);
    expect(updateTestScenario).toHaveBeenCalledWith(
      'proj', 'id-1', expect.objectContaining({ name: 'kept' }),
      expect.arrayContaining(['dashboard-page']),
    );
    expect(deleteTestScenario).not.toHaveBeenCalled();
  });

  it('warns and never fails when the scenario lookup throws', async () => {
    const { runCleanup, core } = await harness();
    listTestScenariosByTag.mockRejectedValueOnce(new Error('gateway down'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    const warningSpy = vi.spyOn(core, 'warning');

    await expect(runCleanup()).resolves.toBeUndefined();

    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('gateway down'));
  });

  it('warns and never fails when an individual cleanup action throws', async () => {
    const { runCleanup, core } = await harness();
    listTestScenariosByTag.mockResolvedValueOnce([{ id: 'id-1', name: 'pr-only', tags: [DRAFT_TAG] }]);
    deleteTestScenario.mockRejectedValueOnce(new Error('conflict'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await expect(runCleanup()).resolves.toBeUndefined();

    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('ignores scenarios carrying another PR draft tag', async () => {
    const { runCleanup } = await harness();
    listTestScenariosByTag.mockResolvedValueOnce([
      { id: 'id-1', name: 'other', tags: ['draft:wix/skills#99'] },
    ]);

    await runCleanup();

    expect(deleteTestScenario).not.toHaveBeenCalled();
    expect(updateTestScenario).not.toHaveBeenCalled();
  });

  it('still sweeps versions when the scenario lookup returns nothing', async () => {
    const { runCleanup } = await harness();
    listCapabilityVersions.mockResolvedValueOnce([
      { id: 'v1', capabilityId: 'cap', version: 'pr-42-aaa' },
    ]);

    await runCleanup();

    expect(deleteCapabilityVersion).toHaveBeenCalledWith('cap', 'proj', 'v1');
  });
});
