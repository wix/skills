import { describe, it, expect } from 'vitest';
import * as c from '../src/utils/comment';

describe('comment formatters', () => {
  it('formatLoadErrors lists each error', () => {
    const out = c.formatLoadErrors([{ path: 'a/b.yml', message: 'bad' }]);
    expect(out).toContain('a/b.yml');
    expect(out).toContain('bad');
    expect(out).toContain(c.COMMENT_MARKER);
  });

  it('formatUncovered includes canonical URL hint and the expected evals path', () => {
    const out = c.formatUncovered([{ file: 'skills/wix-manage/references/events/x.md', canonicalUrl: 'https://example/x', area: 'events' }]);
    expect(out).toContain('https://example/x');
    expect(out).toContain('yaml/wix-manage-evals/events/');
  });

  it('formatForeignDraftConflicts resolves PR URLs from tag format', () => {
    const out = c.formatForeignDraftConflicts(
      [{ kind: 'FOREIGN_DRAFT', name: 'blog/x', foreignTags: ['draft:wix/skills#99'] }],
      { owner: 'wix', repo: 'skills' },
    );
    expect(out).toContain('https://github.com/wix/skills/pull/99');
  });

  it('formatForeignDraftConflicts falls back to raw tag if malformed', () => {
    const out = c.formatForeignDraftConflicts(
      [{ kind: 'FOREIGN_DRAFT', name: 'blog/x', foreignTags: ['draft:malformed'] }],
      { owner: 'wix', repo: 'skills' },
    );
    expect(out).toContain('draft:malformed');
  });

  it('formatOrphanedMds lists each file', () => {
    expect(c.formatOrphanedMds(['skills/wix-manage/references/blog/foo.md']))
      .toContain('skills/wix-manage/references/blog/foo.md');
  });

  it('formatServiceError icon switches by blocking flag', () => {
    expect(c.formatServiceError('boom', true)).toContain('❌');
    expect(c.formatServiceError('boom', false)).toContain('⚠️');
  });

  it('formatEvalPassed includes pass rate + run link', () => {
    const metrics = { totalAssertions: 1, passed: 1, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0 };
    const out = c.formatEvalPassed(metrics, 'run-1', 'https://bo.wix.com/pages/evalforge/proj-1/results?runId=run-1');
    expect(out).toContain('100%');
    expect(out).toContain('run-1');
    expect(out).toContain('(https://bo.wix.com/pages/evalforge/proj-1/results?runId=run-1)');
  });

  it('formatNoChanges signals success', () => {
    expect(c.formatNoChanges()).toContain('No Gated Changes');
  });

  it('formatTooManyNewSkills includes count and file names', () => {
    const out = c.formatTooManyNewSkills(2, 1, [
      'skills/wix-manage/references/payments/process.md',
      'skills/wix-manage/references/invoicing/create.md',
    ]);
    expect(out).toContain('2');
    expect(out).toContain('payments/process.md');
    expect(out).toContain('invoicing/create.md');
    expect(out).toContain('Too Many New Skills');
    expect(out).toContain(c.COMMENT_MARKER);
  });

  it('formatTooManyNewSkills suggests splitting PRs', () => {
    const out = c.formatTooManyNewSkills(2, 1, ['a.md', 'b.md']);
    expect(out).toContain('Split across multiple PRs');
  });

  it('formatTooManyNewSkills shows configured limit', () => {
    const out = c.formatTooManyNewSkills(4, 3, ['a.md', 'b.md', 'c.md', 'd.md']);
    expect(out).toContain('3');
  });

  it('formatTooManyNewSkills lists all files', () => {
    const files = ['area-one/skill.md', 'area-two/skill.md', 'area-three/skill.md'];
    const out = c.formatTooManyNewSkills(files.length, 1, files);
    files.forEach(file => {
      expect(out).toContain(`\`${file}\``);
    });
  });

  it('formatTokenBudgetExceeded lists budget details and the PR run link', () => {
    const out = c.formatTokenBudgetExceeded([{
      scenarioName: 'ecommerce/ecom-load-context',
      maxTokens: 25_000,
      prTokens: 31_420,
      prodTokens: 18_000,
      prRunId: 'run-pr',
      prRunName: 'PR run',
    }], 'project-1');

    expect(out).toContain('Token Budget Exceeded');
    expect(out).toContain('ecommerce/ecom-load-context');
    expect(out).toContain('25,000');
    expect(out).toContain('31,420');
    expect(out).toContain('18,000');
    expect(out).toContain('run-pr');
    expect(out).toContain(c.COMMENT_MARKER);
  });
});
