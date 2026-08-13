import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ANALYSIS_COMMENT_MARKER, GATE_COMMENT_MARKER, makeCommenter } from '@wix/evalforge-core';
import { makeAnalysisCommenter, makeAnalysisUpdater, makeGateCommenter } from '../src/utils/report';

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return { ...actual, makeCommenter: vi.fn(() => async () => {}) };
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

  // Guards the retract path against ever creating a comment: without the option, a green PR that
  // never failed would get an investigation comment saying an investigation no longer applies.
  it('retracts the analysis comment under the analysis marker, and never creates one', () => {
    makeAnalysisUpdater(octokit, TARGET);

    const [, target, , options] = vi.mocked(makeCommenter).mock.calls[0];
    expect(target.marker).toBe(ANALYSIS_COMMENT_MARKER);
    expect(options).toEqual({ createIfMissing: false });
  });

  it('lets both posting commenters create their comment', () => {
    makeGateCommenter(octokit, TARGET);
    makeAnalysisCommenter(octokit, TARGET);

    for (const call of vi.mocked(makeCommenter).mock.calls) {
      expect(call[3]?.createIfMissing).not.toBe(false);
    }
  });
});
