import { describe, it, expect, vi } from 'vitest';
import {
  MAX_SWEEP_SCENARIOS, tagsOfDirectlyAffected, resolveSweepSet, rowsToOutcomes,
} from '../src/utils/merge-tag-sweep';
import type { LoadedScenario } from '../src/utils/evals';
import type { Scenario } from '@wix/evalforge-core';

const scenario = (name: string, tags: string[]): LoadedScenario => ({
  path: `yaml/wix-manage-evals/${name}.yml`,
  scenario: {
    name, description: '', triggerPrompt: '0123456789', tags,
    assertions: [{ tool: 'T', params: { url: `https://x.com/${name}` } }],
  } satisfies Scenario,
});

describe('tagsOfDirectlyAffected', () => {
  it('unions tags across changed-YAML and doc-covered scenarios', () => {
    const head = new Map([
      ['blog/changed', scenario('blog/changed', ['blog', 'bookings'])],
      ['marketing/social', scenario('marketing/social', ['marketing'])],
      ['blog/unrelated', scenario('blog/unrelated', ['unrelated'])],
    ]);
    const tags = tagsOfDirectlyAffected(
      head,
      new Set(['yaml/wix-manage-evals/blog/changed.yml']),
      new Map([['skills/wix-manage/references/marketing/social.md', ['marketing/social']]]),
    );
    expect([...tags].sort()).toEqual(['blog', 'bookings', 'marketing']);
  });

  it('returns an empty set when nothing is directly affected', () => {
    const tags = tagsOfDirectlyAffected(new Map(), new Set(), new Map());
    expect(tags.size).toBe(0);
  });
});

describe('resolveSweepSet', () => {
  it('resolves and dedupes scenarios across multiple tags', async () => {
    const client = {
      listTestScenariosByTag: vi.fn()
        .mockImplementation(async (_projectId: string, tag: string) => {
          if (tag === 'bookings') return [{ id: '1', name: 'a', tags: ['bookings'] }, { id: '2', name: 'b', tags: ['bookings', 'stores'] }];
          if (tag === 'stores') return [{ id: '2', name: 'b', tags: ['bookings', 'stores'] }, { id: '3', name: 'c', tags: ['stores'] }];
          return [];
        }),
    };
    const out = await resolveSweepSet(client, 'proj-1', new Set(['bookings', 'stores']));
    expect(out.selected.map(s => s.id).sort()).toEqual(['1', '2', '3']);
    expect(out.totalMatched).toBe(3);
    expect(out.excludedCount).toBe(0);
  });

  it('caps the sampled set deterministically (sorted by name) and reports the excluded count', async () => {
    const many = Array.from({ length: MAX_SWEEP_SCENARIOS + 5 }, (_, i) => ({
      id: `id-${i}`, name: `scenario-${String(i).padStart(2, '0')}`, tags: ['big'],
    }));
    const client = { listTestScenariosByTag: vi.fn().mockResolvedValue(many) };
    const out = await resolveSweepSet(client, 'proj-1', new Set(['big']));
    expect(out.selected).toHaveLength(MAX_SWEEP_SCENARIOS);
    expect(out.selected[0].name).toBe('scenario-00');
    expect(out.totalMatched).toBe(MAX_SWEEP_SCENARIOS + 5);
    expect(out.excludedCount).toBe(5);
  });

  it('resolves to an empty set for an empty tag set', async () => {
    const client = { listTestScenariosByTag: vi.fn() };
    const out = await resolveSweepSet(client, 'proj-1', new Set());
    expect(out.selected).toEqual([]);
    expect(client.listTestScenariosByTag).not.toHaveBeenCalled();
  });
});

describe('rowsToOutcomes', () => {
  it('marks a clean row as passed', () => {
    const out = rowsToOutcomes([
      { scenarioId: '1', scenarioName: 'a', passed: 3, failed: 0, partial: false, iterationIndex: 0, assertions: [] },
    ]);
    expect(out).toEqual([{ scenarioId: '1', scenarioName: 'a', failed: false, reasons: [] }]);
  });

  it('marks a failing row as failed, naming the failed assertions', () => {
    const out = rowsToOutcomes([{
      scenarioId: '1', scenarioName: 'a', passed: 1, failed: 1, partial: false, iterationIndex: 0,
      assertions: [
        { assertionName: 'correctness', assertionType: 'llm_judge', status: 'FAILED' },
        { assertionName: 'coverage', assertionType: 'tool_called_with_param', status: 'PASSED' },
      ],
    }]);
    expect(out).toEqual([{ scenarioId: '1', scenarioName: 'a', failed: true, reasons: ['correctness'] }]);
  });

  it('includes ERROR assertions in reasons but excludes SKIPPED', () => {
    const out = rowsToOutcomes([{
      scenarioId: '1', scenarioName: 'a', passed: 1, failed: 1, partial: false, iterationIndex: 0,
      assertions: [
        { assertionName: 'api_call', assertionType: 'tool_called', status: 'ERROR' },
        { assertionName: 'validation', assertionType: 'tool_output_check', status: 'SKIPPED' },
        { assertionName: 'check', assertionType: 'llm_judge', status: 'PASSED' },
      ],
    }]);
    expect(out).toEqual([{ scenarioId: '1', scenarioName: 'a', failed: true, reasons: ['api_call'] }]);
  });

  it('excludes UNKNOWN from reasons', () => {
    const out = rowsToOutcomes([{
      scenarioId: '1', scenarioName: 'a', passed: 1, failed: 1, partial: false, iterationIndex: 0,
      assertions: [
        { assertionName: 'actual_fail', assertionType: 'llm_judge', status: 'FAILED' },
        { assertionName: 'unknown_status', assertionType: 'unknown_type', status: 'UNKNOWN' },
      ],
    }]);
    expect(out).toEqual([{ scenarioId: '1', scenarioName: 'a', failed: true, reasons: ['actual_fail'] }]);
  });
});
