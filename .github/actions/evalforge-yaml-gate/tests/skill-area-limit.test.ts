import { describe, it, expect } from 'vitest';
import { classifyChanges } from '../src/utils/github';
import * as c from '../src/utils/comment';

const f = (filename: string, status: 'added' | 'modified' | 'removed' | 'renamed') => ({ filename, status });

describe('Skill Area Limit Validation', () => {
  describe('classifyChanges - detecting new skill areas', () => {
    it('allows 5 new skill areas', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/payments/process.md', 'added'),
        f('skills/wix-manage/references/invoicing/create.md', 'added'),
        f('skills/wix-manage/references/shipping/calculate.md', 'added'),
        f('skills/wix-manage/references/subscriptions/manage.md', 'added'),
        f('skills/wix-manage/references/refunds/process.md', 'added'),
      ]);
      expect(out.newSkillAreas.size).toBe(5);
    });

    it('detects exactly 5 as within limit', () => {
      const areas = ['area1', 'area2', 'area3', 'area4', 'area5'];
      const files = areas.map(area => f(`skills/wix-manage/references/${area}/doc.md`, 'added'));
      const out = classifyChanges(files);
      expect(out.newSkillAreas.size).toBeLessThanOrEqual(5);
    });

    it('detects 6 new skill areas as exceeding limit', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/payments/process.md', 'added'),
        f('skills/wix-manage/references/invoicing/create.md', 'added'),
        f('skills/wix-manage/references/shipping/calculate.md', 'added'),
        f('skills/wix-manage/references/subscriptions/manage.md', 'added'),
        f('skills/wix-manage/references/refunds/process.md', 'added'),
        f('skills/wix-manage/references/taxes/calculate.md', 'added'),
      ]);
      expect(out.newSkillAreas.size).toBeGreaterThan(5);
      expect(out.newSkillAreas.size).toBe(6);
    });

    it('handles many new skill areas', () => {
      const areas = Array.from({ length: 10 }, (_, i) => `area${i}`);
      const files = areas.map(area => f(`skills/wix-manage/references/${area}/doc.md`, 'added'));
      const out = classifyChanges(files);
      expect(out.newSkillAreas.size).toBe(10);
    });

    it('filters new areas correctly from mixed changes', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/blog/existing-post.md', 'modified'),
        f('skills/wix-manage/references/payments/process.md', 'added'),
        f('skills/wix-manage/references/blog/old-post.md', 'removed'),
        f('skills/wix-manage/references/invoicing/create.md', 'added'),
        f('skills/wix-manage/references/shipping/calculate.md', 'added'),
        f('yaml/wix-manage-evals/blog/test.yml', 'added'),
      ]);
      expect(out.newSkillAreas.size).toBe(3);
      expect(out.newSkillAreas).toContain('payments');
      expect(out.newSkillAreas).toContain('invoicing');
      expect(out.newSkillAreas).toContain('shipping');
      expect(out.newSkillAreas).not.toContain('blog');
    });

    it('preserves all tracked metadata alongside new areas detection', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/blog/post.md', 'modified'),
        f('skills/wix-manage/references/payments/process.md', 'added'),
        f('yaml/wix-manage-evals/blog/test.yml', 'added'),
        f('yaml/wix-manage-evals/blog/test2.yml', 'removed'),
      ]);
      expect(out.mdFiles).toHaveLength(2);
      expect(out.evalsAdded).toHaveLength(1);
      expect(out.evalsRemoved).toHaveLength(1);
      expect(out.newSkillAreas.size).toBe(1);
    });
  });

  describe('formatTooManyNewSkills - formatting error messages', () => {
    it('includes the comment marker for PR updates', () => {
      const out = c.formatTooManyNewSkills(6, ['a', 'b', 'c', 'd', 'e', 'f']);
      expect(out).toContain(c.COMMENT_MARKER);
    });

    it('shows the count of new skills', () => {
      const out = c.formatTooManyNewSkills(7, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
      expect(out).toContain('7');
    });

    it('mentions the limit of 5', () => {
      const out = c.formatTooManyNewSkills(6, ['a', 'b', 'c', 'd', 'e', 'f']);
      expect(out).toContain('5');
    });

    it('lists all exceeding skill areas in backticks', () => {
      const areas = ['payments', 'invoicing', 'shipping'];
      const out = c.formatTooManyNewSkills(3, areas);
      areas.forEach(area => {
        expect(out).toContain(`\`${area}\``);
      });
    });

    it('provides actionable guidance', () => {
      const out = c.formatTooManyNewSkills(8, Array.from({ length: 8 }, (_, i) => `area${i}`));
      expect(out).toContain('Split across multiple PRs');
      expect(out).toContain('Update existing skills');
    });

    it('handles single area gracefully', () => {
      const out = c.formatTooManyNewSkills(6, ['single-area']);
      expect(out).toContain('single-area');
    });

    it('handles maximum area count', () => {
      const areas = Array.from({ length: 50 }, (_, i) => `area${i}`);
      const out = c.formatTooManyNewSkills(50, areas);
      expect(out).toContain('50');
      expect(areas.slice(0, 5).every(a => out.includes(`\`${a}\``)));
    });

    it('formats heading as failing check', () => {
      const out = c.formatTooManyNewSkills(6, ['a', 'b', 'c', 'd', 'e', 'f']);
      expect(out).toContain('Too Many New Skills');
      expect(out).toContain('❌');
    });

    it('maintains consistent structure with other formatters', () => {
      const out = c.formatTooManyNewSkills(6, ['a', 'b', 'c', 'd', 'e', 'f']);
      const hasHeading = out.includes('## ❌');
      const hasMarker = out.includes(c.COMMENT_MARKER);
      expect(hasHeading).toBe(true);
      expect(hasMarker).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('handles renamed files in new areas as modified (not added)', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/payments/process.md', 'renamed'),
      ]);
      expect(out.newSkillAreas.size).toBe(0);
    });

    it('detects new areas only from files matching the required pattern', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/payments/process.md', 'added'),
        f('skills/wix-manage/references/invoicing/create-invoice.md', 'added'),
      ]);
      expect(out.newSkillAreas).toContain('payments');
      expect(out.newSkillAreas).toContain('invoicing');
      expect(out.newSkillAreas.size).toBe(2);
    });

    it('handles special characters in area names', () => {
      const out = classifyChanges([
        f('skills/wix-manage/references/area-with-dashes/file.md', 'added'),
        f('skills/wix-manage/references/area_with_underscores/file.md', 'added'),
      ]);
      expect(out.newSkillAreas.size).toBe(2);
      expect(out.newSkillAreas).toContain('area-with-dashes');
      expect(out.newSkillAreas).toContain('area_with_underscores');
    });

    it('handles exactly at boundary (5 areas)', () => {
      const files = ['a', 'b', 'c', 'd', 'e'].map(
        area => f(`skills/wix-manage/references/${area}/doc.md`, 'added'),
      );
      const out = classifyChanges(files);
      expect(out.newSkillAreas.size).toBe(5);
    });

    it('handles just over boundary (6 areas)', () => {
      const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(
        area => f(`skills/wix-manage/references/${area}/doc.md`, 'added'),
      );
      const out = classifyChanges(files);
      expect(out.newSkillAreas.size).toBe(6);
    });
  });
});
