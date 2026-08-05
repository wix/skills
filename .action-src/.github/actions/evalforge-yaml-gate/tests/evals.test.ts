import { describe, it, expect } from 'vitest';
import { loadEvals } from '../src/utils/evals';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup(files: Record<string, string>): string {
  const ws = mkdtempSync(join(tmpdir(), 'evals-'));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(ws, path);
    mkdirSync(join(ws, path, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return ws;
}

const yaml = (name: string) => `
name: ${name}
description: "x"
triggerPrompt: "exercise something at least 10 chars"
tags: [test]
assertions:
  - tool: t
    params: { url: https://x.com/${name} }
`;

describe('loadEvals', () => {
  it('loads + indexes by name', () => {
    const ws = setup({
      'yaml/wix-manage-evals/blog/a.yml': yaml('blog/a'),
      'yaml/wix-manage-evals/bookings/b.yml': yaml('bookings/b'),
    });
    const { scenarios, errors } = loadEvals(ws);
    expect(errors).toEqual([]);
    expect(scenarios.size).toBe(2);
    expect(scenarios.get('blog/a')!.path).toContain('yaml/wix-manage-evals/blog/a.yml');
  });

  it('reports schema errors per file', () => {
    const ws = setup({
      'yaml/wix-manage-evals/blog/bad.yml': 'name: ""',
    });
    const { errors } = loadEvals(ws);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toContain('bad.yml');
  });

  it('flags duplicate names across the repo', () => {
    const ws = setup({
      'yaml/wix-manage-evals/blog/a.yml': yaml('shared'),
      'yaml/wix-manage-evals/bookings/b.yml': yaml('shared'),
    });
    const { errors } = loadEvals(ws);
    expect(errors.some(e => /duplicate name/i.test(e.message))).toBe(true);
  });

  it('loads YAMLs nested under subdirectories within an area', () => {
    const ws = setup({
      'yaml/wix-manage-evals/blog/drafts/save-draft.yml': yaml('blog/save-draft'),
      'yaml/wix-manage-evals/blog/drafts/publish/publish-from-draft.yml': yaml('blog/publish-from-draft'),
    });
    const { scenarios, errors } = loadEvals(ws);
    expect(errors).toEqual([]);
    expect(scenarios.size).toBe(2);
    expect(scenarios.get('blog/save-draft')!.path).toContain('blog/drafts/save-draft.yml');
    expect(scenarios.get('blog/publish-from-draft')!.path).toContain('blog/drafts/publish/publish-from-draft.yml');
  });
});
