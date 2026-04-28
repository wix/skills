import { describe, it, expect } from 'vitest';
import { deduplicateAffectedEntries } from '../src/utils/yaml';

const entry = (title: string, yamlPath: string, tags?: string[]) => ({
  title,
  file: `skills/wix-manage/references/stores/${title}.md`,
  docsEntry: 'https://dev.wix.com/docs/rest/products',
  tags,
  yamlPath,
});

describe('deduplicateAffectedEntries', () => {
  it('returns entries unchanged when no duplicates', () => {
    const entries = [
      entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores']),
      entry('Create Product', 'yaml/wix-manage/stores/documentation.yaml', ['media']),
    ];
    expect(deduplicateAffectedEntries(entries)).toHaveLength(2);
  });

  it('removes duplicate when same entry added by both Path A and Path B', () => {
    const entries = [
      entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores']),
      entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores']),
    ];
    expect(deduplicateAffectedEntries(entries)).toHaveLength(1);
  });

  it('keeps entries with same title but different yamlPath', () => {
    const entries = [
      entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores']),
      entry('Query Products', 'yaml/wix-manage/bookings/documentation.yaml', ['bookings']),
    ];
    expect(deduplicateAffectedEntries(entries)).toHaveLength(2);
  });

  it('merges tags from duplicate entries', () => {
    const first = entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores']);
    const second = entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores', 'extra']);
    const result = deduplicateAffectedEntries([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual(['stores', 'extra']);
  });

  it('merges tags when Path A has partial tags and Path B has full tags', () => {
    const pathA = entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores-v3']);
    const pathB = entry('Query Products', 'yaml/wix-manage/stores/documentation.yaml', ['stores', 'stores-v2', 'stores-v3']);
    const result = deduplicateAffectedEntries([pathA, pathB]);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toHaveLength(3);
    expect(result[0].tags).toEqual(expect.arrayContaining(['stores', 'stores-v2', 'stores-v3']));
  });

  it('handles empty input', () => {
    expect(deduplicateAffectedEntries([])).toHaveLength(0);
  });
});
