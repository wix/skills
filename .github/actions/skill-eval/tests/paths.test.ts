import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveEntryPath, fileExistsInWorkspace, categorizeChanges } from '../src/utils/paths';

describe('resolveEntryPath', () => {
  it('resolves a relative entry path to a repo-root-relative path', () => {
    const result = resolveEntryPath(
      'yaml/wix-manage/stores/documentation.yaml',
      '../../../skills/wix-manage/references/stores/query-products.md',
      process.cwd()
    );
    expect(result).toBe('skills/wix-manage/references/stores/query-products.md');
  });

  it('handles deeper nesting', () => {
    const result = resolveEntryPath(
      'yaml/wix-manage/catalog/sub/documentation.yaml',
      '../../../../skills/wix-manage/references/catalog/list.md',
      process.cwd()
    );
    expect(result).toBe('skills/wix-manage/references/catalog/list.md');
  });

  it('throws when entry path escapes workspace', () => {
    expect(() =>
      resolveEntryPath('yaml/wix-manage/stores/documentation.yaml', '../../../../etc/passwd', process.cwd())
    ).toThrow('escapes workspace');
  });
});

describe('fileExistsInWorkspace', () => {
  const tmp = 'tmp-paths-test';

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'test.md'), '# test');
  });

  afterAll(() => rmSync(tmp, { recursive: true }));

  it('returns true for an existing file', () => {
    expect(fileExistsInWorkspace(join(tmp, 'test.md'))).toBe(true);
  });

  it('returns false for a missing file', () => {
    expect(fileExistsInWorkspace(join(tmp, 'missing.md'))).toBe(false);
  });
});

describe('categorizeChanges', () => {
  it('splits files into yaml and md buckets', () => {
    const files = [
      { filename: 'yaml/wix-manage/stores/documentation.yaml', status: 'modified' },
      { filename: 'skills/wix-manage/references/stores/query.md', status: 'modified' },
      { filename: 'yaml/wix-manage/calendar/documentation.yaml', status: 'added' },
      { filename: 'skills/wix-manage/SKILL.md', status: 'modified' },
    ];
    const { yamlFiles, mdFiles } = categorizeChanges(files);
    expect(yamlFiles).toHaveLength(2);
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0].filename).toBe('skills/wix-manage/references/stores/query.md');
  });

  it('excludes removed files', () => {
    const files = [
      { filename: 'yaml/wix-manage/stores/documentation.yaml', status: 'removed' },
    ];
    const { yamlFiles } = categorizeChanges(files);
    expect(yamlFiles).toHaveLength(0);
  });

  it('includes previousFilename for renamed files', () => {
    const files = [
      { filename: 'skills/wix-manage/references/stores/new-name.md', status: 'renamed', previousFilename: 'skills/wix-manage/references/stores/old-name.md' },
    ];
    const { mdFiles } = categorizeChanges(files);
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0].previousFilename).toBe('skills/wix-manage/references/stores/old-name.md');
  });
});
