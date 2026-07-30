import { describe, it, expect, vi } from 'vitest';
import { getChangedFiles, makeCommenter } from '../src/pr-github';

const MARKER = '<!-- test-marker -->';
const TARGET = { owner: 'wix', repo: 'skills', prNumber: 42, marker: MARKER };

describe('getChangedFiles', () => {
  it('paginates and normalizes the PR file list', async () => {
    const paginate = vi.fn().mockResolvedValue([
      { filename: 'a.md', status: 'modified' },
      { filename: 'b.md', status: 'renamed', previous_filename: 'old.md' },
    ]);
    const octokit = { paginate, rest: { pulls: { listFiles: 'listFiles' } } };

    const files = await getChangedFiles(octokit, 'wix', 'skills', 42);

    expect(files).toEqual([
      { filename: 'a.md', status: 'modified', previousFilename: undefined },
      { filename: 'b.md', status: 'renamed', previousFilename: 'old.md' },
    ]);
    expect(paginate).toHaveBeenCalledWith('listFiles', {
      owner: 'wix', repo: 'skills', pull_number: 42, per_page: 100,
    });
  });
});

function commentOctokit(existing: Array<{ id: number; body: string }>) {
  const updateComment = vi.fn().mockResolvedValue(undefined);
  const createComment = vi.fn().mockResolvedValue({ data: { id: 999 } });
  const iterator = vi.fn(async function* () {
    yield { data: existing };
  });
  const octokit = {
    paginate: { iterator },
    rest: { issues: { listComments: 'listComments', updateComment, createComment } },
  };
  return { octokit, updateComment, createComment, iterator };
}

describe('makeCommenter', () => {
  it('creates a comment when no marked comment exists', async () => {
    const { octokit, createComment, updateComment } = commentOctokit([]);
    const comment = makeCommenter(octokit, TARGET, { warn: vi.fn(), writeSummary: vi.fn() });

    await comment('hello');

    expect(createComment).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 42, body: 'hello' }));
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment instead of adding another', async () => {
    const { octokit, createComment, updateComment } = commentOctokit([
      { id: 7, body: `${MARKER}\nold body` },
    ]);
    const comment = makeCommenter(octokit, TARGET, { warn: vi.fn(), writeSummary: vi.fn() });

    await comment('fresh');

    expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 7, body: 'fresh' }));
    expect(createComment).not.toHaveBeenCalled();
  });

  it('ignores comments carrying a different marker', async () => {
    const { octokit, createComment } = commentOctokit([{ id: 7, body: '<!-- other-action -->' }]);
    const comment = makeCommenter(octokit, TARGET, { warn: vi.fn(), writeSummary: vi.fn() });

    await comment('hello');

    expect(createComment).toHaveBeenCalled();
  });

  it('reuses the resolved id on a second call without listing again', async () => {
    const { octokit, createComment, updateComment, iterator } = commentOctokit([]);
    const comment = makeCommenter(octokit, TARGET, { warn: vi.fn(), writeSummary: vi.fn() });

    await comment('first');
    await comment('second');

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 999, body: 'second' }));
    expect(iterator).toHaveBeenCalledTimes(1);
  });

  it('falls back to the job summary when posting fails, never throwing', async () => {
    const { octokit } = commentOctokit([]);
    octokit.rest.issues.createComment = vi.fn().mockRejectedValue(new Error('403 forbidden'));
    const warn = vi.fn();
    const writeSummary = vi.fn().mockResolvedValue(undefined);
    const comment = makeCommenter(octokit, TARGET, { warn, writeSummary });

    await expect(comment('body text')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('403 forbidden'));
    expect(writeSummary).toHaveBeenCalledWith('body text');
  });
});
