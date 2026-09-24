import { describe, it, expect, beforeAll } from 'vitest';
import { slashedTitles } from '../src/utils/docs-entry-check';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function workspaceWith(cmsTitle: string, ecomTitle: string): string {
  const ws = mkdtempSync(join(tmpdir(), 'slashed-'));
  for (const area of ['cms', 'ecommerce']) {
    mkdirSync(join(ws, `yaml/wix-manage/${area}`), { recursive: true });
    mkdirSync(join(ws, `skills/wix-manage/references/${area}`), { recursive: true });
  }
  writeFileSync(join(ws, 'yaml/wix-manage/cms/documentation.yaml'),
`apiDoc:
  docs:
    - file: ../../../skills/wix-manage/references/cms/cms-publishing-flow.md
      title: "${cmsTitle}"
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/cms
`);
  writeFileSync(join(ws, 'yaml/wix-manage/ecommerce/documentation.yaml'),
`apiDoc:
  docs:
    - file: ../../../skills/wix-manage/references/ecommerce/shipping-pickup.md
      title: "${ecomTitle}"
      docsEntry: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce
`);
  writeFileSync(join(ws, 'skills/wix-manage/references/cms/cms-publishing-flow.md'), '# stub');
  writeFileSync(join(ws, 'skills/wix-manage/references/ecommerce/shipping-pickup.md'), '# stub');
  return ws;
}

let base: string;
beforeAll(() => {
  base = workspaceWith('CMS Draft & Publish Workflow', 'Shipping: Set Up Pickup / Local Delivery');
});

describe('slashedTitles', () => {
  it('blocks a title this PR adds or changes to contain a slash, warns on a pre-existing one', () => {
    const head = workspaceWith('CMS Publishing Flow & Visible/Hidden', 'Shipping: Set Up Pickup / Local Delivery');
    const result = slashedTitles(head, base);
    expect(result.changed.map((e) => e.title)).toEqual(['CMS Publishing Flow & Visible/Hidden']);
    expect(result.existing.map((e) => e.title)).toEqual(['Shipping: Set Up Pickup / Local Delivery']);
  });

  it('reports nothing when no title contains a slash', () => {
    const head = workspaceWith('CMS Draft & Publish Workflow', 'Shipping: Set Up Pickup and Local Delivery');
    const result = slashedTitles(head, base);
    expect(result.changed).toEqual([]);
    expect(result.existing).toEqual([]);
  });
});
