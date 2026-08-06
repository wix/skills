import { describe, it, expect, vi } from 'vitest';
import { deletePrCapabilityVersions } from '../src/plan-version-cleanup';

const version = (id: string, label: string) => ({ id, capabilityId: 'C', version: label });

function recorder() {
  const logs: string[] = [];
  const warnings: string[] = [];
  return { io: { log: (m: string) => logs.push(m), warn: (m: string) => warnings.push(m) }, logs, warnings };
}

describe('deletePrCapabilityVersions', () => {
  it('deletes only versions matching this PR prefix', async () => {
    const listCapabilityVersions = vi.fn().mockResolvedValue([
      version('v1', 'pr-42-abc1234'),
      version('v2', 'pr-42-def5678'),
      version('v3', 'pr-7-aaaaaaa'),
      version('v4', 'main'),
    ]);
    const deleteCapabilityVersion = vi.fn().mockResolvedValue(undefined);
    const { io } = recorder();

    await deletePrCapabilityVersions(
      { listCapabilityVersions, deleteCapabilityVersion }, 'C', 'P', 42, io,
    );

    expect(deleteCapabilityVersion.mock.calls.map(call => call[2])).toEqual(['v1', 'v2']);
  });

  it('does not delete pr-4 versions when sweeping PR 42', async () => {
    const listCapabilityVersions = vi.fn().mockResolvedValue([version('v1', 'pr-4-abc1234')]);
    const deleteCapabilityVersion = vi.fn().mockResolvedValue(undefined);
    const { io } = recorder();

    await deletePrCapabilityVersions(
      { listCapabilityVersions, deleteCapabilityVersion }, 'C', 'P', 42, io,
    );

    expect(deleteCapabilityVersion).not.toHaveBeenCalled();
  });

  it('warns and returns when the list call fails, never throwing', async () => {
    const listCapabilityVersions = vi.fn().mockRejectedValue(new Error('gateway down'));
    const deleteCapabilityVersion = vi.fn();
    const { io, warnings } = recorder();

    await expect(deletePrCapabilityVersions(
      { listCapabilityVersions, deleteCapabilityVersion }, 'C', 'P', 42, io,
    )).resolves.toBeUndefined();

    expect(warnings[0]).toContain('gateway down');
    expect(deleteCapabilityVersion).not.toHaveBeenCalled();
  });

  it('warns on a single failed delete and continues with the rest', async () => {
    const listCapabilityVersions = vi.fn().mockResolvedValue([
      version('v1', 'pr-42-aaa'), version('v2', 'pr-42-bbb'),
    ]);
    const deleteCapabilityVersion = vi.fn()
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce(undefined);
    const { io, warnings } = recorder();

    await deletePrCapabilityVersions(
      { listCapabilityVersions, deleteCapabilityVersion }, 'C', 'P', 42, io,
    );

    expect(deleteCapabilityVersion).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pr-42-aaa');
  });
});
