import * as core from "@actions/core";
import * as github from "@actions/github";

async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token", { required: true });
    const baseUrl = core.getInput("evalforge-url", { required: true });
    const projectId = core.getInput("evalforge-project-id", { required: true });
    const appId = core.getInput("evalforge-app-id", { required: true });
    const appSecret = core.getInput("evalforge-app-secret", { required: true });

    core.setSecret(token);
    core.setSecret(appId);
    core.setSecret(appSecret);

    const octokit = github.getOctokit(token);
    const context = github.context;

    if (!context.payload.pull_request) {
      core.info("Not a pull request — skipping");
      return;
    }

    const comment = await checkConnection(baseUrl, projectId, appId, appSecret);

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request.number;
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });

    core.info(comment);
  } catch (error) {
    core.error(error instanceof Error ? error.message : "Unknown error");
  }
}

async function checkConnection(
  url: string,
  projectId: string,
  appId: string,
  appSecret: string,
): Promise<string> {
  try {
    // Strip trailing slash if present
    const baseUrl = url.replace(/\/$/, "");

    const res = await fetch(`${baseUrl}/projects/${projectId}`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "x-app-id": appId,
        "x-app-secret": appSecret,
      },
    });

    if (res.ok) {
      const data = (await res.json()) as { name?: string };
      return `**EvalForge connection OK** — project \`${data.name ?? projectId}\``;
    }

    const text = await res.text();
    core.debug(`EvalForge error body: ${text}`);
    const snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    return `**EvalForge error** — ${res.status}: ${snippet}`;
  } catch (err) {
    return `**EvalForge unreachable** — ${err instanceof Error ? err.message : String(err)}`;
  }
}

run();
