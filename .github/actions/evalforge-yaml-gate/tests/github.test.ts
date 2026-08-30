import { describe, it, expect } from 'vitest';
import { classifyChanges, parseChangedFiles } from '../src/utils/github';

const f = (filename: string, status: 'added' | 'modified' | 'removed' | 'renamed') => ({ filename, status });

describe('classifyChanges', () => {
  it('separates .md and evals/*.yml', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/how-to-create-blog-posts.md', 'modified'),
      f('skills/wix-manage/references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells-codex-file-change.md', 'added'),
      f('yaml/wix-manage-evals/blog/create.yml', 'added'),
      f('yaml/wix-manage-evals/blog/delete.yml', 'removed'),
      f('README.md', 'modified'),
    ]);
    expect(out.mdFiles.map(file => file.filename)).toEqual([
      'skills/wix-manage/references/blog/how-to-create-blog-posts.md',
      'skills/wix-manage/references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells-codex-file-change.md',
    ]);
    expect(out.evalsAdded).toHaveLength(1);
    expect(out.evalsRemoved).toHaveLength(1);
    expect(out.evalsModified).toHaveLength(0);
  });

  it('skips removed .md files', () => {
    const out = classifyChanges([f('skills/wix-manage/references/blog/x.md', 'removed')]);
    expect(out.mdFiles).toHaveLength(0);
  });

  it('treats renames as modified for evals', () => {
    const out = classifyChanges([f('yaml/wix-manage-evals/blog/x.yml', 'renamed')]);
    expect(out.evalsModified).toHaveLength(1);
  });

  it('ignores files outside skills/wix-manage/references', () => {
    const out = classifyChanges([f('docs/foo.md', 'modified'), f('yaml/wix-manage/blog/documentation.yaml', 'modified')]);
    expect(out.mdFiles).toEqual([]);
    expect(out.evalsAdded).toEqual([]);
    expect(out.evalsModified).toEqual([]);
    expect(out.evalsRemoved).toEqual([]);
  });
});

describe('parseChangedFiles', () => {
  it('parses added, modified, and deleted files', () => {
    const out = parseChangedFiles(
      'A\tyaml/wix-manage-evals/blog/new.yml\n' +
      'M\tskills/wix-manage/references/blog/x.md\n' +
      'D\tyaml/wix-manage-evals/blog/old.yml\n',
    );
    expect(out).toEqual([
      { filename: 'yaml/wix-manage-evals/blog/new.yml', status: 'added' },
      { filename: 'skills/wix-manage/references/blog/x.md', status: 'modified' },
      { filename: 'yaml/wix-manage-evals/blog/old.yml', status: 'removed' },
    ]);
  });

  it('parses a rename with its similarity-score suffix', () => {
    const out = parseChangedFiles('R100\told/path.yml\tnew/path.yml\n');
    expect(out).toEqual([
      { filename: 'new/path.yml', status: 'renamed', previousFilename: 'old/path.yml' },
    ]);
  });

  it('maps a type-change (T) to modified and a copy (C) to added', () => {
    const out = parseChangedFiles(
      'T\tyaml/wix-manage-evals/blog/x.yml\n' +
      'C100\tsrc.yml\tdst.yml\n',
    );
    expect(out).toEqual([
      { filename: 'yaml/wix-manage-evals/blog/x.yml', status: 'modified' },
      { filename: 'dst.yml', status: 'added' },
    ]);
  });

  it('ignores blank lines', () => {
    const out = parseChangedFiles('\nA\ta.yml\n\n');
    expect(out).toEqual([{ filename: 'a.yml', status: 'added' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseChangedFiles('')).toEqual([]);
  });
});
