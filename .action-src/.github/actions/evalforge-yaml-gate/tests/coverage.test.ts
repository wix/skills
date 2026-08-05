import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../src/utils/coverage';
import type { LoadedScenario } from '../src/utils/evals';

const blogScenario: LoadedScenario = {
  path: 'yaml/wix-manage-evals/blog/x.yml',
  scenario: {
    name: 'blog/x',
    description: '', triggerPrompt: '0123456789', tags: ['blog'],
    assertions: [{
      tool: 'T',
      params: { articleUrl: 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts' },
    }],
  },
};

describe('computeCoverage', () => {
  it('matches by normalized URL', () => {
    const scenarios = new Map([['blog/x', blogScenario]]);
    const result = computeCoverage(
      [{ filename: 'skills/wix-manage/references/blog/how-to-create-blog-posts.md', status: 'modified' }],
      scenarios,
      () => 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts',
    );
    expect(result.uncovered).toEqual([]);
    expect(result.coveredBy.get('skills/wix-manage/references/blog/how-to-create-blog-posts.md'))
      .toEqual(['blog/x']);
  });

  it('reports uncovered when no sibling assertion matches', () => {
    const result = computeCoverage(
      [{ filename: 'skills/wix-manage/references/blog/schedule-post.md', status: 'added' }],
      new Map([['blog/x', blogScenario]]),
      () => 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/schedule-post',
    );
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].file).toBe('skills/wix-manage/references/blog/schedule-post.md');
  });

  it('ignores changed files not under a folder with evals/', () => {
    const result = computeCoverage(
      [{ filename: 'README.md', status: 'modified' }],
      new Map([['blog/x', blogScenario]]),
      () => null,
    );
    expect(result.uncovered).toEqual([]);
    expect(result.coveredBy.size).toBe(0);
  });

  it('cross-area scenarios do not cover', () => {
    const result = computeCoverage(
      [{ filename: 'skills/wix-manage/references/bookings/foo.md', status: 'modified' }],
      new Map([['blog/x', blogScenario]]),
      () => 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts',
    );
    expect(result.uncovered).toHaveLength(1);
  });

  it('skips removed files', () => {
    const result = computeCoverage(
      [{ filename: 'skills/wix-manage/references/blog/x.md', status: 'removed' }],
      new Map([['blog/x', blogScenario]]),
      () => 'https://dev.wix.com/x',
    );
    expect(result.uncovered).toEqual([]);
  });

  it('nested scenarios still count toward area coverage', () => {
    const nestedScenario: LoadedScenario = {
      path: 'yaml/wix-manage-evals/blog/drafts/x.yml',
      scenario: {
        name: 'blog/drafts/x',
        description: '', triggerPrompt: '0123456789', tags: ['blog'],
        assertions: [{
          tool: 'T',
          params: { articleUrl: 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts' },
        }],
      },
    };
    const result = computeCoverage(
      [{ filename: 'skills/wix-manage/references/blog/how-to-create-blog-posts.md', status: 'modified' }],
      new Map([['blog/drafts/x', nestedScenario]]),
      () => 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts',
    );
    expect(result.uncovered).toEqual([]);
    expect(result.coveredBy.get('skills/wix-manage/references/blog/how-to-create-blog-posts.md'))
      .toEqual(['blog/drafts/x']);
  });
});
