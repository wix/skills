import { readFileSync } from 'node:fs';
import { dirname, relative, resolve as resolvePath } from 'node:path';
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
  children?: MenuNode[];
};

function loadDocsEntryIndex(workspace: string): Map<string, DocsEntryTarget> {
  const index = new Map<string, DocsEntryTarget>();
  const yamlPaths = glob.sync(DOC_YAML_GLOB, {
    cwd: workspace,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '.action-src/**'],
  });
  for (const yamlPath of yamlPaths) {
    const yamlAbsolutePath = resolvePath(workspace, yamlPath);
    const parsedYaml =
      (jsYaml.load(readFileSync(yamlAbsolutePath, 'utf8'), { schema: jsYaml.CORE_SCHEMA }) as DocYaml) ?? {};
    for (const entry of parsedYaml.apiDoc?.docs ?? []) {
      if (!entry.file || !entry.docsEntry || !entry.title) continue;
      const skillFileAbsolutePath = resolvePath(dirname(yamlAbsolutePath), entry.file);
      const skillFilePath = relative(workspace, skillFileAbsolutePath).split('\\').join('/');
      index.set(skillFilePath, {
        file: skillFilePath,
        yamlPath,
        title: entry.title,
        docsEntry: entry.docsEntry,
      });
    }
  }
  return index;
}

/**
 * Doc entries this PR introduces or repoints — exactly the entries the docs
 * pipeline will try to place in the menu after merge.
 */
export function changedDocsEntries(workspace: string, baseWorkspace: string): DocsEntryTarget[] {
  const headIndex = loadDocsEntryIndex(workspace);
  const baseIndex = loadDocsEntryIndex(baseWorkspace);
  return [...headIndex.values()].filter(
    (target) => baseIndex.get(target.file)?.docsEntry !== target.docsEntry,
  );
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function portalUrlPrefix(portal: Portal): string | null {
  const docsUrl = portal.config?.docsUrl;
  if (!docsUrl?.basename) return null;
  return DEV_WIX_PREFIX + stripTrailingSlashes(`${docsUrl.basename}${docsUrl.path ?? ''}`);
}

/** Longest portal prefix the docsEntry falls under, or null */
function resolvePortal(
  docsEntry: string,
  portals: Portal[],
): { portal: Portal; prefix: string; nodePath: string } | null {
  const docsEntryUrl = stripTrailingSlashes(docsEntry);
  let bestMatch: { portal: Portal; prefix: string } | null = null;
  for (const portal of portals) {
    const prefix = portalUrlPrefix(portal);
    if (!prefix || !portal.id) continue;
    if (docsEntryUrl !== prefix && !docsEntryUrl.startsWith(prefix + '/')) continue;
    if (!bestMatch || prefix.length > bestMatch.prefix.length) bestMatch = { portal, prefix };
  }
  if (!bestMatch) return null;
  return { ...bestMatch, nodePath: docsEntryUrl.slice(bestMatch.prefix.length) };
}

type NodeLookup = { node: MenuNode; nearestCategoryAncestor?: MenuNode };

function findNode(nodes: MenuNode[], url: string, nearestCategory?: MenuNode): NodeLookup | null {
  for (const node of nodes) {
    if (node.url === url) return { node, nearestCategoryAncestor: nearestCategory };
    const nearestForChildren = node.menuNodeType === 'CATEGORY' ? node : nearestCategory;
    const match = findNode(node.children ?? [], url, nearestForChildren);
    if (match) return match;
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} responded ${response.status}`);
  return response.json();
}

/**
 * Checks each docsEntry against the live docs menu. A skill menu node can only
 * be created under a CATEGORY, so anything else is guaranteed to fail.
 */
export async function validateDocsEntries(targets: DocsEntryTarget[]): Promise<DocsEntryValidation> {
  if (targets.length === 0) return { problems: [] };

  const problems: DocsEntryProblem[] = [];
  try {
    const { portals = [] } = (await fetchJson(PORTALS_URL)) as { portals?: Portal[] };
    const menusByPortalId = new Map<string, MenuNode[]>();

    for (const target of targets) {
      const resolvedPortal = resolvePortal(target.docsEntry, portals);
      if (!resolvedPortal) {
        problems.push({ ...target, kind: 'portal-not-found' });
        continue;
      }

      const portalId = resolvedPortal.portal.id!;
      let menu = menusByPortalId.get(portalId);
      if (!menu) {
        menu = (await fetchJson(menuUrl(portalId))) as MenuNode[];
        menusByPortalId.set(portalId, menu);
      }

      const nodeLookup = resolvedPortal.nodePath ? findNode(menu, resolvedPortal.nodePath) : null;
      if (!nodeLookup) {
        problems.push({ ...target, kind: 'node-not-found' });
        continue;
      }

      if (nodeLookup.node.menuNodeType !== 'CATEGORY') {
        problems.push({
          ...target,
          kind: 'not-a-category',
          nodeType: nodeLookup.node.menuNodeType,
          suggestion: nodeLookup.nearestCategoryAncestor?.url
            ? resolvedPortal.prefix + nodeLookup.nearestCategoryAncestor.url
            : undefined,
        });
      }
    }
  } catch (error) {
    return { problems: [], serviceError: error instanceof Error ? error.message : String(error) };
  }

  return { problems };
}
