import { describe, it, expect } from 'vitest';
import {
  deriveTags, touchedScenarioPaths,
  DEFAULT_IGNORE_GLOBS, DEFAULT_BROAD_IMPACT_GLOBS, type TagRules,
} from '../src/derive-tags';

const WIX_APP_RULES: TagRules = {
  skillDir: 'skills/wix-app',
  referenceDir: 'references',
  ignoreGlobs: DEFAULT_IGNORE_GLOBS,
  broadImpactGlobs: DEFAULT_BROAD_IMPACT_GLOBS,
};

describe('deriveTags — precedence', () => {
  it('classifies references/CODE_QUALITY.md as broad impact and derives no tag from it', () => {
    const derived = deriveTags(['skills/wix-app/references/CODE_QUALITY.md'], WIX_APP_RULES);
    expect(derived.broadImpact).toBe(true);
    expect(derived.tags).toEqual([]);
    expect(derived.unmapped).toEqual([]);
  });

  it('treats each of the six cross-cutting references as broad impact, tagless', () => {
    for (const crossCutting of [
      'APP_IDENTIFIERS.md', 'APP_MARKET_REVIEW.md', 'APP_VALIDATION.md',
      'CODE_QUALITY.md', 'DOCUMENTATION.md', 'EXTENSION_REGISTRATION.md',
    ]) {
      const derived = deriveTags([`skills/wix-app/references/${crossCutting}`], WIX_APP_RULES);
      expect(derived.broadImpact, crossCutting).toBe(true);
      expect(derived.tags, crossCutting).toEqual([]);
    }
  });

  it('ignores a path matching ignoreGlobs even though it sits under the skill dir', () => {
    const derived = deriveTags(['skills/wix-app/scripts/generate-auto-patterns.js'], WIX_APP_RULES);
    expect(derived).toEqual({ tags: [], broadImpact: false, unmapped: [] });
  });

  it('prefers ignore over broad impact when a path matches both', () => {
    const rules: TagRules = { ...WIX_APP_RULES, ignoreGlobs: ['SKILL.md'], broadImpactGlobs: ['SKILL.md'] };
    const derived = deriveTags(['skills/wix-app/SKILL.md'], rules);
    expect(derived.broadImpact).toBe(false);
  });
});

describe('deriveTags — reference forms', () => {
  it('derives a tag from a reference file name', () => {
    const derived = deriveTags(['skills/wix-app/references/DASHBOARD_PAGE.md'], WIX_APP_RULES);
    expect(derived).toEqual({ tags: ['dashboard-page'], broadImpact: false, unmapped: [] });
  });

  it('derives the tag from the directory name for a nested sub-doc', () => {
    const derived = deriveTags(['skills/wix-app/references/dashboard-page/API_SPEC.md'], WIX_APP_RULES);
    expect(derived.tags).toEqual(['dashboard-page']);
  });

  it('maps both reference forms of one capability to a single deduped tag', () => {
    const derived = deriveTags([
      'skills/wix-app/references/DASHBOARD_PAGE.md',
      'skills/wix-app/references/dashboard-page/API_SPEC.md',
    ], WIX_APP_RULES);
    expect(derived.tags).toEqual(['dashboard-page']);
  });

  it('keeps STORES_VERSIONING.md tag-deriving — it describes one capability', () => {
    const derived = deriveTags(['skills/wix-app/references/STORES_VERSIONING.md'], WIX_APP_RULES);
    expect(derived).toEqual({ tags: ['stores-versioning'], broadImpact: false, unmapped: [] });
  });

  it('returns tags sorted and deduped across many changed references', () => {
    const derived = deriveTags([
      'skills/wix-app/references/SERVICE_PLUGIN.md',
      'skills/wix-app/references/DATA_COLLECTION.md',
      'skills/wix-app/references/DASHBOARD_PAGE.md',
    ], WIX_APP_RULES);
    expect(derived.tags).toEqual(['dashboard-page', 'data-collection', 'service-plugin']);
  });
});

describe('deriveTags — SKILL.md, unmapped and out-of-scope paths', () => {
  it('treats SKILL.md as broad impact', () => {
    const derived = deriveTags(['skills/wix-app/SKILL.md'], WIX_APP_RULES);
    expect(derived.broadImpact).toBe(true);
    expect(derived.tags).toEqual([]);
  });

  it('reports an unrecognised file under the skill dir as unmapped, deriving nothing', () => {
    const derived = deriveTags(['skills/wix-app/NOTES.txt'], WIX_APP_RULES);
    expect(derived).toEqual({ tags: [], broadImpact: false, unmapped: ['skills/wix-app/NOTES.txt'] });
  });

  it('ignores paths outside the skill dir entirely', () => {
    const derived = deriveTags([
      'README.md',
      'skills/wix-manage/references/blog/post.md',
      'yaml/wix-app-evals/employee-shift-dashboard.yml',
    ], WIX_APP_RULES);
    expect(derived).toEqual({ tags: [], broadImpact: false, unmapped: [] });
  });

  it('combines broad impact with tags derived from other changed references', () => {
    const derived = deriveTags([
      'skills/wix-app/SKILL.md',
      'skills/wix-app/references/DASHBOARD_PAGE.md',
    ], WIX_APP_RULES);
    expect(derived).toEqual({ tags: ['dashboard-page'], broadImpact: true, unmapped: [] });
  });
});

describe('deriveTags — the layout really is a parameter', () => {
  it('works for a different repo layout with no code change', () => {
    const rules: TagRules = {
      skillDir: 'packages/my-skill',
      referenceDir: 'docs',
      ignoreGlobs: ['tools/**'],
      broadImpactGlobs: ['README.md'],
    };
    expect(deriveTags(['packages/my-skill/docs/WIDGET_THING.md'], rules).tags).toEqual(['widget-thing']);
    expect(deriveTags(['packages/my-skill/README.md'], rules).broadImpact).toBe(true);
    expect(deriveTags(['packages/my-skill/tools/build.sh'], rules).unmapped).toEqual([]);
    expect(deriveTags(['packages/my-skill/other.md'], rules).unmapped)
      .toEqual(['packages/my-skill/other.md']);
  });

  it('does not treat skills/wix-app-extra as inside skills/wix-app', () => {
    const derived = deriveTags(['skills/wix-app-extra/SKILL.md'], WIX_APP_RULES);
    expect(derived).toEqual({ tags: [], broadImpact: false, unmapped: [] });
  });
});

describe('touchedScenarioPaths', () => {
  const GLOB = 'yaml/wix-app-evals/**/*.{yml,yaml}';

  it('returns added, modified and renamed scenario paths, sorted', () => {
    const touched = touchedScenarioPaths([
      { path: 'yaml/wix-app-evals/b.yml', status: 'modified' },
      { path: 'yaml/wix-app-evals/a.yml', status: 'added' },
      { path: 'yaml/wix-app-evals/nested/c.yaml', status: 'renamed' },
    ], GLOB);
    expect(touched).toEqual([
      'yaml/wix-app-evals/a.yml',
      'yaml/wix-app-evals/b.yml',
      'yaml/wix-app-evals/nested/c.yaml',
    ]);
  });

  it('excludes removed scenarios — a deleted file cannot be quality-checked', () => {
    const touched = touchedScenarioPaths([
      { path: 'yaml/wix-app-evals/gone.yml', status: 'removed' },
    ], GLOB);
    expect(touched).toEqual([]);
  });

  it('ignores paths outside the evals glob', () => {
    const touched = touchedScenarioPaths([
      { path: 'yaml/wix-manage-evals/blog/a.yml', status: 'modified' },
      { path: 'skills/wix-app/SKILL.md', status: 'modified' },
    ], GLOB);
    expect(touched).toEqual([]);
  });
});
