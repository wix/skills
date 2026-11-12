#!/usr/bin/env node
'use strict';

// Read every planned plugin entity completely, read-only, BEFORE the mapping checkpoint, so
// the mapper maps its fields from complete data instead of a bounded sample. Size is not a
// reason to stop: a large entity just takes longer. Uses the same credentials and bridge
// transport as wp-discovery.js; import later reuses the same full output.
//
//   node plugin-full-read.js --project-dir <dir> [--env-file <file>] [--base-url <url>]
//        [--entity <plugin.slug.entity>]... [--restart] [any wp-discovery credential flag]
//
// Exit 0 when every entity is complete (or, for a project-code assembly plan, every component
// was read in full), 2 when any stays deferred (its typed task is in
// data/source-extract/<entity>.deferred.json), 1 on a usage or setup error.

const path = require('node:path');
const fs = require('node:fs');
const discovery = require('./wp-discovery.js');
const { buildHeaders, configureRateLimit } = require('../lib/wp-http.js');
const plans = require('../lib/plugin-entity-read-plan.js');

function splitArgs(argv) {
  const own = { entities: [], restart: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-dir') { own.projectDir = argv[i + 1]; i += 1; }
    else if (arg === '--entity') { own.entities.push(argv[i + 1]); i += 1; }
    else if (arg === '--restart') own.restart = true;
    else rest.push(arg);
  }
  return { own, rest };
}

async function main(argv, { createTransport = discovery.createBridgeTransport } = {}) {
  const { own, rest } = splitArgs(argv);
  if (!own.projectDir || own.entities.some((entity) => !entity)) {
    console.error('usage: plugin-full-read.js --project-dir <dir> [--env-file <file>] [--base-url <url>] [--entity <ref>]... [--restart]');
    return 1;
  }
  const projectDir = path.resolve(own.projectDir);
  const args = await discovery.hydrateArgsFromEnvFile(discovery.parseArgs(rest));
  const schemaPath = path.join(projectDir, 'source-schema.json');
  const schema = fs.existsSync(schemaPath) ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : {};
  const baseUrl = args.baseUrl || schema.sourceUrl || schema.source?.url;
  if (!baseUrl) { console.error('no source URL: pass --base-url or keep source-schema.json sourceUrl'); return 1; }

  let entities = plans.plannedPluginEntities(projectDir);
  if (own.entities.length) {
    const unknown = own.entities.filter((ref) => !entities.some((entity) => entity.sourceEntityRef === ref));
    if (unknown.length) { console.error(`no current read plan for: ${unknown.join(', ')}`); return 1; }
    entities = entities.filter((entity) => own.entities.includes(entity.sourceEntityRef));
  }

  configureRateLimit({ rateLimitRpm: args.rateLimitRpm, maxRetries: args.maxRetries });
  const sourceReads = discovery.makeSourceReadCollector(path.join(projectDir, 'discovery', 'wordpress'));
  const transport = createTransport({
    baseUrl: plans.sourceIdentity(baseUrl), headers: buildHeaders(args),
    timeoutMs: args.timeoutMs, onSourceRead: sourceReads.onSourceRead,
  });
  const results = await plans.readPluginEntitiesForMapping({ projectDir, transport, entities, restart: own.restart });
  sourceReads.flush();
  console.log(JSON.stringify({ results }, null, 2));
  return results.every((result) => ['current', 'promoted', 'components-read'].includes(result.status)) ? 0 : 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { main, splitArgs };
