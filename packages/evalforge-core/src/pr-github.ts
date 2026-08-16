/**
 * PR plumbing shared by the repo's EvalForge actions.
 *
 * Octokit is declared structurally, as `author-gate.ts` already does, so this package
 * gains no dependency on `@actions/github` — a real Octokit satisfies these shapes.
 */

export type ChangedFile = { filename: string; status: string; previousFilename?: string };

type RawChangedFile = { filename: string; status: string; previous_filename?: string };

export type PrFilesClient = {
  paginate: (route: unknown, params: Record<string, unknown>) => Promise<RawChangedFile[]>;
  rest: { pulls: { listFiles: unknown } };
};

/**
 * The PR's cumulative diff against its base — not the last commit. A gate keyed on the
 * newest commit alone would miss files an earlier commit in the same PR changed.
 */
export async function getChangedFiles(
  octokit: PrFilesClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner, repo, pull_number: prNumber, per_page: 100,
  });
  return files.map(file => ({
    filename: file.filename,
    status: file.status,
    previousFilename: file.previous_filename,
  }));
}

export type CommentClient = {
  paginate: {
    iterator: (route: unknown, params: Record<string, unknown>) =>
      AsyncIterable<{ data: Array<{ id: number; body?: string | null }> }>;
  };
  rest: {
    issues: {
      listComments: unknown;
      updateComment: (params: { owner: string; repo: string; comment_id: number; body: string }) => Promise<unknown>;
      createComment: (params: { owner: string; repo: string; issue_number: number; body: string }) => Promise<{ data: { id: number } }>;
    };
  };
};

export type CommentTarget = {
  owner: string;
  repo: string;
  prNumber: number;
  /** HTML comment identifying this action's comment, e.g. `<!-- evalforge-skill-gate-action -->`. */
  marker: string;
};

export type CommentIo = {
  warn: (message: string) => void;
  /** Where to put the body when the comment API refuses it — normally the job summary. */
  writeSummary: (body: string) => Promise<void>;
};

export type Commenter = (body: string) => Promise<void>;

/**
 * Upserts a single marked PR comment, so repeated runs edit one comment rather than
 * spamming the thread. Never throws: a comment is a report, and losing it must not fail
 * the gate — the body goes to the job summary instead.
 *
 * `createIfMissing: false` makes it update-only: it retracts or rewrites a comment already on the
 * PR and does nothing when there is none, so a body that only makes sense as a replacement cannot
 * introduce itself.
 */
export function makeCommenter(
  octokit: CommentClient,
  target: CommentTarget,
  io: CommentIo,
  options: { createIfMissing?: boolean } = {},
): Commenter {
  let cachedId: number | undefined;
  let resolved = false;

  async function findExistingId(): Promise<number | undefined> {
    if (resolved) return cachedId;
    for await (const page of octokit.paginate.iterator(octokit.rest.issues.listComments, {
      owner: target.owner, repo: target.repo, issue_number: target.prNumber, per_page: 100,
    })) {
      const hit = page.data.find(comment => comment.body?.includes(target.marker));
      if (hit) { cachedId = hit.id; break; }
    }
    resolved = true;
    return cachedId;
  }

  return async function upsert(body: string): Promise<void> {
    try {
      const id = await findExistingId();
      if (id !== undefined) {
        await octokit.rest.issues.updateComment({
          owner: target.owner, repo: target.repo, comment_id: id, body,
        });
      } else {
        if (options.createIfMissing === false) {
          return;
        }
        const created = await octokit.rest.issues.createComment({
          owner: target.owner, repo: target.repo, issue_number: target.prNumber, body,
        });
        cachedId = created.data.id;
        resolved = true;
      }
    } catch (error) {
      io.warn(`Failed to post PR comment: ${error instanceof Error ? error.message : String(error)}`);
      await io.writeSummary(body);
    }
  };
}
