import type { ChangedFile } from './github';
import { findManifestForFile, isManifestFile, relativeToManifest, type Manifest } from './manifest';

export type CoverageError = { file: string; message: string };

export type CoverageResult = {
  scenarioIds: string[];
  fileToIds: Map<string, string[]>;
  uncoveredFiles: CoverageError[];
};

export function computeCoverage(
  changedFiles: ChangedFile[],
  manifests: Manifest[],
): CoverageResult {
  const fileToIds = new Map<string, string[]>();
  const uncoveredFiles: CoverageError[] = [];
  const idSet = new Set<string>();

  for (const f of changedFiles) {
    if (f.status === 'removed') continue;
    if (isManifestFile(f.filename)) continue;

    const manifest = findManifestForFile(f.filename, manifests);
    if (!manifest) continue;

    const rel = relativeToManifest(f.filename, manifest);
    const ids = manifest.coverage[rel];

    if (!ids || ids.length === 0) {
      uncoveredFiles.push({
        file: f.filename,
        message: `no entry in ${manifest.manifestPath}. Add \`${rel}: [<scenario-id>]\` under \`coverage:\` to gate this file.`,
      });
      continue;
    }

    fileToIds.set(f.filename, ids);
    for (const id of ids) idSet.add(id);
  }

  return {
    scenarioIds: [...idSet].sort(),
    fileToIds,
    uncoveredFiles,
  };
}
