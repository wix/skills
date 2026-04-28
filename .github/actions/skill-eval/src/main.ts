import * as core from '@actions/core';
import * as github from '@actions/github';
import { categorizeChanges } from './utils/paths';
import { deduplicateAffectedEntries } from './utils/yaml';
import { collectFromYamlChanges, collectFromMdChanges } from './utils/skill-changes';

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    core.setSecret(token);

    const ctx = github.context;
    if (!ctx.payload.pull_request) {
      core.info('Not a pull request — skipping');
      return;
    }

    const pr = ctx.payload.pull_request;
    const prNumber = pr.number as number;
    const baseSha = (pr.base as { sha: string }).sha;
    const { owner, repo } = ctx.repo;

    core.info(`Skill eval — PR #${prNumber}`);

    const octokit = github.getOctokit(token);

    const allFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner, repo, pull_number: prNumber, per_page: 100,
    });
    const files = allFiles.map(f => ({
      filename: f.filename,
      status: f.status,
      previousFilename: f.previous_filename,
    }));

    const { yamlFiles, mdFiles } = categorizeChanges(files);

    if (yamlFiles.length === 0 && mdFiles.length === 0) {
      core.info('No relevant changes — skipping');
      return;
    }

    core.info(`Changed YAML files: ${yamlFiles.map(f => f.filename).join(', ') || 'none'}`);
    core.info(`Changed MD files: ${mdFiles.map(f => f.filename).join(', ') || 'none'}`);

    const [yamlEntries, mdEntries] = await Promise.all([
      yamlFiles.length > 0 ? collectFromYamlChanges(octokit, owner, repo, yamlFiles, baseSha) : [],
      mdFiles.length > 0 ? collectFromMdChanges(mdFiles, process.cwd()) : [],
    ]);

    const dedupedEntries = deduplicateAffectedEntries([...yamlEntries, ...mdEntries]);
    const allTags = [...new Set(dedupedEntries.flatMap(e => e.tags ?? []))];

    if (allTags.length === 0) {
      core.info('No tags collected — skipping eval');
      return;
    }

    core.info(`Affected entries: ${dedupedEntries.length}`);
    core.info(`Tags to evaluate: ${allTags.join(', ')}`);
    core.info('Phase 0 complete — Phase 1 (validation) not yet implemented');
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
