import * as core from '@actions/core';
import * as github from '@actions/github';

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const url = core.getInput('evalforge-url', { required: true });
    const projectId = core.getInput('evalforge-project-id', { required: true });
    const appId = core.getInput('evalforge-app-id', { required: true });
    const appSecret = core.getInput('evalforge-app-secret', { required: true });

    const octokit = github.getOctokit(token);
    const context = github.context;

    if (!context.payload.pull_request) {
      core.info('Not a pull request — skipping');
      return;
    }

    const comment = await checkConnection(url, projectId, appId, appSecret);

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request.number;
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });

    core.info(comment);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

async function checkConnection(url: string, projectId: string, appId: string, appSecret: string): Promise<string> {
  try {
    const res = await fetch(`${url}/projects/${projectId}`, {
      headers: {
        'x-app-id': appId,
        'x-app-secret': appSecret,
      },
    });

    if (res.ok) {
      const data = await res.json() as { name?: string };
      return `**EvalForge connection OK** — project \`${data.name ?? projectId}\``;
    }

    const text = await res.text();
    return `**EvalForge error** — ${res.status}: ${text}`;
  } catch (err) {
    return `**EvalForge unreachable** — ${err instanceof Error ? err.message : String(err)}`;
  }
}

run();
