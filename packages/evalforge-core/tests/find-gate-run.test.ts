import { describe, it, expect, vi } from 'vitest';
import { findGateRun, GateRunLookup, type WorkflowRunsClient } from '../src/find-gate-run';

const NOW = new Date('2026-07-30T00:00:00Z');
const TARGET = {
  owner: 'wix',
  repo: 'skills',
  workflowFile: 'evalforge-wix-app-gate.yml',
  headSha: 'abc1234',
  now: NOW,
};

const run = (over: Partial<{ id: number; status: string; updated_at: string }> = {}) => ({
  id: 1,
  status: 'completed',
  updated_at: '2026-07-29T00:00:00Z',
  html_url: 'https://github.com/wix/skills/actions/runs/1',
  ...over,
});

const clientWith = (runs: unknown[]): WorkflowRunsClient =>
  ({
    rest: { actions: { listWorkflowRuns: vi.fn().mockResolvedValue({ data: { workflow_runs: runs } }) } },
  }) as unknown as WorkflowRunsClient;

describe('findGateRun', () => {
  it('returns the newest run, and queries by trigger and head sha', async () => {
    const listWorkflowRuns = vi.fn().mockResolvedValue({
      data: { workflow_runs: [run({ id: 9 }), run({ id: 8 })] },
    });
    const client = { rest: { actions: { listWorkflowRuns } } } as unknown as WorkflowRunsClient;

    expect(await findGateRun(client, TARGET)).toEqual({
      kind: GateRunLookup.FOUND,
      runId: 9,
      runUrl: 'https://github.com/wix/skills/actions/runs/1',
    });
    expect(listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'wix',
      repo: 'skills',
      workflow_id: 'evalforge-wix-app-gate.yml',
      event: 'pull_request',
      head_sha: 'abc1234',
    }));
  });

  it('reports NONE when the gate never ran for this commit', async () => {
    expect(await findGateRun(clientWith([]), TARGET)).toEqual({ kind: GateRunLookup.NONE });
  });

  // Re-running now would race the gate against itself and pay for two runs of one commit.
  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'reports ACTIVE for a %s run',
    async (status) => {
      const result = await findGateRun(clientWith([run({ status })]), TARGET);

      expect(result.kind).toBe(GateRunLookup.ACTIVE);
      if (result.kind !== GateRunLookup.ACTIVE) return;
      expect(result.runUrl).toContain('/actions/runs/1');
    },
  );

  it('accepts a run that completed 29 days ago', async () => {
    const recent = run({ updated_at: '2026-07-01T00:00:00Z' });

    expect((await findGateRun(clientWith([recent]), TARGET)).kind).toBe(GateRunLookup.FOUND);
  });

  it("reports TOO_OLD past GitHub's 30-day re-run window", async () => {
    const stale = run({ updated_at: '2026-06-20T00:00:00Z' });
    const result = await findGateRun(clientWith([stale]), TARGET);

    expect(result.kind).toBe(GateRunLookup.TOO_OLD);
    if (result.kind !== GateRunLookup.TOO_OLD) return;
    expect(result.completedAt).toBe('2026-06-20T00:00:00Z');
  });
});
