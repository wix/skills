import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPlan } from '../src/utils/sync-run';

const mkClient = () => ({
  createTestScenario: vi.fn().mockResolvedValue({ id: 'new' }),
  updateTestScenario: vi.fn().mockResolvedValue(undefined),
  deleteTestScenario: vi.fn().mockResolvedValue(undefined),
});

describe('applyPlan', () => {
  it('applies create/update/delete for the matching action kinds', async () => {
    const client = mkClient();
    await applyPlan(client as any, 'proj', {
      actions: [
        { kind: 'CREATE', name: 'a', body: { name: 'a' } as any, tags: [] },
        { kind: 'UPDATE', id: 'r1', name: 'b', body: { name: 'b' } as any, tags: [] },
        { kind: 'DELETE', id: 'r2', name: 'c' },
      ],
      skipped: [],
    });
    expect(client.createTestScenario).toHaveBeenCalledOnce();
    expect(client.createTestScenario).toHaveBeenCalledWith('proj', { name: 'a' }, []);
    expect(client.updateTestScenario).toHaveBeenCalledOnce();
    expect(client.updateTestScenario).toHaveBeenCalledWith('proj', 'r1', { name: 'b' }, []);
    expect(client.deleteTestScenario).toHaveBeenCalledOnce();
    expect(client.deleteTestScenario).toHaveBeenCalledWith('proj', 'r2');
  });

  it('returns a failure flag and continues past a failed action', async () => {
    const client = mkClient();
    client.updateTestScenario.mockRejectedValueOnce(new Error('boom'));
    const result = await applyPlan(client as any, 'proj', {
      actions: [
        { kind: 'UPDATE', id: 'r1', name: 'b', body: { name: 'b' } as any, tags: [] },
        { kind: 'DELETE', id: 'r2', name: 'c' },
      ],
      skipped: [],
    });
    expect(client.deleteTestScenario).toHaveBeenCalledOnce();
    expect(result.hasFailures).toBe(true);
  });

  it('reports no failures when all actions succeed', async () => {
    const client = mkClient();
    const result = await applyPlan(client as any, 'proj', {
      actions: [{ kind: 'DELETE', id: 'r2', name: 'c' }],
      skipped: [],
    });
    expect(result.hasFailures).toBe(false);
  });
});

vi.mock('../src/utils/config', () => ({
  getSyncConfig: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({ rest: { pulls: {} } })),
}));

const listTestScenarios = vi.fn().mockResolvedValue([]);
const createTestScenario = vi.fn().mockResolvedValue({ id: 'created' });
const updateTestScenario = vi.fn().mockResolvedValue(undefined);
const deleteTestScenario = vi.fn().mockResolvedValue(undefined);

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return {
    ...actual,
    getFirstCommitAuthorEmail: vi.fn(),
    loadScenarios: vi.fn().mockReturnValue({ scenarios: new Map(), errors: [] }),
    EvalForgeClient: vi.fn().mockImplementation(() => ({
      listTestScenarios,
      createTestScenario,
      updateTestScenario,
      deleteTestScenario,
    })),
  };
});

describe('runSync — author gate', () => {
  const baseConfig = {
    evalforgeUrl: 'https://evalforge.example.com',
    projectId: 'proj',
    appId: 'app',
    appSecret: 'secret',
    evalsGlob: 'yaml/wix-app-evals/**/*.yml',
    repo: 'wix/skills',
    githubToken: 'gh-token',
    prNumber: 42,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the sync (no EvalForge calls, no setFailed) when the PR author is not a @wix.com address', async () => {
    const { getSyncConfig } = await import('../src/utils/config');
    const { getFirstCommitAuthorEmail } = await import('@wix/evalforge-core');
    const core = await import('@actions/core');
    const { loadScenarios, EvalForgeClient } = await import('@wix/evalforge-core');
    const { runSync } = await import('../src/utils/sync-run');

    vi.mocked(getSyncConfig).mockReturnValue(baseConfig);
    vi.mocked(getFirstCommitAuthorEmail).mockResolvedValue('outsider@gmail.com');
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    const infoSpy = vi.spyOn(core, 'info');

    await runSync();

    expect(loadScenarios).not.toHaveBeenCalled();
    expect(EvalForgeClient).not.toHaveBeenCalled();
    expect(listTestScenarios).not.toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Skipping wix-app sync — PR author is not a @wix.com address');
  });

  it('proceeds with the sync when the PR author is a @wix.com address', async () => {
    const { getSyncConfig } = await import('../src/utils/config');
    const { getFirstCommitAuthorEmail } = await import('@wix/evalforge-core');
    const core = await import('@actions/core');
    const { loadScenarios, EvalForgeClient } = await import('@wix/evalforge-core');
    const { runSync } = await import('../src/utils/sync-run');

    vi.mocked(getSyncConfig).mockReturnValue(baseConfig);
    vi.mocked(getFirstCommitAuthorEmail).mockResolvedValue('dev@wix.com');
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runSync();

    expect(loadScenarios).toHaveBeenCalledOnce();
    expect(EvalForgeClient).toHaveBeenCalledOnce();
    expect(listTestScenarios).toHaveBeenCalledOnce();
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('drives create/update/delete end to end against a non-empty remote', async () => {
    const { getSyncConfig } = await import('../src/utils/config');
    const { getFirstCommitAuthorEmail } = await import('@wix/evalforge-core');
    const core = await import('@actions/core');
    const { loadScenarios, repoTagFor } = await import('@wix/evalforge-core');
    const { runSync } = await import('../src/utils/sync-run');

    const scenario = (name: string) => ({
      name,
      description: 'd',
      triggerPrompt: 'trigger prompt long enough',
      tags: ['dashboard-page'],
      assertions: [{ type: 'llm_judge' as const, prompt: 'p', minScore: 7 }],
    });

    vi.mocked(getSyncConfig).mockReturnValue(baseConfig);
    vi.mocked(getFirstCommitAuthorEmail).mockResolvedValue('dev@wix.com');
    vi.mocked(loadScenarios).mockReturnValue({
      scenarios: new Map([
        ['kept', { path: 'yaml/wix-app-evals/kept.yml', scenario: scenario('kept') }],
        ['fresh', { path: 'yaml/wix-app-evals/fresh.yml', scenario: scenario('fresh') }],
      ]),
      errors: [],
    });
    listTestScenarios.mockResolvedValueOnce([
      { id: 'r1', name: 'kept', tags: [repoTagFor(baseConfig.repo)] },
      { id: 'r2', name: 'gone', tags: [repoTagFor(baseConfig.repo)] },
      { id: 'r3', name: 'ui-only', tags: ['dashboard-page'] },
    ]);
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runSync();

    expect(updateTestScenario).toHaveBeenCalledOnce();
    expect(updateTestScenario).toHaveBeenCalledWith('proj', 'r1', expect.objectContaining({ name: 'kept' }), expect.arrayContaining([repoTagFor(baseConfig.repo)]));
    expect(createTestScenario).toHaveBeenCalledOnce();
    expect(createTestScenario).toHaveBeenCalledWith('proj', expect.objectContaining({ name: 'fresh' }), expect.arrayContaining([repoTagFor(baseConfig.repo)]));
    expect(deleteTestScenario).toHaveBeenCalledOnce();
    expect(deleteTestScenario).toHaveBeenCalledWith('proj', 'r2');
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('fails the run on YAML load errors without touching EvalForge', async () => {
    const { getSyncConfig } = await import('../src/utils/config');
    const { getFirstCommitAuthorEmail } = await import('@wix/evalforge-core');
    const core = await import('@actions/core');
    const { loadScenarios, EvalForgeClient } = await import('@wix/evalforge-core');
    const { runSync } = await import('../src/utils/sync-run');

    vi.mocked(getSyncConfig).mockReturnValue(baseConfig);
    vi.mocked(getFirstCommitAuthorEmail).mockResolvedValue('dev@wix.com');
    vi.mocked(loadScenarios).mockReturnValue({
      scenarios: new Map(),
      errors: [{ path: 'yaml/wix-app-evals/bad.yml', message: 'duplicate name "x"' }],
    });
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runSync();

    expect(EvalForgeClient).not.toHaveBeenCalled();
    expect(listTestScenarios).not.toHaveBeenCalled();
    expect(deleteTestScenario).not.toHaveBeenCalled();
    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringMatching(/Invalid YAML or duplicate names: 1/));
  });

  it('fails the run when an EvalForge action throws', async () => {
    const { getSyncConfig } = await import('../src/utils/config');
    const { getFirstCommitAuthorEmail } = await import('@wix/evalforge-core');
    const core = await import('@actions/core');
    const { loadScenarios, repoTagFor } = await import('@wix/evalforge-core');
    const { runSync } = await import('../src/utils/sync-run');

    vi.mocked(getSyncConfig).mockReturnValue(baseConfig);
    vi.mocked(getFirstCommitAuthorEmail).mockResolvedValue('dev@wix.com');
    vi.mocked(loadScenarios).mockReturnValue({ scenarios: new Map(), errors: [] });
    listTestScenarios.mockResolvedValueOnce([
      { id: 'r2', name: 'gone', tags: [repoTagFor(baseConfig.repo)] },
    ]);
    deleteTestScenario.mockRejectedValueOnce(new Error('boom'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runSync();

    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringMatching(/re-run to retry/));
  });
});
