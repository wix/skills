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

export function getConfig(): Config {
  const githubToken = core.getInput('github-token', { required: true });
  core.setSecret(githubToken);

  const appSecret = core.getInput('evalforge-app-secret', { required: true });
  core.setSecret(appSecret);

  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');

  return {
    githubToken,
    evalforgeUrl: core.getInput('evalforge-url', { required: true }),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: core.getInput('evalforge-app-id', { required: true }),
    appSecret,
    prNumber: pr.number as number,
    baseSha: (pr.base as { sha: string }).sha,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}
