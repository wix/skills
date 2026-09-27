import { describe, it, expect } from 'vitest';
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

describe('slashedTitles', () => {
  it('lists every documentation.yaml title that contains a slash', () => {
    const ws = workspaceWith('CMS Publishing Flow & Visible/Hidden', 'Shipping: Set Up Pickup / Local Delivery');
    expect(slashedTitles(ws).map((e) => e.title).sort()).toEqual([
      'CMS Publishing Flow & Visible/Hidden',
      'Shipping: Set Up Pickup / Local Delivery',
    ]);
  });

  it('is empty when no title contains a slash', () => {
    const ws = workspaceWith('CMS Draft & Publish Workflow', 'Shipping: Set Up Pickup and Local Delivery');
    expect(slashedTitles(ws)).toEqual([]);
  });
});
