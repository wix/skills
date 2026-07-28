import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenarios } from '../src/load-scenarios';

const GLOB = 'evals/*/**/*.{yml,yaml}';
const yaml = (name: string) => `name: ${name}\ndescription: d\ntriggerPrompt: a long enough trigger prompt\ntags: [dashboard-page]\nassertions:\n  - type: llm_judge\n    prompt: p\n    minScore: 7\n`;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'load-scenarios-')); mkdirSync(join(dir, 'evals/area'), { recursive: true }); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadScenarios', () => {
  it('loads valid scenarios by name', () => {
    writeFileSync(join(dir, 'evals/area/a.yml'), yaml('area/a'));
    writeFileSync(join(dir, 'evals/area/b.yml'), yaml('area/b'));
    const { scenarios, errors } = loadScenarios(dir, GLOB);
    expect(errors).toHaveLength(0);
    expect([...scenarios.keys()].sort()).toEqual(['area/a', 'area/b']);
  });
  it('reports a duplicate name as an error', () => {
    writeFileSync(join(dir, 'evals/area/a.yml'), yaml('dup'));
    writeFileSync(join(dir, 'evals/area/b.yml'), yaml('dup'));
    const { errors } = loadScenarios(dir, GLOB);
    expect(errors.some(e => /duplicate name/.test(e.message))).toBe(true);
  });
  it('reports a malformed scenario file as a LoadError, excluded from scenarios', () => {
    writeFileSync(join(dir, 'evals/area/bad.yml'), 'name: [unterminated\n');
    const { scenarios, errors } = loadScenarios(dir, GLOB);
    expect(scenarios.size).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'evals/area/bad.yml' });
  });
  it('ignores .action-src and node_modules copies of the same scenarios', () => {
    mkdirSync(join(dir, '.action-src/evals/area'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/pkg/evals/area'), { recursive: true });
    writeFileSync(join(dir, 'evals/area/a.yml'), yaml('area/a'));
    writeFileSync(join(dir, '.action-src/evals/area/a.yml'), yaml('area/a'));
    writeFileSync(join(dir, 'node_modules/pkg/evals/area/a.yml'), yaml('area/a'));

    const anchored = loadScenarios(dir, GLOB);
    expect(anchored.errors).toHaveLength(0);
    expect([...anchored.scenarios.keys()]).toEqual(['area/a']);

    const greedy = loadScenarios(dir, '**/*.{yml,yaml}');
    expect(greedy.errors).toHaveLength(0);
    expect([...greedy.scenarios.keys()]).toEqual(['area/a']);
  });
});
