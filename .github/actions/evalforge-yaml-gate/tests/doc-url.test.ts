import { describe, it, expect, beforeAll } from 'vitest';
import { canonicalDocUrl } from '../src/utils/doc-url';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'doc-url-'));
  mkdirSync(join(workspace, 'yaml/wix-manage/blog'), { recursive: true });
  mkdirSync(join(workspace, 'yaml/wix-manage/ecommerce'), { recursive: true });
  mkdirSync(join(workspace, 'skills/wix-manage/references/blog'), { recursive: true });
  mkdirSync(join(workspace, 'skills/wix-manage/references/ecommerce'), { recursive: true });
  writeFileSync(join(workspace, 'yaml/wix-manage/blog/documentation.yaml'),
`apiDoc:
  docs:
    - file: ../../../skills/wix-manage/references/blog/how-to-create-blog-posts.md
      title: How to Create Blog Posts
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/blog
`);
  // Filename does NOT match the title slug — exercises the title-slug rule.
  writeFileSync(join(workspace, 'yaml/wix-manage/ecommerce/documentation.yaml'),
`apiDoc:
  docs:
    - file: ../../../skills/wix-manage/references/ecommerce/ecom-abandoned-carts.md
      title: "Abandoned Carts"
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce
    - file: ../../../skills/wix-manage/references/ecommerce/api-shipping.md
      title: "API: Shipping Delivery"
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce
    - file: ../../../skills/wix-manage/references/ecommerce/ecom-load-context.md
      title: "eCommerce: Load Context"
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce
`);
  writeFileSync(join(workspace, 'skills/wix-manage/references/blog/how-to-create-blog-posts.md'), '# stub');
  writeFileSync(join(workspace, 'skills/wix-manage/references/ecommerce/ecom-abandoned-carts.md'), '# stub');
  writeFileSync(join(workspace, 'skills/wix-manage/references/ecommerce/api-shipping.md'), '# stub');
  writeFileSync(join(workspace, 'skills/wix-manage/references/ecommerce/ecom-load-context.md'), '# stub');
});

describe('canonicalDocUrl', () => {
  it('builds URL from docsEntry + /skills/ + slugified title', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/blog/how-to-create-blog-posts.md', workspace))
      .toBe('https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts');
  });

  it('uses title slug, not filename, when they differ (single-word title)', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/ecommerce/ecom-abandoned-carts.md', workspace))
      .toBe('https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts');
  });

  it('uses title slug, not filename, when they differ (title with punctuation)', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/ecommerce/api-shipping.md', workspace))
      .toBe('https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-shipping-delivery');
  });

  it('splits camelCase boundaries before slugifying (e.g. eCommerce → e-commerce)', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/ecommerce/ecom-load-context.md', workspace))
      .toBe('https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context');
  });

  it('returns null for a file not listed in any documentation.yaml', () => {
    expect(canonicalDocUrl('skills/wix-manage/references/blog/orphan.md', workspace)).toBeNull();
  });
});
