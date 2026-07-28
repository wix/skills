import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/config', () => ({
  getGateConfig: vi.fn(),
  BASE_WORKSPACE_SUBDIR: '.action-src',
}));

const upsertComment = vi.fn().mockResolvedValue(undefined);
const listTestScenarios = vi.fn().mockResolvedValue([]);
const listTestScenariosByTag = vi.fn().mockResolvedValue([]);
const createTestScenario = vi.fn().mockResolvedValue({ id: 'created-id' });
const updateTestScenario = vi.fn().mockResolvedValue(undefined);
const deleteTestScenario = vi.fn().mockResolvedValue(undefined);
const ensureSkillVersion = vi.fn();
const createAndRunEvalRun = vi.fn();

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({ rest: { pulls: {}, issues: {} }, paginate: vi.fn() })),
  context: { repo: { owner: 'wix', repo: 'skills' }, payload: {} },
}));

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return {
    ...actual,
    getFirstCommitAuthorEmail: vi.fn(),
    getChangedFiles: vi.fn(),
    makeCommenter: vi.fn(() => upsertComment),
    loadScenarios: vi.fn(),
    collectSkillFiles: vi.fn(),
    pollUntilDone: vi.fn(),
    EvalForgeClient: vi.fn().mockImplementation(() => ({
      listTestScenarios, listTestScenariosByTag, createTestScenario, updateTestScenario,
      deleteTestScenario, ensureSkillVersion, createAndRunEvalRun,
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
  agentId: 'agent',
  evalsGlob: 'yaml/wix-app-evals/**/*.{yml,yaml}',
  skillDir: 'skills/wix-app',
  referenceDir: 'references',
  ignoreGlobs: ['scripts/**'],
  broadImpactGlobs: ['SKILL.md'],
  maxScenarios: 25,
  blocking: true,
  owner: 'wix',
  repo: 'skills',
  repoFullName: 'wix/skills',
  prNumber: 42,
  headSha: 'abc1234deadbeef',
  versionLabel: 'pr-42-abc1234',
};

const strongScenario = (name: string, tags: string[]) => ({
  path: `yaml/wix-app-evals/${name}.yml`,
  scenario: {
    name, description: '', triggerPrompt: 'build a dashboard page', tags,
    assertions: [
      { type: 'skill_was_called' as const, skillNames: ['wix-app'] },
      { type: 'build_passed' as const, command: 'npm run build' },
      { type: 'llm_judge' as const, prompt: 'good?', minScore: 7 },
    ],
  },
});

const runMetrics = (overrides: Record<string, unknown> = {}) => ({
  status: 'completed',
  progress: 100,
  aggregateMetrics: {
    totalAssertions: 3, passed: 3, failed: 0, skipped: 0,
    errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0,
    ...overrides,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  const evalforge = await import('@wix/evalforge-core');
  vi.mocked(evalforge.getFirstCommitAuthorEmail).mockResolvedValue('dev@wix.com');
  vi.mocked(evalforge.getChangedFiles).mockResolvedValue([]);
  vi.mocked(evalforge.loadScenarios).mockReturnValue({ scenarios: new Map(), errors: [] });
  vi.mocked(evalforge.collectSkillFiles).mockReturnValue([{ path: 'SKILL.md', content: '# skill' }]);
  ensureSkillVersion.mockResolvedValue({ id: 'ver-1', capabilityId: 'cap', version: 'pr-42-abc1234' });
  createAndRunEvalRun.mockResolvedValue({ id: 'run-1', status: 'pending' });
  listTestScenarios.mockResolvedValue([]);
  listTestScenariosByTag.mockResolvedValue([]);
  createTestScenario.mockResolvedValue({ id: 'created-id' });
});

async function harness(configOverrides: Record<string, unknown> = {}) {
  const { getGateConfig } = await import('../src/utils/config');
  const coreModule = await import('@actions/core');
  const evalforge = await import('@wix/evalforge-core');
  const { runGate } = await import('../src/utils/gate-run');
  vi.mocked(getGateConfig).mockReturnValue({ ...CONFIG, ...configOverrides } as never);
  return { runGate, core: coreModule, evalforge };
}

describe('runGate — cheap exits before any EvalForge write', () => {
  it('exits without touching EvalForge when the PR author is not a @wix.com address', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockResolvedValue('outsider@gmail.com');
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(evalforge.EvalForgeClient).not.toHaveBeenCalled();
    expect(ensureSkillVersion).not.toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('fails on YAML load errors before creating any capability version', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map(),
      errors: [{ path: 'yaml/wix-app-evals/bad.yml', message: 'tags required' }],
    });
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(ensureSkillVersion).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('bad.yml'));
    expect(setFailedSpy).toHaveBeenCalled();
  });

  it('comments a no-op and exits when nothing gated changed', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'README.md', status: 'modified' },
    ]);
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(ensureSkillVersion).not.toHaveBeenCalled();
    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringMatching(/no gated changes/i));
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('skips the run entirely when the guard finds an uncovered tag', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/references/BACKEND_API.md', status: 'modified' },
    ]);
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(ensureSkillVersion).not.toHaveBeenCalled();
    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('backend-api'));
    expect(setFailedSpy).toHaveBeenCalled();
  });

  it('blocks a touched scenario below the quality bar without running anything', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'yaml/wix-app-evals/thin.yml', status: 'added' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['thin', {
        path: 'yaml/wix-app-evals/thin.yml',
        scenario: {
          name: 'thin', description: '', triggerPrompt: 'do a thing', tags: ['dashboard-page'],
          assertions: [{ type: 'skill_was_called' as const, skillNames: ['wix-app'] }],
        },
      }]]),
      errors: [],
    });

    await runGate();

    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('llm_judge'));
  });
});

describe('runGate — the happy path', () => {
  beforeEach(async () => {
    const evalforge = await import('@wix/evalforge-core');
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/references/DASHBOARD_PAGE.md', status: 'modified' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['covers', strongScenario('covers', ['dashboard-page'])]]),
      errors: [],
    });
    listTestScenariosByTag.mockResolvedValue([{ id: 'remote-id', name: 'covers', tags: ['dashboard-page'] }]);
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics() as never);
  });

  it('creates the PR skill version from the collected files', async () => {
    const { runGate } = await harness();

    await runGate();

    expect(ensureSkillVersion).toHaveBeenCalledWith(
      'cap', 'proj', 'pr-42-abc1234', 42, [{ path: 'SKILL.md', content: '# skill' }],
    );
  });

  // Only the entry file and the reference docs are the skill. An allowlist means a new stray
  // file under the skill dir never reaches the agent as skill guidance.
  it('uploads only SKILL.md and the reference docs', async () => {
    const { runGate, evalforge } = await harness();

    await runGate();

    expect(evalforge.collectSkillFiles).toHaveBeenCalledWith(
      expect.any(String), 'skills/wix-app',
      expect.objectContaining({ includeGlobs: ['SKILL.md', 'references/**'] }),
    );
  });

  it('derives the allowlist from reference-dir, not a hardcoded path', async () => {
    const { runGate, evalforge } = await harness({ referenceDir: 'docs' });
    // The changed path has to live under the configured reference dir, or it is unmapped and
    // the gate exits before collecting anything.
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/docs/DASHBOARD_PAGE.md', status: 'modified' },
    ]);

    await runGate();

    expect(evalforge.collectSkillFiles).toHaveBeenCalledWith(
      expect.any(String), 'skills/wix-app',
      expect.objectContaining({ includeGlobs: ['SKILL.md', 'docs/**'] }),
    );
  });

  it('runs the tag-selected scenario against that version and passes', async () => {
    const { runGate, core } = await harness();
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createAndRunEvalRun).toHaveBeenCalledWith('proj', expect.objectContaining({
      agentId: 'agent',
      scenarioIds: ['remote-id'],
      capabilityIds: ['cap'],
      capabilityVersions: { cap: 'pr-42-abc1234' },
    }));
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('✅'));
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('never passes filter.tag — scenario ids are explicit', async () => {
    const { runGate } = await harness();

    await runGate();

    expect(createAndRunEvalRun.mock.calls[0][1]).not.toHaveProperty('filter');
  });

  it('fails the check when assertions failed', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(
      runMetrics({ failed: 2, passed: 1, passRate: 33 }) as never,
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(setFailedSpy).toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('2 assertions failed'));
  });

  it('warns instead of failing when blocking is false', async () => {
    const { runGate, core, evalforge } = await harness({ blocking: false });
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(
      runMetrics({ failed: 1, passed: 2, passRate: 66 }) as never,
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    const warningSpy = vi.spyOn(core, 'warning');

    await runGate();

    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalled();
  });

  it('fails a run that produced no assertions, rather than reporting green', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(
      runMetrics({ totalAssertions: 0, passed: 0, passRate: 0 }) as never,
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringContaining('no assertions'));
  });

  it('comments a timeout when polling gives up', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.pollUntilDone).mockRejectedValue(
      new evalforge.EvalRunTimeoutError('Eval run timed out after 30 minutes'),
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringMatching(/timed out/i));
    expect(setFailedSpy).toHaveBeenCalled();
  });
});

describe('runGate — sync and selection', () => {
  it('CREATEs a scenario this PR added and includes the returned id in the run', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'yaml/wix-app-evals/fresh.yml', status: 'added' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['fresh', strongScenario('fresh', ['dashboard-page'])]]),
      errors: [],
    });
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics() as never);

    await runGate();

    expect(createTestScenario).toHaveBeenCalledTimes(1);
    expect(createAndRunEvalRun).toHaveBeenCalledWith('proj', expect.objectContaining({
      scenarioIds: ['created-id'],
    }));
  });

  it('keeps the semantic tags on the draft sync so the tag query still matches', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'yaml/wix-app-evals/fresh.yml', status: 'added' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['fresh', strongScenario('fresh', ['dashboard-page'])]]),
      errors: [],
    });
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics() as never);

    await runGate();

    expect(createTestScenario).toHaveBeenCalledWith(
      'proj', expect.anything(),
      expect.arrayContaining(['dashboard-page', 'draft:wix/skills#42']),
    );
  });

  it('aborts before the run when a scenario is held by another PR', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'yaml/wix-app-evals/held.yml', status: 'modified' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['held', strongScenario('held', ['dashboard-page'])]]),
      errors: [],
    });
    listTestScenarios.mockResolvedValue([{ id: 'id-1', name: 'held', tags: ['draft:wix/skills#99'] }]);
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('pull/99'));
    expect(setFailedSpy).toHaveBeenCalled();
  });

  it('does not start a run when selection resolves to no scenario ids', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/references/DASHBOARD_PAGE.md', status: 'modified' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['covers', strongScenario('covers', ['dashboard-page'])]]),
      errors: [],
    });
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    // A gate that verified nothing must not read as green.
    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringContaining('nothing was verified'));
  });

  it('aborts before the run when a sync action fails', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'yaml/wix-app-evals/fresh.yml', status: 'added' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['fresh', strongScenario('fresh', ['dashboard-page'])]]),
      errors: [],
    });
    createTestScenario.mockRejectedValueOnce(new Error('gateway down'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createAndRunEvalRun).not.toHaveBeenCalled();
    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringContaining('Sync failed'));
  });

  it('requests every scenario on broad impact rather than filtering by tag', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/SKILL.md', status: 'modified' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['covers', strongScenario('covers', ['dashboard-page'])]]),
      errors: [],
    });
    listTestScenarios.mockResolvedValue([{ id: 'remote-id', name: 'covers', tags: ['dashboard-page'] }]);
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics() as never);

    await runGate();

    expect(listTestScenarios).toHaveBeenCalledWith('proj');
    expect(createAndRunEvalRun).toHaveBeenCalledWith('proj', expect.objectContaining({
      scenarioIds: ['remote-id'],
    }));
  });
});
