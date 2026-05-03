import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  setFailed: vi.fn(),
}));
vi.mock('../src/utils/config');
vi.mock('../src/utils/evalforge');

import * as core from '@actions/core';
import { getCleanupConfig } from '../src/utils/config';
import { EvalForgeClient } from '../src/utils/evalforge';
import { runCleanup } from '../src/utils/cleanup';

const CLEANUP_CONFIG = {
  evalforgeUrl: 'https://ef.example.com/api',
  projectId: 'proj-1',
  mcpId: 'mcp-1',
  appId: 'app-1',
  appSecret: 'secret-1',
  prNumber: 42,
};

const ALL_VERSIONS = [
  { id: 'ver-1', capabilityId: 'mcp-1', version: 'pr-42-abc1234' },
  { id: 'ver-2', capabilityId: 'mcp-1', version: 'pr-42-def5678' },
  { id: 'ver-3', capabilityId: 'mcp-1', version: '1.0.0' },
  { id: 'ver-4', capabilityId: 'mcp-1', version: 'pr-99-abc1234' },
];

describe('runCleanup', () => {
  let mockListMcpVersions: ReturnType<typeof vi.fn>;
  let mockDeleteMcpVersion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCleanupConfig).mockReturnValue(CLEANUP_CONFIG);
    mockListMcpVersions = vi.fn().mockResolvedValue(ALL_VERSIONS);
    mockDeleteMcpVersion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(EvalForgeClient).mockImplementation(() => ({
      listMcpVersions: mockListMcpVersions,
      deleteMcpVersion: mockDeleteMcpVersion,
    } as unknown as EvalForgeClient));
  });

  it('deletes only versions matching the PR prefix', async () => {
    await runCleanup();

    expect(mockDeleteMcpVersion).toHaveBeenCalledTimes(2);
    expect(mockDeleteMcpVersion).toHaveBeenCalledWith('mcp-1', 'proj-1', 'ver-1');
    expect(mockDeleteMcpVersion).toHaveBeenCalledWith('mcp-1', 'proj-1', 'ver-2');
    expect(mockDeleteMcpVersion).not.toHaveBeenCalledWith('mcp-1', 'proj-1', 'ver-3');
    expect(mockDeleteMcpVersion).not.toHaveBeenCalledWith('mcp-1', 'proj-1', 'ver-4');
  });

  it('logs info for each successfully deleted version', async () => {
    await runCleanup();

    expect(vi.mocked(core.info)).toHaveBeenCalledWith(expect.stringContaining('pr-42-abc1234'));
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(expect.stringContaining('pr-42-def5678'));
  });

  it('warns on individual delete failure but does not fail the job', async () => {
    mockDeleteMcpVersion
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce(undefined);

    await runCleanup();

    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(expect.stringContaining('pr-42-abc1234'));
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it('exits cleanly when no versions match the PR prefix', async () => {
    mockListMcpVersions.mockResolvedValue([
      { id: 'ver-3', capabilityId: 'mcp-1', version: '1.0.0' },
      { id: 'ver-4', capabilityId: 'mcp-1', version: 'pr-99-abc1234' },
    ]);

    await runCleanup();

    expect(mockDeleteMcpVersion).not.toHaveBeenCalled();
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it('calls setFailed when listMcpVersions throws', async () => {
    mockListMcpVersions.mockRejectedValue(new Error('API unavailable'));

    await runCleanup();

    expect(vi.mocked(core.setFailed)).toHaveBeenCalled();
    expect(mockDeleteMcpVersion).not.toHaveBeenCalled();
  });
});
