#!/usr/bin/env node
'use strict';

// The Shopify extract step: reads the full store through Shopify's bulk export, one
// dataset at a time, and writes the extract files the import step consumes.
//
//   node scripts/shopify-extract.js --project <migrations-root>/<project> [--store <shop>.myshopify.com]
//        [--retry-failed] [--catch-up] [--progress-log <path>]
//
// The store defaults to SHOPIFY_SHOP_DOMAIN in config/source.shopify.env. Run the Shopify session
// check first: the extract refuses to start without a passing one.
//
//   (no flag)        start the extract, or resume it from data/source-extract/extract-manifest.json.
//                    A manifest that says `complete` with its final files present skips the read.
//   --retry-failed   Import Operator recovery: send every stopping dataset (each `failed` entry, each
//                    unattributed `denied` entry, and the datasets whose exact count check stopped
//                    the extract) back to `pending` and read it again. Nothing else is reset.
//   --catch-up       a source catch-up rerun: archive the `complete` manifest as
//                    extract-manifest.<T_prev>.json and read the whole store again with a new
//                    snapshot time. A manifest that is not complete is resumed instead.
//
// Output: data/source-extract/<entity>.ndjson, data/source-extract/extract-manifest.json.
// Exit codes: 0 complete; 3 waiting on a question (shopify_bulk_overdue: answer it, run again);
// 2 stopped (the printed code says why; finished datasets are kept); 1 usage error.

const fs = require('node:fs/promises');
const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../../../lib/progress-log.js');
const { readEnvFile } = require('../../../lib/config-env.js');
const { SHOPIFY_SOURCE_ENV } = require('../../../lib/source-access.js');
const { createStoreExecutor, ShopifyCliError } = require('../lib/shopify-cli.js');
const session = require('../lib/shopify-session.js');
const bulk = require('../lib/shopify-bulk.js');
const protectedFields = require('../lib/shopify-protected-fields.js');
const giftCards = require('../lib/shopify-gift-cards.js');

const USAGE = 'Usage: shopify-extract.js --project <migrations-root>/<project> [--store <shop>.myshopify.com] [--retry-failed] [--catch-up] [--progress-log <path>]\n';

function parseArgs(argv) {
  const args = { project: null, store: null, retryFailed: false, catchUp: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project') { args.project = argv[i + 1]; i += 1; }
    else if (arg === '--store') { args.store = argv[i + 1]; i += 1; }
    else if (arg === '--retry-failed') args.retryFailed = true;
    else if (arg === '--catch-up') args.catchUp = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

async function configuredDomain(projectDir) {
  let values;
  try {
    values = await readEnvFile(path.join(projectDir, SHOPIFY_SOURCE_ENV));
  } catch (error) {
    if (error.code === 'ENOENT') throw new session.ShopifySessionStop('shopify_shop_domain_missing', `${SHOPIFY_SOURCE_ENV} is missing; record SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com there or pass --store.`);
    throw error;
  }
  if (!values.SHOPIFY_SHOP_DOMAIN) throw new session.ShopifySessionStop('shopify_shop_domain_missing', `SHOPIFY_SHOP_DOMAIN is missing from ${SHOPIFY_SOURCE_ENV}.`);
  return values.SHOPIFY_SHOP_DOMAIN;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The previous complete manifest is kept as extract-manifest.<T_prev>.json (':' replaced by
// '-' so the name is valid on every platform), and the catch-up starts a fresh manifest.
async function archiveCompleteManifest(manifestPath, knownPrevious = null) {
  const previous = knownPrevious || await readJson(manifestPath);
  if (!previous || previous.status !== 'complete') return null;
  const stamp = String(previous.snapshotTime || 'unknown').replace(/:/g, '-');
  const archived = path.join(path.dirname(manifestPath), `extract-manifest.${stamp}.json`);
  try {
    await fs.access(archived);
    throw new session.ShopifySessionStop('shopify_extract_archive_exists', `${path.basename(archived)} already exists; the previous extract was already archived. Nothing was changed.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(manifestPath, archived);
  return archived;
}

// A crash can land after the complete manifest was renamed but before the new catch-up manifest
// was created. Recover its sidecar ownership from the newest archive so the replacement run still
// removes outputs that no longer exist; no archived record is ever modified.
async function latestArchivedManifest(manifestPath) {
  const dir = path.dirname(manifestPath);
  const prefix = `${path.basename(manifestPath, '.json')}.`;
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const candidates = [];
  for (const name of names.filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith('.json'))) {
    const file = path.join(dir, name);
    const manifest = await readJson(file);
    if (!manifest || manifest.status !== 'complete') continue;
    const time = Date.parse(manifest.snapshotTime || manifest.completedAt || '');
    candidates.push({ file, manifest, time: Number.isFinite(time) ? time : -Infinity });
  }
  candidates.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
  return candidates[0] || null;
}

// The denial path's session check: passes only when the connection is live and holds
// every required scope. A failure is data to the runner, not an exception.
function defaultSessionCheck({ projectDir, store }) {
  return async () => {
    try {
      await session.runSessionCheck({ projectDir, store, askFirstConnection: false });
      return { ok: true };
    } catch (error) {
      if (error instanceof session.ShopifySessionStop || error instanceof ShopifyCliError) return { ok: false, error: { code: error.code, message: error.message } };
      throw error;
    }
  };
}

async function runExtract({
  projectDir,
  store,
  execute,
  retryFailed = false,
  catchUp = false,
  now = () => Date.now(),
  sessionCheck = defaultSessionCheck({ projectDir, store }),
  ...runnerOptions
} = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  if (typeof execute !== 'function') throw new Error('execute is required');
  const normalizedStore = session.normalizeDomain(store);
  const outputDir = path.join(projectDir, bulk.RAW_EXTRACT_DIR);
  const manifestPath = path.join(outputDir, bulk.EXTRACT_MANIFEST_FILE);
  const stagingDir = path.join(outputDir, 'staging');
  let existing = await readJson(manifestPath);
  let archived = null;
  let previousSidecars = [];
  let sameStore = !existing;
  if (existing && existing.store) {
    try {
      sameStore = session.normalizeDomain(existing.store) === normalizedStore;
    } catch {
      sameStore = false;
    }
  }
  // Store binding is checked before the only destructive catch-up action. A mismatch stays in
  // place for the runner to report, so neither the manifest nor any final file is changed.
  if (catchUp && sameStore && existing && existing.status === 'complete') {
    previousSidecars = Array.isArray(existing.sidecars) ? existing.sidecars : [];
    archived = await archiveCompleteManifest(manifestPath, existing);
    existing = null;
  } else if (catchUp && !existing) {
    const recovered = await latestArchivedManifest(manifestPath);
    if (recovered) {
      let recoveredStore = null;
      try {
        recoveredStore = session.normalizeDomain(recovered.manifest.store);
      } catch {
        recoveredStore = null;
      }
      if (recoveredStore !== normalizedStore) {
        return {
          status: 'stopped',
          code: 'shopify_extract_store_mismatch',
          message: `${path.basename(recovered.file)} was read from ${recovered.manifest.store || 'an unrecorded store'}, not ${normalizedStore}. Nothing was read or changed.`,
          details: { recorded: recovered.manifest.store || null, store: normalizedStore },
        };
      }
      archived = recovered.file;
      previousSidecars = Array.isArray(recovered.manifest.sidecars) ? recovered.manifest.sidecars : [];
    }
  }
  giftCards.registerGiftCardHandlers(bulk);
  const snapshotTime = existing && existing.snapshotTime ? existing.snapshotTime : new Date(now()).toISOString();
  const probeState = await protectedFields.readProbeState(projectDir);
  const protectedOptions = protectedFields.createBulkOptions({ projectDir, sessionCheck, probeState });
  const project = protectedOptions.project;
  // Texts are only used for a new manifest; a resumed one keeps what each query was last sent.
  const queries = existing ? null : bulk.QUERY_NAMES.map((name) => ({ name, entity: bulk.entityOf(name), text: bulk.generateQueryText(name, { snapshotTime, project }) }));
  const suppliedHandlers = runnerOptions.handlers || {};
  const handlers = {
    ...protectedOptions.handlers,
    ...suppliedHandlers,
    failed: { ...(protectedOptions.handlers.failed || {}), ...(suppliedHandlers.failed || {}), byQuery: { ...((protectedOptions.handlers.failed || {}).byQuery || {}), ...((suppliedHandlers.failed || {}).byQuery || {}) } },
    reassemble: { ...(protectedOptions.handlers.reassemble || {}), ...(suppliedHandlers.reassemble || {}) },
  };
  const { handlers: _ignoredHandlers, deniedReset: suppliedDeniedReset, ...remainingRunnerOptions } = runnerOptions;
  const runner = bulk.createBulkRunner({
    projectDir,
    store: normalizedStore,
    caller: 'extract',
    manifestPath,
    stagingDir,
    outputDir,
    queries,
    snapshotTime,
    execute,
    retryFailed,
    previousSidecars,
    sessionCheck,
    handlers,
    deniedReset: suppliedDeniedReset || protectedOptions.deniedReset,
    now,
    ...remainingRunnerOptions,
  });
  const result = await runner.run();
  return { ...result, ...(archived ? { archived: path.relative(projectDir, archived) } : {}) };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseProgressArgs(argv);
  const logger = createProgressLogger({ script: 'skills/wix-replatform/resources/rp-source-shopify/scripts/shopify-extract.js', ...parsed.progress });
  let args;
  try {
    args = parseArgs(parsed.args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (args.help) { process.stdout.write(USAGE); return 0; }
  if (!args.project) { process.stderr.write(USAGE); return 1; }
  const projectDir = path.resolve(args.project);
  logger.start('Shopify extract started', { phase: 'execution' });
  try {
    const store = session.normalizeDomain(args.store || await configuredDomain(projectDir));
    // The extract starts only after a passing session check for this store, approved from a
    // confirmed dedicated migration staff account.
    await session.assertConnectionReady(projectDir, store);
    const execute = createStoreExecutor({ store });
    const result = await runExtract({
      projectDir,
      store,
      execute,
      retryFailed: args.retryFailed,
      catchUp: args.catchUp,
      progress: (message, fields) => logger.progress(message, { phase: 'execution', ...fields }),
    });
    const ok = result.status === 'complete';
    print({
      ok,
      status: result.status,
      ...(result.code ? { code: result.code, message: result.message } : {}),
      ...(result.details && result.details.requestIds ? { requestIds: result.details.requestIds } : {}),
      ...(result.archived ? { archived: result.archived } : {}),
      ...(result.skipped ? { skipped: true } : {}),
      manifest: `${bulk.RAW_EXTRACT_DIR}/${bulk.EXTRACT_MANIFEST_FILE}`,
    });
    logger.complete(`Shopify extract ${result.status}`, { phase: 'execution' });
    if (ok) return 0;
    return result.status === 'awaiting_user_action' ? 3 : 2;
  } catch (error) {
    if (error instanceof session.ShopifySessionStop || error instanceof ShopifyCliError) {
      print({ ok: false, status: 'stopped', code: error.code, message: error.message });
      logger.error(error.message, { phase: 'execution' });
      return 2;
    }
    throw error;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, runExtract, archiveCompleteManifest, defaultSessionCheck };
