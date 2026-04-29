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

function ensureHttps(url: string): string {
  if (url.startsWith('https://')) return url;
  const upgraded = 'https://' + url.replace(/^https?:\/\//, '');
  core.warning(`evalforge-url was not HTTPS — upgraded to: ${upgraded}`);
  return upgraded;
}

function safeGetSecret(name: string): string {
  const value = core.getInput(name, { required: true });
  core.setSecret(value);
  return value;
}

export function getConfig(): Config {
  const pr = github.context.payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');

  const prNumber = pr.number as number | undefined;
  const baseSha = (pr.base as { sha?: string } | undefined)?.sha;
  if (!prNumber || !baseSha) throw new Error('PR payload is missing required fields (number or base.sha)');

  return {
    githubToken: safeGetSecret('github-token'),
    evalforgeUrl: ensureHttps(core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret('evalforge-app-id'),
    appSecret: safeGetSecret('evalforge-app-secret'),
    prNumber,
    baseSha,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}
