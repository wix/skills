import { readFile } from 'node:fs/promises';
import { posix, sep } from 'node:path';
import * as jsYaml from 'js-yaml';
import { glob } from 'glob';

export const MANIFEST_FILENAME = '.evalforge.yml';

export type Manifest = {
  manifestPath: string;
  gatedDir: string;
  coverage: Record<string, string[]>;
};

export type ManifestError = {
  manifestPath: string;
  message: string;
};

type RawManifest = { coverage?: unknown };

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export function parseManifest(raw: string): Record<string, string[]> {
  const parsed = jsYaml.load(raw) as RawManifest | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('manifest is empty or not an object');
  }
  const coverage = parsed.coverage;
  if (coverage === undefined) {
    throw new Error('missing top-level "coverage" key');
  }
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error('"coverage" must be a mapping of filename -> scenario-id list');
  }
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(coverage as Record<string, unknown>)) {
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error(`coverage key "${key}" must be a relative path with no ".." segments`);
    }
    if (!Array.isArray(value)) {
      throw new Error(`coverage["${key}"] must be a list of scenario IDs`);
    }
    const ids: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error(`coverage["${key}"] contains a non-string or empty scenario ID`);
      }
      ids.push(id.trim());
    }
    out[toPosix(key)] = ids;
  }
  return out;
}

export async function loadManifests(workspaceRoot: string): Promise<{
  manifests: Manifest[];
  errors: ManifestError[];
}> {
  const found = await glob(`**/${MANIFEST_FILENAME}`, {
    cwd: workspaceRoot,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '.action-src/**'],
    dot: true,
    posix: true,
  });

  const results = await Promise.all(found.sort().map(async (rel): Promise<Manifest | ManifestError> => {
    const manifestPath = toPosix(rel);
    try {
      const raw = await readFile(posix.join(workspaceRoot, rel), 'utf8');
      return {
        manifestPath,
        gatedDir: posix.dirname(manifestPath),
        coverage: parseManifest(raw),
      };
    } catch (e) {
      return { manifestPath, message: e instanceof Error ? e.message : String(e) };
    }
  }));

  const manifests: Manifest[] = [];
  const errors: ManifestError[] = [];
  for (const r of results) {
    if ('coverage' in r) manifests.push(r);
    else errors.push(r);
  }
  return { manifests, errors };
}

function isInside(filePath: string, dir: string): boolean {
  if (dir === '.') return true;
  const rel = posix.relative(dir, filePath);
  return rel !== '' && !rel.startsWith('..') && !posix.isAbsolute(rel);
}

export function findManifestForFile(filePath: string, manifests: Manifest[]): Manifest | undefined {
  const normalized = toPosix(filePath);
  let best: Manifest | undefined;
  for (const m of manifests) {
    if (!isInside(normalized, m.gatedDir)) continue;
    if (!best || m.gatedDir.length > best.gatedDir.length) best = m;
  }
  return best;
}

export function relativeToManifest(filePath: string, manifest: Manifest): string {
  return posix.relative(manifest.gatedDir, toPosix(filePath));
}

export function isManifestFile(filePath: string): boolean {
  return posix.basename(toPosix(filePath)) === MANIFEST_FILENAME;
}
