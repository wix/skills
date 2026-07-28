import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSkillFiles } from '../src/collect-skill-files';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'collect-skill-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function write(relativePath: string, content: string): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('collectSkillFiles', () => {
  it('returns paths relative to the skill dir, sorted deterministically', () => {
    write('skills/wix-app/SKILL.md', '# skill');
    write('skills/wix-app/references/DASHBOARD_PAGE.md', 'dashboard');
    write('skills/wix-app/references/dashboard-page/API.md', 'api');

    const files = collectSkillFiles(root, 'skills/wix-app');

    expect(files.map(file => file.path)).toEqual([
      'SKILL.md',
      'references/DASHBOARD_PAGE.md',
      'references/dashboard-page/API.md',
    ]);
    expect(files[0].content).toBe('# skill');
  });

  it('excludes node_modules and dist', () => {
    write('skills/wix-app/SKILL.md', '# skill');
    write('skills/wix-app/node_modules/pkg/index.js', 'ignored');
    write('skills/wix-app/dist/bundle.js', 'ignored');

    const files = collectSkillFiles(root, 'skills/wix-app');

    expect(files.map(file => file.path)).toEqual(['SKILL.md']);
  });

  it('skips a binary file with a warning rather than corrupting the version', () => {
    write('skills/wix-app/SKILL.md', '# skill');
    writeFileSync(join(root, 'skills/wix-app/logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const warn = vi.fn();

    const files = collectSkillFiles(root, 'skills/wix-app', { warn });

    expect(files.map(file => file.path)).toEqual(['SKILL.md']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('logo.png'));
  });

  it('throws when one file exceeds the per-file cap', () => {
    write('skills/wix-app/SKILL.md', 'x'.repeat(50));

    expect(() => collectSkillFiles(root, 'skills/wix-app', {
      limits: { maxFileBytes: 10, maxTotalBytes: 1_000 },
    })).toThrow(/SKILL\.md/);
  });

  it('throws when the collection exceeds the total cap', () => {
    write('skills/wix-app/a.md', 'x'.repeat(40));
    write('skills/wix-app/b.md', 'x'.repeat(40));

    expect(() => collectSkillFiles(root, 'skills/wix-app', {
      limits: { maxFileBytes: 1_000, maxTotalBytes: 50 },
    })).toThrow(/total/i);
  });

  it('throws when the skill directory holds no files at all', () => {
    mkdirSync(join(root, 'skills/wix-app'), { recursive: true });

    expect(() => collectSkillFiles(root, 'skills/wix-app')).toThrow(/no files/i);
  });

  it('collects nested reference sub-docs at their full relative path', () => {
    write('skills/wix-app/SKILL.md', '# skill');
    write('skills/wix-app/references/stores/deep/NOTE.md', 'note');

    const files = collectSkillFiles(root, 'skills/wix-app');

    expect(files.map(file => file.path)).toContain('references/stores/deep/NOTE.md');
  });
});
