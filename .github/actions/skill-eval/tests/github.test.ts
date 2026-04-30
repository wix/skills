import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import { upsertComment, fail } from '../src/utils/github';
import { COMMENT_MARKER } from '../src/utils/comment';
import type { Config } from '../src/utils/config';

vi.mock('@actions/core', () => ({
  error: vi.fn(),
  setFailed: vi.fn(),
  warning: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnValue({ write: vi.fn().mockResolvedValue(undefined) }) },
}));

const config: Config = {
  githubToken: 'token',
  evalforgeUrl: 'https://evalforge.example.com',
  projectId: 'proj-1',
  agentId: 'agent-1',
  mcpId: 'mcp-1',
  appId: 'app-id',
  appSecret: 'secret',
  prNumber: 42,
  baseSha: 'abc123',
  headSha: 'def456',
  owner: 'wix',
  repo: 'skills',
  blocking: true,
};

function makeOctokit(comments: { id: number; body: string }[]) {
  return {
    paginate: vi.fn().mockResolvedValue(comments),
    rest: {
      issues: {
        listComments: {},
        updateComment: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

describe('fail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls core.setFailed when blocking is true', () => {
    fail('something broke', true);
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('something broke');
    expect(vi.mocked(core.warning)).not.toHaveBeenCalled();
  });

  it('calls core.warning when blocking is false', () => {
    fail('something broke', false);
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith('something broke');
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });
});

describe('upsertComment', () => {
  it('updates existing comment when marker is found', async () => {
    const octokit = makeOctokit([{ id: 101, body: `${COMMENT_MARKER}\n## ✅ old result` }]);
    await upsertComment(octokit as never, config, 'new body');
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 101, body: 'new body' })
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('creates new comment when no marker found', async () => {
    const octokit = makeOctokit([{ id: 99, body: 'unrelated comment' }]);
    await upsertComment(octokit as never, config, 'new body');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, body: 'new body' })
    );
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates only the comment with the marker when multiple comments exist', async () => {
    const octokit = makeOctokit([
      { id: 1, body: 'some other comment' },
      { id: 2, body: `${COMMENT_MARKER}\n## ✅ old result` },
      { id: 3, body: 'another comment' },
    ]);
    await upsertComment(octokit as never, config, 'new body');
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2 })
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
