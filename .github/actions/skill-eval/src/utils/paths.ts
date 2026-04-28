import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

export type ChangedFile = { filename: string; status: string; previousFilename?: string };

export function categorizeChanges(files: ChangedFile[]): {
  yamlFiles: ChangedFile[];
  mdFiles: ChangedFile[];
} {
  const relevant = files.filter(f => f.status !== 'removed');
  return {
    yamlFiles: relevant.filter(f => /^yaml\/wix-manage\/.+\/documentation\.yaml$/.test(f.filename)),
    mdFiles: relevant.filter(f => /^skills\/wix-manage\/references\/.+\.md$/.test(f.filename)),
  };
}

export function resolveEntryPath(yamlPath: string, entryFile: string, workspaceRoot: string): string {
  const absYamlDir = resolve(workspaceRoot, dirname(yamlPath));
  const absEntry = resolve(absYamlDir, entryFile);
  const rel = relative(workspaceRoot, absEntry);
  if (rel.startsWith('..')) {
    throw new Error(`Entry path escapes workspace: ${entryFile} in ${yamlPath}`);
  }
  return rel;
}

export function fileExistsInWorkspace(repoRootPath: string): boolean {
  return existsSync(resolve(process.cwd(), repoRootPath));
}
