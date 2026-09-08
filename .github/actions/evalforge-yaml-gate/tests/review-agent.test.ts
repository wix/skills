import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as core from '@actions/core';

const spawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn }));

type FakeChild = EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild['stdin'];
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.kill = vi.fn();
  return child;
}

/** The shape the CLI emits under `--output-format json` with `--json-schema`. */
function envelope(output: unknown): string {
  return JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: JSON.stringify(output), structured_output: output,
  });
}

const GATEWAY = 'https://www.wixapis.com/anthropic';

const invocation = {
  cwd: '/workspace',
  promptPath: '/workspace/.github/prompts/skill-review.md',
  task: 'the task',
  apiKey: 'wix-sk-secret',
  baseUrl: GATEWAY,
  baseSha: 'base1234',
  model: 'claude-sonnet-5[1m]',
  effort: 'medium',
  timeoutSeconds: 60,
};

let child: FakeChild;

/** Starts the agent and yields once, so a test can drive the child before it closes. */
async function start() {
  child = fakeChild();
  spawn.mockReturnValue(child);
  const { runReviewAgent } = await import('../src/utils/review-agent');
  const promise = runReviewAgent(invocation);
  await Promise.resolve();
  return { promise };
}

/** One full spawn→close cycle with the given stdout. */
async function runWith(stdout: string, code = 0) {
  const { promise } = await start();
  child.stdout.emit('data', Buffer.from(stdout));
  child.emit('close', code);
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.spyOn(core, 'warning').mockImplementation(() => undefined as never);
  vi.spyOn(core, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the agent environment', () => {
  // Actions materialises every input as INPUT_<NAME>, so inheriting process.env would hand the
  // reviewer the EvalForge secret and the GitHub token.
  it('passes no inherited secret to the child', async () => {
    process.env['INPUT_GITHUB-TOKEN'] = 'gh-secret-value';
    process.env['INPUT_EVALFORGE-APP-SECRET'] = 'ef-secret-value';
    process.env.ACTIONS_RUNTIME_TOKEN = 'runtime-secret-value';

    const { buildAgentEnv } = await import('../src/utils/review-agent');
    const env = buildAgentEnv('wix-sk-secret', GATEWAY, 'base1234');

    for (const value of Object.values(env)) {
      if (value === 'wix-sk-secret') continue;
      expect(value).not.toContain('secret-value');
    }
    expect(Object.keys(env)).not.toContain('INPUT_GITHUB-TOKEN');
    expect(Object.keys(env)).not.toContain('ACTIONS_RUNTIME_TOKEN');

    delete process.env['INPUT_GITHUB-TOKEN'];
    delete process.env['INPUT_EVALFORGE-APP-SECRET'];
    delete process.env.ACTIONS_RUNTIME_TOKEN;
  });

  it('is an allowlist, so a variable the runner adds later cannot leak by default', async () => {
    process.env.SOME_FUTURE_RUNNER_VARIABLE = 'x';
    const { buildAgentEnv } = await import('../src/utils/review-agent');
    expect(Object.keys(buildAgentEnv('k', GATEWAY, 'base1234'))).not.toContain('SOME_FUTURE_RUNNER_VARIABLE');
    delete process.env.SOME_FUTURE_RUNNER_VARIABLE;
  });

  // Without the base URL the CLI calls api.anthropic.com, whose egress is IP-allowlisted at the
  // Wix org level — a gateway key then fails with a 403 that reads like a bad key. And the CLI
  // appends `/v1/messages` itself, so a base ending in `/v1` requests `/v1/v1/messages` and 404s.
  it('hands the child the key and the gateway, whose default carries no version segment', async () => {
    const { buildAgentEnv } = await import('../src/utils/review-agent');
    const { DEFAULT_ANTHROPIC_BASE_URL } = await import('../src/utils/config');
    const env = buildAgentEnv('wix-sk-secret', GATEWAY, 'base1234');

    expect(env.ANTHROPIC_API_KEY).toBe('wix-sk-secret');
    expect(env.ANTHROPIC_BASE_URL).toBe(GATEWAY);
    expect(env.BASE_SHA).toBe('base1234');
    expect(DEFAULT_ANTHROPIC_BASE_URL).not.toMatch(/\/v1\/?$/);
  });
});

describe('the command line', () => {
  // The sandbox surface, in one place: every flag here is load-bearing, and the assertion labels
  // say which one drifted. `--bare` is the sharpest — without it a `-p` run connects the servers in
  // the PR's own .mcp.json, runs its hooks, and reads its CLAUDE.md, all with no trust dialog.
  it('pins the sandbox flags, the tool grant, and the model', async () => {
    const { testables } = await import('../src/utils/review-agent');
    const args = testables.buildArgs(invocation);
    const after = (flag: string) => args[args.indexOf(flag) + 1];

    expect(args, '--bare').toContain('--bare');
    expect(args, '--restricted').toContain('--restricted');
    expect(after('--permission-prompts')).toBe('none');
    expect(after('--tools')).toBe('Read,Grep,Glob,Bash');
    expect(after('--allowedTools')).toBe('Read,Grep,Glob,Bash(git diff:*)');
    expect(after('--model')).toBe('claude-sonnet-5[1m]');
    expect(after('--effort')).toBe('medium');
  });

  it('keeps the task off argv, where it would be readable and length-capped', async () => {
    await runWith(envelope({ findings: [] }));
    expect(spawn.mock.calls[0][1]).not.toContain('the task');
    expect(child.stdin.end).toHaveBeenCalledWith('the task', 'utf8');
  });

  it('runs in its own process group so a stuck grandchild can be killed', async () => {
    await runWith(envelope({ findings: [] }));
    const options = spawn.mock.calls[0][2];
    expect(options.detached).toBe(true);
    expect(options.shell).toBe(false);
    expect(options.cwd).toBe('/workspace');
  });
});

describe('reading the answer', () => {
  const good = {
    file: 'skills/wix-manage/references/stores/a.md',
    line: 3,
    section: 'CONTRIBUTING.md#avoid-fragile-content',
    severity: 'blocking',
    quote: 'as mentioned above',
    consequence: 'The reader has no earlier turn to refer back to.',
  };

  it('reads the findings the schema tool returned', async () => {
    const outcome = await runWith(envelope({ findings: [good] }));
    expect(outcome).toMatchObject({ ok: true, discarded: 0 });
    if (outcome.ok) expect(outcome.findings[0].file).toContain('stores/a.md');
  });

  it.each([
    ['an unknown severity', { ...good, severity: 'nonsense' }],
    ['no severity at all', { ...good, severity: undefined }],
  ])('keeps the good findings and counts one with %s', async (_label, bad) => {
    const outcome = await runWith(envelope({ findings: [good, bad] }));
    expect(outcome).toMatchObject({ ok: true, discarded: 1 });
    if (outcome.ok) expect(outcome.findings).toHaveLength(1);
  });

  it('reports an answer with no structured output, without re-rolling it', async () => {
    const outcome = await runWith(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: 'I had a look and it seems fine.',
    }));
    expect(outcome).toMatchObject({ ok: false });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('constrains the answer with a schema built from the severity list', async () => {
    const { testables } = await import('../src/utils/review-agent');
    const args = testables.buildArgs(invocation);
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    const finding = schema.properties.findings.items;
    expect(finding.properties.severity.enum).toEqual(['blocking', 'fix-before-merge']);
    expect(finding.required).toContain('consequence');
    expect(finding.additionalProperties).toBe(false);
  });

  it('reports a non-zero exit without echoing stderr onto the PR', async () => {
    const { promise } = await start();
    child.stderr.emit('data', Buffer.from('Error: invalid x-api-key'));
    child.emit('close', 1);

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).not.toContain('x-api-key');
  });

  it('reports a missing CLI distinctly', async () => {
    const { promise } = await start();
    const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    child.emit('error', error);

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).toContain('not installed');
  });
});
