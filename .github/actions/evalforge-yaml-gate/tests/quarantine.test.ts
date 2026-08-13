import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQuarantine, QUARANTINE_PATH } from '../src/utils/quarantine';
import { EVALS_RE } from '../src/utils/paths';

const makeWorkspace = (content?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'quarantine-'));
  if (content !== undefined) {
    mkdirSync(join(root, 'yaml/wix-manage-evals'), { recursive: true });
    writeFileSync(join(root, QUARANTINE_PATH), content);
  }
  return root;
};

describe('loadQuarantine', () => {
  it('returns an empty set when the file is missing', () => {
    const out = loadQuarantine(makeWorkspace());
    expect(out.names.size).toBe(0);
    expect(out.errors).toEqual([]);
  });

  it('loads entries', () => {
    const out = loadQuarantine(makeWorkspace(
      'scenarios:\n  - name: blog/flaky-one\n    reason: alternates pass/fail since run abc\n',
    ));
    expect([...out.names]).toEqual(['blog/flaky-one']);
    expect(out.entries[0].reason).toContain('alternates');
    expect(out.errors).toEqual([]);
  });

  it('reports malformed entries as errors without throwing', () => {
    const out = loadQuarantine(makeWorkspace('scenarios:\n  - name: 42\n'));
    expect(out.names.size).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it('reports an entry missing a reason', () => {
    const out = loadQuarantine(makeWorkspace('scenarios:\n  - name: blog/x\n'));
    expect(out.names.size).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe('quarantine file placement', () => {
  it('is not matched by the eval-scenario path regex', () => {
    expect(EVALS_RE.test(QUARANTINE_PATH)).toBe(false);
  });
});
