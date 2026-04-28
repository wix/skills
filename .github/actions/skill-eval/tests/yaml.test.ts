import { describe, it, expect } from 'vitest';
import { parseDocumentationYaml, diffYamlEntries } from '../src/utils/yaml';

const BASE_YAML = `
apiDoc:
  title: Wix Stores Management Recipes
  docs:
    - title: "Query Products"
      file: "../../../skills/wix-manage/references/stores/query-products.md"
      docsEntry: "https://dev.wix.com/docs/rest/products"
      tags: [stores, stores-v2]
`;

describe('parseDocumentationYaml', () => {
  it('parses entries from valid yaml', () => {
    const entries = parseDocumentationYaml(BASE_YAML);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      title: 'Query Products',
      file: '../../../skills/wix-manage/references/stores/query-products.md',
      docsEntry: 'https://dev.wix.com/docs/rest/products',
      tags: ['stores', 'stores-v2'],
    });
  });

  it('returns empty array when no apiDoc.docs key', () => {
    expect(parseDocumentationYaml('other: value')).toEqual([]);
  });

  it('handles missing optional docsEntry', () => {
    const raw = `apiDoc:\n  docs:\n    - title: "T"\n      file: "f.md"\n      tags: [t1]`;
    expect(parseDocumentationYaml(raw)[0].docsEntry).toBeUndefined();
  });

  it('handles missing optional tags', () => {
    const raw = `apiDoc:\n  docs:\n    - title: "T"\n      file: "f.md"`;
    expect(parseDocumentationYaml(raw)[0].tags).toBeUndefined();
  });
});

describe('diffYamlEntries', () => {
  it('new entry → all tags', () => {
    const { affectedEntries, errors } = diffYamlEntries([], parseDocumentationYaml(BASE_YAML));
    expect(errors).toHaveLength(0);
    expect(affectedEntries[0].tags).toEqual(['stores', 'stores-v2']);
  });

  it('removed entry → skip', () => {
    const { affectedEntries } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), []);
    expect(affectedEntries).toHaveLength(0);
  });

  it('tags changed → only added tags', () => {
    const next = parseDocumentationYaml(BASE_YAML.replace('tags: [stores, stores-v2]', 'tags: [stores, stores-v2, stores-v3]'));
    const { affectedEntries } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), next);
    expect(affectedEntries[0].tags).toEqual(['stores-v3']);
  });

  it('file changed → all tags', () => {
    const next = parseDocumentationYaml(BASE_YAML.replace('query-products.md', 'query-products-v2.md'));
    const { affectedEntries } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), next);
    expect(affectedEntries[0].tags).toEqual(['stores', 'stores-v2']);
  });

  it('file + tags changed → all tags (file dominates)', () => {
    const next = parseDocumentationYaml(
      BASE_YAML
        .replace('query-products.md', 'query-products-v2.md')
        .replace('stores-v2', 'stores-v3')
    );
    const { affectedEntries } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), next);
    expect(affectedEntries[0].tags).toEqual(['stores', 'stores-v3']);
  });

  it('title only changed → treated as new entry (title is the lookup key)', () => {
    const next = parseDocumentationYaml(BASE_YAML.replace('Query Products"', 'Query Products v2"'));
    const { affectedEntries } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), next);
    expect(affectedEntries).toHaveLength(1);
    expect(affectedEntries[0].tags).toEqual(['stores', 'stores-v2']);
  });

  it('docsEntry removed → validation error, not affected entry', () => {
    const next = parseDocumentationYaml(BASE_YAML.replace(/\s+docsEntry:.*/, ''));
    const { affectedEntries, errors } = diffYamlEntries(parseDocumentationYaml(BASE_YAML), next);
    expect(affectedEntries).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/docsEntry/);
  });

  it('unchanged entry → skip', () => {
    const entries = parseDocumentationYaml(BASE_YAML);
    const { affectedEntries } = diffYamlEntries(entries, entries);
    expect(affectedEntries).toHaveLength(0);
  });
});
