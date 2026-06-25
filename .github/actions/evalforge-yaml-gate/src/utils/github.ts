import * as core from '@actions/core';
import * as github from '@actions/github';
import { COMMENT_MARKER } from './comment';
import { MD_RE, EVALS_RE } from './paths';

type Octokit = ReturnType<typeof github.getOctokit>;
export type ChangedFile = { filename: string; status: string; previousFilename?: string };

export type Classification = {
  mdFiles: ChangedFile[];
  evalsAdded: ChangedFile[];
  evalsModified: ChangedFile[];
  evalsRemoved: ChangedFile[];
};

export function classifyChanges(files: ChangedFile[]): Classification {
  const c: Classification = { mdFiles: [], evalsAdded: [], evalsModified: [], evalsRemoved: [] };
  for (const f of files) {
    if (MD_RE.test(f.filename) && f.status !== 'removed') {
      c.mdFiles.push(f);
    } else if (EVALS_RE.test(f.filename)) {
      if (f.status === 'added') c.evalsAdded.push(f);
      else if (f.status === 'removed') c.evalsRemoved.push(f);
      else if (f.status === 'modified' || f.status === 'renamed') c.evalsModified.push(f);
    }
  }
  return c;
}

export async function getChangedFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 });
  return files.map(f => ({ filename: f.filename, status: f.status, previousFilename: f.previous_filename }));
}

export function fail(message: string, blocking: boolean): void {
  if (blocking) core.setFailed(message);
  else core.warning(message);
}

export function makeCommenter(octokit: Octokit, owner: string, repo: string, prNumber: number) {
  let cachedId: number | undefined;
  let resolved = false;

  async function findExistingId(): Promise<number | undefined> {
    if (resolved) return cachedId;
    for await (const page of octokit.paginate.iterator(octokit.rest.issues.listComments, {
      owner, repo, issue_number: prNumber, per_page: 100,
    })) {
      const hit = page.data.find(c => c.body?.includes(COMMENT_MARKER));
      if (hit) { cachedId = hit.id; break; }
    }
    resolved = true;
    return cachedId;
  }

  return async function upsert(body: string): Promise<void> {
    try {
      const id = await findExistingId();
      if (id !== undefined) {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: id, body });
      } else {
        const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
        cachedId = created.data.id;
      }
    } catch (e) {
      core.error(`Failed to post PR comment: ${e instanceof Error ? e.message : String(e)}`);
      await core.summary.addRaw(body).write();
    }
  };
}
