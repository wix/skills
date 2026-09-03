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
 * Deletes the capability versions this PR minted (`pr-<n>-*`). `keepVersionId` spares one —
 * the gate passes the current commit's version so each push prunes only its predecessors;
 * close-time cleanup passes nothing and sweeps them all. Best-effort throughout: a failure
 * here must never fail the workflow, and the next run sweeps whatever was left behind.
 */
export async function deletePrCapabilityVersions(
  client: VersionCleanupClient,
  capabilityId: string,
  projectId: string,
  prNumber: number,
  io: VersionCleanupIo,
  options: { keepVersionId?: string } = {},
): Promise<void> {
  let versions: CapabilityVersion[];
  try {
    versions = await client.listCapabilityVersions(capabilityId, projectId);
  } catch (error) {
    io.warn(`listCapabilityVersions failed: ${describeError(error)}`);
    return;
  }

  const prefix = `pr-${prNumber}-`;
  const doomed = versions.filter(
    candidate => candidate.version.startsWith(prefix) && candidate.id !== options.keepVersionId,
  );
  for (const version of doomed) {
    try {
      await client.deleteCapabilityVersion(capabilityId, projectId, version.id);
      io.log(`Deleted capability version ${version.version}`);
    } catch (error) {
      io.warn(`Delete capability version ${version.version} failed: ${describeError(error)}`);
    }
  }
}
