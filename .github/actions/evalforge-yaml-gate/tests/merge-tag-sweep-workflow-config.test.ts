import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('EvalForge Merge-Tag Sweep Workflow', () => {
  let workflowContent: string;

  beforeAll(() => {
    const workflowPath = join(__dirname, '../../../workflows/evalforge-merge-tag-sweep.yml');
    workflowContent = readFileSync(workflowPath, 'utf-8');
  });

  it('triggers on push events', () => {
    expect(workflowContent).toContain('on:\n  push:');
  });

  it('targets main branch', () => {
    expect(workflowContent).toContain('branches: [main]');
  });

  it('watches all three wix-manage paths', () => {
    expect(workflowContent).toContain("'skills/wix-manage/references/**'");
    expect(workflowContent).toContain("'yaml/wix-manage/**'");
    expect(workflowContent).toContain("'yaml/wix-manage-evals/**'");
  });

  it('has no cancel-in-progress concurrency rule', () => {
    expect(workflowContent).not.toContain('cancel-in-progress: true');
  });

  it('has no concurrency block at all', () => {
    expect(workflowContent).not.toContain('concurrency:');
  });

  it('checks out with full history for git diff', () => {
    expect(workflowContent).toContain('fetch-depth: 0');
  });

  it('invokes the evalforge-yaml-gate action in merge-tag-sweep mode', () => {
    expect(workflowContent).toContain('./.github/actions/evalforge-yaml-gate');
    expect(workflowContent).toContain('mode: merge-tag-sweep');
  });

  it('passes the diffed changed-files output to the action', () => {
    expect(workflowContent).toContain('changed-files:');
  });

  // Without this the action attaches no MCP and evaluates a tool-less agent.
  it('passes the production MCP capability id so the eval runs are not agent-only', () => {
    expect(workflowContent).toContain('evalforge-prod-mcp-id: ${{ vars.AUTO_SKILLS_PIPELINE_PROD_MCP_ID }}');
  });

  it('does not attach the per-PR MCP capability', () => {
    expect(workflowContent).not.toContain('evalforge-mcp-id:');
  });

  it('guards the confirmed-failure Slack step on a confirmed failure', () => {
    expect(workflowContent).toContain('confirmed-failed-count');
  });

  it('has a separate Slack step for infra errors, distinct from confirmed failures', () => {
    expect(workflowContent).toContain('infra-error');
  });

  it('has a repo-variable kill switch so the sweep can be stopped without a code change', () => {
    expect(workflowContent).toContain("if: vars.MERGE_TAG_SWEEP_ENABLED != 'false'");
  });

  it('allows a job budget above the worst-case three sequential 30-minute polls', () => {
    const match = workflowContent.match(/timeout-minutes:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(95);
  });

  it('notifies even when the sweep step reports no verdict at all', () => {
    expect(workflowContent).toContain('Post Slack notification (job failed with no verdict)');
    // Cancellation, not just failure: a job killed by timeout-minutes reports the cancelled
    // conclusion, so guarding on failure() alone would miss the case the step exists for.
    expect(workflowContent).toContain('(failure() || cancelled())');
  });

  it('surfaces the skipped-retries caveat so a single-attempt verdict is not read as a majority', () => {
    expect(workflowContent).toContain('confirm-skip-reason');
    expect(workflowContent).toContain('$skip_reason');
  });

  it('fails loudly when Slack rejects a payload, rather than dropping the alert', () => {
    expect(workflowContent).not.toMatch(/curl -s -X POST/);
    expect(workflowContent).toContain('--fail-with-body');
  });

  it('does not let git quote non-ASCII paths out of matching the doc and scenario patterns', () => {
    expect(workflowContent).toContain('core.quotePath=false');
  });

  it('reuses the existing Slack webhook secret', () => {
    expect(workflowContent).toContain('SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}');
  });

  it('guards both Slack steps with always(), since the sweep step itself reports failure on a confirmed regression or infra error', () => {
    expect(workflowContent).toContain("if: always() && steps.sweep.outputs.confirmed-failed-count");
    expect(workflowContent).toContain("if: always() && steps.sweep.outputs.infra-error");
  });
});
