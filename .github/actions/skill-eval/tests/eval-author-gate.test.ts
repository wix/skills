import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../src/utils/config';

const getChangedFiles = vi.fn();

vi.mock('../src/utils/config', () => ({ getEvalConfig: vi.fn() }));
vi.mock('../src/utils/github', () => ({
  getChangedFiles,
  upsertComment: vi.fn(),
  fail: vi.fn(),
}));
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({ rest: { pulls: {} } })),
  context: { repo: { owner: 'wix', repo: 'skills' }, payload: {} },
}));

const CONFIG = {
  githubToken: 'gh-token',
  evalforgeUrl: 'https://ef.example.com',
  projectId: 'proj',
  agentId: 'agent',
  mcpId: 'mcp',
  appId: 'app',
  appSecret: 'secret',
  prNumber: 42,
  baseSha: 'base-sha',
  headSha: 'head-sha',
  owner: 'wix',
  repo: 'skills',
  authorAssociation: 'MEMBER',
  blocking: true,
} satisfies Config;

async function runWith(overrides: Partial<Config> = {}) {
  const { getEvalConfig } = await import('../src/utils/config');
  const { runEval } = await import('../src/utils/eval');
  vi.mocked(getEvalConfig).mockReturnValue({ ...CONFIG, ...overrides });
  return runEval;
}

beforeEach(() => {
  vi.clearAllMocks();
  getChangedFiles.mockResolvedValue([]);
});

/**
 * This action is disabled by `if: false` in its workflow, so the gate is here for
 * whoever re-enables it: an eval run costs a live agent build per scenario, and this
 * was the one entry point that spent without asking who the author was.
 */
describe('runEval — author gate', () => {
  it('refuses an outside author before reading a single changed file', async () => {
    const runEval = await runWith({ authorAssociation: 'NONE' });

    await expect(runEval()).rejects.toThrow(/not a member of the wix organization/);
    expect(getChangedFiles).not.toHaveBeenCalled();
  });

  it('lets an org member through to the changed-file lookup', async () => {
    const runEval = await runWith();

    await runEval();

    expect(getChangedFiles).toHaveBeenCalledOnce();
  });

});
