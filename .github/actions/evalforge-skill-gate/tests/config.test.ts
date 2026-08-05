import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function setInputs(inputs: Record<string, string>): void {
  for (const [name, value] of Object.entries(inputs)) {
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;
  }
}

const REQUIRED_GATE_INPUTS = {
  'github-token': 'gh-token',
  'evalforge-url': 'https://evalforge.example.com',
  'evalforge-project-id': 'proj',
  'evalforge-app-id': 'app',
  'evalforge-app-secret': 'secret',
  'evals-glob': 'yaml/wix-app-evals/**/*.{yml,yaml}',
  'capability-id': 'cap',
  'agent-id': 'agent',
  'skill-dir': 'skills/wix-app',
};

vi.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'wix', repo: 'skills' },
    payload: {
      pull_request: {
        number: 42,
        head: { sha: 'abc1234deadbeef' },
        base: { sha: 'base1234567890' },
      },
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key];
  }
  process.env.GITHUB_REPOSITORY = 'wix/skills';
  process.env.GITHUB_SHA = 'merge99feedface';
});

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('getGateConfig', () => {
  it('applies the documented defaults', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');

    const config = getGateConfig();

    expect(config.referenceDir).toBe('references');
    expect(config.ignoreGlobs).toEqual(['scripts/**']);
    expect(config.broadImpactGlobs).toEqual([
      'SKILL.md',
      'references/APP_IDENTIFIERS.md',
      'references/APP_MARKET_REVIEW.md',
      'references/APP_VALIDATION.md',
      'references/CODE_QUALITY.md',
      'references/DOCUMENTATION.md',
      'references/EXTENSION_REGISTRATION.md',
    ]);
    expect(config.maxScenarios).toBe(25);
    expect(config.isBlocking).toBe(false);
  });

  it('builds the version label from the evaluated merge commit, not the PR head', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    process.env.GITHUB_SHA = 'merge99feedface';
    const { getGateConfig } = await import('../src/utils/config');

    const config = getGateConfig();

    expect(config.prNumber).toBe(42);
    expect(config.headSha).toBe('abc1234deadbeef');
    expect(config.evaluatedSha).toBe('merge99feedface');
    expect(config.versionLabel).toBe('pr-42-merge99');
    expect(config.repoFullName).toBe('wix/skills');
  });

  it('keeps the pr-<n>- prefix so PR-close cleanup still sweeps the version', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    process.env.GITHUB_SHA = 'deadbeefcafe';
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().versionLabel.startsWith('pr-42-')).toBe(true);
  });

  it('throws rather than guessing when GITHUB_SHA is absent', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    delete process.env.GITHUB_SHA;
    const { getGateConfig } = await import('../src/utils/config');

    expect(() => getGateConfig()).toThrow(/GITHUB_SHA/);
  });

  it('parses multi-line glob inputs, trimming and dropping blanks', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'broad-impact-globs': '  SKILL.md \n\n  docs/README.md  \n' });
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().broadImpactGlobs).toEqual(['SKILL.md', 'docs/README.md']);
  });

  it('treats blocking: true as blocking and anything else as soaking', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, blocking: 'true' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().isBlocking).toBe(true);
  });

  it('does not treat a stray blocking value as blocking', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, blocking: 'yes' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().isBlocking).toBe(false);
  });

  it('rejects a non-positive max-scenarios rather than running an empty suite', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '0' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(() => getGateConfig()).toThrow(/max-scenarios/);
  });

  it('rejects a non-numeric max-scenarios', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': 'lots' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(() => getGateConfig()).toThrow(/max-scenarios/);
  });

  it('clamps a max-scenarios above the ceiling instead of throwing', async () => {
    // A throw here would fail the check even during the soak period: getGateConfig runs before
    // isBlocking is known.
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '100000' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning');
    const { getGateConfig, MAX_SCENARIOS_CEILING } = await import('../src/utils/config');

    expect(getGateConfig().maxScenarios).toBe(MAX_SCENARIOS_CEILING);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds the ceiling'));
  });

  it('leaves a max-scenarios at the ceiling alone', async () => {
    const { MAX_SCENARIOS_CEILING } = await import('../src/utils/config');
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': String(MAX_SCENARIOS_CEILING) });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().maxScenarios).toBe(MAX_SCENARIOS_CEILING);
  });

  it('falls back to the exported default when max-scenarios is blank', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '' });
    const { DEFAULT_MAX_SCENARIOS } = await import('@wix/evalforge-core');
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().maxScenarios).toBe(DEFAULT_MAX_SCENARIOS);
  });

  it('falls back to the default when a glob input is blank', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'ignore-globs': '   ' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().ignoreGlobs).toEqual(['scripts/**']);
  });

  it('upgrades a non-HTTPS evalforge-url', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'evalforge-url': 'http://evalforge.example.com' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().evalforgeUrl).toBe('https://evalforge.example.com');
  });

  it('throws when a required gate input is missing', async () => {
    const { 'skill-dir': _omitted, ...withoutSkillDir } = REQUIRED_GATE_INPUTS;
    setInputs(withoutSkillDir);
    const { getGateConfig } = await import('../src/utils/config');
    expect(() => getGateConfig()).toThrow(/skill-dir/);
  });
});

describe('getCleanupConfig', () => {
  it('reads only what cleanup needs, with no agent id or skill dir required', async () => {
    setInputs({
      'github-token': 'gh-token',
      'evalforge-url': 'https://evalforge.example.com',
      'evalforge-project-id': 'proj',
      'evalforge-app-id': 'app',
      'evalforge-app-secret': 'secret',
      'evals-glob': 'yaml/wix-app-evals/**/*.{yml,yaml}',
      'capability-id': 'cap',
    });
    const { getCleanupConfig } = await import('../src/utils/config');

    const config = getCleanupConfig();

    expect(config).toMatchObject({
      projectId: 'proj', capabilityId: 'cap', prNumber: 42, repoFullName: 'wix/skills',
    });
  });
});

describe('getGateConfig — the evaluated SHA', () => {
  // A re-run replays the original event, so GITHUB_SHA is the merge commit as it was then, while
  // actions/checkout resolves refs/pull/N/merge fresh. Labelling from the stale one would have
  // createOrReuseSkillVersion reuse a version whose content no longer matches its label.
  it('prefers the evaluated-sha input over GITHUB_SHA', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'evaluated-sha': 'fresh1234567' });
    process.env.GITHUB_SHA = 'staleaaa0000';
    const { getGateConfig } = await import('../src/utils/config');
    const config = getGateConfig();

    expect(config.evaluatedSha).toBe('fresh1234567');
    expect(config.versionLabel).toBe('pr-42-fresh12');
  });

  // The fallback stays for a caller that does not pass the input, but it is the pre-existing bug, so
  // it says so in the log rather than quietly mislabelling a re-run's version.
  it('falls back to GITHUB_SHA, warning that a re-run can mislabel', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    process.env.GITHUB_SHA = 'abcdef1234567';
    const actionsCore = await import('@actions/core');
    const warning = vi.spyOn(actionsCore, 'warning').mockImplementation(() => {});
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().versionLabel).toBe('pr-42-abcdef1');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('evaluated-sha'));
  });
});

describe('getGateConfig — comparison fields', () => {
  it('reads the base SHA for run traceability', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().baseSha).toMatch(/^base1234/);
  });

  it('throws when the payload has no base SHA rather than mislabelling a version', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const github = await import('@actions/github');
    const pullRequest = github.context.payload.pull_request as { base?: { sha?: string } };
    const originalBase = pullRequest.base;
    delete pullRequest.base;
    try {
      const { getGateConfig } = await import('../src/utils/config');
      expect(() => getGateConfig()).toThrow(/base\.sha/);
    } finally {
      pullRequest.base = originalBase;
    }
  });

  it('generates a comparisonGroupId shaped like a UUID v4', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().comparisonGroupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates a different comparisonGroupId on each call, so re-running a PR cannot accumulate '
    + 'runs into the same EvalForge comparison group', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');
    const first = getGateConfig();
    const second = getGateConfig();
    expect(first.comparisonGroupId).not.toBe(second.comparisonGroupId);
  });

  it('defaults runsPerScenario to 1', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().runsPerScenario).toBe(1);
  });

  it('clamps runsPerScenario to the API maximum of 20 with a warning', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'runs-per-scenario': '50' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { getGateConfig, MAX_RUNS_PER_SCENARIO } = await import('../src/utils/config');

    expect(getGateConfig().runsPerScenario).toBe(MAX_RUNS_PER_SCENARIO);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('20'));
  });

  // Finding 2: `getGateConfig` runs before `isBlocking` is known, so a throw here would fail the
  // check even during the soak period — the gate's own promise. This test used to pin that
  // throw; it now pins the fix: an invalid value falls back to the default with a warning,
  // exactly like `getMaxScenarios` already did for "exceeds the ceiling".
  it('falls back a non-positive runsPerScenario to the default, with a warning, instead of throwing', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'runs-per-scenario': '0' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { DEFAULT_RUNS_PER_SCENARIO } = await import('@wix/evalforge-core');
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().runsPerScenario).toBe(DEFAULT_RUNS_PER_SCENARIO);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('runs-per-scenario'));
  });

  it('falls back a non-numeric runsPerScenario to the default, with a warning', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'runs-per-scenario': 'lots' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { DEFAULT_RUNS_PER_SCENARIO } = await import('@wix/evalforge-core');
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().runsPerScenario).toBe(DEFAULT_RUNS_PER_SCENARIO);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('runs-per-scenario'));
  });

  it('defaults baseArmGraceMs to 60 seconds, in milliseconds', async () => {
    setInputs(REQUIRED_GATE_INPUTS);
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().baseArmGraceMs).toBe(60_000);
  });

  it('converts base-arm-grace-seconds to milliseconds', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'base-arm-grace-seconds': '5' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().baseArmGraceMs).toBe(5_000);
  });

  it('clamps base-arm-grace-seconds above the ceiling of 300 with a warning', async () => {
    // A throw here would fail the check even during the soak period, the same reason
    // getMaxScenarios clamps rather than throws.
    setInputs({ ...REQUIRED_GATE_INPUTS, 'base-arm-grace-seconds': '1000' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { getGateConfig, MAX_BASE_ARM_GRACE_SECONDS } = await import('../src/utils/config');

    expect(MAX_BASE_ARM_GRACE_SECONDS).toBe(300);
    expect(getGateConfig().baseArmGraceMs).toBe(MAX_BASE_ARM_GRACE_SECONDS * 1_000);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds the ceiling'));
  });

  // Finding 2: `0` is a deliberate, legitimate value for the grace — "don't wait for the base arm
  // at all" — not a misconfiguration. This test used to pin a throw for it; it now pins the
  // decision that 0 is accepted outright, with no warning.
  it('accepts a base-arm-grace-seconds of 0 as "do not wait for the base arm", without a warning', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'base-arm-grace-seconds': '0' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().baseArmGraceMs).toBe(0);
    // Unrelated to the input under test: REQUIRED_GATE_INPUTS omits evaluated-sha, which always
    // warns on its own GITHUB_SHA fallback (see "falls back to GITHUB_SHA" below).
    expect(warningSpy).not.toHaveBeenCalledWith(expect.stringContaining('base-arm-grace-seconds'));
  });

  it('falls back a negative base-arm-grace-seconds to the default, with a warning', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'base-arm-grace-seconds': '-5' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { DEFAULT_BASE_ARM_GRACE_SECONDS } = await import('@wix/evalforge-core');
    const { getGateConfig } = await import('../src/utils/config');

    expect(getGateConfig().baseArmGraceMs).toBe(DEFAULT_BASE_ARM_GRACE_SECONDS * 1_000);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('base-arm-grace-seconds'));
  });
});

describe('getGateConfig — total scenario execution ceiling (Finding 8)', () => {
  it('leaves runsPerScenario alone when the product stays under the ceiling', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '25', 'runs-per-scenario': '1' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().runsPerScenario).toBe(1);
  });

  it('clamps runsPerScenario down when maxScenarios × runsPerScenario × 2 would exceed the ceiling', async () => {
    // 100 scenarios × 20 runs × 2 arms = 4000, both inputs individually valid and at their own
    // ceiling — this is exactly the unbounded-cost case the per-input ceilings do not catch.
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '100', 'runs-per-scenario': '20' });
    const core = await import('@actions/core');
    const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
    const { getGateConfig, MAX_TOTAL_SCENARIO_EXECUTIONS } = await import('../src/utils/config');

    const config = getGateConfig();
    expect(config.maxScenarios * config.runsPerScenario * 2).toBeLessThanOrEqual(MAX_TOTAL_SCENARIO_EXECUTIONS);
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds the ceiling'));
  });

  it('never clamps runsPerScenario below 1', async () => {
    setInputs({ ...REQUIRED_GATE_INPUTS, 'max-scenarios': '100', 'runs-per-scenario': '1' });
    const { getGateConfig } = await import('../src/utils/config');
    expect(getGateConfig().runsPerScenario).toBeGreaterThanOrEqual(1);
  });
});
