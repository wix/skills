import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as jsYaml from 'js-yaml';
import * as core from '@actions/core';
import { canonicalDocUrl, registeredDocFiles } from './doc-url';
import { AREA_RE } from './paths';

/** Undirected adjacency: doc file -> the doc files it is linked to via frontmatter references. */
export type ReferenceGraph = Map<string, Set<string>>;

function areaOf(file: string): string | null {
  const m = file.match(AREA_RE);
  return m ? m[1] : null;
}

/** The canonical slug of a doc, i.e. the last segment of its `.../skills/<slug>` canonical URL. */
function slugOfDoc(file: string, workspace: string): string | null {
  const url = canonicalDocUrl(file, workspace);
  const seg = url?.split('/skills/')[1];
  return seg ? seg.split('/')[0] : null;
}

/** The child slug a `references[].path` points at — its basename without the `.md` suffix. */
function refSlug(refPath: string): string {
  return (refPath.split('/').pop() ?? refPath).replace(/\.md$/i, '');
}

function frontmatterReferencePaths(absFile: string): string[] {
  let raw: string;
  try { raw = readFileSync(absFile, 'utf8'); } catch { return []; }
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  let parsed: unknown;
  try { parsed = jsYaml.load(fm[1], { schema: jsYaml.CORE_SCHEMA }); } catch { return []; }
  const refs = (parsed as { references?: unknown } | null)?.references;
  if (!Array.isArray(refs)) return [];
  return refs
    .map(r => (r && typeof (r as { path?: unknown }).path === 'string' ? (r as { path: string }).path : null))
    .filter((p): p is string => p !== null);
}

/**
 * Builds the undirected reference graph from injected lookups — the pure core, free of
 * filesystem access so it can be unit-tested with in-memory fixtures.
 *
 * An edge is added whenever a doc's frontmatter references another doc, resolved by canonical
 * slug (a reference path's basename). A slug shared by multiple areas is disambiguated to the
 * referrer's own area; an unresolvable reference is warned about and skipped rather than failing.
 */
export function buildGraphFrom(input: {
  docs: string[];
  slugOf: (file: string) => string | null;
  areaOf: (file: string) => string | null;
  referencesOf: (file: string) => string[];
  warn?: (message: string) => void;
}): ReferenceGraph {
  const { docs, slugOf, areaOf: areaFn, referencesOf, warn = () => {} } = input;

  const bySlug = new Map<string, string[]>();
  for (const file of docs) {
    const slug = slugOf(file);
    if (!slug) continue;
    (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)!).push(file);
  }

  const graph: ReferenceGraph = new Map();
  const link = (a: string, b: string) => {
    (graph.get(a) ?? graph.set(a, new Set()).get(a)!).add(b);
    (graph.get(b) ?? graph.set(b, new Set()).get(b)!).add(a);
  };

  for (const file of docs) {
    const area = areaFn(file);
    for (const refPath of referencesOf(file)) {
      const slug = refSlug(refPath);
      const candidates = bySlug.get(slug) ?? [];
      const target = candidates.length === 1
        ? candidates[0]
        : candidates.find(c => areaFn(c) === area);
      if (!target) {
        warn(`reference-graph: unresolved reference "${refPath}" (slug "${slug}") in ${file} — skipping`);
        continue;
      }
      if (target !== file) link(file, target);
    }
  }
  return graph;
}

/** Builds the reference graph for a workspace from registered docs' frontmatter references. */
export function buildReferenceGraph(workspace: string): ReferenceGraph {
  const docs = registeredDocFiles(workspace);
  return buildGraphFrom({
    docs,
    slugOf: file => slugOfDoc(file, workspace),
    areaOf,
    referencesOf: file => frontmatterReferencePaths(resolvePath(workspace, file)),
    warn: message => core.warning(message),
  });
}

/**
 * The union of the connected components containing `seeds`. Isolated seeds (no edges) return
 * themselves, so callers can pass the changed docs directly and get back the docs to run.
 */
export function connectedDocs(graph: ReferenceGraph, seeds: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const doc = stack.pop()!;
    if (seen.has(doc)) continue;
    seen.add(doc);
    for (const neighbor of graph.get(doc) ?? []) {
      if (!seen.has(neighbor)) stack.push(neighbor);
    }
  }
  return seen;
}
