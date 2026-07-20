import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'path';
import { resolveEvals } from './resolve';
import { EvalForge } from './evalforge';
import { buildComment } from './comment';

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const octokit = github.getOctokit(token);
  const pr = github.context.payload.pull_request as any;
  if (!pr) { core.info('Not a pull_request event; skipping.'); return; }
  const { owner, repo } = github.context.repo;

  const ef = new EvalForge({
    base: core.getInput('evalforge-url', { required: true }),
    project: core.getInput('evalforge-project-id', { required: true }),
    appId: core.getInput('evalforge-app-id', { required: true }),
    appSecret: core.getInput('evalforge-app-secret', { required: true }),
  });
  const agentId = core.getInput('evalforge-agent-id', { required: true });
  const entryCap = core.getInput('evalforge-entry-cap-id', { required: true });
  const skillsRepo = core.getInput('skills-repo') || `${owner}/${repo}`;
  const pollTimeout = parseInt(core.getInput('poll-timeout-min') || '45', 10);

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
  const changed = files.map((f: any) => f.filename);
  const e2eLabel = (pr.labels || []).some((l: any) => l.name === 'run-e2e');

  const mapPath = path.join(__dirname, '..', 'headless-eval-map.yaml');
  const resolved = resolveEvals(changed, mapPath, e2eLabel);
  core.info('Resolved: ' + JSON.stringify(resolved));

  const postComment = (body: string) =>
    octokit.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });

  if (!resolved.dryRunTags.length && !resolved.e2eRun.length) {
    core.info('No wix-headless changes mapped to scenarios.');
    await postComment('_No wix-headless changes mapped to eval scenarios._');
    return;
  }

  const branch = pr.head.ref as string;
  const { versionId, state } = await ef.ensureBranchEntryVersion(entryCap, branch, skillsRepo, 'skills/wix-headless/entry/skill.md');
  core.info(`entry version ${state}: ${versionId}`);
  const scenarios = await ef.selectScenarios(resolved);
  core.info(`selected ${Object.keys(scenarios).length} scenarios`);
  const runs = await ef.launch(scenarios, agentId, entryCap, versionId);
  core.info(`launched ${Object.keys(runs).length} runs`);
  const results = await ef.poll(runs, pollTimeout);

  await postComment(buildComment(resolved, state, branch, results));
  const failed = results.some(r => r.judge !== 'passed');
  core.setOutput('eval_failed', String(failed));
  core.info(`eval_failed=${failed}`);
}

run().catch(e => core.setFailed(e instanceof Error ? e.message : String(e)));
