import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ANALYSIS_COMMENT_MARKER, GATE_COMMENT_MARKER, makeCommenter, makeCommentUpdater,
} from '@wix/evalforge-core';
import { makeAnalysisCommenter, makeAnalysisUpdater, makeGateCommenter } from '../src/utils/report';

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return {
    ...actual,
    makeCommenter: vi.fn(() => async () => {}),
    makeCommentUpdater: vi.fn(() => async () => {}),
  };
});

vi.mock('@actions/github', () => ({ getOctokit: () => ({}) }));

const octokit = {} as Parameters<typeof makeGateCommenter>[0];
const TARGET = { owner: 'wix', repo: 'skills', prNumber: 42 };

beforeEach(() => {
  vi.clearAllMocks();
});

// Swapping the two markers keeps every other suite green, yet points the analyze job's upsert at
// the gate's verdict comment — `findExistingId` matches on the marker, so the investigation would
// overwrite the verdict while both jobs stayed green.
describe('comment factories bind the marker they name', () => {
  it('posts the gate comment under the gate marker', () => {
    makeGateCommenter(octokit, TARGET);

    expect(vi.mocked(makeCommenter).mock.calls[0][1].marker).toBe(GATE_COMMENT_MARKER);
  });

  it('posts the analysis comment under the analysis marker', () => {
    makeAnalysisCommenter(octokit, TARGET);

    expect(vi.mocked(makeCommenter).mock.calls[0][1].marker).toBe(ANALYSIS_COMMENT_MARKER);
  });

  it('retracts the analysis comment under the analysis marker, and only ever updates', () => {
    makeAnalysisUpdater(octokit, TARGET);

    expect(vi.mocked(makeCommenter)).not.toHaveBeenCalled();
    expect(vi.mocked(makeCommentUpdater).mock.calls[0][1].marker).toBe(ANALYSIS_COMMENT_MARKER);
  });
});
