import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

import { readFileSync } from 'node:fs';
import { changedScenarioFiles, collectScenarioTags } from '../src/utils/scenarios';
import type { ChangedFile } from '../src/utils/reporting';

const DIR = 'yaml/wix-manage-evals';

function file(filename: string, status = 'modified'): ChangedFile {
  return { filename, status };
}

describe('changedScenarioFiles', () => {
  it('keeps only non-removed .yml/.yaml files under the scenarios dir', () => {
    const files: ChangedFile[] = [
      file('yaml/wix-manage-evals/a.yml'),
      file('yaml/wix-manage-evals/nested/b.yaml'),
      file('yaml/wix-manage-evals/c.yml', 'removed'),
      file('yaml/wix-manage-evals/README.md'),
      file('yaml/wix-manage/other.yml'),
      file('src/x.yml'),
    ];
    expect(changedScenarioFiles(files, DIR).map(f => f.filename)).toEqual([
      'yaml/wix-manage-evals/a.yml',
      'yaml/wix-manage-evals/nested/b.yaml',
    ]);
  });

  it('strips a trailing slash from the scenarios dir', () => {
    expect(changedScenarioFiles([file('yaml/wix-manage-evals/a.yml')], `${DIR}/`)).toHaveLength(1);
  });
});

describe('collectScenarioTags', () => {
  beforeEach(() => vi.restoreAllMocks());

  function mockContent(map: Record<string, string>) {
    vi.mocked(readFileSync).mockImplementation((p: Parameters<typeof readFileSync>[0]) => {
      const key = Object.keys(map).find(k => String(p).endsWith(k));
      if (key === undefined) throw new Error(`unexpected read: ${String(p)}`);
      return map[key];
    });
  }

  it('returns the deduped union of tags across scenarios', () => {
    mockContent({
      'a.yml': 'name: a\ntags: [stores, calendar]\n',
      'b.yml': 'name: b\ntags: [stores, blog]\n',
    });
    const tags = collectScenarioTags(
      [file('yaml/wix-manage-evals/a.yml'), file('yaml/wix-manage-evals/b.yml')],
      '/ws',
    );
    expect([...tags].sort()).toEqual(['blog', 'calendar', 'stores']);
  });

  it('throws on a scenario with no tags (naming the file)', () => {
    mockContent({ 'a.yml': 'name: a\ntriggerPrompt: hi\n' });
    expect(() =>
      collectScenarioTags([file('yaml/wix-manage-evals/a.yml')], '/ws'),
    ).toThrow(/yaml\/wix-manage-evals\/a\.yml.*tags/);
  });

  it('throws on invalid YAML (naming the file)', () => {
    mockContent({ 'a.yml': 'tags: [unterminated\n' });
    expect(() =>
      collectScenarioTags([file('yaml/wix-manage-evals/a.yml')], '/ws'),
    ).toThrow(/yaml\/wix-manage-evals\/a\.yml.*failed to parse YAML/);
  });

  it('throws on the first invalid file', () => {
    mockContent({
      'good.yml': 'tags: [stores]\n',
      'bad.yml': 'name: bad\n',
    });
    expect(() =>
      collectScenarioTags(
        [file('yaml/wix-manage-evals/good.yml'), file('yaml/wix-manage-evals/bad.yml')],
        '/ws',
      ),
    ).toThrow('bad.yml');
  });
});
