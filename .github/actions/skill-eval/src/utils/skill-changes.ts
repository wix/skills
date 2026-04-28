import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFileSync } from 'node:fs';
import { glob } from 'glob';
import { parseDocumentationYaml, diffYamlEntries, filterSkillEntries, deduplicateAffectedEntries } from './yaml';
import { resolveEntryPath } from './paths';
import type { AffectedEntry, DocEntry } from './yaml';
import type { ChangedFile } from './paths';

type Octokit = ReturnType<typeof github.getOctokit>;

export async function collectSkillChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  yamlFiles: ChangedFile[],
  mdFiles: ChangedFile[],
  baseSha: string,
  workspaceRoot: string
): Promise<AffectedEntry[]> {
  const [yamlEntries, mdEntries] = await Promise.all([
    collectFromYamlChanges(octokit, owner, repo, yamlFiles, baseSha),
    collectFromMdChanges(mdFiles, workspaceRoot),
  ]);
  return deduplicateAffectedEntries([...yamlEntries, ...mdEntries]);
}

async function collectFromYamlChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  yamlFiles: ChangedFile[],
  baseSha: string
): Promise<AffectedEntry[]> {
  const oldPaths = yamlFiles.map(f => f.previousFilename ?? f.filename);
  const oldContents = await fetchFilesAtRef(octokit, owner, repo, oldPaths, baseSha);
  const result: AffectedEntry[] = [];

  for (const yamlFile of yamlFiles) {
    const oldRaw = oldContents[yamlFile.previousFilename ?? yamlFile.filename];
    let oldEntries: DocEntry[], newEntries: DocEntry[];
    try {
      const newRaw = readFileSync(yamlFile.filename, 'utf-8');
      oldEntries = oldRaw ? parseDocumentationYaml(oldRaw) : [];
      newEntries = parseDocumentationYaml(newRaw);
    } catch (e) {
      core.warning(`Failed to parse ${yamlFile.filename}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const entries = diffYamlEntries(oldEntries, newEntries);
    result.push(...entries.map(e => ({ ...e, yamlPath: yamlFile.filename })));
  }

  return result;
}

async function collectFromMdChanges(
  mdFiles: ChangedFile[],
  workspaceRoot: string
): Promise<AffectedEntry[]> {
  const changedMdSet = new Set(mdFiles.map(f => f.filename));
  const allYamlPaths = await glob('yaml/wix-manage/**/documentation.yaml');
  const result: AffectedEntry[] = [];

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
        resolvedPath = resolveEntryPath(yamlPath, entry.file, workspaceRoot);
      } catch (e) {
        core.warning(`Skipping invalid entry path "${entry.file}" in ${yamlPath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (changedMdSet.has(resolvedPath)) {
        result.push({ ...entry, yamlPath });
      }
    }
  }

  return result;
}

async function fetchFilesAtRef(
  octokit: Octokit,
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
