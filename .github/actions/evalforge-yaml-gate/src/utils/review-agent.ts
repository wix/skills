import { spawn } from 'node:child_process';
import * as core from '@actions/core';
import { REVIEW_SEVERITIES, type ReviewFinding, type ReviewSeverity } from './review-comment';

/**
 * Two layers, because the CLI separates them: `--tools` decides which tools exist at all,
 * `--allowedTools` what they may do. So Bash exists solely to run `git diff`.
 */
const TOOLS = 'Read,Grep,Glob,Bash';
const ALLOWED_TOOLS = 'Read,Grep,Glob,Bash(git diff:*)';
const DISALLOWED_TOOLS = 'Edit,Write,NotebookEdit,WebFetch,WebSearch,Task';

/**
 * The working directory is the PR's own tree, which holds `.mcp.json`, `.claude/` and `AGENTS.md`.
 *
 * `--bare` is load-bearing: without it a `-p` run connects that `.mcp.json`'s servers and runs its
 * hooks with no trust dialog, and reads its CLAUDE.md — so a PR could hand itself network access
 * and write instructions to the agent reviewing it. `--restricted` confines the file tools to the
 * working directory and refuses bypassPermissions.
 */
const SANDBOX_ARGS = ['--bare', '--restricted', '--permission-prompts', 'none'];

/**
 * Built up, never filtered down. Actions materialises every input as `INPUT_<NAME>` — including
 * `INPUT_GITHUB-TOKEN` and `INPUT_EVALFORGE-APP-SECRET` — alongside `ACTIONS_RUNTIME_TOKEN`, and
 * inheriting `process.env` would put all of it inside a process whose job is to read text an
 * outside contributor wrote. A denylist would have to track every variable the runner adds.
 */
const INHERITED_ENV = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'] as const;

const MAX_STDERR_CHARS = 2000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const SIGKILL_GRACE_MS = 5000;

/** Built from `REVIEW_SEVERITIES`, so a new severity cannot be accepted here and rejected there. */
const OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Path from the repository root — e.g. skills/wix-manage/references/<area>/<skill>.md',
          },
          line: { type: 'integer', minimum: 1 },
          section: {
            type: 'string',
            description: 'The guide section, when one covers it — e.g. CONTRIBUTING.md#stay-agnostic-to-agent-and-client',
          },
          severity: { enum: [...REVIEW_SEVERITIES] },
          quote: { type: 'string', description: 'The offending line' },
          consequence: { type: 'string', description: 'What an agent or user gets wrong because of this' },
          suggestion: { type: 'string', description: 'The wording that should replace the quoted line' },
        },
        required: ['file', 'severity', 'consequence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
});

export type AgentInvocation = {
  cwd: string;
  promptPath: string;
  task: string;
  apiKey: string;
  baseUrl: string;
  baseSha: string;
  model: string;
  effort: string;
  timeoutSeconds: number;
};

export type AgentOutcome =
  | { ok: true; findings: ReviewFinding[]; discarded: number }
  | { ok: false; reason: string };

type CliResult =
  | { kind: 'completed'; code: number; stdout: string; stderrTail: string }
  | { kind: 'timeout' }
  | { kind: 'not-installed' }
  | { kind: 'oversized' }
  | { kind: 'spawn-failed'; message: string };

export function buildAgentEnv(apiKey: string, baseUrl: string, baseSha: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl, BASE_SHA: baseSha, CI: 'true', TERM: 'dumb', NO_COLOR: '1' };
}

function buildArgs(invocation: AgentInvocation): string[] {
  return [
    '-p',
    ...SANDBOX_ARGS,
    '--tools', TOOLS,
    '--append-system-prompt-file', invocation.promptPath,
    '--allowedTools', ALLOWED_TOOLS,
    '--disallowedTools', DISALLOWED_TOOLS,
    '--json-schema', OUTPUT_SCHEMA,
    '--output-format', 'json',
    '--model', invocation.model,
    '--effort', invocation.effort,
  ];
}

function runCli(invocation: AgentInvocation): Promise<CliResult> {
  return new Promise(resolve => {
    const child = spawn('claude', buildArgs(invocation), {
      cwd: invocation.cwd,
      env: buildAgentEnv(invocation.apiKey, invocation.baseUrl, invocation.baseSha),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Explicit though it is the default: a shell would re-parse this argv.
      shell: false,
      // Its own process group, so the timeout kill reaches grandchildren. Otherwise a stuck one
      // holds the stdout pipe open, `close` never fires, and the job hangs to its own timeout.
      detached: true,
    });

    let settled = false;
    let stdout = '';
    let stdoutBytes = 0;
    let stderrTail = '';

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), SIGKILL_GRACE_MS).unref();
      finish({ kind: 'timeout' });
    }, invocation.timeoutSeconds * 1000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        killGroup('SIGKILL');
        finish({ kind: 'oversized' });
        return;
      }
      stdout += chunk.toString('utf8');
    });

    // Tail only, and it never reaches the PR comment: stderr can carry an upstream error page.
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
    });

    child.on('error', (error: NodeJS.ErrnoException) => finish(
      error.code === 'ENOENT'
        ? { kind: 'not-installed' }
        : { kind: 'spawn-failed', message: error.message },
    ));

    child.on('close', code => finish({ kind: 'completed', code: code ?? -1, stdout, stderrTail }));

    // stdin, not argv: argv has a length ceiling and is readable through /proc. EPIPE is swallowed
    // because the child may exit before it finishes reading.
    child.stdin.on('error', () => {});
    child.stdin.end(invocation.task, 'utf8');
  });
}

type Envelope = {
  structured_output?: { findings?: ReviewFinding[] };
  num_turns?: unknown;
  duration_ms?: unknown;
  total_cost_usd?: unknown;
  permission_denials?: unknown;
};

function parseEnvelope(stdout: string): Envelope | undefined {
  try {
    return JSON.parse(stdout) as Envelope;
  } catch {
    return undefined;
  }
}

/**
 * Denials are why this exists: a refused tool is not an error in `-p` mode — the model is told no
 * and carries on — so a mis-scoped allowlist quietly produces a thinner review behind a green check.
 */
function logRunStats(envelope: Envelope): void {
  const turns = typeof envelope.num_turns === 'number' ? envelope.num_turns : '?';
  const cost = typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : '?';
  const took = typeof envelope.duration_ms === 'number' ? envelope.duration_ms : '?';
  core.info(`Reviewer run: took ${took} ms, cost ${cost} usd, ${turns} turns.`);

  const denials = Array.isArray(envelope.permission_denials) ? envelope.permission_denials : [];
  if (denials.length > 0) {
    core.info(`The reviewer was denied ${denials.length} tool call(s) — check the allowlist: ${JSON.stringify(denials).slice(0, 500)}`);
  }
}

function isSeverity(value: unknown): value is ReviewSeverity {
  return typeof value === 'string' && (REVIEW_SEVERITIES as readonly string[]).includes(value);
}

function isReportable(finding: ReviewFinding): boolean {
  return isSeverity(finding.severity);
}

function parseFindings(
  output: Envelope['structured_output'],
): { findings: ReviewFinding[]; discarded: number } | undefined {
  const list = output?.findings;
  if (!Array.isArray(list)) return undefined;

  const findings = list.filter(isReportable);
  return { findings, discarded: list.length - findings.length };
}

function describeFailure(result: CliResult): string {
  switch (result.kind) {
    case 'timeout': return 'it exceeded its time limit and was stopped';
    case 'not-installed': return 'the reviewer is not installed on this runner';
    case 'oversized': return 'it returned an unreadable amount of output';
    case 'spawn-failed': return 'the reviewer could not be started';
    case 'completed': return `the reviewer exited with code ${result.code}`;
  }
}

/** No retry: `--json-schema` constrains the answer, so re-rolling would only double the cost. */
export async function runReviewAgent(invocation: AgentInvocation): Promise<AgentOutcome> {
  const result = await runCli(invocation);

  if (result.kind !== 'completed' || result.code !== 0) {
    if (result.kind === 'completed' && result.stderrTail !== '') {
      core.info(`Reviewer stderr (tail): ${result.stderrTail}`);
    }
    return { ok: false, reason: describeFailure(result) };
  }

  const envelope = parseEnvelope(result.stdout);
  if (envelope === undefined) {
    return { ok: false, reason: "the reviewer's output was not a JSON envelope" };
  }
  logRunStats(envelope);

  const parsed = parseFindings(envelope.structured_output);
  if (!parsed) {
    core.warning('The reviewer produced no structured output; the schema tool was never called.');
    return { ok: false, reason: 'it did not return findings in the expected format' };
  }

  return { ok: true, ...parsed };
}

export const testables = { buildArgs };
