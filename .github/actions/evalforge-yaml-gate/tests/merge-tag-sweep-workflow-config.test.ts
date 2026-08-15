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

  it('guards the confirmed-failure Slack step on a confirmed failure', () => {
    expect(workflowContent).toContain('confirmed-failed-count');
  });

  it('has a separate Slack step for infra errors, distinct from confirmed failures', () => {
    expect(workflowContent).toContain('infra-error');
  });

  it('reuses the existing Slack webhook secret', () => {
    expect(workflowContent).toContain('SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}');
  });
});
