import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

type Workflow = {
  on: { pull_request: { types: string[]; paths?: string[]; branches: string[] } };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    steps: Array<{ id?: string; uses?: string; run?: string; with?: Record<string, string> }>;
  }>;
};

const loadWorkflow = (name: string) =>
  yaml.load(readFileSync(join(__dirname, '../../../workflows', name), 'utf8')) as Workflow;

describe('EvalForge skill review workflow', () => {
  const workflow = loadWorkflow('evalforge-skill-review.yml');
  const job = workflow.jobs.review;
  const actionStep = job.steps[job.steps.length - 1];

  it('runs the action in review mode', () => {
    expect(actionStep.uses).toBe('./.github/actions/evalforge-yaml-gate');
    expect(actionStep.with?.mode).toBe('review');
  });

  // A required check whose workflow is path-scoped is never reported on PRs outside those paths,
  // and GitHub leaves it "Expected" forever.
  it('has no paths filter, so the check can be reported on every PR', () => {
    expect(workflow.on.pull_request.paths).toBeUndefined();
  });

  it('triggers on every PR event that changes a head, including synchronize', () => {
    expect(workflow.on.pull_request.types).toEqual(
      ['opened', 'synchronize', 'reopened', 'ready_for_review'],
    );
  });

  it('skips drafts and forks, and runs only for org members', () => {
    expect(job.if).toContain('!github.event.pull_request.draft');
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    // Computed by GitHub, so unlike a commit email it cannot be spoofed.
    expect(job.if).toContain('author_association');
  });

  it('grants exactly what it needs and no more', () => {
    expect(job.permissions).toEqual({ 'contents': 'read', 'pull-requests': 'write' });
  });

  it('starts in soak mode so the reviewer reports before it can block', () => {
    expect(actionStep.with?.blocking).toContain('SKILL_REVIEW_BLOCK_MERGE');
    expect(actionStep.with?.blocking).toContain("|| 'false'");
  });

  it('checks out enough history to diff against the base commit', () => {
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('pins the reviewer CLI to an exact version', () => {
    const install = job.steps.find(step => step.run?.includes('@anthropic-ai/claude-code'));
    expect(install?.run).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+$/m);
  });

  it('pins every action by commit sha rather than a tag', () => {
    for (const step of job.steps) {
      if (!step.uses || step.uses.startsWith('./')) continue;
      expect(step.uses, step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('allows more wall-clock than the reviewer’s own ceiling', () => {
    expect(job['timeout-minutes']).toBeGreaterThan(900 / 60);
  });

  it('cancels superseded runs per PR — only the newest commit is worth reviewing', () => {
    expect(workflow.concurrency.group).toContain('${{ github.event.pull_request.number }}');
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  });
});
