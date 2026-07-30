import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  getChangedFiles as coreGetChangedFiles,
  makeCommenter as coreMakeCommenter,
  type ChangedFile,
  type Commenter,
} from '@wix/evalforge-core';
import { COMMENT_MARKER } from './comment';
import { MD_RE, EVALS_RE } from './paths';

type Octokit = ReturnType<typeof github.getOctokit>;
export type { ChangedFile, Commenter };

export type Classification = {
  mdFiles: ChangedFile[];
  evalsAdded: ChangedFile[];
  evalsModified: ChangedFile[];
  evalsRemoved: ChangedFile[];
};

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
