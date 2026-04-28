import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFileSync } from 'node:fs';
import { glob } from 'glob';
import { parseDocumentationYaml, diffYamlEntries, deduplicateAffectedEntries, filterSkillEntries } from './utils/yaml';
import { categorizeChanges, resolveEntryPath } from './utils/paths';
import type { AffectedEntry, DocEntry } from './utils/yaml';

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

    const affectedEntries: AffectedEntry[] = [];

    // ── Path A: changed YAML files ───────────────────────────────────────────
    if (yamlFiles.length > 0) {
      // For renamed files, fetch old content using the previous filename (it didn't exist at baseSha under the new name)
      const oldPaths = yamlFiles.map(f => f.previousFilename ?? f.filename);
      const oldContents = await batchFetchFilesAtRef(octokit, owner, repo, oldPaths, baseSha);

      for (const yamlFile of yamlFiles) {
        const oldRaw = oldContents[yamlFile.previousFilename ?? yamlFile.filename];
        const newRaw = readFileSync(yamlFile.filename, 'utf-8');
        let oldEntries: DocEntry[], newEntries: DocEntry[];
        try {
          oldEntries = oldRaw ? parseDocumentationYaml(oldRaw) : [];
          newEntries = parseDocumentationYaml(newRaw);
        } catch (e) {
          core.warning(`Failed to parse ${yamlFile.filename}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const entries = diffYamlEntries(oldEntries, newEntries);
        affectedEntries.push(...entries.map(e => ({ ...e, yamlPath: yamlFile.filename })));
      }
    }

    // ── Path B: changed MD files — reverse lookup ────────────────────────────
    if (mdFiles.length > 0) {
      // Include previous filenames for renamed MDs — YAML entries still point to the old path
      const changedMdSet = new Set(mdFiles.flatMap(f => f.previousFilename ? [f.filename, f.previousFilename] : [f.filename]));
      const allYamlPaths = await glob('yaml/wix-manage/**/documentation.yaml');

      for (const yamlPath of allYamlPaths) {
        let entries;
        try {
          entries = parseDocumentationYaml(readFileSync(yamlPath, 'utf-8'));
        } catch (e) {
          core.warning(`Failed to parse ${yamlPath}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        for (const entry of filterSkillEntries(entries)) {
          let resolvedPath: string;
          try {
            resolvedPath = resolveEntryPath(yamlPath, entry.file, process.cwd());
          } catch (e) {
            core.warning(`Skipping invalid entry path "${entry.file}" in ${yamlPath}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
          }
          if (changedMdSet.has(resolvedPath)) {
            affectedEntries.push({ ...entry, yamlPath });
          }
        }
      }
    }

    const dedupedEntries = deduplicateAffectedEntries(affectedEntries);
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

async function batchFetchFilesAtRef(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  paths: string[],
  ref: string
): Promise<Record<string, string | null>> {
  if (paths.length === 0) return {};

  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, string | null]> => {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        if (!Array.isArray(data) && data.type === 'file' && data.encoding === 'base64') {
          return [path, Buffer.from(data.content, 'base64').toString('utf-8')];
        }
        return [path, null];
      } catch (e) {
        if ((e as { status?: number }).status === 404) return [path, null];
        throw e;
      }
    })
  );

  return Object.fromEntries(entries);
}

run();
