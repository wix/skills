import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as jsYaml from 'js-yaml';
import * as core from '@actions/core';
import { canonicalDocUrl, registeredDocFiles } from './doc-url';
import { AREA_RE } from './paths';

/** Undirected adjacency: doc file -> doc files linked to it via frontmatter references. */
export type ReferenceGraph = Map<string, Set<string>>;

/** A doc plus the references it declares — the input to the pure graph builder. */
export type DocNode = { file: string; area: string | null; slug: string | null; refs: string[] };

/**
 * Builds the undirected reference graph. A doc is linked to each doc its frontmatter references,
 * resolved by canonical slug (a slug shared across areas is disambiguated to the referrer's own
 * area); an unresolvable reference is warned about and skipped rather than failing the gate.
 * Pure over `nodes`, so it can be unit-tested without the filesystem.
 */
export function buildGraph(nodes: DocNode[], warn: (message: string) => void = () => {}): ReferenceGraph {
  const bySlug = new Map<string, DocNode[]>();
  for (const node of nodes) {
    if (node.slug) (bySlug.get(node.slug) ?? bySlug.set(node.slug, []).get(node.slug)!).push(node);
  }

  const graph: ReferenceGraph = new Map();
  const link = (a: string, b: string) => {
    (graph.get(a) ?? graph.set(a, new Set()).get(a)!).add(b);
    (graph.get(b) ?? graph.set(b, new Set()).get(b)!).add(a);
  };

  for (const node of nodes) {
    for (const ref of node.refs) {
      const slug = (ref.split('/').pop() ?? ref).replace(/\.md$/i, '');
      const hits = bySlug.get(slug) ?? [];
      const target = hits.length === 1 ? hits[0] : hits.find(h => h.area === node.area);
      if (!target) {
        warn(`reference-graph: unresolved reference "${ref}" (slug "${slug}") in ${node.file} — skipping`);
        continue;
      }
      if (target.file !== node.file) link(node.file, target.file);
    }
  }
  return graph;
}

/** Reads registered docs and their frontmatter references to build the graph for a workspace. */
export function buildReferenceGraph(workspace: string): ReferenceGraph {
  const nodes: DocNode[] = registeredDocFiles(workspace).map(file => ({
    file,
    area: file.match(AREA_RE)?.[1] ?? null,
    slug: canonicalDocUrl(file, workspace)?.split('/skills/')[1]?.split('/')[0] ?? null,
    refs: frontmatterReferences(resolvePath(workspace, file)),
  }));
  return buildGraph(nodes, message => core.warning(message));
}

/** The union of the connected components containing `seeds` (an isolated seed returns itself). */
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

function frontmatterReferences(absFile: string): string[] {
  let raw: string;
  try { raw = readFileSync(absFile, 'utf8'); } catch { return []; }
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  let parsed: unknown;
  try { parsed = jsYaml.load(fm[1], { schema: jsYaml.CORE_SCHEMA }); } catch { return []; }
  const refs = (parsed as { references?: unknown } | null)?.references;
  if (!Array.isArray(refs)) return [];
  return refs
    .map(r => (typeof (r as { path?: unknown })?.path === 'string' ? (r as { path: string }).path : null))
    .filter((p): p is string => p !== null);
}
