import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('EvalForge YAML Gate Workflow', () => {
  let workflowContent: string;

  beforeAll(() => {
    const workflowPath = join(__dirname, '../../../workflows/evalforge-yaml-gate.yml');
    workflowContent = readFileSync(workflowPath, 'utf-8');
  });

  describe('Timeout Configuration', () => {
    it('has timeout-minutes configured', () => {
      expect(workflowContent).toContain('timeout-minutes');
    });

    it('sets timeout-minutes to 60', () => {
      expect(workflowContent).toMatch(/timeout-minutes:\s*60/);
    });

    it('increases timeout beyond default 30 minutes', () => {
      const match = workflowContent.match(/timeout-minutes:\s*(\d+)/);
      expect(match).not.toBeNull();
      if (match) {
        const timeout = parseInt(match[1], 10);
        expect(timeout).toBeGreaterThan(30);
      }
    });
  });

  describe('Gate Job Configuration', () => {
    it('defines a gate job', () => {
      expect(workflowContent).toContain('gate:');
    });

    it('runs on ubuntu-latest', () => {
      expect(workflowContent).toContain('runs-on: ubuntu-latest');
    });

    it('has read permissions on contents', () => {
      expect(workflowContent).toContain('contents: read');
    });

    it('has write permissions on pull-requests', () => {
      expect(workflowContent).toContain('pull-requests: write');
    });

    it('has id-token write permission for OIDC', () => {
      expect(workflowContent).toContain('id-token: write');
    });
  });

  describe('Trigger Configuration', () => {
    // pull_request_target, so the workflow file and the action come from main: under pull_request
    // a branch could rewrite either and run it with the gate's secrets.
    it('triggers on pull_request_target, not pull_request', () => {
      expect(workflowContent).toContain('on:\n  pull_request_target:');
      expect(workflowContent).not.toMatch(/^  pull_request:$/m);
    });

    it('targets main branch', () => {
      expect(workflowContent).toContain('branches: [main]');
    });

    it('watches skill reference changes', () => {
      expect(workflowContent).toContain("'skills/wix-manage/references/**'");
    });

    it('watches eval scenario changes', () => {
      expect(workflowContent).toContain("'yaml/wix-manage-evals/**'");
    });
  });

  describe('Concurrency Configuration', () => {
    it('has concurrency rules to prevent duplicate runs', () => {
      expect(workflowContent).toContain('concurrency:');
      expect(workflowContent).toContain('evalforge-yaml-gate-pr-');
      expect(workflowContent).toContain('cancel-in-progress: true');
    });
  });

  describe('Action Invocation', () => {
    it('runs the action from the base checkout, never the PR', () => {
      expect(workflowContent).toContain('uses: ./.action-src/.github/actions/evalforge-yaml-gate');
      expect(workflowContent).not.toContain('uses: ./.github/actions/');
    });

    it('checks out the PR merge ref as data, without persisting credentials', () => {
      expect(workflowContent).toContain('ref: refs/pull/${{ github.event.pull_request.number }}/merge');
      expect(workflowContent).toContain('persist-credentials: false');
    });

    it('takes the action from main\'s head and waits for the merge ref to include this head', () => {
      expect(workflowContent).toContain('ref: ${{ github.sha }}');
      expect(workflowContent).not.toContain('ref: ${{ github.event.pull_request.base.sha }}');
      expect(workflowContent).toContain('name: Wait for the merge ref to include this head');
    });

    // Its check run already lands on the PR head; a status of its own would show the gate twice.
    it('posts no commit status of its own', () => {
      expect(workflowContent).not.toContain('statuses: write');
      expect(workflowContent).not.toContain('createCommitStatus');
    });

    it('passes evalforge credentials', () => {
      expect(workflowContent).toContain('evalforge-url:');
      expect(workflowContent).toContain('evalforge-app-id:');
      expect(workflowContent).toContain('evalforge-app-secret:');
    });

    it('passes github-token to action', () => {
      expect(workflowContent).toContain('github-token:');
    });

    it('passes max new skills from GitHub config with a default', () => {
      expect(workflowContent).toContain("max-new-skills: ${{ vars.EVAL_MAX_NEW_SKILL_AREAS || '1' }}");
    });
  });
});
