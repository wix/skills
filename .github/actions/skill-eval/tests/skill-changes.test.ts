import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateEntry } from '../src/utils/skill-changes';
import type { AffectedEntry } from '../src/utils/yaml';

const YAML_PATH = 'yaml/wix-manage/stores/documentation.yaml';
const ENTRY_FILE = '../../../skills/wix-manage/references/stores/query-products.md';
const RESOLVED_FILE = 'skills/wix-manage/references/stores/query-products.md';

const makeEntry = (overrides: Partial<AffectedEntry> = {}): AffectedEntry => ({
  title: 'Query Products',
  file: ENTRY_FILE,
  docsEntry: 'https://dev.wix.com/docs/rest/products',
  tags: ['stores'],
  yamlPath: YAML_PATH,
  ...overrides,
});

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'skill-eval-test-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function createEntryFile() {
  const dir = join(workspaceRoot, 'skills/wix-manage/references/stores');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'query-products.md'), '# Query Products');
}

describe('validateEntry', () => {
  it('returns no errors for a valid entry', () => {
    createEntryFile();
    expect(validateEntry(makeEntry(), workspaceRoot)).toEqual([]);
  });

  it('errors when tags are missing', () => {
    createEntryFile();
    const errors = validateEntry(makeEntry({ tags: undefined }), workspaceRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/missing tags/);
    expect(errors[0].message).toContain(YAML_PATH);
  });

  it('errors when tags array is empty', () => {
    createEntryFile();
    const errors = validateEntry(makeEntry({ tags: [] }), workspaceRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/missing tags/);
  });

  it('errors when file does not exist', () => {
    const errors = validateEntry(makeEntry(), workspaceRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/file not found/);
    expect(errors[0].message).toContain(RESOLVED_FILE);
    expect(errors[0].message).toContain(YAML_PATH);
  });

  it('accumulates missing-tags and file-not-found errors together', () => {
    const errors = validateEntry(makeEntry({ tags: undefined }), workspaceRoot);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toMatch(/missing tags/);
    expect(errors[1].message).toMatch(/file not found/);
  });

  it('errors when file path escapes the workspace', () => {
    const errors = validateEntry(makeEntry({ file: '../../../../etc/passwd' }), workspaceRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/invalid file path/);
    expect(errors[0].message).toContain(YAML_PATH);
  });

  it('stops after invalid path error — does not also report file-not-found', () => {
    const errors = validateEntry(makeEntry({ file: '../../../../etc/passwd' }), workspaceRoot);
    expect(errors).toHaveLength(1);
  });
});
