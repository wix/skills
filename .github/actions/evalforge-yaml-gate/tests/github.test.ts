import { describe, it, expect, vi } from 'vitest';
import { classifyChanges, makeReviewPendingCommenter, parseChangedFiles } from '../src/utils/github';
import { REVIEW_PENDING_MARKER } from '../src/utils/review-comment';

const f = (filename: string, status: 'added' | 'modified' | 'removed' | 'renamed') => ({ filename, status });

describe('classifyChanges', () => {
  it('separates .md and evals/*.yml', () => {
    const out = classifyChanges([
      f('skills/wix-manage/references/blog/how-to-create-blog-posts.md', 'modified'),
      f('skills/wix-manage/references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells-codex-file-change.md', 'added'),
      f('yaml/wix-manage-evals/blog/create.yml', 'added'),
      f('yaml/wix-manage-evals/blog/delete.yml', 'removed'),
      f('README.md', 'modified'),
    ]);
    expect(out.mdFiles.map(file => file.filename)).toEqual([
      'skills/wix-manage/references/blog/how-to-create-blog-posts.md',
      'skills/wix-manage/references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells-codex-file-change.md',
    ]);
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
});

describe('parseChangedFiles', () => {
  it('parses added, modified, and deleted files', () => {
    const out = parseChangedFiles(
      'A\tyaml/wix-manage-evals/blog/new.yml\n' +
      'M\tskills/wix-manage/references/blog/x.md\n' +
      'D\tyaml/wix-manage-evals/blog/old.yml\n',
    );
    expect(out).toEqual([
      { filename: 'yaml/wix-manage-evals/blog/new.yml', status: 'added' },
      { filename: 'skills/wix-manage/references/blog/x.md', status: 'modified' },
      { filename: 'yaml/wix-manage-evals/blog/old.yml', status: 'removed' },
    ]);
  });

  it('parses a rename with its similarity-score suffix', () => {
    const out = parseChangedFiles('R100\told/path.yml\tnew/path.yml\n');
    expect(out).toEqual([
      { filename: 'new/path.yml', status: 'renamed', previousFilename: 'old/path.yml' },
    ]);
  });

  it('maps a type-change (T) to modified and a copy (C) to added', () => {
    const out = parseChangedFiles(
      'T\tyaml/wix-manage-evals/blog/x.yml\n' +
      'C100\tsrc.yml\tdst.yml\n',
    );
    expect(out).toEqual([
      { filename: 'yaml/wix-manage-evals/blog/x.yml', status: 'modified' },
      { filename: 'dst.yml', status: 'added' },
    ]);
  });

  it('ignores blank lines', () => {
    const out = parseChangedFiles('\nA\ta.yml\n\n');
    expect(out).toEqual([{ filename: 'a.yml', status: 'added' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseChangedFiles('')).toEqual([]);
  });
});

describe('makeReviewPendingCommenter', () => {
  const octokitWith = (comments: { id: number; body: string }[]) => {
    const createComment = vi.fn().mockResolvedValue({ data: { id: 99 } });
    const updateComment = vi.fn().mockResolvedValue({});
    const deleteComment = vi.fn().mockResolvedValue({});
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      octokit: {
        paginate: { iterator: () => [{ data: comments }] },
        rest: { issues: { listComments: {}, createComment, updateComment, deleteComment } },
      } as any,
      createComment,
      updateComment,
      deleteComment,
    };
  };
  const reminder = (id: number) => ({ id, body: `${REVIEW_PENDING_MARKER}\nawaiting review` });

  it('rewrites the standing reminder instead of adding another', async () => {
    const { octokit, createComment, updateComment } = octokitWith([reminder(7)]);
    await makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).post('awaiting review');
    expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 7 }));
    expect(createComment).not.toHaveBeenCalled();
  });

  it('introduces itself when there is no reminder yet', async () => {
    const { octokit, createComment } = octokitWith([]);
    await makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).post('awaiting review');
    expect(createComment).toHaveBeenCalledOnce();
  });

  it('leaves the verdict comment alone', async () => {
    const { octokit, updateComment, deleteComment } = octokitWith([
      { id: 3, body: '<!-- evalforge-skill-review-action -->\n1 blocking' },
    ]);
    const pending = makeReviewPendingCommenter(octokit, 'wix', 'skills', 42);
    await pending.post('awaiting review');
    await pending.clear();
    expect(updateComment).not.toHaveBeenCalled();
    expect(deleteComment).not.toHaveBeenCalled();
  });

  it('deletes the reminder once a verdict lands', async () => {
    const { octokit, deleteComment } = octokitWith([reminder(7)]);
    await makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).clear();
    expect(deleteComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 7 }));
  });

  it('warns rather than throwing when the reminder cannot be deleted', async () => {
    const { octokit, deleteComment } = octokitWith([reminder(7)]);
    deleteComment.mockRejectedValue(new Error('403'));
    await expect(makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).clear())
      .resolves.toBeUndefined();
  });
});
