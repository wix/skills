import type { CapabilityVersion } from './evalforge';

export type VersionCleanupClient = {
  listCapabilityVersions(capabilityId: string, projectId: string): Promise<CapabilityVersion[]>;
  deleteCapabilityVersion(capabilityId: string, projectId: string, versionId: string): Promise<void>;
};

export type VersionCleanupIo = {
  log: (message: string) => void;
  warn: (message: string) => void;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deletes every capability version this PR minted (`pr-<n>-*`). Best-effort throughout:
 * cleanup runs after the PR closed, so a failure here must never fail the workflow — the
 * next run of the same job sweeps whatever was left behind.
 */
export async function deletePrCapabilityVersions(
  client: VersionCleanupClient,
  capabilityId: string,
  projectId: string,
  prNumber: number,
  io: VersionCleanupIo,
): Promise<void> {
  let versions: CapabilityVersion[];
  try {
    versions = await client.listCapabilityVersions(capabilityId, projectId);
  } catch (error) {
    io.warn(`listCapabilityVersions failed: ${describeError(error)}`);
    return;
  }

  const prefix = `pr-${prNumber}-`;
  for (const version of versions.filter(candidate => candidate.version.startsWith(prefix))) {
    try {
      await client.deleteCapabilityVersion(capabilityId, projectId, version.id);
      io.log(`Deleted capability version ${version.version}`);
    } catch (error) {
      io.warn(`Delete capability version ${version.version} failed: ${describeError(error)}`);
    }
  }
}
