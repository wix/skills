import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

type ChangedFile = { filename: string; status: string };

export function categorizeChanges(files: ChangedFile[]): {
  yamlFiles: ChangedFile[];
  mdFiles: ChangedFile[];
} {
  const relevant = files.filter(f => f.status !== 'removed');
  return {
    yamlFiles: relevant.filter(f => f.filename.match(/^yaml\/wix-manage\/.+\/documentation\.yaml$/)),
    mdFiles: relevant.filter(f => f.filename.match(/^skills\/wix-manage\/.+\.md$/)),
  };
}

export function resolveEntryPath(yamlPath: string, entryFile: string): string {
  const absYamlDir = resolve(process.cwd(), dirname(yamlPath));
  const absEntry = resolve(absYamlDir, entryFile);
  return absEntry.slice(process.cwd().length + 1);
}

export function fileExistsInWorkspace(repoRootPath: string): boolean {
  return existsSync(resolve(process.cwd(), repoRootPath));
}
