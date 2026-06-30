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
    it('triggers on pull_request events', () => {
      expect(workflowContent).toContain('on:\n  pull_request:');
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
    it('uses evalforge-yaml-gate action', () => {
      expect(workflowContent).toContain('./.github/actions/evalforge-yaml-gate');
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
      expect(workflowContent).toContain("max-new-skills: ${{ vars.EVAL_MAX_NEW_SKILLS || '1' }}");
    });
  });
});
