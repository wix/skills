import { minimatch } from 'minimatch';

export type TagRules = {
  /** Repo-relative skill root, e.g. `skills/wix-app`. */
  skillDir: string;
  /** Reference directory relative to `skillDir`, e.g. `references`. */
  referenceDir: string;
  /** Globs, relative to `skillDir`, whose changes derive nothing at all. */
  ignoreGlobs: string[];
  /** Globs, relative to `skillDir`, whose changes put the whole suite in play. */
  broadImpactGlobs: string[];
};

export type DerivedTags = {
  /** Reference-derived tags only — sorted and deduped. Never includes broad-impact expansion. */
  tags: string[];
  /**
   * A cross-cutting file changed, so the whole suite is in play. Consumed by scenario
   * selection only: a broad-impact path derives no tag, so there is no tag for the coverage
   * guard to demand a scenario for. Feeding an expanded tag union to the guard instead would
   * block a SKILL.md typo fix on any weak scenario anywhere in the repo.
   */
  broadImpact: boolean;
  /** Paths under `skillDir` that no rule covered — reported, never blocking. */
  unmapped: string[];
};

export const DEFAULT_IGNORE_GLOBS: string[] = ['scripts/**'];

/**
 * `SKILL.md` plus the six references that apply across scenarios rather than to one
 * capability. "Changed → run everything" is the honest semantics for these: their effect is
 * not confined to one capability, so no single tag could describe it, and demanding a
 * `code-quality`-tagged scenario would be asking for a scenario that verifies nothing in
 * particular.
 */
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
 * Classifies the PR's changed paths into the tags whose scenarios must run.
 *
 * Precedence is first-match-wins: **ignore → broad-impact → reference → unmapped**. The
 * order is load-bearing. A broad-impact file that happens to live inside `referenceDir` must
 * be caught before the reference rule sees it, or `references/CODE_QUALITY.md` would derive
 * a `code-quality` tag and the coverage guard would block on a tag no scenario will ever
 * carry.
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
      // A sub-doc directory is already named for its capability, so the directory name is
      // the tag; a flat reference file derives its tag from the filename.
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

/**
 * Scenario files this PR added, modified or renamed. Removals are excluded: a deleted
 * scenario cannot be quality-checked, and the sync plan handles the delete.
 */
export function touchedScenarioPaths(changed: ChangedPath[], evalsGlob: string): string[] {
  return changed
    .filter(file => file.status !== 'removed' && minimatch(file.path, evalsGlob))
    .map(file => file.path)
    .sort();
}
