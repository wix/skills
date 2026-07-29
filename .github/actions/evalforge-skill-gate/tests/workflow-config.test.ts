import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const loadWorkflow = (name: string) =>
  yaml.load(readFileSync(join(__dirname, '../../../workflows', name), 'utf8')) as Workflow;

type Workflow = {
  on: { pull_request: { types: string[]; paths?: string[]; branches: string[] } };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    steps: Array<{ uses: string; with?: Record<string, string> }>;
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
    expect(gateStep.with?.['capability-id']).toBe('ad0b7e36-e85b-40b1-902b-d67bb3c90363');
    expect(gateStep.with?.['agent-id']).toBe('76093ada-d1ad-42a4-9f49-743673763b00');
  });

  it('starts in soak mode so the gate reports before it can block', () => {
    expect(gateStep.with?.blocking).toContain("vars.WIX_APP_EVAL_BLOCK_MERGE || 'false'");
  });

  it('skips fork PRs, which cannot reach the secrets anyway', () => {
    expect(workflow.jobs.gate.if).toContain('head.repo.full_name == github.repository');
  });

  it('pins every action by commit sha rather than a tag', () => {
    for (const step of workflow.jobs.gate.steps) {
      if (step.uses.startsWith('./')) continue;
      expect(step.uses, step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
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
