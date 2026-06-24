import { describe, it, expect } from 'vitest';
import { classifyChanges } from '../src/utils/github';

const f = (filename: string, status: 'added' | 'modified' | 'removed' | 'renamed') => ({ filename, status });

describe('classifyChanges', () => {
  it('separates .md and evals/*.yml', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/how-to-create-blog-posts.md', 'modified'),
      f('yaml/wix-manage-evals/blog/create.yml', 'added'),
      f('yaml/wix-manage-evals/blog/delete.yml', 'removed'),
      f('README.md', 'modified'),
    ]);
    expect(out.mdFiles).toHaveLength(1);
    expect(out.evalsAdded).toHaveLength(1);
    expect(out.evalsRemoved).toHaveLength(1);
    expect(out.evalsModified).toHaveLength(0);
  });

  it('skips removed .md files', () => {
    const out = classifyChanges([f('skills/wix-manage/references/blog/x.md', 'removed')]);
    expect(out.mdFiles).toHaveLength(0);
  });

  it('treats renames as modified for evals', () => {
    const out = classifyChanges([f('yaml/wix-manage-evals/blog/x.yml', 'renamed')]);
    expect(out.evalsModified).toHaveLength(1);
  });

  it('ignores files outside skills/wix-manage/references', () => {
    const out = classifyChanges([f('docs/foo.md', 'modified'), f('yaml/wix-manage/blog/documentation.yaml', 'modified')]);
    expect(out.mdFiles).toEqual([]);
    expect(out.evalsAdded).toEqual([]);
    expect(out.evalsModified).toEqual([]);
    expect(out.evalsRemoved).toEqual([]);
  });

  it('detects single new skill area from added file', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/payments/process-payment.md', 'added'),
    ]);
    expect(out.newSkillAreas).toContain('payments');
    expect(out.newSkillAreas.size).toBe(1);
  });

  it('detects multiple new skill areas from multiple added files', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/payments/process-payment.md', 'added'),
      f('skills/wix-manage/references/invoicing/create-invoice.md', 'added'),
      f('skills/wix-manage/references/shipping/calculate-shipping.md', 'added'),
    ]);
    expect(out.newSkillAreas.size).toBe(3);
    expect(out.newSkillAreas).toContain('payments');
    expect(out.newSkillAreas).toContain('invoicing');
    expect(out.newSkillAreas).toContain('shipping');
  });

  it('deduplicates new skill areas from multiple files in same area', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/payments/process-payment.md', 'added'),
      f('skills/wix-manage/references/payments/refund-payment.md', 'added'),
      f('skills/wix-manage/references/payments/payment-methods.md', 'added'),
    ]);
    expect(out.newSkillAreas.size).toBe(1);
    expect(out.newSkillAreas).toContain('payments');
  });

  it('ignores modified files when detecting new skill areas', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/x.md', 'modified'),
      f('skills/wix-manage/references/blog/y.md', 'modified'),
    ]);
    expect(out.newSkillAreas.size).toBe(0);
  });

  it('ignores removed files when detecting new skill areas', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/x.md', 'removed'),
    ]);
    expect(out.newSkillAreas.size).toBe(0);
  });

  it('detects new areas from added files, ignoring modifications in existing areas', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/x.md', 'modified'),
      f('skills/wix-manage/references/payments/process.md', 'added'),
      f('skills/wix-manage/references/blog/y.md', 'added'),
    ]);
    expect(out.newSkillAreas.size).toBe(2);
    expect(out.newSkillAreas).toContain('payments');
    expect(out.newSkillAreas).toContain('blog');
  });
});
