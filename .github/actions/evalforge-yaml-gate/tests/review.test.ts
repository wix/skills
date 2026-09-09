import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import type { ChangedFile } from '../src/utils/github';
import type { ReviewFinding } from '../src/utils/review-comment';
import type { AgentOutcome } from '../src/utils/review-agent';

// `vi.hoisted` because `vi.mock` is hoisted above these declarations, and this file imports the
// mocked modules at the top — so a factory would run before a plain `const` spy was initialised.
const {
  getChangedFiles, runReviewAgent, upsert, postPending, clearPending, getHeadCommitAuthorEmail,
  existsSync,
} =
  vi.hoisted(() => ({
    getChangedFiles: vi.fn<() => Promise<ChangedFile[]>>(),
    runReviewAgent: vi.fn<() => Promise<AgentOutcome>>(),
    upsert: vi.fn<(body: string) => Promise<void>>(),
    postPending: vi.fn<(body: string) => Promise<void>>(),
    clearPending: vi.fn<() => Promise<void>>(),
    getHeadCommitAuthorEmail: vi.fn<() => Promise<string | undefined>>(),
    existsSync: vi.fn<() => boolean>(),
  }));

vi.mock('../src/utils/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/github')>();
  return {
    ...actual, getChangedFiles,
    makeReviewCommenter: () => upsert,
    makeReviewPendingCommenter: () => ({ post: postPending, clear: clearPending }),
  };
});

vi.mock('@wix/evalforge-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wix/evalforge-core')>();
  return { ...actual, getHeadCommitAuthorEmail };
});

vi.mock('../src/utils/review-agent', () => ({ runReviewAgent }));

vi.mock('node:fs', () => ({ existsSync }));

const payload: { action: string; pull_request: unknown } = {
  action: 'opened',
  pull_request: { number: 42, head: { sha: 'abcdef1234' }, base: { sha: 'base5678' } },
};
vi.mock('@actions/github', () => ({
  getOctokit: () => ({}),
  context: { repo: { owner: 'wix', repo: 'skills' }, get payload() { return payload; } },
}));

const REVIEW_INPUTS: Record<string, string> = {
  'INPUT_GITHUB-TOKEN': 'gh-token',
  'INPUT_ANTHROPIC-API-KEY': 'wix-sk-test-key',
};

/** Matches MD_RE in src/utils/paths.ts — the gate's own definition of wix-manage content. */
const IN_SCOPE: ChangedFile[] = [
  { filename: 'skills/wix-manage/references/stores/create-bundle.md', status: 'added' },
];

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  file: 'skills/wix-manage/references/stores/create-bundle.md',
  line: 12,
  section: 'CONTRIBUTING.md#stay-agnostic-to-agent-and-client',
  severity: 'blocking',
  quote: 'call ReadFullDocsArticle',
  consequence: 'An agent without that tool cannot follow the instruction.',
  ...over,
});

let setFailed: ReturnType<typeof vi.spyOn>;

async function run(): Promise<void> {
  const { runReview } = await import('../src/utils/review');
  await runReview();
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue(undefined);
  postPending.mockResolvedValue(undefined);
  clearPending.mockResolvedValue(undefined);
  getHeadCommitAuthorEmail.mockResolvedValue('someone@wix.com');
  getChangedFiles.mockResolvedValue(IN_SCOPE);
  runReviewAgent.mockResolvedValue({ ok: true, findings: [], discarded: 0 });
  existsSync.mockReturnValue(true);
  payload.action = 'opened';
  delete process.env.GITHUB_RUN_ATTEMPT;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key];
  }
  process.env.INPUT_MODE = 'review';
  for (const [key, value] of Object.entries(REVIEW_INPUTS)) process.env[key] = value;

  setFailed = vi.spyOn(core, 'setFailed').mockImplementation(() => {});
  vi.spyOn(core, 'warning').mockImplementation(() => undefined as never);
  vi.spyOn(core, 'info').mockImplementation(() => {});
  vi.spyOn(core, 'setSecret').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('review mode — whether it spends', () => {
  it.each([
    ['a newly opened PR', 'opened', '1'],
    ['a draft marked ready for review', 'ready_for_review', '1'],
    // A re-run replays the original payload, so `/review` after a push still arrives as
    // `synchronize`; without the attempt check the manual command would silently do nothing.
    ['a re-run whose replayed payload says synchronize', 'synchronize', '2'],
  ])('reviews %s', async (_label, action, attempt) => {
    payload.action = action;
    process.env.GITHUB_RUN_ATTEMPT = attempt;
    await run();
    expect(runReviewAgent).toHaveBeenCalledOnce();
    expect(clearPending).toHaveBeenCalledOnce();
  });

  it('reviews an eval scenario change as well as a skill change', async () => {
    getChangedFiles.mockResolvedValue([
      { filename: 'yaml/wix-manage-evals/stores/create-bundle.yml', status: 'modified' },
    ]);
    await run();
    expect(runReviewAgent).toHaveBeenCalledOnce();
  });

  it('leaves the verdict standing on a push and asks for a review of the new commit', async () => {
    payload.action = 'synchronize';
    await run();
    expect(runReviewAgent).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(postPending).toHaveBeenCalledOnce();
    expect(postPending.mock.calls[0][0]).toContain('/review');
    expect(postPending.mock.calls[0][0]).toContain('abcdef1');
  });

  it('does not run the agent for a non-Wix author, and says so on the PR', async () => {
    getHeadCommitAuthorEmail.mockResolvedValue('someone@example.com');
    await run();
    expect(runReviewAgent).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0][0]).toContain('Review job skipped');
    expect(setFailed).not.toHaveBeenCalled();
  });

  // A reminder from an earlier push must not outlive the change it asked about.
  it.each([
    ['nothing in scope changed', () => getChangedFiles.mockResolvedValue([{ filename: 'README.md', status: 'modified' }])],
    ['the author is not a wix author', () => getHeadCommitAuthorEmail.mockResolvedValue('someone@example.com')],
  ])('clears any standing reminder when %s', async (_label, setUp) => {
    setUp();
    await run();
    expect(runReviewAgent).not.toHaveBeenCalled();
    expect(clearPending).toHaveBeenCalledOnce();
  });

  it('reports a missing prompt rather than reviewing without its rules', async () => {
    process.env.INPUT_BLOCKING = 'true';
    existsSync.mockReturnValue(false);
    await run();
    expect(runReviewAgent).not.toHaveBeenCalled();
    expect(postPending.mock.calls[0][0]).toContain('prompt');
    expect(upsert).not.toHaveBeenCalled();
    expect(setFailed).toHaveBeenCalledOnce();
  });
});

describe('review mode — what may and may not fail the check', () => {
  it.each([
    ['a blocking finding while soaking', [finding()], undefined, false],
    ['a blocking finding once blocking is on', [finding()], 'true', true],
    ['a finding that is not blocking', [finding({ severity: 'fix-before-merge' })], 'true', false],
    ['no findings at all', [], 'true', false],
  ])('%s', async (_label, findings, blocking, fails) => {
    if (blocking) process.env.INPUT_BLOCKING = blocking;
    runReviewAgent.mockResolvedValue({ ok: true, findings, discarded: 0 });
    await run();
    expect(setFailed).toHaveBeenCalledTimes(fails ? 1 : 0);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it.each([
    ['a discarded finding alongside good ones', [finding({ severity: 'fix-before-merge' })], 1],
    ['a discarded finding and nothing else', [], 1],
  ])('reports the findings and the drop count, then fails, on %s', async (_label, findings, discarded) => {
    process.env.INPUT_BLOCKING = 'true';
    runReviewAgent.mockResolvedValue({ ok: true, findings, discarded });
    await run();
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toContain('⚠️ Review job partly completed — 1 finding could not be read');
    expect(clearPending).toHaveBeenCalledOnce();
    expect(setFailed).toHaveBeenCalledOnce();
    expect(setFailed.mock.calls[0][0]).toContain('1 malformed finding(s)');
  });

  it('comments even when there is nothing to report, so a green check is legible', async () => {
    await run();
    expect(upsert.mock.calls[0][0]).toContain('No findings');
    expect(upsert.mock.calls[0][0]).toContain('abcdef1');
  });

  // A commit nobody could review is not a reviewed commit, so every one of these fails the check.
  it.each([
    ['a timeout', () => runReviewAgent.mockResolvedValue({ ok: false, reason: 'it exceeded its time limit and was stopped' })],
    ['a missing CLI', () => runReviewAgent.mockResolvedValue({ ok: false, reason: 'the reviewer is not installed on this runner' })],
    ['unparseable output', () => runReviewAgent.mockResolvedValue({ ok: false, reason: 'it did not return findings in the expected format' })],
    ['an unreadable changed-file list', () => getChangedFiles.mockRejectedValue(new Error('502'))],
    ['a broken author lookup', () => getHeadCommitAuthorEmail.mockRejectedValue(new Error('502'))],
  ])('fails the check on %s', async (_label, breakIt) => {
    process.env.INPUT_BLOCKING = 'true';
    breakIt();
    await run();
    expect(setFailed).toHaveBeenCalledOnce();
    expect(postPending).toHaveBeenCalledOnce();
    expect(postPending.mock.calls[0][0]).not.toContain('wix-sk');
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing in scope changed', () => getChangedFiles.mockResolvedValue([{ filename: 'README.md', status: 'modified' }])],
    ['the author is not a wix author', () => getHeadCommitAuthorEmail.mockResolvedValue('someone@example.com')],
  ])('does not gate an unreviewed head when %s', async (_label, setUp) => {
    process.env.INPUT_BLOCKING = 'true';
    payload.action = 'synchronize';
    setUp();
    await run();
    expect(setFailed).not.toHaveBeenCalled();
  });

  it('does not let an unreviewed head pass once blocking is on', async () => {
    process.env.INPUT_BLOCKING = 'true';
    payload.action = 'synchronize';
    await run();
    expect(setFailed).toHaveBeenCalledOnce();
    expect(setFailed.mock.calls[0][0]).toContain('/review');
  });
});
