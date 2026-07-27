import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drive runSchedule end-to-end against a FAKE EvalForge backend so the batching,
// parallelism, and aggregation execute for real without touching the network.
// All shared state lives in vi.hoisted() because vi.mock factories are hoisted
// above every other top-level binding.
const h = vi.hoisted(() => {
  const outputs = new Map<string, string>();
  const logs: string[] = [];
  const timeline: string[] = [];
  type CreateCall = { runId: string; scenarioIds: string[] };
  const createCalls: CreateCall[] = [];
  const state = { failedMessage: undefined as string | undefined, failingBatchIndex: -1 };

  class FakeEvalForgeClient {
    constructor(_url: string, _appId: string, _appSecret: string) {}

    async listTestScenariosByTag(_projectId: string, _tag: string) {
      // 40 scenarios -> batches of 15, 15, 10.
      return Array.from({ length: 40 }, (_, i) => ({ id: `scenario-${i + 1}` }));
    }

    async createAndRunEvalRun(_projectId: string, input: { scenarioIds: string[] }) {
      const runId = `run-${createCalls.length + 1}`;
      createCalls.push({ runId, scenarioIds: input.scenarioIds });
      timeline.push(`create ${runId} (${input.scenarioIds.length} scenarios)`);
      return { id: runId, status: 'pending' as const };
    }

    async getEvalRun(_projectId: string, runId: string) {
      const idx = createCalls.findIndex(c => c.runId === runId);
      const call = createCalls[idx];
      // Yield to the event loop so all batches are in-flight concurrently.
      await Promise.resolve();
      timeline.push(`poll ${runId} -> terminal`);
      const total = call.scenarioIds.length * 2;
      const failed = idx === state.failingBatchIndex ? 3 : 0;
      return {
        status: failed > 0 ? ('failed' as const) : ('completed' as const),
        progress: 100,
        aggregateMetrics: {
          totalAssertions: total,
          passed: total - failed,
          failed,
          skipped: 0,
          errors: 0,
          passRate: ((total - failed) / total) * 100,
          avgDuration: 1,
          totalDuration: total,
        },
      };
    }
  }

  return { outputs, logs, timeline, createCalls, state, FakeEvalForgeClient };
});

vi.mock('@actions/core', () => ({
  info: (m: string) => h.logs.push(`[info] ${m}`),
  warning: (m: string) => h.logs.push(`[warn] ${m}`),
  error: (m: string) => h.logs.push(`[error] ${m}`),
  setOutput: (k: string, v: string) => h.outputs.set(k, String(v)),
  setFailed: (m: string) => {
    h.state.failedMessage = m;
  },
  setSecret: () => {},
}));

vi.mock('@wix/evalforge-core', () => ({
  CODE_TAG: 'created-via-code',
  TERMINAL_RUN_STATUSES: ['completed', 'failed', 'cancelled'],
  evalRunUrl: (projectId: string, runId: string) =>
    `https://bo.wix.com/pages/evalforge/${projectId}/results?runId=${runId}`,
  EvalForgeClient: h.FakeEvalForgeClient,
}));

vi.mock('../src/utils/config', () => ({
  getScheduleConfig: () => ({
    evalforgeUrl: 'https://evalforge.example',
    projectId: 'proj-1',
    agentId: 'agent-1',
    mcpId: 'mcp-1',
    appId: 'app-1',
    appSecret: 'secret-1',
    runName: 'scheduled-99',
  }),
}));

import { runSchedule } from '../src/utils/schedule';

beforeEach(() => {
  h.outputs.clear();
  h.createCalls.length = 0;
  h.timeline.length = 0;
  h.logs.length = 0;
  h.state.failedMessage = undefined;
  h.state.failingBatchIndex = -1;
});

afterEach(() => {
  // Print the narrative so the "local run" is observable.
  console.log('\n--- runSchedule log ---');
  for (const line of h.logs) console.log(line);
  console.log('--- create/poll interleave ---');
  for (const line of h.timeline) console.log(line);
  console.log('--- outputs ---');
  for (const [k, v] of h.outputs) console.log(`${k} = ${v}`);
  if (h.state.failedMessage) console.log(`setFailed: ${h.state.failedMessage}`);
});

describe('runSchedule batching', () => {
  it('splits 40 scenarios into batches of 15/15/10 and runs them in parallel', async () => {
    await runSchedule();

    expect(h.createCalls.map(c => c.scenarioIds.length)).toEqual([15, 15, 10]);
    // Every batch is created before any poll resolves -> they run concurrently.
    const firstPollAt = h.timeline.findIndex(l => l.startsWith('poll'));
    const createsBeforeFirstPoll = h.timeline.slice(0, firstPollAt).filter(l => l.startsWith('create')).length;
    expect(createsBeforeFirstPoll).toBe(3);
  });

  it('aggregates a clean run into one completed result', async () => {
    await runSchedule();

    expect(h.outputs.get('status')).toBe('completed');
    expect(h.outputs.get('total')).toBe('80'); // 40 scenarios * 2 assertions
    expect(h.outputs.get('passed')).toBe('80');
    expect(h.outputs.get('failed')).toBe('0');
    expect(h.outputs.get('pass-rate')).toBe('100');
    expect(h.state.failedMessage).toBeUndefined();
  });

  it('aggregates failures across batches and fails the job (still one report)', async () => {
    h.state.failingBatchIndex = 1; // second batch has 3 failing assertions

    await runSchedule();

    expect(h.outputs.get('status')).toBe('failed');
    expect(h.outputs.get('failed')).toBe('3');
    expect(h.outputs.get('passed')).toBe('77');
    expect(h.outputs.get('pass-rate')).toBe('96'); // round(77/80*100)
    expect(h.state.failedMessage).toContain('3 assertion(s) failed');
  });
});
