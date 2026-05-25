import { describe, it, expect, beforeAll } from 'vitest';
import { canonicalDocUrl } from '../src/utils/doc-url';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'doc-url-'));
  mkdirSync(join(workspace, 'yaml/wix-manage/blog'), { recursive: true });
  mkdirSync(join(workspace, 'skills/wix-manage/references/blog'), { recursive: true });
  writeFileSync(join(workspace, 'yaml/wix-manage/blog/documentation.yaml'),
`apiDoc:
  docs:
    - file: ../../../skills/wix-manage/references/blog/how-to-create-blog-posts.md
      title: How to Create Blog Posts
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/blog
`);
  writeFileSync(join(workspace, 'skills/wix-manage/references/blog/how-to-create-blog-posts.md'), '# stub');
});

describe('canonicalDocUrl', () => {
  it('resolves a known file via documentation.yaml + /skills/ + basename', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/blog/how-to-create-blog-posts.md', workspace))
      .toBe('https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts');
  });
  it('returns null for a file not listed in any documentation.yaml', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/blog/orphan.md', workspace)).toBeNull();
  });
});
