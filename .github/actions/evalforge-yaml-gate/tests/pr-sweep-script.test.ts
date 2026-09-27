import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

/**
 * The authorize step ships as a string inside `evalforge-pr-sweep.yml`. `github-script` runs the
 * `script:` input by compiling exactly that string into an async function with `github`, `context`
 * and `core` in scope, so these tests do the same — the spend gate is exercised as the artifact
 * that ships.
 */
const AsyncFunction = Object.getPrototypeOf(async function noop() { /* shape only */ }).constructor as
  new (...argumentNames: string[]) => (github: unknown, context: unknown, core: unknown) => Promise<unknown>;

const SCRIPT = (() => {
  const workflow = yaml.load(
    readFileSync(join(__dirname, '../../../workflows/evalforge-pr-sweep.yml'), 'utf8'),
  ) as { jobs: Record<string, { steps: Array<{ with?: { script?: string } }> }> };
  const steps = workflow.jobs.authorize.steps;
  const script = steps[steps.length - 1].with?.script;
  if (!script) throw new Error('evalforge-pr-sweep.yml has no github-script step to compile');
  return script;
})();

type PullRequest = {
  number: number;
  state: string;
  draft: boolean;
  user: { login: string };
  head: { sha: string; repo: { full_name: string } | null };
  base: { sha: string };
};

const PR_AUTHOR = 'pr-author';
const OPEN_PR: PullRequest = {
  number: 42,
  state: 'open',
  draft: false,
  user: { login: PR_AUTHOR },
  head: { sha: 'abc1234def5678', repo: { full_name: 'wix/skills' } },
  base: { sha: 'base9876543210' },
};

function harness(options: {
  body?: string;
  requester?: string;
  pull?: Partial<PullRequest>;
  level?: { permission: string; role_name: string };
  levelError?: Error;
} = {}) {
  const comments: string[] = [];
  const outputs: Record<string, string> = {};
  const pull = { ...OPEN_PR, ...options.pull };

  const pullsGet = vi.fn(async () => ({ data: pull }));
  const getCollaboratorPermissionLevel = vi.fn(async () => {
    if (options.levelError) throw options.levelError;
    // Default to a read-only account, so a test that means to authorise has to say so.
    return { data: options.level ?? { permission: 'read', role_name: 'read' } };
  });

  const github = {
    rest: {
      issues: { createComment: vi.fn(async ({ body }: { body: string }) => { comments.push(body); }) },
      pulls: { get: pullsGet },
      repos: { getCollaboratorPermissionLevel },
    },
  };
  const core = {
    info: vi.fn(), warning: vi.fn(), setFailed: vi.fn(),
    setOutput: vi.fn((name: string, value: string) => { outputs[name] = value; }),
  };
  const context = {
    repo: { owner: 'wix', repo: 'skills' },
    serverUrl: 'https://github.com',
    runId: 777,
    payload: {
      issue: { number: 42, pull_request: {} },
      comment: { body: options.body ?? '/sweep', user: { login: options.requester ?? PR_AUTHOR } },
    },
  };

  return {
    comments, outputs, core, pullsGet, getCollaboratorPermissionLevel,
    execute: () => new AsyncFunction('github', 'context', 'core', SCRIPT)(github, context, core),
  };
}

describe('the command parse', () => {
  it.each([
    ['the bare command', '/sweep'],
    ['trailing words', '/sweep please'],
    ['any case', '/SWEEP'],
    ['leading blank lines', '\n\n  /sweep\n'],
    ['a CRLF line ending', '/sweep\r\nthanks'],
  ])('acts on %s', async (_label, body) => {
    const test = harness({ body });
    await test.execute();
    expect(test.outputs.allowed).toBe('true');
  });

  it.each([
    ['mid-sentence use', 'we should /sweep this one'],
    ['a quoted note', '> Comment `/sweep` to run the sweep.'],
    ['a longer token', '/sweeper please'],
    ['an empty body', ''],
    ['the command on a later line', 'context first\n/sweep'],
  ])('ignores %s without touching the API', async (_label, body) => {
    const test = harness({ body });
    await test.execute();
    expect(test.pullsGet).not.toHaveBeenCalled();
    expect(test.outputs).toEqual({});
    expect(test.comments).toEqual([]);
  });
});

describe('the states the gates exclude in their own workflow if:', () => {
  it.each([
    ['a closed PR', { state: 'closed' }, 'closed'],
    ['a draft PR', { draft: true }, 'draft'],
    ['a fork PR', { head: { sha: 'abc1234def5678', repo: { full_name: 'someone/skills' } } }, 'fork'],
    ['a PR whose head repo is gone', { head: { sha: 'abc1234def5678', repo: null } }, 'fork'],
  ])('declines %s', async (_label, pull, word) => {
    const test = harness({ pull });
    await test.execute();
    expect(test.comments).toHaveLength(1);
    expect(test.comments[0]).toContain(word);
    expect(test.outputs.allowed).toBeUndefined();
    // Declining is the system working, never a failed check.
    expect(test.core.setFailed).not.toHaveBeenCalled();
  });
});

describe('the spend gate', () => {
  it('lets the PR author through without a permission lookup', async () => {
    const test = harness({ requester: PR_AUTHOR });
    await test.execute();
    expect(test.getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(test.outputs.allowed).toBe('true');
  });

  it.each([
    ['admin', { permission: 'admin', role_name: 'admin' }],
    ['write', { permission: 'write', role_name: 'write' }],
    ['maintain, which the legacy field collapses to write', { permission: 'write', role_name: 'maintain' }],
    ['a custom role with push access reported only under role_name', { permission: 'read', role_name: 'write' }],
  ])('lets a collaborator with %s through', async (_label, level) => {
    const test = harness({ requester: 'someone-else', level });
    await test.execute();
    expect(test.outputs.allowed).toBe('true');
  });

  it.each([
    ['read', { permission: 'read', role_name: 'read' }],
    ['triage, which the legacy field collapses to read', { permission: 'read', role_name: 'triage' }],
    ['none', { permission: 'none', role_name: 'none' }],
  ])('declines a requester with %s', async (_label, level) => {
    const test = harness({ requester: 'stranger', level });
    await test.execute();
    expect(test.outputs.allowed).toBeUndefined();
    expect(test.comments[0]).toContain('write access');
  });

  it('declines when the permission lookup fails, rather than treating the error as access', async () => {
    const test = harness({ requester: 'stranger', levelError: new Error('Not Found') });
    await test.execute();
    expect(test.outputs.allowed).toBeUndefined();
    expect(test.comments[0]).toContain('Not Found');
  });
});

describe('the hand-off to the sweep job', () => {
  it('passes the PR number, head and base it authorised', async () => {
    const test = harness();
    await test.execute();
    expect(test.outputs).toEqual({
      allowed: 'true',
      'pr-number': '42',
      'head-sha': 'abc1234def5678',
      'base-sha': 'base9876543210',
    });
  });

  it('acknowledges on the PR with the run link and the commit being swept', async () => {
    const test = harness();
    await test.execute();
    expect(test.comments).toHaveLength(1);
    expect(test.comments[0]).toContain('abc1234');
    expect(test.comments[0]).toContain('https://github.com/wix/skills/actions/runs/777');
    expect(test.comments[0]).toContain(`@${PR_AUTHOR}`);
  });
});
