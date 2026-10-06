import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

type Workflow = {
  on: { pull_request?: unknown; pull_request_target: { types: string[]; paths?: string[]; branches: string[] } };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    steps: Array<{ id?: string; uses?: string; run?: string; if?: string; 'working-directory'?: string; with?: Record<string, string | number | boolean> }>;
  }>;
};

const loadWorkflow = (name: string) =>
  yaml.load(readFileSync(join(__dirname, '../../../workflows', name), 'utf8')) as Workflow;

describe('EvalForge skill review workflow', () => {
  const workflow = loadWorkflow('evalforge-skill-review.yml');
  const job = workflow.jobs.review;
  const actionStep = job.steps.find(step => step.uses?.endsWith('/evalforge-yaml-gate'))!;

  it('runs the action in review mode', () => {
    expect(actionStep.uses).toBe('./.action-src/.github/actions/evalforge-yaml-gate');
    expect(actionStep.with?.mode).toBe('review');
  });

  // pull_request_target, so the workflow file, the action and the reviewer's definition all come
  // from main: under pull_request a branch could rewrite any of them and run with the API key.
  it('triggers on pull_request_target, not pull_request', () => {
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.pull_request_target.branches).toEqual(['main']);
  });

  it('takes the action and the reviewer definition from the base checkout', () => {
    const base = job.steps.find(step => step.with?.path === '.action-src');
    // main's head, the commit this workflow came from. base.sha could be an older action that
    // still read the reviewer definition from the PR.
    expect(base?.with?.ref).toBe('${{ github.sha }}');
    expect(job.steps.some(step => step.uses?.startsWith('./.github/'))).toBe(false);
  });

  // pull_request_target can start before GitHub rebuilds the merge ref for this push.
  it('waits for the merge ref to include this head before running the action', () => {
    const names = job.steps.map(s => (s as { name?: string }).name ?? s.uses ?? '');
    const wait = names.indexOf('Wait for the merge ref to include this head');
    const action = names.findIndex(n => n.endsWith('/evalforge-yaml-gate'));
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(action);
  });

  it('persists no credentials into any checkout', () => {
    for (const step of job.steps.filter(s => s.uses?.startsWith('actions/checkout'))) {
      expect(step.with?.['persist-credentials']).toBe(false);
    }
  });

  // An `.npmrc` in the PR checkout could otherwise point the install at another registry.
  it('installs the reviewer CLI outside the PR checkout', () => {
    const install = job.steps.find(step => step.run?.includes('@anthropic-ai/claude-code'));
    expect(install?.['working-directory']).toBe('${{ runner.temp }}');
  });

  it('reports pending, then its verdict, as a status on the PR head', () => {
    const scripts = job.steps.filter(step => step.uses?.startsWith('actions/github-script'));
    expect(scripts).toHaveLength(2);
    expect(String(scripts[0].with?.script)).toContain("state: 'pending'");
    expect(scripts[1].if).toBe('always()');
  });

  // A required check whose workflow is path-scoped is never reported on PRs outside those paths,
  // and GitHub leaves it "Expected" forever.
  it('has no paths filter, so the check can be reported on every PR', () => {
    expect(workflow.on.pull_request_target.paths).toBeUndefined();
  });

  it('triggers on every PR event that changes a head, including synchronize', () => {
    expect(workflow.on.pull_request_target.types).toEqual(
      ['opened', 'synchronize', 'reopened', 'ready_for_review'],
    );
  });

  // The same two clauses the eval gates use: a fork PR gets no secrets anyway, and the author is
  // checked inside the action. `author_association` was tried and dropped — it reports CONTRIBUTOR
  // for an org member whose membership is private, which is GitHub's default.
  it('skips drafts and forks, exactly as the eval gates do', () => {
    expect(job.if).toContain('!github.event.pull_request.draft');
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(job.if).not.toContain('author_association');
  });

  it('grants exactly what it needs and no more', () => {
    expect(job.permissions).toEqual({ 'contents': 'read', 'pull-requests': 'write', 'statuses': 'write' });
  });

  it('starts in soak mode so the reviewer reports before it can block', () => {
    expect(actionStep.with?.blocking).toContain('SKILL_REVIEW_BLOCK_MERGE');
    expect(actionStep.with?.blocking).toContain("|| 'false'");
  });

  // `HEAD^1` is the base branch side of the merge ref, and a depth-1 clone has no parents.
  it('checks out enough history to diff against the merge ref\'s first parent', () => {
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(checkout?.with?.ref).toBe('refs/pull/${{ github.event.pull_request.number }}/merge');
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
