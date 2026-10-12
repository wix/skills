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
  type Added = { path: string; line: number | null; subjectType: 'LINE' | 'FILE'; body: string };

  /** `fits` stands in for GitHub, which answers with no thread when it cannot attach one. */
  const octokitWith = (
    threads: Thread[] = [], fits: (added: Added) => boolean = () => true, pendingReviews: { id: number; state: string }[] = [],
  ) => {
    const graphql = vi.fn(async (query: string, variables: Added) => {
      if (query.startsWith('query')) {
        return { repository: { pullRequest: { reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: threads.map(thread => ({
            id: thread.id, isResolved: thread.isResolved,
            comments: { totalCount: thread.totalCount, nodes: [{
              id: `c-${thread.id}`, body: thread.body, isMinimized: thread.isMinimized ?? false, viewerDidAuthor: thread.mine ?? true,
            }] },
          })),
        } } } };
      }
      if (query.includes('addPullRequestReviewThread')) {
        return { addPullRequestReviewThread: { thread: fits(variables) ? { id: 'thread' } : null } };
      }
      return {};
    });
    const createReview = vi.fn().mockResolvedValue({ data: { id: 5, node_id: 'review-5' } });
    const submitReview = vi.fn().mockResolvedValue({});
    const deletePendingReview = vi.fn().mockResolvedValue({});
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      octokit: {
        graphql,
        paginate: vi.fn().mockResolvedValue(pendingReviews),
        rest: { pulls: { listReviews: {}, createReview, submitReview, deletePendingReview } },
      } as any,
      graphql, createReview, submitReview, deletePendingReview,
    };
  };
  const mutations = (graphql: ReturnType<typeof vi.fn>, name: string) =>
    graphql.mock.calls.filter(call => String(call[0]).includes(name)).map(call => call[1]);
  const added = (graphql: ReturnType<typeof vi.fn>) =>
    mutations(graphql, 'addPullRequestReviewThread').map(({ path, line, subjectType, body }) => [path, line, subjectType, body]);
  const prior = (over: Partial<Thread>): Thread => ({
    id: 't1', isResolved: false, totalCount: 1, body: `${REVIEW_THREAD_MARKER}\n🔴 **blocking**`, ...over,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = (octokit: any, comments: ThreadComment[]) =>
    makeReviewThreadPoster(octokit, 'wix', 'skills', 42)('head1', comments);

  it('posts one review with no summary text: each comment on its line, or on its file when it has none', async () => {
    const { octokit, graphql, createReview, submitReview } = octokitWith();
    const unplaced = await post(octokit, [
      { path: 'a.md', line: 3, body: 'on a line', fileBody: 'unused' },
      { path: 'b.md', body: 'unused', fileBody: 'on the file' },
    ]);

    expect(unplaced).toEqual([]);
    expect(createReview).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', pull_number: 42, commit_id: 'head1' });
    expect(added(graphql)).toEqual([['a.md', 3, 'LINE', 'on a line'], ['b.md', null, 'FILE', 'on the file']]);
    expect(submitReview).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', pull_number: 42, review_id: 5, event: 'COMMENT' });
  });

  it('falls back from the line to the file, then hands back what GitHub could put nowhere', async () => {
    const { octokit, graphql, submitReview } = octokitWith([], ({ path, subjectType }) => path === 'a.md' && subjectType === 'FILE');
    const outside = { path: 'elsewhere.md', line: 3, body: 'not in this PR', fileBody: 'not in this PR, quoted' };
    const unplaced = await post(octokit, [{ path: 'a.md', line: 99, body: 'past the diff', fileBody: 'line 99, quoted' }, outside]);

    expect(added(graphql)).toEqual([
      ['a.md', 99, 'LINE', 'past the diff'], ['a.md', null, 'FILE', 'line 99, quoted'],
      ['elsewhere.md', 3, 'LINE', 'not in this PR'], ['elsewhere.md', null, 'FILE', 'not in this PR, quoted'],
    ]);
    expect(unplaced).toEqual([outside]);
    expect(submitReview).toHaveBeenCalledOnce();
  });

  it('submits no empty review when GitHub could place none of them', async () => {
    const { octokit, submitReview, deletePendingReview } = octokitWith([], () => false);
    const comments = [{ path: 'elsewhere.md', body: 'not in this PR', fileBody: 'not in this PR' }];

    expect(await post(octokit, comments)).toEqual(comments);
    expect(submitReview).not.toHaveBeenCalled();
    expect(deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 5 }));
  });

  it('retires the last run\'s threads, but leaves alone the ones someone resolved or answered', async () => {
    const { octokit, graphql, createReview } = octokitWith([
      prior({ id: 'quiet' }),
      prior({ id: 'answered', totalCount: 2 }),
      prior({ id: 'human', mine: false }),
      prior({ id: 'unmarked', body: 'a reviewer wrote this' }),
      prior({ id: 'settled', isResolved: true }),
    ]);
    expect(await post(octokit, [])).toEqual([]);

    expect(createReview).not.toHaveBeenCalled();
    expect(mutations(graphql, 'minimizeComment')).toEqual([{ subjectId: 'c-quiet' }]);
    expect(mutations(graphql, 'resolveReviewThread')).toEqual([{ threadId: 'quiet' }]);
  });

  it('retires the last run only once the new review is submitted', async () => {
    const { octokit, graphql, submitReview } = octokitWith([prior({ id: 'last' })]);
    await post(octokit, [{ path: 'a.md', line: 3, body: 'x', fileBody: 'x' }]);

    const minimized = graphql.mock.invocationCallOrder[graphql.mock.calls.findIndex(call => String(call[0]).includes('minimizeComment'))];
    expect(submitReview.mock.invocationCallOrder[0]).toBeLessThan(minimized);
  });

  it('clears a draft a crashed run left behind, since GitHub allows only one', async () => {
    const { octokit, deletePendingReview, createReview } = octokitWith([], () => true, [{ id: 9, state: 'PENDING' }, { id: 8, state: 'COMMENTED' }]);
    await post(octokit, [{ path: 'a.md', line: 3, body: 'x', fileBody: 'x' }]);

    expect(deletePendingReview).toHaveBeenCalledOnce();
    expect(deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 9 }));
    expect(createReview).toHaveBeenCalledOnce();
  });

  // Nothing shows until the review is submitted, so a failed run only throws its draft away.
  it('discards its draft and leaves the last run standing when GitHub fails', async () => {
    const { octokit, graphql, submitReview, deletePendingReview } = octokitWith([prior({ id: 'last' })]);
    submitReview.mockRejectedValue(Object.assign(new Error('Server Error'), { status: 502 }));
    const warning = vi.spyOn(core, 'warning').mockImplementation(() => {});

    expect(await post(octokit, [{ path: 'a.md', line: 3, body: 'x', fileBody: 'x' }])).toBeUndefined();
    expect(deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 5 }));
    expect(mutations(graphql, 'minimizeComment')).toEqual([]);
    expect(mutations(graphql, 'resolveReviewThread')).toEqual([]);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
