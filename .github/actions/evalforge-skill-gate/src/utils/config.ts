import * as core from '@actions/core';
import * as github from '@actions/github';
import { ensureHttps, safeGetSecret, getPrNumber } from '@wix/evalforge-core';

export type SyncConfig = {
  evalforgeUrl: string;
  projectId: string;
  appId: string;
  appSecret: string;
  evalsGlob: string;
  repo: string;
  githubToken: string;
  prNumber: number;
};

export function getSyncConfig(): SyncConfig {
  return {
    evalforgeUrl: ensureHttps(core, core.getInput('evalforge-url', { required: true })),
    projectId: core.getInput('evalforge-project-id', { required: true }),
    appId: safeGetSecret(core, 'evalforge-app-id'),
    appSecret: safeGetSecret(core, 'evalforge-app-secret'),
    evalsGlob: core.getInput('evals-glob', { required: true }),
    repo: `${github.context.repo.owner}/${github.context.repo.repo}`,
    githubToken: core.getInput('github-token', { required: true }),
    prNumber: getPrNumber(github.context.payload),
  };
}
