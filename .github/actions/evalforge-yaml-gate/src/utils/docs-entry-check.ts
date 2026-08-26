import { readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve as resolvePath } from 'node:path';
import { glob } from 'glob';
import * as jsYaml from 'js-yaml';
import { DOC_YAML_GLOB } from './paths';

const PORTALS_URL = 'https://dev.wix.com/docs/api/v1/available-portals';
const menuUrl = (portalId: string) =>
  `https://dev.wix.com/docs/api/v1/cache/get-cached-menu/public/${portalId}`;
const DEV_WIX_PREFIX = 'https://dev.wix.com';

type DocEntry = { file?: string; docsEntry?: string; title?: string };
type DocYaml = { apiDoc?: { docs?: DocEntry[] } };

export type DocsEntryTarget = {
  /** Skill .md path relative to the workspace root */
  file: string;
  /** documentation.yaml path relative to the workspace root */
  yamlPath: string;
  title: string;
  docsEntry: string;
};

export type DocsEntryProblem = DocsEntryTarget & {
  kind: 'portal-not-found' | 'node-not-found' | 'not-a-category';
  /** Menu node type actually found at the docsEntry path (not-a-category only) */
  nodeType?: string;
  /** Nearest CATEGORY ancestor URL to suggest instead (not-a-category only) */
  suggestion?: string;
};

export type DocsEntryValidation = {
  problems: DocsEntryProblem[];
  /** Set when the docs endpoints could not be reached — callers should warn and pass */
  serviceError?: string;
};

type Portal = {
  id?: string;
  config?: { docsUrl?: { basename?: string; path?: string } };
};

type MenuNode = {
  url?: string;
  menuNodeType?: string;
  displayName?: string;
  children?: MenuNode[];
};

function loadDocsEntryIndex(workspace: string): Map<string, DocsEntryTarget> {
  const index = new Map<string, DocsEntryTarget>();
  const found = glob.sync(DOC_YAML_GLOB, {
    cwd: workspace,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '.action-src/**'],
  });
  for (const rel of found) {
    const abs = resolvePath(workspace, rel);
    const parsed = (jsYaml.load(readFileSync(abs, 'utf8'), { schema: jsYaml.CORE_SCHEMA }) as DocYaml) ?? {};
    for (const e of parsed.apiDoc?.docs ?? []) {
      if (!e.file || !e.docsEntry || !e.title) continue;
      const fileAbs = resolvePath(dirname(abs), e.file);
      const fileRel = relative(workspace, fileAbs).split('\\').join('/');
      index.set(fileRel, { file: fileRel, yamlPath: rel, title: e.title, docsEntry: e.docsEntry });
    }
  }
  return index;
}

/**
 * Doc entries this PR introduces or repoints: present in the head workspace with no
 * base counterpart, or with a different docsEntry than base. Mirrors the docs
 * pipeline's wiring trigger (new doc / docsEntry change), so the gate validates
 * exactly the entries the pipeline will try to place in the menu after merge.
 */
export function changedDocsEntries(workspace: string, baseWorkspace: string): DocsEntryTarget[] {
  const head = loadDocsEntryIndex(workspace);
  const base = loadDocsEntryIndex(baseWorkspace);
  return [...head.values()].filter(
    (t) => base.get(t.file)?.docsEntry !== t.docsEntry,
  );
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '');
}

function portalPrefix(portal: Portal): string | null {
  const docsUrl = portal.config?.docsUrl;
  if (!docsUrl?.basename) return null;
  return DEV_WIX_PREFIX + normalizePath(`${docsUrl.basename}${docsUrl.path ?? ''}`);
}

/** Longest portal prefix the docsEntry falls under, or null */
function resolvePortal(
  docsEntry: string,
  portals: Portal[],
): { portal: Portal; prefix: string; nodePath: string } | null {
  const entry = normalizePath(docsEntry);
  let best: { portal: Portal; prefix: string } | null = null;
  for (const portal of portals) {
    const prefix = portalPrefix(portal);
    if (!prefix || !portal.id) continue;
    if (entry !== prefix && !entry.startsWith(prefix + '/')) continue;
    if (!best || prefix.length > best.prefix.length) best = { portal, prefix };
  }
  if (!best) return null;
  return { ...best, nodePath: entry.slice(best.prefix.length) };
}

type NodeLookup = { node: MenuNode; nearestCategoryAncestor?: MenuNode };

function findNode(nodes: MenuNode[], url: string, nearestCategory?: MenuNode): NodeLookup | null {
  for (const node of nodes) {
    if (node.url === url) return { node, nearestCategoryAncestor: nearestCategory };
    const nextCategory = node.menuNodeType === 'CATEGORY' ? node : nearestCategory;
    const found = findNode(node.children ?? [], url, nextCategory);
    if (found) return found;
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`);
  return res.json();
}

/**
 * Checks each docsEntry against the live docs menu — the same public menu the docs
 * pipeline walks when placing the skill after merge. A skill menu node can only be
 * created under a CATEGORY, so anything else is guaranteed to fail.
 */
export async function validateDocsEntries(targets: DocsEntryTarget[]): Promise<DocsEntryValidation> {
  if (targets.length === 0) return { problems: [] };

  const problems: DocsEntryProblem[] = [];
  try {
    const { portals = [] } = (await fetchJson(PORTALS_URL)) as { portals?: Portal[] };
    const menus = new Map<string, MenuNode[]>();

    for (const target of targets) {
      const resolved = resolvePortal(target.docsEntry, portals);
      if (!resolved) {
        problems.push({ ...target, kind: 'portal-not-found' });
        continue;
      }

      const portalId = resolved.portal.id!;
      let menu = menus.get(portalId);
      if (!menu) {
        menu = (await fetchJson(menuUrl(portalId))) as MenuNode[];
        menus.set(portalId, menu);
      }

      const lookup = resolved.nodePath ? findNode(menu, resolved.nodePath) : null;
      if (!lookup) {
        problems.push({ ...target, kind: 'node-not-found' });
        continue;
      }

      if (lookup.node.menuNodeType !== 'CATEGORY') {
        problems.push({
          ...target,
          kind: 'not-a-category',
          nodeType: lookup.node.menuNodeType,
          suggestion: lookup.nearestCategoryAncestor?.url
            ? resolved.prefix + lookup.nearestCategoryAncestor.url
            : undefined,
        });
      }
    }
  } catch (e) {
    return { problems: [], serviceError: e instanceof Error ? e.message : String(e) };
  }

  return { problems };
}
