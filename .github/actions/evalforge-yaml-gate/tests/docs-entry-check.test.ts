import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { changedDocsEntries, validateDocsEntries, type DocsEntryTarget } from '../src/utils/docs-entry-check';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_REF = 'https://dev.wix.com/docs/api-reference';

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'docs-entry-'));
}

function writeDocYaml(workspace: string, area: string, docs: Array<{ file: string; title: string; docsEntry: string }>): void {
  mkdirSync(join(workspace, `yaml/wix-manage/${area}`), { recursive: true });
  const entries = docs.map(d =>
    `    - file: ../../../skills/wix-manage/references/${area}/${d.file}\n      title: "${d.title}"\n      docsEntry: ${d.docsEntry}\n`,
  ).join('');
  writeFileSync(join(workspace, `yaml/wix-manage/${area}/documentation.yaml`), `apiDoc:\n  docs:\n${entries}`);
}

describe('changedDocsEntries', () => {
  it('returns new entries and entries whose docsEntry changed, skipping unchanged ones', () => {
    const head = makeWorkspace();
    const base = makeWorkspace();
    writeDocYaml(base, 'seo', [
      { file: 'unchanged.md', title: 'Unchanged', docsEntry: `${API_REF}/business-management/seo` },
      { file: 'repointed.md', title: 'Repointed', docsEntry: `${API_REF}/old-place` },
    ]);
    writeDocYaml(head, 'seo', [
      { file: 'unchanged.md', title: 'Unchanged', docsEntry: `${API_REF}/business-management/seo` },
      { file: 'repointed.md', title: 'Repointed', docsEntry: `${API_REF}/new-place` },
      { file: 'brand-new.md', title: 'Brand New', docsEntry: `${API_REF}/business-management/seo` },
    ]);

    const changed = changedDocsEntries(head, base);

    expect(changed.map(t => t.file).sort()).toEqual([
      'skills/wix-manage/references/seo/brand-new.md',
      'skills/wix-manage/references/seo/repointed.md',
    ]);
    expect(changed.every(t => t.yamlPath === 'yaml/wix-manage/seo/documentation.yaml')).toBe(true);
  });

  it('treats every head entry as changed when the base workspace has no yamls', () => {
    const head = makeWorkspace();
    writeDocYaml(head, 'sites', [
      { file: 'a.md', title: 'A', docsEntry: `${API_REF}/x` },
    ]);

    expect(changedDocsEntries(head, makeWorkspace())).toHaveLength(1);
  });
});

describe('validateDocsEntries', () => {
  const PORTALS = [
    { id: 'portal-1', config: { docsUrl: { basename: '/docs', path: '/api-reference' } } },
    { id: 'portal-2', config: { docsUrl: { basename: '/docs', path: '/api-reference/internal-only' } } },
  ];

  const MENU = [
    {
      url: '/business-management', menuNodeType: 'SECTION', children: [
        {
          url: '/business-management/seo', menuNodeType: 'CATEGORY', children: [
            { url: '/business-management/seo/redirects', menuNodeType: 'CATEGORY', children: [] },
            { url: '/business-management/seo/item-seo-tags-v1', menuNodeType: 'RESOURCE', children: [] },
          ],
        },
      ],
    },
    {
      url: '/tools', menuNodeType: 'SECTION', children: [
        { url: '/tools/dynamic-site-context', menuNodeType: 'RESOURCE', children: [] },
      ],
    },
  ];

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/available-portals')) return { ok: true, json: async () => ({ portals: PORTALS }) };
      if (url.includes('/get-cached-menu/public/portal-1')) return { ok: true, json: async () => MENU };
      if (url.includes('/get-cached-menu/public/portal-2')) return { ok: true, json: async () => [] };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function target(docsEntry: string): DocsEntryTarget {
    return { file: 'skills/wix-manage/references/x/a.md', yamlPath: 'yaml/wix-manage/x/documentation.yaml', title: 'A', docsEntry };
  }

  it('passes a docsEntry pointing at a CATEGORY node', async () => {
    const { problems, serviceError } = await validateDocsEntries([
      target(`${API_REF}/business-management/seo/redirects`),
    ]);
    expect(serviceError).toBeUndefined();
    expect(problems).toEqual([]);
  });

  it('normalizes a trailing slash before matching', async () => {
    const { problems } = await validateDocsEntries([target(`${API_REF}/business-management/seo/`)]);
    expect(problems).toEqual([]);
  });

  it('fails a RESOURCE target and suggests the nearest CATEGORY ancestor', async () => {
    const { problems } = await validateDocsEntries([
      target(`${API_REF}/business-management/seo/item-seo-tags-v1`),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: 'not-a-category',
      nodeType: 'RESOURCE',
      suggestion: `${API_REF}/business-management/seo`,
    });
  });

  it('fails a RESOURCE target with no CATEGORY ancestor without a suggestion', async () => {
    const { problems } = await validateDocsEntries([target(`${API_REF}/tools/dynamic-site-context`)]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('not-a-category');
    expect(problems[0].suggestion).toBeUndefined();
  });

  it('fails a SECTION target', async () => {
    const { problems } = await validateDocsEntries([target(`${API_REF}/tools`)]);
    expect(problems[0]).toMatchObject({ kind: 'not-a-category', nodeType: 'SECTION' });
  });

  it('reports a path that does not exist in the menu', async () => {
    const { problems } = await validateDocsEntries([target(`${API_REF}/no-such/category`)]);
    expect(problems[0].kind).toBe('node-not-found');
  });

  it('treats the portal root itself as not a valid docsEntry', async () => {
    const { problems } = await validateDocsEntries([target(API_REF)]);
    expect(problems[0].kind).toBe('node-not-found');
  });

  it('reports a URL under no known portal', async () => {
    const { problems } = await validateDocsEntries([
      target('https://dev.wix.com/docs/no-such-portal/x'),
    ]);
    expect(problems[0].kind).toBe('portal-not-found');
  });

  it('matches the longest portal prefix', async () => {
    await validateDocsEntries([target(`${API_REF}/internal-only/whatever`)]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('portal-2'));
  });

  it('fetches each portal menu once for multiple targets', async () => {
    await validateDocsEntries([
      target(`${API_REF}/business-management/seo`),
      target(`${API_REF}/business-management/seo/redirects`),
    ]);
    const menuCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('get-cached-menu'));
    expect(menuCalls).toHaveLength(1);
  });

  it('returns a serviceError instead of problems when the docs endpoints fail', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { problems, serviceError } = await validateDocsEntries([
      target(`${API_REF}/business-management/seo`),
    ]);
    expect(problems).toEqual([]);
    expect(serviceError).toContain('503');
  });

  it('makes no requests when there is nothing to validate', async () => {
    const { problems } = await validateDocsEntries([]);
    expect(problems).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
