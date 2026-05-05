import * as core from '@actions/core';
import * as github from '@actions/github';
import type { Config } from './config';
import type { ChangedFile } from './paths';
import { COMMENT_MARKER } from './comment';

type Octokit = ReturnType<typeof github.getOctokit>;

export function fail(message: string, blocking: boolean): void {
  if (blocking) core.setFailed(message);
  else core.warning(message);
}

export async function getChangedFiles(octokit: Octokit, config: Config): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: config.owner,
    repo: config.repo,
    pull_number: config.prNumber,
    per_page: 100,
  });
  return files.map(f => ({
    filename: f.filename,
    status: f.status,
    previousFilename: f.previous_filename,
  }));
}

export async function upsertComment(octokit: Octokit, config: Config, body: string): Promise<void> {
  try {
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: config.owner,
      repo: config.repo,
      issue_number: config.prNumber,
      per_page: 100,
    });
    const existing = comments.find(c => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: config.owner,
        repo: config.repo,
        comment_id: existing.id,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        owner: config.owner,
        repo: config.repo,
        issue_number: config.prNumber,
        body,
      });
    }
  } catch (e) {
    core.error(`Failed to post PR comment: ${e instanceof Error ? e.message : String(e)}`);
    await core.summary.addRaw(body).write();
  }
}
