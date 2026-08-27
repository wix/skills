import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const loadWorkflow = (name: string) =>
  yaml.load(readFileSync(join(__dirname, '../../../workflows', name), 'utf8')) as Workflow;

type Workflow = {
  on: {
    pull_request: { types: string[]; paths?: string[]; branches: string[] };
    /** Only the re-eval workflow has this one. */
    issue_comment?: { types: string[] };
  };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    needs?: string | string[];
    outputs?: Record<string, string>;
    // `uses` and `run` are mutually exclusive per step, and both optional here so a `run:` step
    // typechecks — the gate gained one to capture the checked-out merge commit.
    steps: Array<{ id?: string; uses?: string; run?: string; with?: Record<string, string> }>;
  }>;
};

describe('EvalForge wix-app gate workflow', () => {
  const workflow = loadWorkflow('evalforge-wix-app-gate.yml');
  const gateStep = workflow.jobs.gate.steps[workflow.jobs.gate.steps.length - 1];

  it('runs the action in gate mode', () => {
    expect(gateStep.uses).toBe('./.github/actions/evalforge-skill-gate');
    expect(gateStep.with?.mode).toBe('gate');
  });

  it('triggers on the PR events that change a PR head', () => {
    expect(workflow.on.pull_request.types).toEqual(
      expect.arrayContaining(['opened', 'synchronize', 'reopened']),
    );
  });

  it('also triggers on ready_for_review, since the job skips drafts', () => {
    expect(workflow.on.pull_request.types).toContain('ready_for_review');
    expect(workflow.jobs.gate.if).toContain('draft');
  });

  it('watches both the skill dir and the scenario YAML', () => {
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining(['skills/wix-app/**', 'yaml/wix-app-evals/**']),
    );
  });

  it('cancels superseded runs per PR — only the newest commit verdict is correct', () => {
    expect(workflow.concurrency.group).toContain('evalforge-wix-app-gate-pr-');
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  });

  it('checks the base SHA out into .action-src for the sync diff', () => {
    const baseCheckout = workflow.jobs.gate.steps.find(step => step.with?.path === '.action-src');
    expect(baseCheckout).toBeDefined();
    expect(baseCheckout?.with?.ref).toContain('base.sha');
  });

  it('can write PR comments', () => {
    expect(workflow.jobs.gate.permissions['pull-requests']).toBe('write');
    // Auth to EvalForge is OAuth client-credentials, so the job never mints an OIDC token.
    expect(workflow.jobs.gate.permissions).not.toHaveProperty('id-token');
  });

  it('allows more wall-clock than the 30-minute eval poll window', () => {
    expect(workflow.jobs.gate['timeout-minutes']).toBeGreaterThan(30);
  });

  it('passes the reviewed capability and agent ids inline, not as repo vars', () => {
    expect(gateStep.with?.['capability-id']).toBe('6eb9e9b8-6fd7-4b6d-b846-cde489899ff2');
    expect(gateStep.with?.['agent-id']).toBe('3b9754c0-d603-4a7f-b9b2-b4f17cff7a95');
  });

  it('starts in soak mode so the gate reports before it can block', () => {
    expect(gateStep.with?.blocking).toContain("vars.WIX_APP_EVAL_BLOCK_MERGE || 'false'");
  });

  it('wires runs-per-scenario to its repo variable, so it is tunable without a code change', () => {
    expect(gateStep.with?.['runs-per-scenario']).toContain('vars.WIX_APP_EVAL_RUNS_PER_SCENARIO');
  });

  it('wires base-arm-grace-seconds to its repo variable, so it is tunable without a code change', () => {
    expect(gateStep.with?.['base-arm-grace-seconds']).toContain('vars.WIX_APP_EVAL_BASE_GRACE_SECONDS');
  });

  it('skips fork PRs, which cannot reach the secrets anyway', () => {
    expect(workflow.jobs.gate.if).toContain('head.repo.full_name == github.repository');
  });

  it('pins every action by commit sha rather than a tag', () => {
    for (const step of workflow.jobs.gate.steps) {
      // `run:` steps have nothing to pin, and local `./` actions are this repo's own.
      if (!step.uses || step.uses.startsWith('./')) continue;
      expect(step.uses, step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  // A re-run replays the original event's GITHUB_SHA while checkout resolves the merge ref fresh,
  // so the label must come from the commit on disk.
  it('labels the version from the commit actually checked out', () => {
    expect(gateStep.with?.['evaluated-sha']).toContain('steps.merge.outputs.sha');
    const mergeStep = workflow.jobs.gate.steps.find(step => step.id === 'merge');
    expect(mergeStep?.run).toContain('git rev-parse HEAD');
  });
});

describe('EvalForge wix-app gate workflow — analyze job', () => {
  const workflow = loadWorkflow('evalforge-wix-app-gate.yml');
  const analyze = workflow.jobs.analyze;
  const analyzeStep = analyze.steps[analyze.steps.length - 1];
  const gateStep = workflow.jobs.gate.steps[workflow.jobs.gate.steps.length - 1];

  it('exposes the gate job output the analyze job triggers on', () => {
    expect(workflow.jobs.gate.outputs?.['analyze-run-id'])
      .toContain('steps.gate.outputs.analyze-run-id');
  });

  it('gives the step that produces analyze-run-id the id its output reference needs', () => {
    expect(gateStep.id).toBe('gate');
  });

  it('runs after the gate', () => {
    expect(analyze.needs).toBe('gate');
  });

  it('still runs when the gate job went red, so a blocking failure is investigated', () => {
    expect(analyze.if).toContain('!cancelled()');
    expect(analyze.if).not.toMatch(/success\(\)/);
  });

  it('does nothing when the gate emitted no run id', () => {
    expect(analyze.if).toContain("needs.gate.outputs.analyze-run-id != ''");
  });

  it('can be switched off with a repo variable', () => {
    expect(analyze.if).toContain("vars.WIX_APP_EVAL_ANALYZE != 'false'");
  });

  it('can comment on the PR and read the repo', () => {
    expect(analyze.permissions['pull-requests']).toBe('write');
    expect(analyze.permissions.contents).toBe('read');
  });

  it('is bounded to 5 minutes, well over the 57-second analysis budget', () => {
    expect(analyze['timeout-minutes']).toBe(5);
  });

  it('runs the action in analyze mode on the gate output', () => {
    expect(analyzeStep.uses).toBe('./.github/actions/evalforge-skill-gate');
    expect(analyzeStep.with?.mode).toBe('analyze');
    expect(analyzeStep.with?.['eval-run-id']).toContain('needs.gate.outputs.analyze-run-id');
  });

  it('passes every credential the action needs, none of them empty', () => {
    const credentialInputs = [
      'github-token',
      'evalforge-url',
      'evalforge-project-id',
      'evalforge-app-id',
      'evalforge-app-secret',
    ];
    for (const input of credentialInputs) {
      expect(analyzeStep.with?.[input]).toBeTruthy();
    }
  });

  it('checks out once, pinned to the same sha as the gate job — nothing in analyze mode reads scenarios', () => {
    const checkouts = analyze.steps.filter(step => step.uses?.startsWith('actions/checkout'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].uses).toBe('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
  });
});

describe('EvalForge wix-app gate cleanup workflow', () => {
  const workflow = loadWorkflow('evalforge-wix-app-gate-cleanup.yml');
  const cleanupStep = workflow.jobs.cleanup.steps[workflow.jobs.cleanup.steps.length - 1];

  it('runs the action in cleanup mode on PR close', () => {
    expect(cleanupStep.with?.mode).toBe('cleanup');
    expect(workflow.on.pull_request.types).toEqual(['closed']);
  });

  it('runs on merge as well as close, since wix-app has no promote step to sweep versions', () => {
    expect(workflow.jobs.cleanup.if).not.toContain('merged');
  });

  it('runs the action from the base SHA checkout', () => {
    expect(cleanupStep.uses).toBe('./.action-src/.github/actions/evalforge-skill-gate');
  });

  it('shares the gate concurrency group so a close cancels an in-flight gate run', () => {
    expect(workflow.concurrency.group).toContain('evalforge-wix-app-gate-pr-');
  });

  it('needs no agent id or skill dir', () => {
    expect(cleanupStep.with).not.toHaveProperty('agent-id');
    expect(cleanupStep.with).not.toHaveProperty('skill-dir');
  });

  it('asks for no GitHub API access, since cleanup calls none', () => {
    expect(workflow.jobs.cleanup.permissions).toEqual({ 'contents': 'read' });
    expect(cleanupStep.with).not.toHaveProperty('github-token');
  });
});

/**
 * The workflow-level wiring only. What the script itself does — the parse, the spend gate, which
 * runs are re-run — is covered behaviourally in re-eval-script.test.ts, which compiles this same
 * `script:` string the way `github-script` does.
 */
describe('EvalForge re-eval workflow', () => {
  const workflow = loadWorkflow('evalforge-re-eval.yml');
  const job = workflow.jobs['re-eval'];
  const step = job.steps[job.steps.length - 1];

  it('runs on created comments only', () => {
    expect(workflow.on.issue_comment?.types).toEqual(['created']);
  });

  it('fires only for PR comments, from non-bots, mentioning the command', () => {
    expect(job.if).toContain('github.event.issue.pull_request');
    expect(job.if).toContain('/re-eval');
    // Its own comments name the command; without this they re-fire the webhook.
    expect(job.if).toContain("github.event.comment.user.type != 'Bot'");
  });

  // Sharing the gate's group would let this job cancel the very run it re-runs. Nor does it cancel
  // its own predecessor: this job spends, so losing one mid-flight can lose the acknowledgement of
  // a re-run that was already triggered.
  it('neither shares a gate concurrency group nor cancels itself', () => {
    expect(workflow.concurrency.group).not.toContain('evalforge-wix-app-gate-pr');
    expect(workflow.concurrency.group).not.toContain('evalforge-yaml-gate-pr');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  // A workflow id that names no file finds no run, and the command then declines as if the gate
  // had never run for the commit — a silent scope loss no behavioural test can see.
  it('names gate workflows that exist', () => {
    const gates = step.with?.script?.match(/const GATES = \[([^\]]*)\]/)?.[1];
    expect(gates).toBeDefined();
    const files = [...gates!.matchAll(/'([^']+)'/g)].map(match => match[1]);

    expect(files).toEqual(['evalforge-wix-app-gate.yml', 'evalforge-yaml-gate.yml']);
    for (const file of files) {
      expect(existsSync(join(__dirname, '../../../workflows', file))).toBe(true);
    }
  });

  it('grants exactly what it needs and no more', () => {
    expect(job.permissions).toEqual({
      actions: 'write',
      'pull-requests': 'write',
      contents: 'read',
    });
  });

  it('pins github-script by commit sha', () => {
    expect(step.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
  });
});
