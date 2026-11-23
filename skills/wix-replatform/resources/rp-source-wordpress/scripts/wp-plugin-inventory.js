#!/usr/bin/env node

// Plugin inventory pre-pass. Fetches the signals plugin detection needs — the REST index,
// GET /wp/v2/plugins, /wp/v2/types, /wp/v2/taxonomies, and optionally the public homepage
// HTML — then runs the pure detector and writes plugin-inventory.json.
//
// Runs before route classification so classification can already know which plugins are
// present. Every fetch here is individually non-fatal: an unauthenticated run loses the
// plugin list but must still produce an inventory from namespace/route/asset fingerprints.

const fs = require('node:fs/promises');
const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../../../lib/progress-log.js');
const {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_RPM,
  DEFAULT_MAX_RETRIES,
  configureRateLimit,
  buildHeaders,
  normalizeBaseUrl,
  fetchJson,
} = require('../lib/wp-http.js');
const { pluginsRoot, loadProfiles, loadFingerprintAliases } = require('../lib/plugin-knowledge.js');
const { detectPlugins } = require('../lib/wp-plugin-detect.js');

let progress;

function printUsage() {
  console.log(`Usage:
  node wp-plugin-inventory.js --base-url <url> --out-dir <dir> [auth options]

Required:
  --base-url <url>              WordPress site base URL
  --out-dir <dir>               Directory to write plugin-inventory.json into

Authentication options (same as wp-discovery.js):
  --username <name>             WordPress username for Application Password auth
  --application-password <pw>   WordPress Application Password
  --api-key <token>             API key/token for custom auth setups
  --api-key-header <name>       Header name for --api-key
  --auth-header <'Name: Value'> Add a raw HTTP header. Can be repeated.

Optional:
  --no-html-fingerprint         Skip the public homepage fetch used for asset fingerprints
  --timeout-ms <n>              Request timeout in ms
  --rate-limit-rpm <n>          Max requests per minute
  --max-retries <n>             Retries on 429/503
  --progress-log <path>         Append progress NDJSON records to this file
  --help                        Show this help text

GET /wp/v2/plugins requires an administrator credential. Without it the run continues and
records pluginListAvailable: false — detection then relies on REST namespaces, declared
routes, registered types/taxonomies, and public asset paths.
`);
}

function parseArgs(argv) {
  const args = {
    authHeaders: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    rateLimitRpm: DEFAULT_RATE_LIMIT_RPM,
    maxRetries: DEFAULT_MAX_RETRIES,
    htmlFingerprint: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--base-url': args.baseUrl = next; i += 1; break;
      case '--out-dir': args.outDir = next; i += 1; break;
      case '--username': args.username = next; i += 1; break;
      case '--application-password': args.applicationPassword = next; i += 1; break;
      case '--api-key': args.apiKey = next; i += 1; break;
      case '--api-key-header': args.apiKeyHeader = next; i += 1; break;
      case '--auth-header': args.authHeaders.push(next); i += 1; break;
      case '--timeout-ms': args.timeoutMs = Number.parseInt(next, 10); i += 1; break;
      case '--rate-limit-rpm': args.rateLimitRpm = Number.parseInt(next, 10); i += 1; break;
      case '--max-retries': args.maxRetries = Number.parseInt(next, 10); i += 1; break;
      case '--no-html-fingerprint': args.htmlFingerprint = false; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.baseUrl = args.baseUrl || process.env.WP_BASE_URL || process.env.WP_SITE_URL;
  args.username = args.username || process.env.WP_USERNAME;
  args.applicationPassword = args.applicationPassword || process.env.WP_APPLICATION_PASSWORD;
  args.apiKey = args.apiKey || process.env.WP_API_KEY;
  args.apiKeyHeader = args.apiKeyHeader || process.env.WP_API_KEY_HEADER;
  if (args.authHeaders.length === 0 && process.env.WP_AUTH_HEADER) {
    args.authHeaders.push(process.env.WP_AUTH_HEADER);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) args.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(args.rateLimitRpm) || args.rateLimitRpm < 1) args.rateLimitRpm = DEFAULT_RATE_LIMIT_RPM;
  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 0) args.maxRetries = DEFAULT_MAX_RETRIES;
  return args;
}

async function fetchOptional(baseUrl, routePath, options, label) {
  const response = await fetchJson(baseUrl, routePath, options);
  if (response.ok && response.json !== undefined) {
    return { value: response.json, status: response.status, available: true };
  }
  return {
    value: null,
    status: response.status,
    available: false,
    reason: `${label} unavailable: ${response.status} ${response.statusText}`,
  };
}

// Deliberately a plain fetch rather than the wp-http helper: the homepage is not a
// /wp-json route, and this signal is a best-effort extra that must never fail the run.
async function fetchHomepageHtml(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000));
  try {
    const response = await fetch(normalizeBaseUrl(baseUrl), {
      signal: controller.signal,
      headers: { accept: 'text/html' },
    });
    if (!response.ok) return '';
    const text = await response.text();
    return text.slice(0, 500000);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function gatherInventory({ baseUrl, headers, timeoutMs, htmlFingerprint = true, restIndex = null, logger = null }) {
  const notes = [];
  const options = { headers, method: 'GET', timeoutMs, progress: logger, progressContext: { step: 'plugin-inventory' } };

  let index = restIndex;
  if (!index) {
    const rootResponse = await fetchJson(baseUrl, '', options);
    if (!rootResponse.ok || !rootResponse.json) {
      throw new Error(`Failed to fetch WordPress REST index from ${rootResponse.url}: ${rootResponse.status} ${rootResponse.statusText}`);
    }
    index = rootResponse.json;
  }

  const [pluginList, types, taxonomies, html] = await Promise.all([
    fetchOptional(baseUrl, '/wp/v2/plugins', options, 'GET /wp/v2/plugins'),
    fetchOptional(baseUrl, '/wp/v2/types', options, 'GET /wp/v2/types'),
    fetchOptional(baseUrl, '/wp/v2/taxonomies', options, 'GET /wp/v2/taxonomies'),
    htmlFingerprint ? fetchHomepageHtml(baseUrl, timeoutMs) : Promise.resolve(''),
  ]);
  if (!pluginList.available) {
    notes.push(`${pluginList.reason}. Plugin detection fell back to namespace, route, type, and asset fingerprints; installed-but-unprofiled plugins cannot be enumerated.`);
  }
  if (!types.available) notes.push(`${types.reason}. Generic custom-post-type derivation is unavailable.`);
  if (!taxonomies.available) notes.push(`${taxonomies.reason}. Generic custom-taxonomy derivation is unavailable.`);
  if (htmlFingerprint && !html) notes.push('Public homepage HTML could not be read; asset-path plugin fingerprints were skipped.');

  const knowledgeDir = pluginsRoot(path.resolve(__dirname, '..'));
  const profiles = loadProfiles(knowledgeDir);
  const detection = detectPlugins({
    profiles,
    restIndex: index,
    pluginList: Array.isArray(pluginList.value) ? pluginList.value : null,
    types: types.value,
    taxonomies: taxonomies.value,
    htmlSources: html ? [html] : [],
    fingerprintAliases: loadFingerprintAliases(knowledgeDir),
  });

  return {
    restIndex: index,
    types: types.value,
    taxonomies: taxonomies.value,
    // Raw signals are returned so the caller can re-run detection after sampling without
    // re-fetching: the core-embedded pass needs record properties that do not exist yet.
    pluginList: Array.isArray(pluginList.value) ? pluginList.value : null,
    htmlSources: html ? [html] : [],
    detection,
    notes,
    profileCount: profiles.length,
  };
}

function inventoryPayload({ generatedAt, baseUrl, authenticated, detection, notes, unprofiled = [], profileCount }) {
  return {
    generatedAt,
    baseUrl,
    authenticated,
    pluginListAvailable: detection.pluginListAvailable,
    profilesLoaded: profileCount,
    notes,
    detected: detection.detected,
    unprofiled,
    installedButUnprofiled: detection.installedButUnprofiled,
    // Publicly fingerprinted plugins nothing else claimed — names only, no
    // completeness claim, never route scope.
    fingerprinted: detection.fingerprinted || [],
  };
}

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/replatform/resources/rp-source-wordpress/scripts/wp-plugin-inventory.js',
    ...parsed.progress,
  });
  progress.start('WordPress plugin inventory started', { phase: 'discovery' });

  const args = parseArgs(parsed.args);
  if (args.help) {
    printUsage();
    progress.complete('WordPress plugin inventory help shown', { phase: 'discovery', step: 'help' });
    return;
  }
  if (!args.baseUrl || !args.outDir) {
    printUsage();
    progress.error('Missing required plugin inventory arguments', { phase: 'discovery' });
    throw new Error('Missing required arguments: --base-url and --out-dir are required.');
  }

  configureRateLimit({ rateLimitRpm: args.rateLimitRpm, maxRetries: args.maxRetries });
  const headers = buildHeaders(args);
  const authenticated = Boolean((args.username && args.applicationPassword) || args.apiKey || args.authHeaders.length > 0);

  const result = await gatherInventory({
    baseUrl: args.baseUrl,
    headers,
    timeoutMs: args.timeoutMs,
    htmlFingerprint: args.htmlFingerprint,
    logger: progress,
  });

  const payload = inventoryPayload({
    generatedAt: new Date().toISOString(),
    baseUrl: normalizeBaseUrl(args.baseUrl),
    authenticated,
    detection: result.detection,
    notes: result.notes,
    profileCount: result.profileCount,
  });

  await fs.mkdir(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, 'plugin-inventory.json');
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Detected ${payload.detected.length} profiled plugin(s); wrote ${outPath}`);
  progress.complete('WordPress plugin inventory completed', {
    phase: 'discovery',
    artifact: outPath,
    count: payload.detected.length,
    unit: 'plugins',
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    if (progress) progress.error(error && error.message ? error.message : 'plugin inventory failed', { phase: 'discovery' });
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  gatherInventory,
  inventoryPayload,
  fetchHomepageHtml,
};
