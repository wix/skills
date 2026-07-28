import { minimatch } from 'minimatch';

/** Everything but `skillDir` is relative to it. */
export type TagRules = {
  /** Repo-relative skill root, e.g. `skills/wix-app`. */
  skillDir: string;
  /** e.g. `references`. */
  referenceDir: string;
  /** Changes here derive nothing. */
  ignoreGlobs: string[];
  /** Changes here put the whole suite in play. */
  broadImpactGlobs: string[];
};

export type DerivedTags = {
  /** Reference-derived tags, sorted and deduped. */
  tags: string[];
  /**
   * Whole suite is in play. Drives selection only — expanding it to a tag union for the guard
   * would block a SKILL.md typo fix on any weak scenario in the repo.
   */
  broadImpact: boolean;
  /** Paths under `skillDir` no rule covered — reported, never blocking. */
  unmapped: string[];
};

export const DEFAULT_IGNORE_GLOBS: string[] = ['scripts/**'];

/** References that apply across scenarios, so no single tag describes them. */
export const DEFAULT_BROAD_IMPACT_GLOBS: string[] = [
  'SKILL.md',
  'references/APP_IDENTIFIERS.md',
  'references/APP_MARKET_REVIEW.md',
  'references/APP_VALIDATION.md',
  'references/CODE_QUALITY.md',
  'references/DOCUMENTATION.md',
  'references/EXTENSION_REGISTRATION.md',
];

/** `DASHBOARD_PAGE.md` → `dashboard-page`. */
export function tagForReferencePath(relativeReferencePath: string): string {
  return relativeReferencePath.replace(/\.md$/i, '').toLowerCase().replace(/_/g, '-');
}

function matchesAny(relativePath: string, globs: string[]): boolean {
  return globs.some(pattern => minimatch(relativePath, pattern, { dot: true }));
}

function relativeToSkillDir(changedPath: string, skillDir: string): string | undefined {
  const prefix = `${skillDir}/`;
  return changedPath.startsWith(prefix) ? changedPath.slice(prefix.length) : undefined;
}

/**
 * Changed paths → the tags whose scenarios must run.
 *
 * Order is load-bearing: ignore → broad-impact → reference → unmapped, first match wins. Let
 * the reference rule run first and `references/CODE_QUALITY.md` derives a `code-quality` tag
 * the coverage guard can never satisfy.
 */
export function deriveTags(changedPaths: string[], rules: TagRules): DerivedTags {
  const tags = new Set<string>();
  const unmapped: string[] = [];
  let broadImpact = false;

  const referencePrefix = `${rules.referenceDir}/`;

  for (const changedPath of changedPaths) {
    const relativePath = relativeToSkillDir(changedPath, rules.skillDir);
    if (relativePath === undefined) continue;

    if (matchesAny(relativePath, rules.ignoreGlobs)) continue;

    if (matchesAny(relativePath, rules.broadImpactGlobs)) {
      broadImpact = true;
      continue;
    }

    if (relativePath.startsWith(referencePrefix)) {
      const withinReferences = relativePath.slice(referencePrefix.length);
      const [head, ...rest] = withinReferences.split('/');
      // A sub-doc directory is already named for its capability.
      tags.add(rest.length > 0 ? head.toLowerCase() : tagForReferencePath(head));
      continue;
    }

    unmapped.push(changedPath);
  }

  return {
    tags: [...tags].sort(),
    broadImpact,
    unmapped: unmapped.sort(),
  };
}

export type ChangedPath = { path: string; status: string };

/** Scenario files added, modified or renamed. Removals are the sync plan's business. */
export function touchedScenarioPaths(changed: ChangedPath[], evalsGlob: string): string[] {
  return changed
    .filter(file => file.status !== 'removed' && minimatch(file.path, evalsGlob))
    .map(file => file.path)
    .sort();
}
