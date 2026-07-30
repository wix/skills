import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

/**
 * The re-eval logic ships as a string inside `evalforge-re-eval.yml`, because an `issue_comment`
 * workflow runs from the default branch and a `github-script` step needs no build. That does not
 * make it untestable: `github-script` runs the `script:` input by compiling exactly that string into
 * an async function with `github`, `context` and `core` in scope, so these tests do the same.
 *
 * The guards are therefore exercised as the artifact that ships. Reformatting the script is
 * invisible to this suite; inverting a condition, dropping a `return` before a `decline`, or
 * re-running a run that cannot produce a verdict is not.
 */
const AsyncFunction = Object.getPrototypeOf(async function noop() { /* shape only */ }).constructor as
  new (...argumentNames: string[]) => (
    github: unknown, context: unknown, core: unknown,
  ) => Promise<unknown>;

const RE_EVAL_SCRIPT = (() => {
  const workflow = yaml.load(
    readFileSync(join(__dirname, '../../../workflows/evalforge-re-eval.yml'), 'utf8'),
  ) as { jobs: Record<string, { steps: Array<{ with?: { script?: string } }> }> };
  const steps = workflow.jobs['re-eval'].steps;
  const script = steps[steps.length - 1].with?.script;
  if (!script) throw new Error('evalforge-re-eval.yml has no github-script step to compile');
  return script;
})();

type WorkflowRun = { id: number; status: string; conclusion: string | null; html_url: string };

type PullRequest = {
  state: string;
  draft: boolean;
  user: { login: string };
  head: { sha: string; repo: { full_name: string } | null };
};

const PR_AUTHOR = 'pr-author';

const OPEN_PR: PullRequest = {
  state: 'open',
  draft: false,
  user: { login: PR_AUTHOR },
  head: { sha: 'abc1234def5678', repo: { full_name: 'wix/skills' } },
};

const FAILED_RUN: WorkflowRun = {
  id: 900,
  status: 'completed',
  conclusion: 'failure',
  html_url: 'https://github.com/wix/skills/actions/runs/900',
};

const run = (overrides: Partial<WorkflowRun>): WorkflowRun => ({ ...FAILED_RUN, ...overrides });

function harness(options: {
  body?: string;
  requester?: string;
  pull?: Partial<PullRequest>;
  level?: { permission: string; role_name: string };
  levelError?: Error;
  runs?: WorkflowRun[];
  rerunError?: Error;
} = {}) {
  const comments: string[] = [];
  const rerunIds: number[] = [];
  const runQueries: Array<Record<string, unknown>> = [];
  const pull = { ...OPEN_PR, ...options.pull };

  const pullsGet = vi.fn(async () => ({ data: pull }));
  const getCollaboratorPermissionLevel = vi.fn(async () => {
    if (options.levelError) throw options.levelError;
    // Default to a read-only account, so a test that means to authorise has to say so.
    return { data: options.level ?? { permission: 'read', role_name: 'read' } };
  });
  const listWorkflowRuns = vi.fn(async (query: Record<string, unknown>) => {
    runQueries.push(query);
    return { data: { workflow_runs: options.runs ?? [FAILED_RUN] } };
  });
  const reRunWorkflow = vi.fn(async ({ run_id }: { run_id: number }) => {
    if (options.rerunError) throw options.rerunError;
    rerunIds.push(run_id);
  });

  const github = {
    rest: {
      issues: {
        createComment: vi.fn(async ({ body }: { body: string }) => { comments.push(body); }),
      },
      pulls: { get: pullsGet },
      repos: { getCollaboratorPermissionLevel },
      actions: { listWorkflowRuns, reRunWorkflow },
    },
  };
  const core = { info: vi.fn(), warning: vi.fn(), setFailed: vi.fn() };
  const context = {
    repo: { owner: 'wix', repo: 'skills' },
    payload: {
      issue: { number: 42, pull_request: {} },
      comment: {
        body: options.body ?? '/re-eval',
        user: { login: options.requester ?? PR_AUTHOR },
      },
    },
  };

  return {
    comments,
    rerunIds,
    runQueries,
    core,
    pullsGet,
    getCollaboratorPermissionLevel,
    reRunWorkflow,
    execute: () => new AsyncFunction('github', 'context', 'core', RE_EVAL_SCRIPT)(github, context, core),
  };
}

describe('the /re-eval command parse', () => {
  // The `if:` on the job is a loose `contains`, so every comment naming the command reaches this
  // script. It is the strict parse that decides whether a live agent build gets paid for.
  it.each([
    ['the bare command', '/re-eval'],
    ['trailing words', '/re-eval please, the poll 403d'],
    ['any case', '/RE-Eval'],
    ['leading blank lines', '\n\n  /re-eval\n'],
    ['a CRLF line ending', '/re-eval\r\nthanks'],
  ])('acts on %s', async (_label, body) => {
    const test = harness({ body });
    await test.execute();

    expect(test.rerunIds).toEqual([FAILED_RUN.id]);
  });

  it.each([
    ['mid-sentence use', 'I think we should /re-eval this one'],
    ['a quoted retry note', '> Comment `/re-eval` to run the gate again, or push a new commit.'],
    ['a longer token', '/re-evaluate the scenario'],
    ['an empty body', ''],
    ['the command on a later line', 'context first\n/re-eval'],
  ])('ignores %s without touching the API', async (_label, body) => {
    const test = harness({ body });
    await test.execute();

    expect(test.pullsGet).not.toHaveBeenCalled();
    expect(test.rerunIds).toEqual([]);
    expect(test.comments).toEqual([]);
  });
});

describe('the states the gate excludes in its own workflow if:', () => {
  it('declines a closed PR, naming the sweep that already happened', async () => {
    const test = harness({ pull: { state: 'closed' } });
    await test.execute();

    expect(test.comments[0]).toContain('closed');
    expect(test.rerunIds).toEqual([]);
  });

  it('declines a draft, pointing at ready-for-review instead', async () => {
    const test = harness({ pull: { draft: true } });
    await test.execute();

    expect(test.comments[0]).toMatch(/draft/);
    expect(test.comments[0]).toContain('ready for review');
    expect(test.rerunIds).toEqual([]);
  });

  it('declines a fork branch', async () => {
    const test = harness({ pull: { head: { sha: 'abc1234def5678', repo: { full_name: 'someone/skills' } } } });
    await test.execute();

    expect(test.comments[0]).toContain('fork');
    expect(test.rerunIds).toEqual([]);
  });

  it('declines a PR whose head repo is missing rather than throwing', async () => {
    const test = harness({ pull: { head: { sha: 'abc1234def5678', repo: null } } });
    await test.execute();

    expect(test.comments[0]).toContain('fork');
    expect(test.core.setFailed).not.toHaveBeenCalled();
  });
});

/**
 * Authorisation here is a spend gate, not a security boundary — nothing is checked out and the run
 * replays an event that already happened. But the repo is public and every scenario is a live agent
 * build, so it has to fail closed.
 */
describe('who may spend', () => {
  it('lets the PR author through without an API call', async () => {
    const test = harness({ requester: PR_AUTHOR });
    await test.execute();

    expect(test.getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(test.rerunIds).toEqual([FAILED_RUN.id]);
  });

  it.each([
    ['admin', { permission: 'admin', role_name: 'admin' }],
    ['write', { permission: 'write', role_name: 'write' }],
    // Today the maintain role reports as `write` in the legacy `permission` field and by name in
    // `role_name`. Both spellings are accepted, so neither field alone carries the decision — the
    // last two cases pin each branch.
    ['maintain', { permission: 'write', role_name: 'maintain' }],
    ['a custom role, which only `permission` collapses to write', { permission: 'write', role_name: 'deployer' }],
    ['a role named only by `role_name`', { permission: 'read', role_name: 'maintain' }],
  ])('lets a collaborator with %s through', async (_label, level) => {
    const test = harness({ requester: 'someone-else', level });
    await test.execute();

    expect(test.rerunIds).toEqual([FAILED_RUN.id]);
  });

  it.each([
    ['read', { permission: 'read', role_name: 'read' }],
    ['triage', { permission: 'read', role_name: 'triage' }],
    ['none', { permission: 'none', role_name: 'none' }],
  ])('refuses a collaborator with %s', async (_label, level) => {
    const test = harness({ requester: 'someone-else', level });
    await test.execute();

    expect(test.comments[0]).toContain('only the PR author or a collaborator with write access');
    expect(test.rerunIds).toEqual([]);
  });

  it('fails closed when the permission lookup errors, quoting why', async () => {
    const test = harness({ requester: 'someone-else', levelError: new Error('403 Forbidden') });
    await test.execute();

    expect(test.comments[0]).toContain('403 Forbidden');
    expect(test.rerunIds).toEqual([]);
    // A refused request is the system working, not a broken check.
    expect(test.core.setFailed).not.toHaveBeenCalled();
  });
});

describe('finding the run to re-run', () => {
  it('asks only for the wix-app gate, the PR trigger, and this head sha', async () => {
    const test = harness();
    await test.execute();

    expect(test.runQueries).toEqual([
      expect.objectContaining({
        workflow_id: 'evalforge-wix-app-gate.yml',
        event: 'pull_request',
        head_sha: OPEN_PR.head.sha,
        per_page: 1,
      }),
    ]);
  });

  it('declines when no gate run exists, naming the wix-manage scope gap', async () => {
    const test = harness({ runs: [] });
    await test.execute();

    expect(test.comments[0]).toContain('no wix-app gate run exists');
    expect(test.comments[0]).toContain('wix-manage');
    expect(test.rerunIds).toEqual([]);
  });
});

describe('what gets re-run', () => {
  /**
   * The reason clay's `#rerun` shape was not adopted: it skips passing runs and re-runs only failed
   * jobs. In soak mode an unverified run still reports success, so the run worth re-running is green
   * and contains no failed job — exactly the #773 case this command exists for.
   */
  it.each(['success', 'failure', 'cancelled', 'timed_out', null])(
    're-runs a completed run whose conclusion is %s',
    async (conclusion) => {
      const test = harness({ runs: [run({ conclusion })] });
      await test.execute();

      expect(test.rerunIds).toEqual([FAILED_RUN.id]);
    },
  );

  it('acknowledges with the short sha, the requester and the run link', async () => {
    const test = harness();
    await test.execute();

    expect(test.comments).toHaveLength(1);
    expect(test.comments[0]).toContain('Re-running the eval gate');
    expect(test.comments[0]).toContain('abc1234');
    expect(test.comments[0]).toContain(`@${PR_AUTHOR}`);
    expect(test.comments[0]).toContain(FAILED_RUN.html_url);
  });

  it('leaves an in-progress run alone', async () => {
    const test = harness({ runs: [run({ status: 'in_progress', conclusion: null })] });
    await test.execute();

    expect(test.rerunIds).toEqual([]);
    expect(test.comments[0]).toContain('already in progress');
  });

  // A re-run replays the original event, so a job its own `if:` skipped skips again.
  it('does not re-run a skipped run, and says a commit is needed', async () => {
    const test = harness({ runs: [run({ conclusion: 'skipped' })] });
    await test.execute();

    expect(test.rerunIds).toEqual([]);
    expect(test.comments[0]).toContain('Push a commit');
  });

  it('reports a rerun that GitHub refuses without failing the job', async () => {
    const test = harness({ rerunError: new Error('Unable to re-run: 30 day limit') });
    await test.execute();

    expect(test.comments[0]).toContain('30 day limit');
    expect(test.comments[0]).toContain('push a commit');
    expect(test.core.setFailed).not.toHaveBeenCalled();
  });

  // The heading is the only part most requesters read, so it must not claim a re-run that the
  // notes below it then contradict.
  it.each([
    ['an in-progress run', { runs: [run({ status: 'in_progress', conclusion: null })] }],
    ['a skipped run', { runs: [run({ conclusion: 'skipped' })] }],
    ['a rerun GitHub refused', { rerunError: new Error('past the 30 day limit') }],
  ])('does not claim to be re-running given %s', async (_label, options) => {
    const test = harness(options);
    await test.execute();

    expect(test.comments[0]).toContain('Nothing to re-run');
    expect(test.comments[0]).not.toContain('Re-running the eval gate');
  });
});
