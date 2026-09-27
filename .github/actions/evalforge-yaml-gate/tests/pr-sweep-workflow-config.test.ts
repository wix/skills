import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

type Step = { id?: string; name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string | number> };
type Workflow = {
  on: {
    pull_request?: { types: string[]; paths?: string[]; branches: string[] };
    issue_comment?: unknown;
    workflow_dispatch?: unknown;
    push?: unknown;
  };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    name?: string;
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    steps: Step[];
  }>;
};

const WORKFLOWS = join(__dirname, '../../../workflows');
const raw = readFileSync(join(WORKFLOWS, 'evalforge-pr-sweep.yml'), 'utf-8');
const workflow = yaml.load(raw) as Workflow;
const reEval = readFileSync(join(WORKFLOWS, 'evalforge-re-eval.yml'), 'utf-8');

describe('EvalForge PR Sweep workflow — trigger', () => {
  // Modelled on the skill review: a `pull_request` run is attached to the PR head, which is what
  // lets its job be a required status check. A comment-triggered run is attached to the default
  // branch commit and never appears on the PR.
  it('runs on pull_request events, and on nothing else', () => {
    expect(workflow.on.pull_request?.branches).toEqual(['main']);
    expect(workflow.on.issue_comment).toBeUndefined();
    expect(workflow.on.workflow_dispatch).toBeUndefined();
    expect(workflow.on.push).toBeUndefined();
  });

  it('includes synchronize, so every head commit gets a check for /sweep to re-run', () => {
    expect(workflow.on.pull_request?.types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened', 'ready_for_review']));
  });

  // A required check whose workflow is path-scoped is never reported on PRs outside those paths,
  // and GitHub then waits for it forever. The action decides scope from the diff instead.
  it('has no paths filter', () => {
    expect(workflow.on.pull_request?.paths).toBeUndefined();
  });

  it('supersedes an in-flight run of the same PR — only the newest head matters', () => {
    expect(workflow.concurrency.group).toContain('evalforge-pr-sweep-pr-');
    expect(workflow.concurrency.group).toContain('github.event.pull_request.number');
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  });
});

describe('EvalForge PR Sweep workflow — pr-sweep job', () => {
  const job = workflow.jobs['pr-sweep'];
  const action = job.steps.find(s => s.uses === './.github/actions/evalforge-yaml-gate');

  it('names its job pr-sweep, which is the required-status-check name', () => {
    expect(job).toBeDefined();
    expect(job.name).toBe('pr-sweep');
  });

  it('skips drafts and fork PRs, as the gates do', () => {
    expect(job.if).toContain('!github.event.pull_request.draft');
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('has a repo-variable kill switch so the sweep can be stopped without a code change', () => {
    expect(job.if).toContain("vars.PR_SWEEP_ENABLED != 'false'");
  });

  it('checks out the merge ref with full history, so HEAD^1 is the base', () => {
    const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.ref).toBeUndefined();
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('diffs the merge commit against its first parent, so only the PR\'s own changes count', () => {
    const diff = job.steps.find(s => s.id === 'diff');
    expect(diff?.run).toContain('git -c core.quotePath=false diff --name-status HEAD^1 HEAD');
  });

  it('runs the action in pr-sweep mode with the diffed files', () => {
    expect(action?.with?.mode).toBe('pr-sweep');
    expect(action?.with?.['changed-files']).toContain('steps.diff.outputs.files');
  });

  it('pins the per-PR MCP capability, not the production one', () => {
    expect(action?.with?.['evalforge-mcp-id']).toBe('${{ vars.AUTO_SKILLS_PIPELINE_MCP_ID }}');
    expect(action?.with?.['evalforge-prod-mcp-id']).toBeUndefined();
  });

  // Two dials, both off by default. `required` makes an unswept commit red; `blocking` makes a
  // sweep that found a regression red. Either can be turned on its own.
  it('wires required and blocking to their own repo variables, both defaulting to off', () => {
    expect(action?.with?.required).toBe("${{ vars.PR_SWEEP_REQUIRED || 'false' }}");
    expect(action?.with?.blocking).toBe("${{ vars.PR_SWEEP_BLOCK_MERGE || 'false' }}");
  });

  it('passes every credential the action needs', () => {
    expect(action?.with?.['github-token']).toBe('${{ secrets.GITHUB_TOKEN }}');
    expect(action?.with?.['evalforge-url']).toBe('${{ vars.EVALFORGE_URL }}');
    expect(action?.with?.['evalforge-project-id']).toBe('${{ vars.AUTO_SKILLS_PIPELINE_PROJECT_ID }}');
    expect(action?.with?.['evalforge-agent-id']).toBe('${{ vars.AUTO_SKILLS_PIPELINE_AGENT_ID }}');
    expect(action?.with?.['evalforge-app-id']).toBe('${{ secrets.AUTO_SKILLS_PIPELINE_APP_ID }}');
    expect(action?.with?.['evalforge-app-secret']).toBe('${{ secrets.AUTO_SKILLS_PIPELINE_APP_SECRET }}');
  });

  it('can comment on the PR and read the repo, nothing more', () => {
    expect(job.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('allows a job budget above the worst-case three sequential 30-minute polls', () => {
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(95);
  });

  it('posts to Slack nowhere — the PR comment is the report', () => {
    expect(raw).not.toContain('SLACK_WEBHOOK_URL');
  });

  it('pins every external action by commit sha rather than a tag', () => {
    const external = Object.values(workflow.jobs).flatMap(j => j.steps)
      .map(s => s.uses)
      .filter((uses): uses is string => uses !== undefined && !uses.startsWith('./'));
    expect(external.length).toBeGreaterThan(0);
    for (const uses of external) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('the /sweep command', () => {
  // The command lives in the re-eval workflow's COMMANDS map, which re-runs the head's own
  // pull_request run; that is what turns a comment into a verdict on the required check.
  it('is registered in the re-eval command map, pointing at this workflow', () => {
    expect(reEval).toContain("['/sweep', {");
    expect(reEval).toMatch(/\['\/sweep', \{[^}]*gates: \['evalforge-pr-sweep\.yml'\]/s);
  });

  it('starts the re-eval runner for comments that mention it', () => {
    expect(reEval).toContain("contains(github.event.comment.body, '/sweep')");
  });
});
