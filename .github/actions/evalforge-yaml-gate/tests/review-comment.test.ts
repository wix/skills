import { describe, it, expect } from 'vitest';
import {
  REVIEW_COMMENT_MARKER, REVIEW_PENDING_MARKER, formatFindingComment, formatReviewClean,
  formatReviewFindings, formatReviewPending, formatReviewServiceError, formatReviewSkipped,
  type ReviewFinding, type ReviewSummary,
} from '../src/utils/review-comment';

const summary = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({
  headSha: 'abcdef1234567890',
  filesReviewed: 3,
  discarded: 0,
  score: 8,
  verdict: '`stores/create-bundle` is clear and its scenario covers what it claims.',
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

const REPO_URL = 'https://github.com/wix/skills';

describe('the review comment', () => {
  // The fixtures below assert whole bodies. Everything outside them covers only what a
  // fixture cannot show: an invariant, or a shape none of them happens to contain.
  it('keeps the verdict and the reminder on markers neither of which contains the other', () => {
    expect(REVIEW_COMMENT_MARKER).not.toBe('<!-- evalforge-yaml-gate-action -->');
    expect(REVIEW_PENDING_MARKER).not.toContain(REVIEW_COMMENT_MARKER);
    expect(REVIEW_COMMENT_MARKER).not.toContain(REVIEW_PENDING_MARKER);
    expect(formatReviewFindings([finding()], summary(), [], REPO_URL)).toContain(REVIEW_COMMENT_MARKER);
    expect(formatReviewClean(summary())).toContain(REVIEW_COMMENT_MARKER);
    expect(formatReviewPending('abcdef1')).toContain(REVIEW_PENDING_MARKER);
  });

  // Real .md files, so a change to a body shows up in a PR diff as prose.
  describe('as it lands on the PR', () => {
    it('renders findings: counted here, posted on the changed lines', async () => {
      const body = formatReviewFindings(
        [finding(), finding({ severity: 'advisory' })],
        summary({ score: 5, verdict: '`stores/create-bundle` tells the agent to call a tool not every client has.' }),
        [],
        REPO_URL,
      );

      await expect(body).toMatchFileSnapshot('./fixtures/review-comment-findings.md');
    });

    // One finding GitHub had no changed file for: the comment is the only place it can be read.
    it('renders a finding GitHub could not place on the changed files', async () => {
      const unplaced = finding({
        file: 'skills/wix-manage/references/stores/create-product.md',
        line: 18,
        severity: 'advisory',
        quote: 'Create a product with a name, a price and an image.',
        consequence: 'Covers the same flow as this skill, so an agent finds two answers to one question.',
        suggestion: 'Fold the image step into `create-product` as an optional first step.',
      });
      const body = formatReviewFindings(
        [finding(), finding({ severity: 'advisory' }), unplaced],
        summary({ score: 5, verdict: '`stores/create-bundle` tells the agent to call a tool not every client has.' }),
        [unplaced],
        REPO_URL,
      );

      await expect(body).toMatchFileSnapshot('./fixtures/review-comment-findings-unplaced.md');
    });

    it('renders a review with nothing to raise', async () => {
      await expect(formatReviewClean(summary()))
        .toMatchFileSnapshot('./fixtures/review-comment-clean.md');
    });

    it('renders the reminder that a commit is unreviewed', async () => {
      await expect(formatReviewPending('abcdef1234567890'))
        .toMatchFileSnapshot('./fixtures/review-comment-pending.md');
    });

    // On the whole file, GitHub shows no line beside the comment, so the comment names and quotes it.
    it('renders a finding as the comment on its line, and on its whole file when GitHub refuses the line', async () => {
      const commented = finding({
        suggestion: 'Name the call itself — `POST /stores/v3/bundles` — so any agent can make it.',
      });
      const body = [
        formatFindingComment(commented, 'abcdef1234567890', REPO_URL, true),
        formatFindingComment(commented, 'abcdef1234567890', REPO_URL, false),
      ].join('\n\n---\n\n');

      await expect(body).toMatchFileSnapshot('./fixtures/review-comment-threads.md');
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
    expect(formatFindingComment(finding({ section: 'some prose' }), 'abcdef1', REPO_URL, true))
      .toContain('`some prose`');
  });

  it('reports discarded findings rather than passing a half-broken run off as clean', () => {
    expect(formatReviewClean(summary({ discarded: 2 }))).toContain('2 findings');
    expect(formatReviewFindings([finding()], summary({ discarded: 1 }), [], REPO_URL)).toContain('1 finding');
  });
});

describe('who triggered the review', () => {
  const summary = { headSha: 'abcdef1234567890', filesReviewed: 3, discarded: 0, score: 8, verdict: 'Fine.' };

  it('names the actor in the verdict line', () => {
    const body = formatReviewClean({ ...summary, triggeredBy: 'omerme' });
    expect(body).toContain('triggered by @omerme');
  });

  it('says nothing when the trigger is unknown', () => {
    expect(formatReviewClean(summary)).not.toContain('triggered by');
  });
});
