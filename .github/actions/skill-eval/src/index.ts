import * as core from '@actions/core';
import { getConfig } from './utils/config';
import * as github from '@actions/github';
import { getChangedFiles, upsertComment } from './utils/github';
import { EvalForgeClient } from './utils/evalforge';
import { categorizeChanges } from './utils/paths';
import { collectSkillChanges } from './utils/skill-changes';
import { formatValidationErrors, formatValidationPassed, formatFailedJobMessage, formatServiceError } from './utils/comment';
import type { ValidationError } from './utils/yaml';

async function run(): Promise<void> {
  const config = getConfig();
  const octokit = github.getOctokit(config.githubToken);

  core.info(`Skill eval — PR #${config.prNumber}`);

  const allFiles = await getChangedFiles(octokit, config);
  const { yamlFiles, mdFiles } = categorizeChanges(allFiles);

  if (yamlFiles.length === 0 && mdFiles.length === 0) {
    core.info('No relevant changes — skipping');
    return;
  }

  core.info(`Changed YAML files: ${yamlFiles.map(f => f.filename).join(', ') || 'none'}`);
  core.info(`Changed MD files: ${mdFiles.map(f => f.filename).join(', ') || 'none'}`);

  const { entries, errors } = await collectSkillChanges(
    octokit, config.owner, config.repo, yamlFiles, mdFiles, config.baseSha, process.env.GITHUB_WORKSPACE ?? process.cwd(),
  );

  if (entries.length === 0 && errors.length === 0) {
    core.info('No affected skill entries — skipping eval');
    return;
  }

  core.info(`Affected entries: ${entries.length}`);

  if (errors.length > 0) {
    await upsertComment(octokit, config, formatValidationErrors(errors));
    core.setFailed(formatFailedJobMessage(errors));
    return;
  }

  // EvalForge tag validation

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  let availableTags: Set<string>;
  try {
    availableTags = await evalforge.getTags(config.projectId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await upsertComment(octokit, config, formatServiceError(`EvalForge request failed: ${message}`));
    core.setFailed(`EvalForge request failed: ${message}`);
    return;
  }
  const tagErrors: ValidationError[] = [];

  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      if (!availableTags.has(tag)) {
        tagErrors.push({ entryTitle: entry.title, message: `unknown tag "${tag}"` });
      }
    }
  }

  if (tagErrors.length > 0) {
    await upsertComment(octokit, config, formatValidationErrors(tagErrors));
    core.setFailed(formatFailedJobMessage(tagErrors));
    return;
  }

  await upsertComment(octokit, config, formatValidationPassed());
  core.info('Validation passed — eval run not yet implemented');
}

run().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
