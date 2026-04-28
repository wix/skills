import * as core from '@actions/core';
import * as github from '@actions/github';

export type Config = {
  githubToken: string;
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  prNumber: number;
  baseSha: string;
  owner: string;
  repo: string;
};

function safeGetSecret(name: string): string {
  const value = core.getInput(name, { required: true });
  core.setSecret(value);
  return value;
}

export function getConfig(): Config {
  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');

  return {
    githubToken: safeGetSecret('github-token'),
    evalforgeUrl: core.getInput('evalforge-url', { required: true }),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret('evalforge-app-id'),
    appSecret: safeGetSecret('evalforge-app-secret'),
    prNumber: pr.number as number,
    baseSha: (pr.base as { sha: string }).sha,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}
