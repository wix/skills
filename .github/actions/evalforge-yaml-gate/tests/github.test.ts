import { describe, it, expect, vi } from 'vitest';
import * as core from '@actions/core';
import {
  classifyChanges, makeReviewCommenter, makeReviewPendingCommenter, makeReviewThreadPoster, parseChangedFiles,
} from '../src/utils/github';
import type { ThreadComment } from '../src/utils/github';
import { REVIEW_PENDING_MARKER, REVIEW_THREAD_MARKER } from '../src/utils/review-comment';

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

  it('deletes the /review acknowledgement too, so one run leaves one comment', async () => {
    const { octokit, deleteComment } = octokitWith([
      { id: 11, body: '<!-- evalforge-skill-review-ack -->\nRe-running the skill review' },
    ]);
    await makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).clear();
    expect(deleteComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 11 }));
  });

  it('clearAck retires the acknowledgement but leaves the failure notice standing', async () => {
    const { octokit, deleteComment } = octokitWith([
      { id: 11, body: '<!-- evalforge-skill-review-ack -->\nRe-running the skill review' },
      { id: 12, body: `${REVIEW_PENDING_MARKER}\nReview job failed` },
    ]);
    await makeReviewPendingCommenter(octokit, 'wix', 'skills', 42).clearAck();
    expect(deleteComment).toHaveBeenCalledOnce();
    expect(deleteComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 11 }));
  });
});

describe('makeReviewCommenter', () => {
  const octokitWith = (comments: { id: number; node_id: string; body: string }[]) => {
    const createComment = vi.fn().mockResolvedValue({ data: { id: 99 } });
    const updateComment = vi.fn().mockResolvedValue({});
    const graphql = vi.fn().mockResolvedValue({});
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      octokit: {
        graphql,
        paginate: { iterator: () => [{ data: comments }] },
        rest: { issues: { listComments: {}, createComment, updateComment } },
      } as any,
      createComment,
      updateComment,
      graphql,
    };
  };
  const verdict = (id: number) => ({
    id, node_id: `node-${id}`, body: '<!-- evalforge-skill-review-action -->\n1 blocking',
  });

  it('posts a new verdict rather than editing the last one, and hands back its id', async () => {
    const { octokit, createComment, updateComment } = octokitWith([verdict(3)]);
    expect(await makeReviewCommenter(octokit, 'wix', 'skills', 42).post('no findings')).toBe(99);
    expect(createComment).toHaveBeenCalledOnce();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('marks every earlier verdict outdated, but not the one it keeps', async () => {
    const { octokit, graphql } = octokitWith([verdict(3), verdict(4), verdict(99)]);
    await makeReviewCommenter(octokit, 'wix', 'skills', 42).retirePrior(99);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[0][0]).toContain('classifier: OUTDATED');
    expect(graphql.mock.calls.map(call => call[1].subjectId)).toEqual(['node-3', 'node-4']);
  });

  it('carries on when collapsing an old verdict is refused', async () => {
    const { octokit, graphql } = octokitWith([verdict(3)]);
    graphql.mockRejectedValue(new Error('403'));
    await expect(makeReviewCommenter(octokit, 'wix', 'skills', 42).retirePrior(99)).resolves.toBeUndefined();
  });

  it('leaves the pending reminder uncollapsed', async () => {
    const { octokit, graphql } = octokitWith([
      { id: 7, node_id: 'node-7', body: `${REVIEW_PENDING_MARKER}\nawaiting review` },
    ]);
    await makeReviewCommenter(octokit, 'wix', 'skills', 42).retirePrior(99);
    expect(graphql).not.toHaveBeenCalled();
  });
});

describe('makeReviewThreadPoster', () => {
  type Thread = { id: string; isResolved: boolean; totalCount: number; body: string; isMinimized?: boolean; mine?: boolean };
  type Posted = { path: string; body: string; line?: number; subject_type?: string };

  /** `fits` stands in for GitHub, which answers 422 for a line or path it cannot resolve. */
  const octokitWith = (threads: Thread[] = [], fits: (posted: Posted) => boolean = () => true) => {
    const graphql = vi.fn(async (query: string) => (query.startsWith('query')
      ? { repository: { pullRequest: { reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: threads.map(thread => ({
          id: thread.id, isResolved: thread.isResolved,
          comments: { totalCount: thread.totalCount, nodes: [{
            id: `c-${thread.id}`, body: thread.body, isMinimized: thread.isMinimized ?? false, viewerDidAuthor: thread.mine ?? true,
          }] },
        })),
      } } } }
      : {}));
    let nextId = 100;
    const createReviewComment = vi.fn(async (posted: Posted) => {
      if (!fits(posted)) throw Object.assign(new Error('Validation Failed'), { status: 422 });
      return { data: { id: nextId++ } };
    });
    const deleteReviewComment = vi.fn().mockResolvedValue({});
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      octokit: { graphql, rest: { pulls: { createReviewComment, deleteReviewComment } } } as any,
      graphql, createReviewComment, deleteReviewComment,
    };
  };
  const mutations = (graphql: ReturnType<typeof vi.fn>, name: string) =>
    graphql.mock.calls.filter(call => String(call[0]).includes(name)).map(call => call[1]);
  const attempts = (createReviewComment: ReturnType<typeof vi.fn>) =>
    createReviewComment.mock.calls.map(([posted]) => [posted.path, posted.line ?? posted.subject_type]);
  const prior = (over: Partial<Thread>): Thread => ({
    id: 't1', isResolved: false, totalCount: 1, body: `${REVIEW_THREAD_MARKER}\n🔴 **blocking**`, ...over,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = (octokit: any, comments: ThreadComment[]) =>
    makeReviewThreadPoster(octokit, 'wix', 'skills', 42)('head1', comments);

  it('posts each comment on its own, on its line on the new side, or on its file when it has none', async () => {
    const { octokit, createReviewComment } = octokitWith();
    const unplaced = await post(octokit, [
      { path: 'a.md', line: 3, body: 'on a line', fileBody: 'a.md line 3, quoted' },
      { path: 'b.md', body: 'unused', fileBody: 'on the file' },
    ]);

    expect(unplaced).toEqual([]);
    expect(createReviewComment.mock.calls.map(([posted]) => posted)).toEqual([
      { owner: 'wix', repo: 'skills', pull_number: 42, commit_id: 'head1', path: 'a.md', body: 'on a line', line: 3, side: 'RIGHT' },
      { owner: 'wix', repo: 'skills', pull_number: 42, commit_id: 'head1', path: 'b.md', body: 'on the file', subject_type: 'file' },
    ]);
  });

  it('falls back from the line to the file, then hands back what GitHub could put nowhere', async () => {
    const { octokit, createReviewComment } = octokitWith([], posted => posted.path === 'a.md' && posted.subject_type === 'file');
    const outside = { path: 'elsewhere.md', line: 3, body: 'not in this PR', fileBody: 'not in this PR, quoted' };
    const unplaced = await post(octokit, [{ path: 'a.md', line: 99, body: 'past the diff', fileBody: 'line 99, quoted' }, outside]);

    expect(attempts(createReviewComment)).toEqual([['a.md', 99], ['a.md', 'file'], ['elsewhere.md', 3], ['elsewhere.md', 'file']]);
    // On the whole file the comment carries the body that names and quotes the line it meant.
    expect(createReviewComment.mock.calls[1][0].body).toBe('line 99, quoted');
    expect(unplaced).toEqual([outside]);
  });

  it('retires the last run\'s threads, but leaves alone the ones someone resolved or answered', async () => {
    const { octokit, graphql } = octokitWith([
      prior({ id: 'quiet' }),
      prior({ id: 'answered', totalCount: 2 }),
      prior({ id: 'human', mine: false }),
      prior({ id: 'unmarked', body: 'a reviewer wrote this' }),
      prior({ id: 'settled', isResolved: true }),
    ]);
    expect(await post(octokit, [])).toEqual([]);

    expect(mutations(graphql, 'minimizeComment')).toEqual([{ subjectId: 'c-quiet' }]);
    expect(mutations(graphql, 'resolveReviewThread')).toEqual([{ threadId: 'quiet' }]);
  });

  it('retires the last run only once the new comments are up', async () => {
    const { octokit, graphql, createReviewComment } = octokitWith([prior({ id: 'last' })]);
    await post(octokit, [{ path: 'a.md', line: 3, body: 'x', fileBody: 'x' }]);

    const minimized = graphql.mock.invocationCallOrder[graphql.mock.calls.findIndex(call => String(call[0]).includes('minimizeComment'))];
    expect(createReviewComment.mock.invocationCallOrder[0]).toBeLessThan(minimized);
  });

  // As a failed review does: the last run stands, and this run takes back what it had posted.
  it('takes its own comments down and leaves the last run standing when GitHub fails', async () => {
    const { octokit, graphql, createReviewComment, deleteReviewComment } = octokitWith([prior({ id: 'last' })]);
    createReviewComment
      .mockResolvedValueOnce({ data: { id: 7 } })
      .mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 502 }));
    const warning = vi.spyOn(core, 'warning').mockImplementation(() => {});

    expect(await post(octokit, [{ path: 'a.md', line: 3, body: 'x', fileBody: 'x' }, { path: 'a.md', line: 4, body: 'y', fileBody: 'y' }])).toBeUndefined();
    expect(deleteReviewComment).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', comment_id: 7 });
    expect(mutations(graphql, 'minimizeComment')).toEqual([]);
    expect(mutations(graphql, 'resolveReviewThread')).toEqual([]);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
