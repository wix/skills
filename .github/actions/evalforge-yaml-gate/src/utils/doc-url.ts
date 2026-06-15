import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { glob } from 'glob';
import * as jsYaml from 'js-yaml';
import { DOC_YAML_GLOB } from './paths';

type DocEntry = { file?: string; docsEntry?: string; title?: string };
type DocYaml = { apiDoc?: { docs?: DocEntry[] } };

type DocInfo = { docsEntry: string; title: string };
type DocIndex = Map<string, DocInfo>;

const indexCache = new Map<string, DocIndex>();

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
      if (!e.file || !e.docsEntry || !e.title) continue;
      index.set(resolvePath(yamlDir, e.file), { docsEntry: e.docsEntry, title: e.title });
    }
  }
  indexCache.set(workspace, index);
  return index;
}

function slugify(displayName: string): string {
  const shouldAddDollarPrefix = displayName.startsWith('$');
  const slug = displayName
    .replace(/\(\)$|\( \)$/, '')
    .replace(/[ \W_]+/g, '-')
    .replace(/[a-z][A-Z]/g, (m) => m[0] + '-' + m[1].toLowerCase());

  let trimmedSlug = slug[0]?.match(/[ \W_]/) ? slug.slice(1) : slug;
  if (trimmedSlug.length > 0 && trimmedSlug.slice(-1).match(/[ \W_]/)) {
    trimmedSlug = trimmedSlug.slice(0, -1);
  }
  return `${shouldAddDollarPrefix ? '$' : ''}${trimmedSlug.toLowerCase()}`;
}

export function canonicalDocUrl(filePath: string, workspace: string): string | null {
  const info = buildDocIndex(workspace).get(resolvePath(workspace, filePath));
  if (!info) return null;
  const slug = slugify(info.title);
  if (!slug) return null;
  return `${info.docsEntry.replace(/\/+$/, '')}/skills/${slug}`;
}
