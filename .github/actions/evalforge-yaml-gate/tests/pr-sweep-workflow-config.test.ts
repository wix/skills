import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

type Step = { id?: string; name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string> };
type Workflow = {
  on: { issue_comment?: { types: string[] }; push?: unknown; pull_request?: unknown };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    'timeout-minutes': number;
    permissions: Record<string, string>;
    if?: string;
    needs?: string | string[];
    outputs?: Record<string, string>;
    steps: Step[];
  }>;
};

const WORKFLOW_PATH = join(__dirname, '../../../workflows/evalforge-pr-sweep.yml');
const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
const workflow = yaml.load(raw) as Workflow;

describe('EvalForge PR Sweep workflow — trigger', () => {
  it('runs on created comments only, never on push or pull_request', () => {
    expect(workflow.on.issue_comment?.types).toEqual(['created']);
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.pull_request).toBeUndefined();
  });

  it('serialises per PR without cancelling an in-flight sweep', () => {
    expect(workflow.concurrency.group).toContain('evalforge-pr-sweep-pr-');
    expect(workflow.concurrency.group).toContain('github.event.issue.number');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  it('has a repo-variable kill switch so the command can be stopped without a code change', () => {
    expect(raw).toContain("vars.PR_SWEEP_ENABLED != 'false'");
  });
});

describe('EvalForge PR Sweep workflow — authorize job', () => {
  const job = workflow.jobs.authorize;
  const script = job.steps[job.steps.length - 1];

  it('starts a runner only for PR comments from non-bots that mention the command', () => {
    expect(job.if).toContain('github.event.issue.pull_request');
    expect(job.if).toContain("github.event.comment.user.type != 'Bot'");
    expect(job.if).toContain('/sweep');
  });

  it('checks out nothing — it decides whether to spend, it spends nothing itself', () => {
    expect(job.steps.some(s => s.uses?.startsWith('actions/checkout'))).toBe(false);
  });

  it('pins github-script by commit sha', () => {
    expect(script.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
  });

  it('can only read the repo and comment on the PR', () => {
    expect(job.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('hands the sweep job the PR number and the exact head and base it authorised', () => {
    expect(job.outputs).toMatchObject({
      allowed: expect.stringContaining('allowed'),
      'pr-number': expect.stringContaining('pr-number'),
      'head-sha': expect.stringContaining('head-sha'),
      'base-sha': expect.stringContaining('base-sha'),
    });
  });

  it('requires the command as the first token of the first line, as /re-eval does', () => {
    expect(script.with?.script).toContain("split('\\n')[0]");
    expect(script.with?.script).toContain("!== '/sweep'");
  });

  it('applies the same spend gate as /re-eval: PR author or a collaborator with push access', () => {
    expect(script.with?.script).toContain('getCollaboratorPermissionLevel');
    expect(script.with?.script).toContain("['admin', 'maintain', 'write']");
  });

  it('declines closed, draft and fork PRs, which the gates never evaluate either', () => {
    expect(script.with?.script).toContain("pr.state !== 'open'");
    expect(script.with?.script).toContain('pr.draft');
    expect(script.with?.script).toContain('pr.head.repo?.full_name');
  });
});

describe('EvalForge PR Sweep workflow — sweep job', () => {
  const job = workflow.jobs.sweep;
  const action = job.steps.find(s => s.uses === './.github/actions/evalforge-yaml-gate');

  it('runs only once the authorize job allowed it', () => {
    expect(job.needs).toEqual('authorize');
    expect(job.if).toContain("needs.authorize.outputs.allowed == 'true'");
  });

  it('checks out the authorised head sha with full history, so the diff and the action source are the PR\'s', () => {
    const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.ref).toContain('needs.authorize.outputs.head-sha');
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('diffs the PR against its base with a three-dot range, so only the PR\'s own changes count', () => {
    const diff = job.steps.find(s => s.id === 'diff');
    expect(diff?.run).toContain('git -c core.quotePath=false diff --name-status');
    expect(diff?.run).toMatch(/\$BASE_SHA"?\.\.\."?\$HEAD_SHA/);
  });

  it('runs the action in pr-sweep mode with the PR context and the diffed files', () => {
    expect(action?.with?.mode).toBe('pr-sweep');
    expect(action?.with?.['pr-number']).toContain('needs.authorize.outputs.pr-number');
    expect(action?.with?.['pr-head-sha']).toContain('needs.authorize.outputs.head-sha');
    expect(action?.with?.['changed-files']).toContain('steps.diff.outputs.files');
  });

  it('pins the per-PR MCP capability, not the production one', () => {
    expect(action?.with?.['evalforge-mcp-id']).toBe('${{ vars.AUTO_SKILLS_PIPELINE_MCP_ID }}');
    expect(action?.with?.['evalforge-prod-mcp-id']).toBeUndefined();
  });

  it('starts in soak mode, wired to a repo variable so it can be made blocking without a code change', () => {
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

  it('pins every action by commit sha rather than a tag', () => {
    const external = Object.values(workflow.jobs).flatMap(j => j.steps)
      .map(s => s.uses)
      .filter((uses): uses is string => uses !== undefined && !uses.startsWith('./'));
    expect(external.length).toBeGreaterThan(0);
    for (const uses of external) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });
});
