import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { glob } from 'glob';
import * as jsYaml from 'js-yaml';
import { DOC_YAML_GLOB } from './paths';

type DocEntry = { file?: string; docsEntry?: string };
type DocYaml = { apiDoc?: { docs?: DocEntry[] } };

type DocIndex = Map<string, string>;  // absolute md path → docsEntry

const indexCache = new Map<string, DocIndex>();  // workspace → built index

function buildDocIndex(workspace: string): DocIndex {
  const cached = indexCache.get(workspace);
  if (cached) return cached;

  const index: DocIndex = new Map();
  const found = glob.sync(DOC_YAML_GLOB, {
    cwd: workspace,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '.action-src/**'],
  });
  for (const rel of found) {
    const abs = resolvePath(workspace, rel);
    const yamlDir = dirname(abs);
    const raw = readFileSync(abs, 'utf8');
    const parsed = (jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) as DocYaml) ?? {};
    for (const e of parsed.apiDoc?.docs ?? []) {
      if (!e.file || !e.docsEntry) continue;
      index.set(resolvePath(yamlDir, e.file), e.docsEntry);
    }
  }
  indexCache.set(workspace, index);
  return index;
}

export function resolveDocsEntry(filePath: string, workspace: string): string | null {
  return buildDocIndex(workspace).get(resolvePath(workspace, filePath)) ?? null;
}

export function canonicalDocUrl(filePath: string, workspace: string): string | null {
  const docsEntry = resolveDocsEntry(filePath, workspace);
  if (!docsEntry) return null;
  const stem = basename(filePath, '.md');
  return `${docsEntry.replace(/\/+$/, '')}/skills/${stem}`;
}
