import { describe, it, expect } from 'vitest';
import {
  formatValidationErrors, COMMENT_MARKER,
  formatEvalPassed, formatEvalFailed, formatEvalTimeout, formatNoScenarios,
} from '../src/utils/comment';

describe('formatValidationErrors', () => {
  it('includes the comment marker', () => {
    const result = formatValidationErrors([{ entryTitle: 'T', message: 'msg' }]);
    expect(result).toContain(COMMENT_MARKER);
  });

  it('formats a single error', () => {
    const result = formatValidationErrors([{ entryTitle: 'Query Products', message: 'missing tags' }]);
    expect(result).toContain('**Query Products**: missing tags');
  });

  it('formats multiple errors as separate lines', () => {
    const result = formatValidationErrors([
      { entryTitle: 'Entry A', message: 'missing tags' },
      { entryTitle: 'Entry B', message: 'file not found: skills/x.md' },
    ]);
    expect(result).toContain('**Entry A**: missing tags');
    expect(result).toContain('**Entry B**: file not found: skills/x.md');
  });
});

describe('eval result formatters', () => {
  const metrics = {
    totalAssertions: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    errors: 0,
    passRate: 100,
    avgDuration: 500,
    totalDuration: 5000,
  };

  it('formatEvalPassed includes pass rate and scenario count', () => {
    const body = formatEvalPassed({ ...metrics }, 'run-123');
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('✅');
    expect(body).toContain('10/10');
    expect(body).toContain('100%');
    expect(body).toContain('run-123');
  });

  it('formatEvalFailed includes failure count and pass rate', () => {
    const body = formatEvalFailed({ ...metrics, passed: 8, failed: 2, passRate: 80 }, 'run-123');
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('❌');
    expect(body).toContain('2 failed');
    expect(body).toContain('80%');
    expect(body).toContain('run-123');
  });

  it('formatEvalFailed shows errors when only errors present', () => {
    const body = formatEvalFailed({ ...metrics, passed: 7, failed: 0, errors: 3, passRate: 70 }, 'run-123');
    expect(body).toContain('3 errors');
    expect(body).not.toContain('0 failed');
  });

  it('formatEvalTimeout includes run ID', () => {
    const body = formatEvalTimeout('run-123');
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('⏱');
    expect(body).toContain('run-123');
  });

  it('formatNoScenarios includes tags', () => {
    const body = formatNoScenarios(['stores', 'calendar']);
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('❌');
    expect(body).toContain('stores');
    expect(body).toContain('calendar');
  });
});
