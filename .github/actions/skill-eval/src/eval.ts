import * as core from '@actions/core';
import { getConfig } from './utils/config';
import { getOctokit, getChangedFiles, upsertComment } from './utils/github';
import { EvalForgeClient } from './utils/evalforge';
import { categorizeChanges, resolveEntryPath, fileExistsInWorkspace } from './utils/paths';
import { collectSkillChanges } from './utils/skill-changes';
import { formatValidationErrors } from './utils/comment';
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

  const entries = await collectSkillChanges(
    octokit, config.owner, config.repo, yamlFiles, mdFiles, config.baseSha, process.cwd(),
  );
  const allTags = [...new Set(entries.flatMap(e => e.tags ?? []))];

  if (allTags.length === 0) {
    core.info('No tags collected — skipping eval');
    return;
  }

  core.info(`Affected entries: ${entries.length}, tags: ${allTags.join(', ')}`);

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);
  const availableTags = new Set(await evalforge.getTags(config.projectId));

  const errors: ValidationError[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = `${entry.yamlPath}::${entry.title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!entry.tags?.length) {
      errors.push({ entryTitle: entry.title, message: 'missing tags (required when docsEntry is present)' });
    }

    let resolved: string;
    try {
      resolved = resolveEntryPath(entry.yamlPath, entry.file, process.cwd());
    } catch {
      errors.push({ entryTitle: entry.title, message: `invalid file path: ${entry.file}` });
      continue;
    }

    if (!fileExistsInWorkspace(resolved)) {
      errors.push({ entryTitle: entry.title, message: `file not found: ${resolved}` });
    }

    for (const tag of entry.tags ?? []) {
      if (!availableTags.has(tag)) {
        errors.push({ entryTitle: entry.title, message: `unknown tag "${tag}"` });
      }
    }
  }

  if (errors.length > 0) {
    await upsertComment(octokit, config, formatValidationErrors(errors));
    core.setFailed(`Skill validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}) — see PR comment`);
    return;
  }

  core.info('Validation passed — eval run not yet implemented');
}
