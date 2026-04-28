import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFileSync } from 'node:fs';
import { glob } from 'glob';
import { parseDocumentationYaml, diffYamlEntries } from './utils/yaml';
import { categorizeChanges, resolveEntryPath } from './utils/paths';
import type { DocEntry } from './utils/yaml';

type AffectedEntry = DocEntry & { yamlPath: string };

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
    const phaseZeroErrors: Array<{ entryTitle: string; message: string }> = [];

    // ── Path A: changed YAML files ───────────────────────────────────────────
    if (yamlFiles.length > 0) {
      // For renamed files, fetch old content using the previous filename (it didn't exist at baseSha under the new name)
      const oldPaths = yamlFiles.map(f => f.previousFilename ?? f.filename);
      const oldContents = await batchFetchFilesAtRef(octokit, owner, repo, oldPaths, baseSha);

      for (const yamlFile of yamlFiles) {
        const oldRaw = oldContents[yamlFile.previousFilename ?? yamlFile.filename];
        const newRaw = readFileSync(yamlFile.filename, 'utf-8');
        const { affectedEntries: entries, errors } = diffYamlEntries(
          oldRaw ? parseDocumentationYaml(oldRaw) : [],
          parseDocumentationYaml(newRaw)
        );
        affectedEntries.push(...entries.map(e => ({ ...e, yamlPath: yamlFile.filename })));
        phaseZeroErrors.push(...errors);
      }
    }

    // ── Path B: changed MD files — reverse lookup ────────────────────────────
    if (mdFiles.length > 0) {
      // Include previous filenames for renamed MDs — YAML entries still point to the old path
      const changedMdSet = new Set(mdFiles.flatMap(f => f.previousFilename ? [f.filename, f.previousFilename] : [f.filename]));
      const allYamlPaths = await glob('yaml/wix-manage/**/documentation.yaml');

      for (const yamlPath of allYamlPaths) {
        const entries = parseDocumentationYaml(readFileSync(yamlPath, 'utf-8'));
        for (const entry of entries) {
          if (changedMdSet.has(resolveEntryPath(yamlPath, entry.file, process.cwd()))) {
            affectedEntries.push({ ...entry, yamlPath });
          }
        }
      }
    }

    const allTags = [...new Set(affectedEntries.flatMap(e => e.tags ?? []))];

    if (phaseZeroErrors.length > 0) {
      core.warning(`Phase 0 issues:\n${phaseZeroErrors.map(e => `  - ${e.entryTitle}: ${e.message}`).join('\n')}`);
    }

    if (allTags.length === 0) {
      core.info('No tags collected — skipping eval');
      return;
    }

    core.info(`Affected entries: ${affectedEntries.length}`);
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

  for (const p of paths) {
    if (p.includes('"') || p.includes('\\')) {
      throw new Error(`Unsafe file path for GraphQL: ${p}`);
    }
  }

  const fields = paths
    .map((p, i) => `f${i}: object(expression: "${ref}:${p}") { ... on Blob { text } }`)
    .join('\n');

  const query = `query { repository(owner: "${owner}", name: "${repo}") { ${fields} } }`;

  const result = await octokit.graphql<{
    repository: Record<string, { text: string | null } | null>;
  }>(query);

  return Object.fromEntries(paths.map((p, i) => [p, result.repository[`f${i}`]?.text ?? null]));
}

run();
