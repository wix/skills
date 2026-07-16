import { describe, expect, it, vi } from 'vitest';
import { buildGraph, connectedDocs, unionGraphs, type DocNode } from '../src/utils/reference-graph';

const R = 'skills/wix-manage/references';

// A small family: recommend (parent) -> goal-aov + coupons (children); find-products is unrelated.
const NODES: DocNode[] = [
  { file: `${R}/ecommerce/recommend.md`, area: 'ecommerce', slug: 'recommend', refs: ['ecommerce/goal-aov.md', 'ecommerce/coupons.md'] },
  { file: `${R}/ecommerce/pricing/goal-aov.md`, area: 'ecommerce', slug: 'goal-aov', refs: [] },
  { file: `${R}/ecommerce/pricing/coupons.md`, area: 'ecommerce', slug: 'coupons', refs: [] },
  { file: `${R}/stores/find-products.md`, area: 'stores', slug: 'find-products', refs: [] },
];

describe('buildGraph', () => {
  it('links a doc to each doc it references, resolved by canonical slug, undirected', () => {
    const g = buildGraph(NODES);
    const parent = `${R}/ecommerce/recommend.md`;
    const child = `${R}/ecommerce/pricing/goal-aov.md`;
    expect(g.get(parent)?.has(child)).toBe(true);
    expect(g.get(child)?.has(parent)).toBe(true);
  });

  it('warns and skips an unresolvable reference instead of throwing', () => {
    const warn = vi.fn();
    const g = buildGraph([{ file: `${R}/ecommerce/recommend.md`, area: 'ecommerce', slug: 'recommend', refs: ['ecommerce/missing.md'] }], warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(g.size).toBe(0);
  });

  it('disambiguates a slug shared across areas to the referrer’s own area', () => {
    const warn = vi.fn();
    const g = buildGraph([
      { file: `${R}/ecommerce/ref.md`, area: 'ecommerce', slug: 'ref', refs: ['whatever/dup.md'] },
      { file: `${R}/ecommerce/dup.md`, area: 'ecommerce', slug: 'dup', refs: [] },
      { file: `${R}/stores/dup.md`, area: 'stores', slug: 'dup', refs: [] },
    ], warn);
    expect(g.get(`${R}/ecommerce/ref.md`)?.has(`${R}/ecommerce/dup.md`)).toBe(true);
    expect(g.get(`${R}/ecommerce/ref.md`)?.has(`${R}/stores/dup.md`)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('connectedDocs', () => {
  it('returns the transitive component in both directions', () => {
    const g = buildGraph(NODES);
    const child = `${R}/ecommerce/pricing/goal-aov.md`;
    // from a child, reach the parent (up) and the sibling coupons doc (across, via the parent)
    expect(connectedDocs(g, [child])).toEqual(new Set([
      child,
      `${R}/ecommerce/recommend.md`,
      `${R}/ecommerce/pricing/coupons.md`,
    ]));
  });

  it('returns an isolated seed unchanged, even one absent from the graph', () => {
    const g = buildGraph(NODES);
    expect(connectedDocs(g, [`${R}/stores/find-products.md`])).toEqual(new Set([`${R}/stores/find-products.md`]));
    expect(connectedDocs(g, [`${R}/blog/unknown.md`])).toEqual(new Set([`${R}/blog/unknown.md`]));
  });
});

describe('unionGraphs (base ∪ head — detachment)', () => {
  const parent = `${R}/ecommerce/parent.md`;
  const child = `${R}/ecommerce/child.md`;

  it('re-runs a detached neighbor by unioning base and head edges', () => {
    // head: the PR removed parent's reference to child (edge gone)
    const head = buildGraph([
      { file: parent, area: 'ecommerce', slug: 'parent', refs: [] },
      { file: child, area: 'ecommerce', slug: 'child', refs: [] },
    ]);
    // base: parent still referenced child
    const base = buildGraph([
      { file: parent, area: 'ecommerce', slug: 'parent', refs: ['ecommerce/child.md'] },
      { file: child, area: 'ecommerce', slug: 'child', refs: [] },
    ]);

    // head alone drops the child; the union keeps it reachable from the edited parent
    expect(connectedDocs(head, [parent])).toEqual(new Set([parent]));
    expect(connectedDocs(unionGraphs(head, base), [parent])).toEqual(new Set([parent, child]));
  });

  it('merges disjoint edges from both graphs', () => {
    const a = buildGraph([{ file: parent, area: 'ecommerce', slug: 'parent', refs: ['ecommerce/child.md'] }, { file: child, area: 'ecommerce', slug: 'child', refs: [] }]);
    const b = buildGraph([{ file: child, area: 'ecommerce', slug: 'child', refs: ['ecommerce/grandchild.md'] }, { file: `${R}/ecommerce/grandchild.md`, area: 'ecommerce', slug: 'grandchild', refs: [] }]);
    expect(connectedDocs(unionGraphs(a, b), [parent])).toEqual(new Set([parent, child, `${R}/ecommerce/grandchild.md`]));
  });
});
