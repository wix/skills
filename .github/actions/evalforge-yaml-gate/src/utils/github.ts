import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  getChangedFiles as coreGetChangedFiles,
  makeCommenter as coreMakeCommenter,
  type ChangedFile,
  type Commenter,
} from '@wix/evalforge-core';
import { COMMENT_MARKER, PR_SWEEP_ACK_MARKER, PR_SWEEP_MARKER, PR_SWEEP_PENDING_MARKER } from './comment';
import { MD_RE, EVALS_RE } from './paths';
import { REVIEW_ACK_MARKER, REVIEW_COMMENT_MARKER, REVIEW_PENDING_MARKER, REVIEW_THREAD_MARKER } from './review-comment';

type Octokit = ReturnType<typeof github.getOctokit>;
export type { ChangedFile, Commenter };

export type Classification = {
  mdFiles: ChangedFile[];
  evalsAdded: ChangedFile[];
  evalsModified: ChangedFile[];
  evalsRemoved: ChangedFile[];
};

const GIT_STATUS_MAP: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  T: 'modified',
};

/**
 * Parses `git diff --name-status <before> <after>` output into `ChangedFile[]`, for the
 * merge-tag sweep (a push event, not a PR — there's no octokit file-list API to call here).
 * Copy (C) is treated as added and type-change (T) as modified; renames (R<score>) carry
 * both paths. Unrecognized status codes are skipped rather than guessed at.
 */
export function parseChangedFiles(diffOutput: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of diffOutput.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const letter = parts[0][0];
    if (letter === 'R') {
      files.push({ filename: parts[2], status: 'renamed', previousFilename: parts[1] });
      continue;
    }
    if (letter === 'C') {
      files.push({ filename: parts[2], status: 'added' });
      continue;
    }
    const status = GIT_STATUS_MAP[letter];
    if (!status) continue;
    files.push({ filename: parts[1], status });
  }
  return files;
}

export function classifyChanges(files: ChangedFile[]): Classification {
  const classification: Classification = { mdFiles: [], evalsAdded: [], evalsModified: [], evalsRemoved: [] };
  for (const file of files) {
    if (MD_RE.test(file.filename) && file.status !== 'removed') {
      classification.mdFiles.push(file);
    } else if (EVALS_RE.test(file.filename)) {
      if (file.status === 'added') classification.evalsAdded.push(file);
      else if (file.status === 'removed') classification.evalsRemoved.push(file);
      else if (file.status === 'modified' || file.status === 'renamed') classification.evalsModified.push(file);
    }
  }
  return classification;
}

export function getChangedFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
  return coreGetChangedFiles(octokit, owner, repo, prNumber);
}

export function fail(message: string, blocking: boolean): void {
  if (blocking) core.setFailed(message);
  else core.warning(message);
}

export function makeCommenter(octokit: Octokit, owner: string, repo: string, prNumber: number): Commenter {
  return coreMakeCommenter(octokit, { owner, repo, prNumber, marker: COMMENT_MARKER }, {
    warn: core.warning,
    writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
  });
}

/** The PR sweep's comment, upserted under its own marker so it sits beside the gate's rather than replacing it. */
export function makeSweepCommenter(octokit: Octokit, owner: string, repo: string, prNumber: number): Commenter {
  return coreMakeCommenter(octokit, { owner, repo, prNumber, marker: PR_SWEEP_MARKER }, {
    warn: core.warning,
    writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
  });
}

export type PendingCommenter = {
  post: (body: string) => Promise<void>;
  clear: () => Promise<void>;
  clearAck: () => Promise<void>;
};

/**
 * A reminder edited in place rather than re-posted — a new comment on every push notifies everyone
 * watching the PR — plus the ability to delete it, and the command acknowledgement, once a verdict
 * replaces them. `label` names the feature in the warning when a delete fails.
 */
function makePendingCommenter(
  octokit: Octokit, owner: string, repo: string, prNumber: number,
  markers: { pending: string; ack: string }, label: string,
): PendingCommenter {
  const post = coreMakeCommenter(octokit, { owner, repo, prNumber, marker: markers.pending }, {
    warn: core.warning,
    writeSummary: async (body: string) => { await core.summary.addRaw(body).write(); },
  });

  async function deleteMarked(toDelete: string[]): Promise<void> {
    try {
      const stale: number[] = [];
      for await (const page of octokit.paginate.iterator(octokit.rest.issues.listComments, {
        owner, repo, issue_number: prNumber, per_page: 100,
      })) {
        for (const comment of page.data) {
          const body = comment.body ?? '';
          if (toDelete.some(marker => body.includes(marker))) stale.push(comment.id);
        }
      }
      for (const comment_id of stale) {
        await octokit.rest.issues.deleteComment({ owner, repo, comment_id });
      }
    } catch (error) {
      core.warning(`Could not clear the ${label} reminder: ${String(error)}`);
    }
  }

  return {
    post,
    clear: () => deleteMarked([markers.pending, markers.ack]),
    clearAck: () => deleteMarked([markers.ack]),
  };
}

export function makeReviewPendingCommenter(
  octokit: Octokit, owner: string, repo: string, prNumber: number,
): PendingCommenter {
  return makePendingCommenter(
    octokit, owner, repo, prNumber,
    { pending: REVIEW_PENDING_MARKER, ack: REVIEW_ACK_MARKER }, 'skill review',
  );
}

export function makeSweepPendingCommenter(
  octokit: Octokit, owner: string, repo: string, prNumber: number,
): PendingCommenter {
  return makePendingCommenter(
    octokit, owner, repo, prNumber,
    { pending: PR_SWEEP_PENDING_MARKER, ack: PR_SWEEP_ACK_MARKER }, 'PR sweep',
  );
}

/**
 * The summary comment, in steps rather than one call: it is posted before the finding comments so
 * it reads first on the PR, and the earlier ones are retired only once the whole run is up.
 */
export type ReviewCommenter = {
  /** Resolves to the new comment's id, or undefined when it could only go to the job summary. */
  post: (body: string) => Promise<number | undefined>;
  edit: (id: number, body: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  retirePrior: (keep?: number) => Promise<void>;
};

export function makeReviewCommenter(octokit: Octokit, owner: string, repo: string, prNumber: number): ReviewCommenter {
  const warn = (what: string, error: unknown) =>
    core.warning(`Failed to ${what} the skill review comment: ${error instanceof Error ? error.message : String(error)}`);
  return {
    async post(body) {
      try {
        const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
        return data.id;
      } catch (error) {
        warn('post', error);
        await core.summary.addRaw(body).write();
        return undefined;
      }
    },
    async edit(id, body) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: id, body }).catch(error => warn('update', error));
    },
    async remove(id) {
      await octokit.rest.issues.deleteComment({ owner, repo, comment_id: id }).catch(error => warn('delete', error));
    },
    retirePrior: keep => outdatePriorReviews(octokit, owner, repo, prNumber, keep).catch(error => warn('outdate', error)),
  };
}

/** No `line`: a comment on the whole file. `fileBody` is the body there, which says what line it meant. */
export type ThreadComment = { path: string; line?: number; body: string; fileBody: string };

/** Resolves to the comments GitHub had nowhere to put, or undefined when the run could not post. */
export type ThreadPoster = (headSha: string, comments: ThreadComment[]) => Promise<ThreadComment[] | undefined>;

/**
 * One review per run, so a run notifies once. It is built as a draft a comment at a time, so a line
 * GitHub refuses falls back alone, to its file, then out; and it is submitted with no summary text,
 * since a review's text cannot be hidden as outdated. Nothing shows until it is submitted, so a
 * failed run only discards its draft, and the last run's comments are retired once the new ones are up.
 */
export function makeReviewThreadPoster(octokit: Octokit, owner: string, repo: string, prNumber: number): ThreadPoster {
  return async function post(headSha, comments) {
    const prior = await findPriorThreads(octokit, owner, repo, prNumber);
    const unplaced: ThreadComment[] = [];
    if (comments.length > 0) {
      let draft: { id: number; node_id: string } | undefined;
      try {
        await deleteOwnPendingReviews(octokit, owner, repo, prNumber);
        ({ data: draft } = await octokit.rest.pulls.createReview({ owner, repo, pull_number: prNumber, commit_id: headSha }));
        for (const comment of comments) {
          let placed = false;
          if (comment.line !== undefined) placed = await addThread(octokit, draft.node_id, comment.path, comment.body, comment.line);
          if (!placed) placed = await addThread(octokit, draft.node_id, comment.path, comment.fileBody);
          if (!placed) unplaced.push(comment);
        }
        if (unplaced.length === comments.length) {
          await octokit.rest.pulls.deletePendingReview({ owner, repo, pull_number: prNumber, review_id: draft.id });
        } else {
          await octokit.rest.pulls.submitReview({ owner, repo, pull_number: prNumber, review_id: draft.id, event: 'COMMENT' });
        }
      } catch (error) {
        core.warning(`Could not post the skill review on the changed lines: ${error instanceof Error ? error.message : String(error)}`);
        if (draft) await octokit.rest.pulls.deletePendingReview({ owner, repo, pull_number: prNumber, review_id: draft.id }).catch(() => {});
        return undefined;
      }
    }
    await retireThreads(octokit, prior);
    return unplaced;
  };
}

/** No `line`: on the whole file. A line or path GitHub cannot resolve comes back as no thread, not as an error. */
async function addThread(octokit: Octokit, reviewId: string, path: string, body: string, line?: number): Promise<boolean> {
  const result: { addPullRequestReviewThread: { thread: { id: string } | null } } = await octokit.graphql(
    'mutation($reviewId: ID!, $path: String!, $line: Int, $subjectType: PullRequestReviewThreadSubjectType!, $body: String!) {'
    + ' addPullRequestReviewThread(input: { pullRequestReviewId: $reviewId, path: $path, line: $line, side: RIGHT,'
    + ' subjectType: $subjectType, body: $body }) { thread { id } } }',
    { reviewId, path, line: line ?? null, subjectType: line === undefined ? 'FILE' : 'LINE', body },
  );
  return result.addPullRequestReviewThread.thread !== null;
}

/** GitHub allows one pending review per user, and a run that died mid-post leaves one behind. */
async function deleteOwnPendingReviews(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<void> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number: prNumber, per_page: 100 });
  for (const review of reviews.filter(candidate => candidate.state === 'PENDING')) {
    await octokit.rest.pulls.deletePendingReview({ owner, repo, pull_number: prNumber, review_id: review.id });
  }
}

type ThreadPage = {
  repository: { pullRequest: { reviewThreads: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      isResolved: boolean;
      comments: { totalCount: number; nodes: Array<{ id: string; body: string; isMinimized: boolean; viewerDidAuthor: boolean }> };
    }>;
  } } };
};

type PriorThread = { threadId: string; commentId: string; isMinimized: boolean };

/**
 * Only threads nobody has acted on. One someone resolved or replied to is theirs now, so it is
 * left as it is: not stamped outdated, and not folded away.
 */
async function findPriorThreads(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<PriorThread[]> {
  const prior: PriorThread[] = [];
  try {
    let cursor: string | null = null;
    do {
      const page: ThreadPage = await octokit.graphql(
        'query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {'
        + ' repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {'
        + ' reviewThreads(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor }'
        + ' nodes { id isResolved comments(first: 1) { totalCount nodes { id body isMinimized viewerDidAuthor } } } } } } }',
        { owner, repo, pr: prNumber, cursor },
      );
      const threads = page.repository.pullRequest.reviewThreads;
      for (const thread of threads.nodes) {
        const first = thread.comments.nodes[0];
        if (!first?.viewerDidAuthor || !first.body.includes(REVIEW_THREAD_MARKER)) continue;
        if (thread.isResolved || thread.comments.totalCount > 1) continue;
        prior.push({ threadId: thread.id, commentId: first.id, isMinimized: first.isMinimized });
      }
      cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
    } while (cursor !== null);
  } catch (error) {
    core.warning(`Could not find earlier skill review comments: ${String(error)}`);
  }
  return prior;
}

async function retireThreads(octokit: Octokit, prior: PriorThread[]): Promise<void> {
  for (const thread of prior) {
    try {
      if (!thread.isMinimized) {
        await octokit.graphql(
          'mutation($subjectId: ID!) { minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED }) { minimizedComment { isMinimized } } }',
          { subjectId: thread.commentId },
        );
      }
      await octokit.graphql(
        'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }',
        { threadId: thread.threadId },
      );
    } catch (error) {
      core.warning(`Could not mark an earlier skill review comment as outdated: ${String(error)}`);
    }
  }
}

async function outdatePriorReviews(
  octokit: Octokit, owner: string, repo: string, prNumber: number, keep?: number,
): Promise<void> {
  const priorNodeIds: string[] = [];
  for await (const page of octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner, repo, issue_number: prNumber, per_page: 100,
  })) {
    for (const comment of page.data) {
      if (comment.id !== keep && comment.body?.includes(REVIEW_COMMENT_MARKER)) priorNodeIds.push(comment.node_id);
    }
  }

  for (const subjectId of priorNodeIds) {
    try {
      await octokit.graphql(
        'mutation($subjectId: ID!) {'
        + ' minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED })'
        + ' { minimizedComment { isMinimized } } }',
        { subjectId },
      );
    } catch (error) {
      core.warning(`Could not mark an earlier skill review as outdated: ${String(error)}`);
    }
  }
}
