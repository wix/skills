import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../src/utils/coverage';
import type { Manifest } from '../src/utils/manifest';
import type { ChangedFile } from '../src/utils/github';

const manifest = (gatedDir: string, coverage: Record<string, string[]>): Manifest => ({
  manifestPath: `${gatedDir}/.evalforge.yml`,
  gatedDir,
  coverage,
});

const file = (filename: string, status = 'modified'): ChangedFile => ({ filename, status });

describe('computeCoverage', () => {
  const manifests = [
    manifest('skills/wix-manage/references/blog', {
      'how-to-create-blog-posts.md': ['S-1234'],
    }),
  ];

  it('maps changed files to scenario IDs', () => {
    const result = computeCoverage(
      [file('skills/wix-manage/references/blog/how-to-create-blog-posts.md')],
      manifests,
    );
    expect(result.scenarioIds).toEqual(['S-1234']);
    expect(result.uncoveredFiles).toEqual([]);
  });

  it('ignores files outside any gated folder', () => {
    const result = computeCoverage([file('README.md')], manifests);
    expect(result.scenarioIds).toEqual([]);
    expect(result.uncoveredFiles).toEqual([]);
  });

  it('reports uncovered files inside a gated folder', () => {
    const result = computeCoverage(
      [file('skills/wix-manage/references/blog/new-post.md', 'added')],
      manifests,
    );
    expect(result.scenarioIds).toEqual([]);
    expect(result.uncoveredFiles).toHaveLength(1);
    expect(result.uncoveredFiles[0].file).toBe('skills/wix-manage/references/blog/new-post.md');
    expect(result.uncoveredFiles[0].message).toContain('blog/.evalforge.yml');
  });

  it('skips removed files', () => {
    const result = computeCoverage(
      [file('skills/wix-manage/references/blog/how-to-create-blog-posts.md', 'removed')],
      manifests,
    );
    expect(result.scenarioIds).toEqual([]);
    expect(result.uncoveredFiles).toEqual([]);
  });

  it('skips manifest files themselves', () => {
    const result = computeCoverage(
      [file('skills/wix-manage/references/blog/.evalforge.yml')],
      manifests,
    );
    expect(result.scenarioIds).toEqual([]);
    expect(result.uncoveredFiles).toEqual([]);
  });

  it('dedupes scenario IDs across multiple files', () => {
    const ms = [
      manifest('skills/blog', {
        'a.md': ['S-1', 'S-2'],
        'b.md': ['S-2', 'S-3'],
      }),
    ];
    const result = computeCoverage(
      [file('skills/blog/a.md'), file('skills/blog/b.md')],
      ms,
    );
    expect(result.scenarioIds).toEqual(['S-1', 'S-2', 'S-3']);
    expect(result.fileToIds.get('skills/blog/a.md')).toEqual(['S-1', 'S-2']);
    expect(result.fileToIds.get('skills/blog/b.md')).toEqual(['S-2', 'S-3']);
  });

  it('treats an empty ID list as uncovered', () => {
    const ms = [manifest('skills/blog', { 'a.md': [] })];
    const result = computeCoverage([file('skills/blog/a.md')], ms);
    expect(result.uncoveredFiles).toHaveLength(1);
  });
});
