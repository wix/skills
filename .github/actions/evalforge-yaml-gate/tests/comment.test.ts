import { describe, it, expect } from 'vitest';
import * as c from '../src/utils/comment';

describe('comment formatters', () => {
  it('formatLoadErrors lists each error', () => {
    const out = c.formatLoadErrors([{ path: 'a/b.yml', message: 'bad' }]);
    expect(out).toContain('a/b.yml');
    expect(out).toContain('bad');
    expect(out).toContain(c.COMMENT_MARKER);
  });

  it('formatUncovered includes canonical URL hint', () => {
    expect(c.formatUncovered([{ file: 'x.md', canonicalUrl: 'https://example/x' }])).toContain('https://example/x');
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

  it('formatEvalPassed includes pass rate + run id', () => {
    const metrics = { totalAssertions: 1, passed: 1, failed: 0, skipped: 0, errors: 0, passRate: 100, avgDuration: 0, totalDuration: 0 };
    const out = c.formatEvalPassed(metrics, 'run-1');
    expect(out).toContain('100%');
    expect(out).toContain('run-1');
  });

  it('formatNoChanges signals success', () => {
    expect(c.formatNoChanges()).toContain('No Gated Changes');
  });
});
