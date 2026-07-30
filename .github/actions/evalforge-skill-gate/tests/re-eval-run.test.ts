import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReEvalConfig } from '../src/utils/config';

vi.mock('../src/utils/config', () => ({ getReEvalConfig: vi.fn() }));

const upsertComment = vi.fn().mockResolvedValue(undefined);
const getCollaboratorPermissionLevel = vi.fn();
const listWorkflowRuns = vi.fn();
const reRunWorkflow = vi.fn().mockResolvedValue(undefined);
const pullsGet = vi.fn();

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    rest: {
      pulls: { get: pullsGet },
      repos: { getCollaboratorPermissionLevel },
      actions: { listWorkflowRuns, reRunWorkflow },
      issues: {},
    },
    paginate: vi.fn(),
  })),
  context: {
    repo: { owner: 'wix', repo: 'skills' },
    // Reassigned per test via `setPayload`.
    payload: {} as Record<string, unknown>,
  },
}));

// The real formatters render, so the refusal copy under test is the copy that ships.
vi.mock('@wix/evalforge-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@wix/evalforge-core')>(),
  makeCommenter: vi.fn(() => upsertComment),
}));

const CONFIG: ReEvalConfig = {
  githubToken: 'gh-token',
  owner: 'wix',
  repo: 'skills',
  gateWorkflowFile: 'evalforge-wix-app-gate.yml',
};

const OPEN_PULL = {
  head: { sha: 'abc1234', repo: { full_name: 'wix/skills' } },
  user: { login: 'author' },
  state: 'open',
  draft: false,
};

const COMPLETED_RUN = {
  id: 555,
  status: 'completed',
  updated_at: new Date().toISOString(),
  html_url: 'https://github.com/wix/skills/actions/runs/555',
};

async function setPayload(comment: { body: string; login: string }): Promise<void> {
  const github = await import('@actions/github');
  github.context.payload = {
    issue: { number: 42, pull_request: { url: 'https://api.github.com/repos/wix/skills/pulls/42' } },
    comment: { id: 1, body: comment.body, user: { login: comment.login } },
  };
}

async function run(): Promise<void> {
  const { getReEvalConfig } = await import('../src/utils/config');
  vi.mocked(getReEvalConfig).mockReturnValue(CONFIG);
  const { runReEval } = await import('../src/utils/re-eval-run');
  await runReEval();
}

const refusal = (): string => upsertComment.mock.calls[0][0] as string;

beforeEach(async () => {
  vi.clearAllMocks();
  pullsGet.mockResolvedValue({ data: OPEN_PULL });
  listWorkflowRuns.mockResolvedValue({ data: { workflow_runs: [COMPLETED_RUN] } });
  await setPayload({ body: '/re-eval', login: 'author' });
});

describe('runReEval — the happy path', () => {
  it('re-runs the PR gate run and posts nothing', async () => {
    await run();

    expect(reRunWorkflow).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', run_id: 555 });
    expect(upsertComment).not.toHaveBeenCalled();
  });

  it('costs no permission lookup when the author asks', async () => {
    await run();

    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(reRunWorkflow).toHaveBeenCalled();
  });

  it('re-runs for a write collaborator who is not the author', async () => {
    await setPayload({ body: '/re-eval', login: 'maintainer' });
    getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'write' } });

    await run();

    expect(reRunWorkflow).toHaveBeenCalled();
  });
});

describe('runReEval — comments that are not the command', () => {
  // This is the mutation that matters: a loose parse turns ordinary PR conversation into a paid run.
  it('ignores a comment that merely mentions /re-eval, touching no API', async () => {
    await setPayload({ body: 'I think /re-eval is the fix here', login: 'author' });

    await run();

    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(listWorkflowRuns).not.toHaveBeenCalled();
    expect(upsertComment).not.toHaveBeenCalled();
  });
});

describe('runReEval — ineligible PRs', () => {
  it.each([
    ['closed', { ...OPEN_PULL, state: 'closed' }, /closed/],
    ['draft', { ...OPEN_PULL, draft: true }, /draft/],
    ['fork', { ...OPEN_PULL, head: { sha: 'abc1234', repo: { full_name: 'someone/skills' } } }, /fork/],
  ])('refuses a %s PR, naming why', async (_label, pull, expected) => {
    pullsGet.mockResolvedValue({ data: pull });

    await run();

    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(refusal()).toMatch(expected);
  });

  // Eligibility before authorisation, so an ineligible PR costs no API call.
  it('refuses a closed PR without looking up permissions or runs', async () => {
    pullsGet.mockResolvedValue({ data: { ...OPEN_PULL, state: 'closed' } });
    await setPayload({ body: '/re-eval', login: 'stranger' });

    await run();

    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('runReEval — authorisation', () => {
  beforeEach(async () => {
    await setPayload({ body: '/re-eval', login: 'stranger' });
  });

  it('refuses a read-only requester without looking up the run', async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'read' } });

    await run();

    expect(listWorkflowRuns).not.toHaveBeenCalled();
    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/write access/);
  });

  it('refuses and names the failure when the permission lookup 403s', async () => {
    getCollaboratorPermissionLevel.mockRejectedValue(new Error('Resource not accessible by integration'));

    await run();

    expect(refusal()).toContain('Resource not accessible by integration');
  });
});

describe('runReEval — run lookup', () => {
  it('refuses when no gate run exists for the commit', async () => {
    listWorkflowRuns.mockResolvedValue({ data: { workflow_runs: [] } });

    await run();

    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/no gate run exists/);
  });

  it('refuses and links the run when one is already in progress', async () => {
    listWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [{ ...COMPLETED_RUN, status: 'in_progress' }] },
    });

    await run();

    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/already in progress/);
    // A markdown link, not a bare URL: rendered mid-sentence, a trailing period would otherwise be
    // swallowed into the href.
    expect(refusal()).toContain('](https://github.com/wix/skills/actions/runs/555)');
    expect(refusal()).not.toMatch(/runs\/555\./);
  });

  it("refuses a run past GitHub's re-run window", async () => {
    listWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [{ ...COMPLETED_RUN, updated_at: '2020-01-01T00:00:00Z' }] },
    });

    await run();

    expect(reRunWorkflow).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/30-day/);
  });

  it('asks for the gate workflow named in the config', async () => {
    await run();

    expect(listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({
      workflow_id: 'evalforge-wix-app-gate.yml',
      head_sha: 'abc1234',
    }));
  });
});

describe('runReEval — a refusal is not a failed check', () => {
  it('never calls setFailed, whatever it declines', async () => {
    const core = await import('@actions/core');
    const setFailed = vi.spyOn(core, 'setFailed').mockImplementation(() => {});
    pullsGet.mockResolvedValue({ data: { ...OPEN_PULL, state: 'closed' } });

    await run();

    expect(setFailed).not.toHaveBeenCalled();
  });

  it('refuses under the re-eval marker, never the gate marker', async () => {
    const { RE_EVAL_COMMENT_MARKER, GATE_COMMENT_MARKER } = await import('@wix/evalforge-core');
    pullsGet.mockResolvedValue({ data: { ...OPEN_PULL, draft: true } });

    await run();

    // Upserting through the gate marker would overwrite the PR's last real verdict.
    expect(refusal()).toContain(RE_EVAL_COMMENT_MARKER);
    expect(refusal()).not.toContain(GATE_COMMENT_MARKER);
  });
});
