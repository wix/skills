import { describe, expect, it, vi } from 'vitest';
import { buildGraphFrom, connectedDocs, type ReferenceGraph } from '../src/utils/reference-graph';

// Docs keyed like the gate sees them; slug = canonical slug, area = references/<area>/.
const DOCS: Record<string, { slug: string; area: string; refs: string[] }> = {
  'skills/wix-manage/references/ecommerce/recommend.md': {
    slug: 'recommend-ecommerce-strategy', area: 'ecommerce',
    refs: ['ecommerce/goal-aov.md', 'ecommerce/setup-coupons.md'],
  },
  'skills/wix-manage/references/ecommerce/pricing-promotions/goal-aov.md': {
    slug: 'goal-aov', area: 'ecommerce', refs: [],
  },
  'skills/wix-manage/references/ecommerce/pricing-promotions/coupons.md': {
    slug: 'setup-coupons', area: 'ecommerce', refs: [],
  },
  'skills/wix-manage/references/stores/find-products.md': {
    slug: 'find-products', area: 'stores', refs: [],
  },
};

function fixtureGraph(warn?: (m: string) => void): ReferenceGraph {
  const files = Object.keys(DOCS);
  return buildGraphFrom({
    docs: files,
    slugOf: f => DOCS[f]?.slug ?? null,
    areaOf: f => DOCS[f]?.area ?? null,
    referencesOf: f => DOCS[f]?.refs ?? [],
    warn,
  });
}

describe('buildGraphFrom', () => {
  it('links a parent to each child it references, resolved by canonical slug', () => {
    const g = fixtureGraph();
    const parent = 'skills/wix-manage/references/ecommerce/recommend.md';
    const child = 'skills/wix-manage/references/ecommerce/pricing-promotions/goal-aov.md';
    expect(g.get(parent)?.has(child)).toBe(true);
    // undirected — the edge exists both ways
    expect(g.get(child)?.has(parent)).toBe(true);
  });

  it('warns and skips an unresolvable reference instead of throwing', () => {
    const warn = vi.fn();
    const g = buildGraphFrom({
      docs: ['skills/wix-manage/references/ecommerce/recommend.md'],
      slugOf: () => 'recommend-ecommerce-strategy',
      areaOf: () => 'ecommerce',
      referencesOf: () => ['ecommerce/does-not-exist.md'],
      warn,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect([...(g.get('skills/wix-manage/references/ecommerce/recommend.md') ?? [])]).toEqual([]);
  });

  it('disambiguates a slug shared across areas to the referrer’s own area', () => {
    const warn = vi.fn();
    const g = buildGraphFrom({
      docs: ['a/ref.md', 'ecommerce/dup.md', 'stores/dup.md'],
      slugOf: f => ({ 'a/ref.md': 'ref', 'ecommerce/dup.md': 'shared', 'stores/dup.md': 'shared' }[f] ?? null),
      areaOf: f => ({ 'a/ref.md': 'ecommerce', 'ecommerce/dup.md': 'ecommerce', 'stores/dup.md': 'stores' }[f] ?? null),
      referencesOf: f => (f === 'a/ref.md' ? ['whatever/shared.md'] : []),
      warn,
    });
    expect(g.get('a/ref.md')?.has('ecommerce/dup.md')).toBe(true);
    expect(g.get('a/ref.md')?.has('stores/dup.md')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('connectedDocs', () => {
  it('returns the transitive component in both directions', () => {
    const g = fixtureGraph();
    const child = 'skills/wix-manage/references/ecommerce/pricing-promotions/goal-aov.md';
    const component = connectedDocs(g, [child]);
    // from a child: reach the parent (up) and the sibling coupons doc (across, via the parent)
    expect(component).toEqual(new Set([
      child,
      'skills/wix-manage/references/ecommerce/recommend.md',
      'skills/wix-manage/references/ecommerce/pricing-promotions/coupons.md',
    ]));
  });

  it('returns an isolated seed unchanged (no edges → just itself)', () => {
    const g = fixtureGraph();
    const lonely = 'skills/wix-manage/references/stores/find-products.md';
    expect(connectedDocs(g, [lonely])).toEqual(new Set([lonely]));
  });

  it('includes a seed that is not a node in the graph at all', () => {
    const g = fixtureGraph();
    expect(connectedDocs(g, ['skills/wix-manage/references/blog/unknown.md']))
      .toEqual(new Set(['skills/wix-manage/references/blog/unknown.md']));
  });
});
