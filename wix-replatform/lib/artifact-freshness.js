'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

const DEFAULT_ARTIFACTS = {
  sourceSchema: 'source-schema.json',
  mappingPlan: 'mapping/mapping-plan.json',
  setupVerification: 'setup/setup-verification.json',
  generatedImportCode: 'src/import',
};

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  return sha256Text(fs.readFileSync(filePath));
}

function directoryHash(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = listFilesRecursive(dirPath)
    .map((file) => {
      const relative = path.relative(dirPath, file).replace(/\\/g, '/');
      return `${relative}\0${fileHash(file)}`;
    })
    .join('\n');
  return sha256Text(entries);
}

function listFilesRecursive(root) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function hashArtifact(projectDir, relativePath) {
  if (!relativePath) return null;
  const absolute = path.resolve(projectDir, relativePath);
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) return directoryHash(absolute);
  if (stat.isFile()) return fileHash(absolute);
  return null;
}

function targetLedgerRevision(domainsDir) {
  if (!domainsDir || !fs.existsSync(domainsDir)) return null;
  return directoryHash(domainsDir);
}

function createFreshnessMetadata({
  projectDir,
  domainsDir,
  artifactPaths = DEFAULT_ARTIFACTS,
  generatedImportCodeRevision = null,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    artifacts: {
      sourceSchema: {
        path: artifactPaths.sourceSchema || DEFAULT_ARTIFACTS.sourceSchema,
        sha256: hashArtifact(projectDir, artifactPaths.sourceSchema || DEFAULT_ARTIFACTS.sourceSchema),
      },
      mappingPlan: {
        path: artifactPaths.mappingPlan || DEFAULT_ARTIFACTS.mappingPlan,
        sha256: hashArtifact(projectDir, artifactPaths.mappingPlan || DEFAULT_ARTIFACTS.mappingPlan),
      },
      setupVerification: {
        path: artifactPaths.setupVerification || DEFAULT_ARTIFACTS.setupVerification,
        sha256: hashArtifact(projectDir, artifactPaths.setupVerification || DEFAULT_ARTIFACTS.setupVerification),
      },
      generatedImportCode: {
        path: artifactPaths.generatedImportCode || DEFAULT_ARTIFACTS.generatedImportCode,
        sha256: hashArtifact(projectDir, artifactPaths.generatedImportCode || DEFAULT_ARTIFACTS.generatedImportCode),
        revision: generatedImportCodeRevision,
      },
    },
    targetContractLedger: {
      path: domainsDir || null,
      revision: targetLedgerRevision(domainsDir),
    },
  };
}

function compareFreshnessMetadata(current, recorded) {
  const changes = [];
  if (!recorded || typeof recorded !== 'object') {
    return { ok: false, stale: true, changes: [{ field: 'metadata', reason: 'missing' }] };
  }
  if (recorded.schemaVersion !== SCHEMA_VERSION) {
    changes.push({ field: 'schemaVersion', expected: SCHEMA_VERSION, actual: recorded.schemaVersion });
  }
  for (const name of Object.keys(current.artifacts || {})) {
    const currentEntry = current.artifacts[name] || {};
    const recordedEntry = (recorded.artifacts && recorded.artifacts[name]) || {};
    if (currentEntry.sha256 !== recordedEntry.sha256) {
      changes.push({
        field: `artifacts.${name}.sha256`,
        path: currentEntry.path || recordedEntry.path || null,
        expected: recordedEntry.sha256 || null,
        actual: currentEntry.sha256 || null,
      });
    }
    if (name === 'generatedImportCode' && currentEntry.revision !== recordedEntry.revision) {
      changes.push({
        field: 'artifacts.generatedImportCode.revision',
        expected: recordedEntry.revision || null,
        actual: currentEntry.revision || null,
      });
    }
  }
  const currentLedger = current.targetContractLedger || {};
  const recordedLedger = recorded.targetContractLedger || {};
  if (currentLedger.revision !== recordedLedger.revision) {
    changes.push({
      field: 'targetContractLedger.revision',
      path: currentLedger.path || recordedLedger.path || null,
      expected: recordedLedger.revision || null,
      actual: currentLedger.revision || null,
    });
  }
  return { ok: changes.length === 0, stale: changes.length > 0, changes };
}

function validateImportPlanFreshness({
  projectDir,
  domainsDir,
  metadataPath = 'execution/review/import-plan.freshness.json',
  artifactPaths = DEFAULT_ARTIFACTS,
  generatedImportCodeRevision = null,
} = {}) {
  const absoluteMetadataPath = path.resolve(projectDir, metadataPath);
  const current = createFreshnessMetadata({
    projectDir,
    domainsDir,
    artifactPaths,
    generatedImportCodeRevision,
  });
  if (!fs.existsSync(absoluteMetadataPath)) {
    return {
      ok: false,
      stale: true,
      current,
      recorded: null,
      changes: [{ field: metadataPath, reason: 'missing' }],
    };
  }
  const recorded = JSON.parse(fs.readFileSync(absoluteMetadataPath, 'utf8'));
  const comparison = compareFreshnessMetadata(current, recorded);
  return { ...comparison, current, recorded };
}

function writeFreshnessMetadata(filePath, metadata) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function renderImportPlanDelta({ staleResult, generatedAt = new Date().toISOString() }) {
  const lines = [
    '# Import Plan Delta',
    '',
    `Generated: ${generatedAt}`,
    '',
    'The approved import plan is stale relative to current artifacts.',
    '',
    '## Changed Assumptions',
    '',
  ];
  for (const change of staleResult.changes || []) {
    const pathPart = change.path ? ` (${change.path})` : '';
    const reasonPart = change.reason ? `: ${change.reason}` : '';
    lines.push(`- ${change.field}${pathPart}${reasonPart}`);
  }
  lines.push('', 'Regenerate `execution/review/import-plan.md` or accept this delta before live writes/final reporting.');
  return `${lines.join('\n')}\n`;
}

function writeImportPlanDelta(filePath, staleResult) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, renderImportPlanDelta({ staleResult }));
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ARTIFACTS,
  createFreshnessMetadata,
  compareFreshnessMetadata,
  validateImportPlanFreshness,
  writeFreshnessMetadata,
  renderImportPlanDelta,
  writeImportPlanDelta,
  hashArtifact,
  targetLedgerRevision,
};
