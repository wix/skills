import * as core from '@actions/core';
import { getConfig } from './utils/config';
import { getOctokit, getChangedFiles, upsertComment } from './utils/github';
import { EvalForgeClient } from './utils/evalforge';
import { categorizeChanges } from './utils/paths';
import { collectSkillChanges } from './utils/skill-changes';
import { formatValidationErrors, formatValidationPassed } from './utils/comment';
import type { ValidationError } from './utils/yaml';

export async function run(): Promise<void> {
  const config = getConfig();
  const octokit = getOctokit(config.githubToken);

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
    octokit, config.owner, config.repo, yamlFiles, mdFiles, config.baseSha, process.cwd(),
  );

  if (entries.length === 0 && errors.length === 0) {
    core.info('No affected skill entries — skipping eval');
    return;
  }

  core.info(`Affected entries: ${entries.length}`);

  if (errors.length > 0) {
    try {
      await upsertComment(octokit, config, formatValidationErrors(errors));
    } catch (e) {
      core.warning(`Failed to post PR comment: ${e instanceof Error ? e.message : String(e)}`);
    }
    core.setFailed(`Skill validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}) — see PR comment`);
    return;
  }

  // EvalForge tag validation
  const allTags = [...new Set(entries.flatMap(e => e.tags ?? []))];
  core.info(`Tags to validate: ${allTags.join(', ')}`);

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const availableTags = new Set(await evalforge.getTags(config.projectId));
  const tagErrors: ValidationError[] = [];

  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      if (!availableTags.has(tag)) {
        tagErrors.push({ entryTitle: entry.title, message: `unknown tag "${tag}"` });
      }
    }
  }

  if (tagErrors.length > 0) {
    try {
      await upsertComment(octokit, config, formatValidationErrors(tagErrors));
    } catch (e) {
      core.warning(`Failed to post PR comment: ${e instanceof Error ? e.message : String(e)}`);
    }
    core.setFailed(`Skill validation failed (${tagErrors.length} error${tagErrors.length === 1 ? '' : 's'}) — see PR comment`);
    return;
  }

  try {
    await upsertComment(octokit, config, formatValidationPassed());
  } catch (e) {
    core.warning(`Failed to post PR comment: ${e instanceof Error ? e.message : String(e)}`);
  }
  core.info('Validation passed — eval run not yet implemented');
}
