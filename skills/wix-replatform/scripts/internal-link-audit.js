#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { census } = require('../lib/link-census.js');
const { buildLinkPlan } = require('../lib/link-plan.js');
const { readLinkAudit, writeLinkAudit, linkOperatorActions } = require('../lib/link-audit.js');
const { verifyLinkAudit } = require('../lib/link-verification.js');
const { structuredLinkPatch } = require('../lib/structured-link-patch.js');
const { createLinkWriteJournal } = require('../lib/link-write-journal.js');
const { inspectRoute, configureRoute } = require('../lib/app-page-routing.js');
const routeKnowledge = require('../resources/rp-target-wix/app-page-routing-capabilities.json');

function withinProject(projectDir, relative) {
  const resolved = path.resolve(projectDir, relative);
  if (!resolved.startsWith(`${projectDir}${path.sep}`)) throw new Error('input must be inside project directory');
  return resolved;
}

async function loadJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

async function main() {
  const [operation, projectArg, inputArg] = process.argv.slice(2);
  if (!['plan', 'route', 'verify'].includes(operation) || !projectArg || !inputArg) {
    throw new Error('Usage: internal-link-audit.js <plan|route|verify> <projectDir> <input.json>');
  }
  const projectDir = path.resolve(projectArg);
  const config = await loadJson(withinProject(projectDir, inputArg));
  if (operation === 'plan') {
    const previous = await readLinkAudit(projectDir);
    if (!Array.isArray(config.expectedFiles)) throw new Error('plan input needs the complete captured-file inventory as expectedFiles');
    const roots = config.capturedRoots.map((item) => withinProject(projectDir, item));
    const expectedFiles = config.expectedFiles.map((item) => withinProject(projectDir, item));
    const containingPages = Object.fromEntries(Object.entries(config.containingPages || {}).map(([file, value]) => [withinProject(projectDir, file), value]));
    const scanned = await census({ capturedRoots: roots, expectedFiles, sourceHosts: config.sourceHosts, destinationHosts: config.destinationHosts, containingPages, previous });
    const routeFile = path.join(projectDir, 'state/url-preservation/app-page-routes.json');
    const routes = await loadJson(routeFile).then((row) => row.results).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    const audit = buildLinkPlan({ census: scanned, targets: config.targets, samples: config.samples || [], routes, ownershipDecisions: config.ownershipDecisions || {}, activeWriters: config.activeWriters, previous, runId: config.runId, sourceSnapshot: config.sourceSnapshot, routeRevision: config.routeRevision, deploymentId: config.deploymentId || null, budgetDecision: config.budgetDecision || null });
    await writeLinkAudit(projectDir, audit);
    console.log(JSON.stringify({ stage: audit.stage, counts: audit.counts, pending: audit.pendingDestinations.length, unresolved: audit.unresolved.length, operatorActions: linkOperatorActions(audit).map((row) => row.code) }));
    return;
  }
  if (operation === 'route') {
    const transport = require(withinProject(projectDir, config.transportModule));
    if (typeof transport.inspectDestination !== 'function' || (await transport.inspectDestination()).isLive !== false) {
      throw new Error('route configuration requires an inspected non-live migration destination');
    }
    const results = [];
    for (const row of config.routes) {
      const capability = routeKnowledge.capabilities.find((item) => item.family === row.source.family && item.frontendType === row.frontendType)
        || { family: row.source.family, frontendType: row.frontendType, supported: false, reason: 'missing-schema-backed-adapter' };
      const existing = capability.supported ? await transport.read(capability.key, capability) : null;
      const plan = inspectRoute(row.source, capability, existing);
      results.push(await configureRoute(plan, capability, transport));
    }
    const output = withinProject(projectDir, config.output || 'state/url-preservation/app-page-routes.json');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`);
    await fs.rename(temporary, output);
    console.log(JSON.stringify({ routeCount: results.length, configured: results.filter((row) => row.status === 'configured' || row.status === 'reused').length, unresolved: results.filter((row) => !['configured', 'reused'].includes(row.status)).length }));
    return;
  }
  const audit = await readLinkAudit(projectDir);
  if (!audit) throw new Error('link audit missing; run plan first');
  const adapter = require(withinProject(projectDir, config.adapterModule));
  if (typeof adapter.getActiveWriters !== 'function') throw new Error('adapter must provide getActiveWriters');
  if (typeof adapter.inspectDestination !== 'function' || (await adapter.inspectDestination()).isLive !== false) {
    throw new Error('link repair requires an inspected non-live migration destination');
  }
  const activeWriters = await adapter.getActiveWriters();
  if (typeof adapter.readRecord !== 'function' || typeof adapter.writeRecord !== 'function' || typeof adapter.checkRenderedLink !== 'function') {
    throw new Error('verify adapter must provide readRecord, writeRecord and checkRenderedLink; per-occurrence repair callbacks are not accepted');
  }
  const recordAdapter = { read: adapter.readRecord.bind(adapter), write: adapter.writeRecord.bind(adapter), patchField: structuredLinkPatch };
  const result = await verifyLinkAudit(audit, {
    deploymentId: config.deploymentId, destinationState: 'migration-not-live', activeWriters,
    checkDestination: adapter.checkDestination, checkSample: adapter.checkSample,
    recordAdapter, journal: createLinkWriteJournal(projectDir, audit.runId),
    checkRenderedLink: adapter.checkRenderedLink.bind(adapter), checkFragment: adapter.checkFragment?.bind(adapter),
    readBackMs: config.readBackMs,
    writeMs: config.writeMs, writeSource: config.writeSource,
    sessionCount: config.sessionCount, exceptionTokens: config.exceptionTokens,
    onCheckpoint: (snapshot) => writeLinkAudit(projectDir, snapshot),
  });
  console.log(JSON.stringify({ stage: result.stage, estimate: result.estimate, pending: result.pendingDestinations.length, unresolved: result.unresolved.length, operatorActions: linkOperatorActions(result).map((row) => row.code) }));
}

main().catch((error) => { console.error(error && error.message || error); process.exitCode = 1; });
