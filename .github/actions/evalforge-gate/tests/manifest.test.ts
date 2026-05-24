import { describe, it, expect } from 'vitest';
import { findManifestForFile, parseManifest, relativeToManifest, type Manifest } from '../src/utils/manifest';

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const yaml = `coverage:\n  create-post.md: [S-1234, S-5678]\n  schedule-post.md: [S-9012]\n`;
    expect(parseManifest(yaml)).toEqual({
      'create-post.md': ['S-1234', 'S-5678'],
      'schedule-post.md': ['S-9012'],
    });
  });

  it('rejects a missing coverage key', () => {
    expect(() => parseManifest('other: thing')).toThrow(/coverage/);
  });

  it('rejects non-array values', () => {
    expect(() => parseManifest('coverage:\n  foo.md: "S-1"')).toThrow(/list/);
  });

  it('rejects empty/non-string IDs', () => {
    expect(() => parseManifest('coverage:\n  foo.md: [""]')).toThrow();
    expect(() => parseManifest('coverage:\n  foo.md: [1]')).toThrow();
  });

  it('rejects coverage keys with ".." or absolute paths', () => {
    expect(() => parseManifest('coverage:\n  "../escape.md": [S-1]')).toThrow();
    expect(() => parseManifest('coverage:\n  "/abs.md": [S-1]')).toThrow();
  });

  it('trims whitespace from IDs', () => {
    expect(parseManifest('coverage:\n  foo.md: ["  S-1  "]')).toEqual({ 'foo.md': ['S-1'] });
  });

  it('accepts an empty coverage map (gated folder with nothing covered yet)', () => {
    expect(parseManifest('coverage: {}')).toEqual({});
  });
});

const m = (gatedDir: string, coverage: Record<string, string[]> = {}): Manifest => ({
  manifestPath: gatedDir === '.' ? '.evalforge.yml' : `${gatedDir}/.evalforge.yml`,
  gatedDir,
  coverage,
});

describe('findManifestForFile', () => {
  const manifests = [
    m('skills/wix-manage/references/blog'),
    m('skills/wix-manage/references'),
  ];

  it('picks the deepest matching manifest', () => {
    const found = findManifestForFile('skills/wix-manage/references/blog/post.md', manifests);
    expect(found?.gatedDir).toBe('skills/wix-manage/references/blog');
  });

  it('falls back to a higher-level manifest if no deep match', () => {
    const found = findManifestForFile('skills/wix-manage/references/stores/foo.md', manifests);
    expect(found?.gatedDir).toBe('skills/wix-manage/references');
  });

  it('returns undefined when no manifest applies', () => {
    expect(findManifestForFile('docs/elsewhere/file.md', manifests)).toBeUndefined();
  });

  it('handles root-level manifest', () => {
    const found = findManifestForFile('any/file.md', [m('.')]);
    expect(found?.gatedDir).toBe('.');
  });
});

describe('relativeToManifest', () => {
  it('computes the file path relative to the manifest folder', () => {
    expect(relativeToManifest('skills/blog/post.md', m('skills/blog'))).toBe('post.md');
    expect(relativeToManifest('skills/blog/sub/post.md', m('skills/blog'))).toBe('sub/post.md');
  });

  it('handles root-level manifest', () => {
    expect(relativeToManifest('foo/bar.md', m('.'))).toBe('foo/bar.md');
  });
});
