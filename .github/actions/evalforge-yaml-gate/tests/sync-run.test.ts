import { describe, it, expect, vi } from 'vitest';
import { applyPlan } from '../src/utils/sync-run';

const mkClient = () => ({
  createTestScenario: vi.fn().mockResolvedValue({ id: 'new' }),
  updateTestScenario: vi.fn().mockResolvedValue(undefined),
  deleteTestScenario: vi.fn().mockResolvedValue(undefined),
});

describe('applyPlan', () => {
  it('applies create/update/delete for the matching action kinds', async () => {
    const client = mkClient();
    await applyPlan(client as any, 'proj', {
      actions: [
        { kind: 'CREATE', name: 'a', body: { name: 'a' } as any, tags: [] },
        { kind: 'UPDATE', id: 'r1', name: 'b', body: { name: 'b' } as any, tags: [] },
        { kind: 'DELETE', id: 'r2', name: 'c' },
      ],
      skipped: [],
    }, false);
    expect(client.createTestScenario).toHaveBeenCalledOnce();
    expect(client.createTestScenario).toHaveBeenCalledWith('proj', { name: 'a' }, []);
    expect(client.updateTestScenario).toHaveBeenCalledOnce();
    expect(client.updateTestScenario).toHaveBeenCalledWith('proj', 'r1', { name: 'b' }, []);
    expect(client.deleteTestScenario).toHaveBeenCalledOnce();
    expect(client.deleteTestScenario).toHaveBeenCalledWith('proj', 'r2');
  });

  it('dryRun makes no client calls', async () => {
    const client = mkClient();
    await applyPlan(client as any, 'proj', {
      actions: [
        { kind: 'CREATE', name: 'a', body: { name: 'a' } as any, tags: [] },
        { kind: 'UPDATE', id: 'r1', name: 'b', body: { name: 'b' } as any, tags: [] },
        { kind: 'DELETE', id: 'r2', name: 'c' },
      ],
      skipped: [],
    }, true);
    expect(client.createTestScenario).not.toHaveBeenCalled();
    expect(client.updateTestScenario).not.toHaveBeenCalled();
    expect(client.deleteTestScenario).not.toHaveBeenCalled();
  });

  it('returns a failure flag and continues past a failed action', async () => {
    const client = mkClient();
    client.updateTestScenario.mockRejectedValueOnce(new Error('boom'));
    const result = await applyPlan(client as any, 'proj', {
      actions: [
        { kind: 'UPDATE', id: 'r1', name: 'b', body: { name: 'b' } as any, tags: [] },
        { kind: 'DELETE', id: 'r2', name: 'c' },
      ],
      skipped: [],
    }, false);
    expect(client.deleteTestScenario).toHaveBeenCalledOnce();
    expect(result.hasFailures).toBe(true);
  });

  it('reports no failures when all actions succeed', async () => {
    const client = mkClient();
    const result = await applyPlan(client as any, 'proj', {
      actions: [{ kind: 'DELETE', id: 'r2', name: 'c' }],
      skipped: [],
    }, false);
    expect(result.hasFailures).toBe(false);
  });
});
