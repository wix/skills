import * as github from '@actions/github';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'glob';
import { parseDocumentationYaml, diffYamlEntries, filterSkillEntries, deduplicateAffectedEntries } from './yaml';
import { resolveEntryPath, fileExistsInWorkspace } from './paths';
import type { AffectedEntry, DocEntry, ValidationError } from './yaml';
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
): Promise<{ entries: AffectedEntry[], errors: ValidationError[] }> {
  const [yamlResult, mdResult] = await Promise.all([
    collectFromYamlChanges(octokit, owner, repo, yamlFiles, baseSha, workspaceRoot),
    collectFromMdChanges(mdFiles, workspaceRoot),
  ]);
  const entries = deduplicateAffectedEntries([...yamlResult.entries, ...mdResult.entries]);
  const entryErrors = validateEntries(entries, workspaceRoot);
  return { entries, errors: [...yamlResult.errors, ...mdResult.errors, ...entryErrors] };
}

async function collectFromYamlChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  yamlFiles: ChangedFile[],
  baseSha: string,
  workspaceRoot: string
): Promise<{ entries: AffectedEntry[], errors: ValidationError[] }> {
  const oldPaths = yamlFiles.map(f => f.previousFilename ?? f.filename);
  const oldContents = await fetchFilesAtRef(octokit, owner, repo, oldPaths, baseSha);
  const entries: AffectedEntry[] = [];
  const errors: ValidationError[] = [];

  for (const yamlFile of yamlFiles) {
    const oldRaw = oldContents[yamlFile.previousFilename ?? yamlFile.filename];
    let oldEntries: DocEntry[], newEntries: DocEntry[];
    try {
      const newRaw = readFileSync(join(workspaceRoot, yamlFile.filename), 'utf-8');
      oldEntries = oldRaw ? parseDocumentationYaml(oldRaw) : [];
      newEntries = parseDocumentationYaml(newRaw);
    } catch (e) {
      errors.push({ entryTitle: yamlFile.filename, message: `failed to parse: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const diffed = diffYamlEntries(oldEntries, newEntries);
    entries.push(...diffed.map(e => ({ ...e, yamlPath: yamlFile.filename })));
  }

  return { entries, errors };
}

export function validateEntry(entry: AffectedEntry, workspaceRoot: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const location = `(${entry.yamlPath})`;
  if (!entry.tags?.length) {
    errors.push({ entryTitle: entry.title, message: `missing tags — at least one tag is required ${location}` });
  }
  let resolved: string;
  try {
    resolved = resolveEntryPath(entry.yamlPath, entry.file, workspaceRoot);
  } catch {
    errors.push({ entryTitle: entry.title, message: `invalid file path: ${entry.file} ${location}` });
    return errors;
  }
  if (!fileExistsInWorkspace(resolved, workspaceRoot)) {
    errors.push({ entryTitle: entry.title, message: `file not found: ${resolved} ${location}` });
  }
  return errors;
}

function validateEntries(entries: AffectedEntry[], workspaceRoot: string): ValidationError[] {
  return entries.flatMap(entry => validateEntry(entry, workspaceRoot));
}

async function collectFromMdChanges(
  mdFiles: ChangedFile[],
  workspaceRoot: string
): Promise<{ entries: AffectedEntry[], errors: ValidationError[] }> {
  const changedMdSet = new Set(mdFiles.map(f => f.filename));
  const allYamlPaths = await glob('yaml/wix-manage/**/documentation.yaml', { cwd: workspaceRoot });
  const entries: AffectedEntry[] = [];
  const errors: ValidationError[] = [];

  for (const yamlPath of allYamlPaths) {
    let skillEntries;
    try {
      skillEntries = filterSkillEntries(parseDocumentationYaml(readFileSync(join(workspaceRoot, yamlPath), 'utf-8')));
    } catch (e) {
      errors.push({ entryTitle: yamlPath, message: `failed to parse: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    for (const entry of skillEntries) {
      let resolvedPath: string;
      try {
        resolvedPath = resolveEntryPath(yamlPath, entry.file, workspaceRoot);
      } catch (e) {
        errors.push({ entryTitle: entry.title, message: `invalid file path: ${entry.file} (${yamlPath})` });
        continue;
      }
      if (changedMdSet.has(resolvedPath)) {
        entries.push({ ...entry, yamlPath });
      }
    }
  }

  return { entries, errors };
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
