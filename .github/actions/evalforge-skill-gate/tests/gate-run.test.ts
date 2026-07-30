import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalRunStatus } from '@wix/evalforge-core';
import type { GateConfig } from '../src/utils/config';

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
const createOrReuseSkillVersion = vi.fn();
const createAndRunEvalRun = vi.fn();

// pulls.get is real: with a bare `{}` the call threw a TypeError that isDraftTagActive's catch
// swallowed into `true`, so the FOREIGN_DRAFT tests below passed via the error path rather than
// via a genuinely open PR.
const pullsGet = vi.fn().mockResolvedValue({ data: { state: 'open' } });

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({ rest: { pulls: { get: pullsGet }, issues: {} }, paginate: vi.fn() })),
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
      deleteTestScenario, createOrReuseSkillVersion, createAndRunEvalRun,
    })),
  };
});

const CONFIG: GateConfig = {
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
  isBlocking: true,
  owner: 'wix',
  repo: 'skills',
  repoFullName: 'wix/skills',
  prNumber: 42,
  headSha: 'abc1234deadbeef',
  evaluatedSha: 'merge99feedface',
  versionLabel: 'pr-42-merge99',
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

const runMetrics = (
  overrides: Partial<EvalRunStatus['aggregateMetrics']> = {},
): EvalRunStatus => ({
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
  createOrReuseSkillVersion.mockResolvedValue({ id: 'ver-1', capabilityId: 'cap', version: 'pr-42-merge99' });
  createAndRunEvalRun.mockResolvedValue({ id: 'run-1', status: 'pending' });
  listTestScenarios.mockResolvedValue([]);
  listTestScenariosByTag.mockResolvedValue([]);
  createTestScenario.mockResolvedValue({ id: 'created-id' });
});

async function harness(configOverrides: Partial<GateConfig> = {}) {
  const { getGateConfig } = await import('../src/utils/config');
  const coreModule = await import('@actions/core');
  const evalforge = await import('@wix/evalforge-core');
  const { runGate } = await import('../src/utils/gate-run');
  vi.mocked(getGateConfig).mockReturnValue({ ...CONFIG, ...configOverrides });
  return { runGate, core: coreModule, evalforge };
}

describe('runGate — cheap exits before any EvalForge write', () => {
  it('exits without touching EvalForge when the PR author is not a @wix.com address', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockResolvedValue('outsider@gmail.com');
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(evalforge.EvalForgeClient).not.toHaveBeenCalled();
    expect(createOrReuseSkillVersion).not.toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('skips rather than fails when the author lookup itself errors', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockRejectedValue(new Error('Bad credentials'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');
    const warningSpy = vi.spyOn(core, 'warning');

    await runGate();

    expect(evalforge.EvalForgeClient).not.toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('could not resolve the PR author'));
  });

  it('skips on an author lookup error even when blocking is on', async () => {
    const { runGate, core, evalforge } = await harness({ isBlocking: true });
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockRejectedValue(new Error('502'));
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it('comments on skip, so a green check is not mistaken for a pass', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockResolvedValue('outsider@gmail.com');

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringMatching(/\*\*not evaluated\*\*/));
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('not a wix author'));
  });

  it('comments on skip when the lookup breaks too', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getFirstCommitAuthorEmail).mockRejectedValue(new Error('Bad credentials'));

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('could not resolve the PR author'));
  });

  it('fails on YAML load errors before creating any capability version', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map(),
      errors: [{ path: 'yaml/wix-app-evals/bad.yml', message: 'tags required' }],
    });
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createOrReuseSkillVersion).not.toHaveBeenCalled();
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

    expect(createOrReuseSkillVersion).not.toHaveBeenCalled();
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

    expect(createOrReuseSkillVersion).not.toHaveBeenCalled();
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
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics());
  });

  it('creates the PR skill version from the collected files', async () => {
    const { runGate } = await harness();

    await runGate();

    expect(createOrReuseSkillVersion).toHaveBeenCalledWith(
      'cap', 'proj', 'pr-42-merge99', 42, [{ path: 'SKILL.md', content: '# skill' }],
    );
  });

  it('collects from the configured skill dir', async () => {
    const { runGate, evalforge } = await harness({ skillDir: 'packages/other-skill' });
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'packages/other-skill/references/DASHBOARD_PAGE.md', status: 'modified' },
    ]);

    await runGate();

    const [collectRoot, collectDir] = vi.mocked(evalforge.collectSkillFiles).mock.calls[0];
    expect(collectDir).toBe('packages/other-skill');
    expect(collectRoot).toEqual(expect.any(String));
  });

  it('runs the tag-selected scenario against that version and passes', async () => {
    const { runGate, core } = await harness();
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(createAndRunEvalRun).toHaveBeenCalledWith('proj', expect.objectContaining({
      agentId: 'agent',
      scenarioIds: ['remote-id'],
      capabilityIds: ['cap'],
      capabilityVersions: { cap: 'ver-1' },
    }));
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('✅'));
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  // The evaluator resolves capabilityVersions by version id; passing the label makes it 400
  // and the run fails with zero assertions.
  it('pins the capability version by id, not by label', async () => {
    const { runGate } = await harness();

    await runGate();

    const input = createAndRunEvalRun.mock.calls[0][1];
    expect(input.capabilityVersions).toEqual({ cap: 'ver-1' });
    expect(Object.values(input.capabilityVersions)).not.toContain('pr-42-merge99');
  });

  it('never passes filter.tag — scenario ids are explicit', async () => {
    const { runGate } = await harness();

    await runGate();

    expect(createAndRunEvalRun.mock.calls[0][1]).not.toHaveProperty('filter');
  });

  it('fails the check when assertions failed', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(
      runMetrics({ failed: 2, passed: 1, passRate: 33 }),
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    expect(setFailedSpy).toHaveBeenCalled();
    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('2 assertions failed'));
  });

  it('warns instead of failing when blocking is false', async () => {
    const { runGate, core, evalforge } = await harness({ isBlocking: false });
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(
      runMetrics({ failed: 1, passed: 2, passRate: 66 }),
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
      runMetrics({ totalAssertions: 0, passed: 0, passRate: 0 }),
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

  // Seen on #773: polling died on a 403 after the run had been going six minutes, and the comment
  // named no run at all — the cost was paid and the result was unreachable from the PR.
  it('links the run when polling fails for any other reason', async () => {
    const { runGate, core, evalforge } = await harness();
    vi.mocked(evalforge.pollUntilDone).mockRejectedValue(
      new Error('EvalForge GET /v1/projects/proj/eval-runs/run-1 → 403: '),
    );
    const setFailedSpy = vi.spyOn(core, 'setFailed');

    await runGate();

    const body = upsertComment.mock.calls.at(-1)?.[0] as string;
    expect(body).toContain('run-1');
    expect(body).toContain(evalforge.evalRunUrl('proj', 'run-1'));
    expect(body).toContain('403');
    expect(setFailedSpy).toHaveBeenCalledWith(expect.stringContaining('403'));
  });
});

describe('runGate — failure comments name their stage', () => {
  // They all used to render the same bare "Service Error", so a reader could not tell which stage
  // broke without reading the body.
  beforeEach(async () => {
    const evalforge = await import('@wix/evalforge-core');
    vi.mocked(evalforge.getChangedFiles).mockResolvedValue([
      { filename: 'skills/wix-app/references/DASHBOARD_PAGE.md', status: 'modified' },
    ]);
    vi.mocked(evalforge.loadScenarios).mockReturnValue({
      scenarios: new Map([['covers', strongScenario('covers', ['dashboard-page'])]]),
      errors: [],
    });
  });

  it('heads a GitHub lookup failure differently from an EvalForge outage', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.getChangedFiles).mockRejectedValue(new Error('Bad credentials'));

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('GitHub Lookup Failed'));
  });

  it('heads a failed version creation as such', async () => {
    const { runGate } = await harness();
    createOrReuseSkillVersion.mockRejectedValue(new Error('409 conflict'));

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('Version Not Created'));
  });

  it('heads an unreachable EvalForge as such', async () => {
    const { runGate } = await harness();
    listTestScenariosByTag.mockRejectedValue(new Error('ECONNRESET'));

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('EvalForge Unreachable'));
  });

  it('heads an unreadable skill directory as such', async () => {
    const { runGate, evalforge } = await harness();
    vi.mocked(evalforge.collectSkillFiles).mockImplementation(() => {
      throw new Error('EACCES');
    });

    await runGate();

    expect(upsertComment).toHaveBeenCalledWith(expect.stringContaining('Skill Content Unreadable'));
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
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics());

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
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics());

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
    vi.mocked(evalforge.pollUntilDone).mockResolvedValue(runMetrics());

    await runGate();

    expect(listTestScenarios).toHaveBeenCalledWith('proj');
    expect(createAndRunEvalRun).toHaveBeenCalledWith('proj', expect.objectContaining({
      scenarioIds: ['remote-id'],
    }));
  });
});
