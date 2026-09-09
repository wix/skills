import { describe, it, expect } from 'vitest';
import {
  REVIEW_COMMENT_MARKER, REVIEW_PENDING_MARKER, formatReviewClean, formatReviewFindings,
  formatReviewPending, formatReviewServiceError, formatReviewSkipped,
  type ReviewFinding, type ReviewSummary,
} from '../src/utils/review-comment';

const summary = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({
  headSha: 'abcdef1234567890',
  filesReviewed: 3,
  discarded: 0,
  ...over,
});

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  file: 'skills/wix-manage/references/stores/create-bundle.md',
  line: 12,
  section: 'CONTRIBUTING.md#stay-agnostic-to-agent-and-client',
  severity: 'blocking',
  quote: 'call ReadFullDocsArticle to fetch the schema',
  consequence: 'An agent without that tool reads an instruction it cannot follow.',
  ...over,
});

describe('the review comment', () => {
  // The four fixtures below assert whole bodies. Everything outside them covers only what a
  // fixture cannot show: an invariant, or a shape none of the four happens to contain.
  it('keeps the verdict and the reminder on markers neither of which contains the other', () => {
    expect(REVIEW_COMMENT_MARKER).not.toBe('<!-- evalforge-yaml-gate-action -->');
    expect(REVIEW_PENDING_MARKER).not.toContain(REVIEW_COMMENT_MARKER);
    expect(REVIEW_COMMENT_MARKER).not.toContain(REVIEW_PENDING_MARKER);
    expect(formatReviewFindings([finding()], summary())).toContain(REVIEW_COMMENT_MARKER);
    expect(formatReviewClean(summary())).toContain(REVIEW_COMMENT_MARKER);
    expect(formatReviewPending('abcdef1')).toContain(REVIEW_PENDING_MARKER);
  });

  // Real .md files, so a change to a body shows up in a PR diff as prose.
  describe('as it lands on the PR', () => {
    it('renders findings', async () => {
      const body = formatReviewFindings([
        finding(),
        finding({
          line: 44,
          section: undefined,
          severity: 'fix-before-merge',
          quote: 'The response contains the bundle and its items.',
          consequence: 'An agent cannot tell which field the next call reads, so it guesses or goes back to the docs for it.',
          suggestion: 'The response returns `bundle.id`, which the publish call takes as `bundleId`.',
        }),
      ], summary());

      await expect(body).toMatchFileSnapshot('./fixtures/review-comment-findings.md');
    });

    it('renders a review with nothing to raise', async () => {
      await expect(formatReviewClean(summary()))
        .toMatchFileSnapshot('./fixtures/review-comment-clean.md');
    });

    it('renders the reminder that a commit is unreviewed', async () => {
      await expect(formatReviewPending('abcdef1234567890'))
        .toMatchFileSnapshot('./fixtures/review-comment-pending.md');
    });

    it('renders a reviewer that could not run', async () => {
      const body = formatReviewServiceError('it exceeded its time limit and was stopped');

      await expect(body).toMatchFileSnapshot('./fixtures/review-comment-error.md');
    });
  });

  it('is honest that a skipped review is not a passed one', () => {
    const body = formatReviewSkipped('the PR author is not a wix author');
    expect(body).toContain('⏭ Review job skipped — the PR author is not a wix author');
    expect(body).toContain('not because the change passed');
    expect(body).toContain(REVIEW_COMMENT_MARKER);
  });

  it('renders the finding shapes no fixture happens to carry', () => {
    // A section string we do not recognise is quoted, never turned into a guessed URL.
    expect(formatReviewFindings([finding({ section: 'some prose' })], summary()))
      .toContain('`some prose`');
    // No line to anchor: the link points at the file, not at a guessed line.
    const noLine = formatReviewFindings([finding({ line: undefined })], summary());
    expect(noLine).toContain('[file](../blob/abcdef1234567890/skills/');
    expect(noLine).not.toContain('#L');
  });

  // The headline counts every finding, so a body that drops the worst ones would fail the check
  // over something the contributor cannot read. Ranked before anything is dropped.
  it('leads with the blocking findings whatever order they arrive in', () => {
    const body = formatReviewFindings([
      finding({ file: 'later.md', severity: 'fix-before-merge' }),
      finding({ file: 'worst.md', severity: 'blocking' }),
    ], summary());

    expect(body.indexOf('worst.md')).toBeLessThan(body.indexOf('later.md'));
  });

  it('reports discarded findings rather than passing a half-broken run off as clean', () => {
    expect(formatReviewClean(summary({ discarded: 2 }))).toContain('2 findings');
    expect(formatReviewFindings([finding()], summary({ discarded: 1 }))).toContain('1 finding');
  });
});
