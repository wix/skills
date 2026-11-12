#!/usr/bin/env node
'use strict';

// The deterministic writer half of the entity-QA attestation gate. The QA
// subagent does the actual entity-by-entity pass (`rp-execute-import/SKILL.md`'s "Entity-by-
// entity QA" section) and hands its per-entity results to this script as a plain JSON file;
// this script never re-derives or copies counts out of the completion report on its own -- it
// only computes the report digest, resolves the independent mapped-entity coverage source
// (`mapping/mapping-plan.json` or, for quick mode, `quick-mode/plan.json`), and writes the
// attestation atomically, but ONLY if it validates. A count mismatch (or any other gate
// failure) is printed as a QA finding and the script exits non-zero without writing anything --
// it must never overwrite a previously-valid attestation with a broken one.
//
// Usage:
//   node scripts/entity-qa-attestation.js <projectDir> --entities-file <path> [--verified-by <label>]

const fs = require('node:fs');
const path = require('node:path');
const { BACKEND_COMPLETION_FILE, readMappedEntities } = require('../lib/migration-completion.js');
const { hashArtifact } = require('../lib/artifact-freshness.js');
const { ENTITY_QA_ATTESTATION_FILE, SCHEMA_VERSION, validateEntityQaAttestation } = require('../lib/entity-qa-attestation.js');
const { writeJsonAtomic } = require('../lib/orchestration-state.js');

function usage() {
  console.error(`Usage:
  node skills/wix-replatform/scripts/entity-qa-attestation.js <projectDir> --entities-file <path> [--verified-by <label>]

Reads the QA subagent's per-entity results from --entities-file (a JSON array; full-mode rows
carry the ten completion-report fields, quick-mode rows carry imported/skipped), computes the
digest of <projectDir>/execution/completion-report.json itself, resolves the independent
mapped-entity coverage source by mode, and writes <projectDir>/execution/qa/entity-qa-attestation.json
ONLY if the result validates. A count mismatch or any other gate failure is printed as a
finding and the script exits non-zero without writing the file.
`);
}

function parseArgs(argv) {
  const positional = [];
  const options = { entitiesFile: null, verifiedBy: 'qa-subagent' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--entities-file') {
      options.entitiesFile = argv[i + 1];
      i += 1;
    } else if (arg === '--verified-by') {
      options.verifiedBy = argv[i + 1];
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { projectDir: positional[0], ...options };
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} not found at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} at ${filePath} is not valid JSON: ${error.message}`);
  }
}

function printFindings(result) {
  if (result.entities && result.entities.length) {
    for (const entry of result.entities) {
      console.error(`${entry.entity}/${entry.subtype}: ${entry.reasons.join(', ')}`);
    }
  } else {
    for (const reason of result.reasons) {
      console.error(reason);
    }
  }
}

async function main() {
  const { projectDir: projectDirArg, entitiesFile, verifiedBy } = parseArgs(process.argv.slice(2));
  if (!projectDirArg || !entitiesFile) {
    usage();
    process.exit(1);
    return;
  }
  const projectDir = path.resolve(projectDirArg);

  const report = readJsonFile(path.join(projectDir, BACKEND_COMPLETION_FILE), 'completion report');
  const entities = readJsonFile(path.resolve(entitiesFile), 'entities file');
  if (!Array.isArray(entities)) {
    throw new Error(`--entities-file must contain a JSON array of per-entity rows: ${entitiesFile}`);
  }

  const managementImportMode = report.managementImportMode === 'quick' ? 'quick' : 'full';
  const mappedEntities = await readMappedEntities(projectDir, managementImportMode);
  const completionReportDigest = hashArtifact(projectDir, BACKEND_COMPLETION_FILE);

  const attestation = {
    schemaVersion: SCHEMA_VERSION,
    completionReportDigest,
    verifiedAt: new Date().toISOString(),
    verifiedBy,
    entities,
  };

  const result = validateEntityQaAttestation({
    attestation,
    report,
    reportDigest: completionReportDigest,
    mappedEntities,
  });

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, qaStatus: result.qaStatus, projectDir }, null, 2));
    printFindings(result);
    process.exit(1);
    return;
  }

  const outputPath = path.join(projectDir, ENTITY_QA_ATTESTATION_FILE);
  await writeJsonAtomic(outputPath, attestation);
  console.log(JSON.stringify({ ok: true, outputPath, qaStatus: result.qaStatus }, null, 2));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
