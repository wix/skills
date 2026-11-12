'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnvText } = require('./config-env.js');

const SCHEMA_VERSION = 1;

const SETUP_PLAN = 'setup/setup-plan.json';
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

function configuredSiteId(projectDir) {
  try { return parseEnvText(fs.readFileSync(path.join(projectDir, 'config', 'wix.env'), 'utf8')).WIX_SITE_ID?.trim() || null; } catch { return null; }
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
  exampleCaptureRef = null,
} = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  const planFile=path.join(projectDir,artifactPaths.mappingPlan || DEFAULT_ARTIFACTS.mappingPlan);
  const plan=fs.existsSync(planFile)?JSON.parse(fs.readFileSync(planFile,'utf8')):null;
  const exact=plan?.fieldContractVersion===1;
  if (exampleCaptureRef && !/^state\/attempts\/field-mapping-examples\/[A-Za-z0-9_-]+\.ndjson$/.test(exampleCaptureRef)) throw new Error('invalid synthetic capture path');
  const additional = exact ? Object.fromEntries(Object.entries({
    entityDecisions:'mapping/entity-decisions',importPlan:'execution/review/import-plan.md',
    generatedHelpers:'src/lib',mappingExampleCapture:exampleCaptureRef,
  }).map(([name,p])=>[name,{path:p,sha256:hashArtifact(projectDir,p)}])) : {};
  const schemaFile = path.join(projectDir, 'source-schema.json');
  const schema = fs.existsSync(schemaFile) ? JSON.parse(fs.readFileSync(schemaFile, 'utf8')) : {};
  const entities = Array.isArray(schema.entities) ? schema.entities : Object.values(schema.entities || {});
  if (entities.some((entity) => entity.sourceMeta?.extractionPlan)) {
    const { planFreshnessReferences } = require('../resources/rp-source-wordpress/lib/plugin-entity-read-plan.js');
    for (const reference of planFreshnessReferences({ projectDir, entities })) additional[`pluginInput:${reference.path}`] = { path: reference.path, sha256: hashArtifact(projectDir, reference.path) };
    for (const input of ['src/extract', 'src/lib', 'src/project', 'src/import/plugin-handoff.js']) additional[`pluginCode:${input}`] = { path: input, sha256: hashArtifact(projectDir, input) };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    artifacts: {
      ...additional,
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
        setupPlanSha256: hashArtifact(projectDir, SETUP_PLAN),
        siteId: configuredSiteId(projectDir),
      },
      generatedImportCode: {
        path: artifactPaths.generatedImportCode || DEFAULT_ARTIFACTS.generatedImportCode,
        sha256: hashArtifact(projectDir, artifactPaths.generatedImportCode || DEFAULT_ARTIFACTS.generatedImportCode),
        revision: generatedImportCodeRevision,
      },
    },
    ...(exact ? {mappingRuntimeRevision: sha256Text([
      'lib/mapping-field-contract.js','lib/field-mapping-examples.js','lib/mapping-target-rules.js',
      'resources/rp-target-wix/lib/wix-writers.js',
    ].map(name=>`${name}\0${fileHash(path.join(__dirname,'..',name))}`).join('\n'))} : {}),
    targetContractLedger: {
      path: domainsDir || null,
      revision: targetLedgerRevision(domainsDir),
    },
  };
}

// The execution approval precedes every setup write, so a plan approved before setup records no
// receipt. The first receipt the approved setup plan then produces on the approved site is the
// approved outcome, not a changed assumption. It stays fresh only when the approval bound the setup
// plan and site, both are unchanged, the receipt passes the shared setup-verification validator, it
// and every check in it are at or after the approval, and it replaced no receipt from after the
// approval. Anything else, including a restored older receipt or a later setup re-run, is stale.
function approvedSetupReceipt(name, currentEntry, recordedEntry, setupReceiptValid) {
  return name === 'setupVerification' && setupReceiptValid === true && recordedEntry.sha256 == null
    && Boolean(recordedEntry.setupPlanSha256) && currentEntry.setupPlanSha256 === recordedEntry.setupPlanSha256
    && Boolean(recordedEntry.siteId) && currentEntry.siteId === recordedEntry.siteId;
}

function currentSetupReceiptValid(projectDir, artifactPaths, recorded) {
  const { validateSetupVerification } = require('./setup-verification.js');
  const read = (file) => { try { return JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); } catch { return null; } };
  const siteId = configuredSiteId(projectDir);
  const approvedAt = Date.parse(recorded?.createdAt);
  if (!siteId || siteId !== recorded?.artifacts?.setupVerification?.siteId || Number.isNaN(approvedAt)) return false;
  const receipt = read(artifactPaths.setupVerification || DEFAULT_ARTIFACTS.setupVerification);
  const after = (at) => typeof at === 'string' && Date.parse(at) >= approvedAt;
  if (!receipt || !after(receipt.generatedAt) || !(receipt.requirements || []).every((row) => after(row.verification?.checkedAt))) return false;
  if (!Object.hasOwn(receipt, 'replaces') || (receipt.replaces !== null && !(Date.parse(receipt.replaces?.generatedAt) < approvedAt))) return false;
  return validateSetupVerification({ verification: receipt, plan: read(SETUP_PLAN), planDigest: hashArtifact(projectDir, SETUP_PLAN), siteId, projectDir }).ok;
}

function compareFreshnessMetadata(current, recorded, { setupReceiptValid = false } = {}) {
  const changes = [];
  if (!recorded || typeof recorded !== 'object') {
    return { ok: false, stale: true, changes: [{ field: 'metadata', reason: 'missing' }] };
  }
  if (recorded.schemaVersion !== SCHEMA_VERSION) {
    changes.push({ field: 'schemaVersion', expected: SCHEMA_VERSION, actual: recorded.schemaVersion });
  }
  for (const name of new Set([...Object.keys(current.artifacts || {}), ...Object.keys(recorded.artifacts || {})])) {
    const currentEntry = current.artifacts[name] || {};
    const recordedEntry = (recorded.artifacts && recorded.artifacts[name]) || {};
    if (name === 'setupVerification' && Object.hasOwn(recordedEntry, 'setupPlanSha256') && currentEntry.setupPlanSha256 !== recordedEntry.setupPlanSha256) {
      changes.push({ field: 'artifacts.setupVerification.setupPlanSha256', path: SETUP_PLAN, expected: recordedEntry.setupPlanSha256 || null, actual: currentEntry.setupPlanSha256 || null });
    }
    if (name === 'setupVerification' && Object.hasOwn(recordedEntry, 'siteId') && currentEntry.siteId !== recordedEntry.siteId) {
      changes.push({ field: 'artifacts.setupVerification.siteId', path: 'config/wix.env', expected: recordedEntry.siteId || null, actual: currentEntry.siteId || null });
    }
    if (currentEntry.sha256 !== recordedEntry.sha256 && !approvedSetupReceipt(name, currentEntry, recordedEntry, setupReceiptValid)) {
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
  if (current.mappingRuntimeRevision !== recorded.mappingRuntimeRevision) changes.push({field:'mappingRuntimeRevision',reason:'runtime helpers changed'});
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
  if (current.artifacts?.mappingExampleCapture && !current.artifacts.mappingExampleCapture.sha256) changes.push({field:'mappingExampleCapture',reason:'missing'});
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
  const recorded = fs.existsSync(absoluteMetadataPath)?JSON.parse(fs.readFileSync(absoluteMetadataPath,'utf8')):null;
  const current = createFreshnessMetadata({
    projectDir,
    domainsDir,
    artifactPaths,
    generatedImportCodeRevision,
    exampleCaptureRef:recorded?.artifacts?.mappingExampleCapture?.path || null,
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
  const comparison = compareFreshnessMetadata(current, recorded, { setupReceiptValid: currentSetupReceiptValid(projectDir, artifactPaths, recorded) });
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
