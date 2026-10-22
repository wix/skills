'use strict';

// The one way this adapter reads a Shopify store: `shopify store execute` run as a child process on
// the import operator's machine, through the session `shopify store auth` created there. No token
// is held or stored here.
//
// Read-only by construction: a document whose operation is a mutation is refused before any
// process starts (the CLI would refuse it too). The one exception is `startBulkOperation`
//: it sends the fixed `bulkOperationRunQuery` document -- a read job the CLI still
// classes as a mutation -- with `--allow-mutations`. No other call can carry that flag: the
// document is a constant here and the caller supplies only the bulk query text (a `query`
// operation, checked) as a variable.
//
// One pinned CLI, one pinned API version:
//   - every CLI process is `[process.execPath, <tools>/shopify-cli-4.8.3/node_modules/@shopify/cli/bin/run.js, ...]`,
//     so the Node.js the session check verified is the one that runs it, and a `shopify` or
//     `node` elsewhere on PATH is never used;
//   - every process gets the parent environment with `CI=1` and without
//     `SHOPIFY_CLI_FORCE_AUTO_UPGRADE`, so the CLI never runs its machine-wide self-update;
//   - the installed package's version is read before every `store execute`;
//   - every `store execute` passes `--version 2026-10`.
//
// Result contract for every call:
//   { data, errors: [] }      the store answered
//   { data: null, errors }    the store answered with GraphQL errors (returned to the caller)
//   throws ShopifyCliError    anything else, with a class code:
//     source_auth_expired              the CLI has no valid stored session for the store
//     shopify_throttled                THROTTLED on all 6 calls of one read (31 s of waits)
//     shopify_api_version_unsupported  the CLI rejected the pinned API version
//     shopify_cli_incompatible         the CLI has no `store` commands
//     shopify_cli_version_changed      the installed CLI is not 4.8.3 (checked before the call)
//     shopify_cli_failed               anything else: stop the step; never retried

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHOPIFY_CLI_VERSION = '4.8.3';
const SHOPIFY_CLI_NODE_MIN = '22.12.0';
// What the pinned package's `engines.node` must say; a pin moved without moving the runtime
// minimum stops at the session check.
const SHOPIFY_CLI_ENGINES_NODE = `>=${SHOPIFY_CLI_NODE_MIN}`;
const SHOPIFY_ADMIN_API_VERSION = '2026-10';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;
// Paging pace and throttling: first: 250 with cursors, 500 ms between paged calls; a
// THROTTLED answer is retried after 1, 2, 4, 8 and 16 s -- at most 6 calls per read.
const PAGE_SIZE = 250;
const PAGE_GAP_MS = 500;
const THROTTLE_WAITS_MS = Object.freeze([1000, 2000, 4000, 8000, 16000]);

// The only mutation this adapter ever sends. `groupObjects` stays at its
// schema default (false): the reassembler folds children by `__parentId` in any line order.
const BULK_RUN_MUTATION = 'mutation RpBulkRunQuery($query: String!) { bulkOperationRunQuery(query: $query) { bulkOperation { id status createdAt } userErrors { field message code } } }';

class ShopifyCliError extends Error {
  constructor(message, { code = 'shopify_cli_failed', exitCode = null, stderr = '', errors = null } = {}) {
    super(message);
    this.name = 'ShopifyCliError';
    this.code = code;
    this.exitCode = exitCode;
    // A short tail only: the CLI's own output can echo the query, never a secret, but keep it bounded.
    this.stderrTail = String(stderr || '').slice(-2000);
    if (errors) this.errors = errors;
  }
}

// ---------------------------------------------------------------------------------------------
// The adapter's own CLI install
// ---------------------------------------------------------------------------------------------

function defaultToolsDir() {
  return path.join(os.homedir(), '.replatform', 'tools');
}

function cliInstallDir(toolsDir = defaultToolsDir()) {
  return path.join(toolsDir, `shopify-cli-${SHOPIFY_CLI_VERSION}`);
}

function cliPackageDir(toolsDir = defaultToolsDir()) {
  return path.join(cliInstallDir(toolsDir), 'node_modules', '@shopify', 'cli');
}

function cliEntryPath(toolsDir = defaultToolsDir()) {
  return path.join(cliPackageDir(toolsDir), 'bin', 'run.js');
}

// The argv prefix of every CLI process: the checked runtime, then the adapter's entry script.
// Never `.bin/shopify` (its `env node` shebang) and never a `shopify` on PATH.
function adapterCommand(toolsDir = defaultToolsDir()) {
  return [process.execPath, cliEntryPath(toolsDir)];
}

// A file read, no process: { present, version, enginesNode }.
function readInstalledPackage(toolsDir = defaultToolsDir()) {
  const file = path.join(cliPackageDir(toolsDir), 'package.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { present: false, version: null, enginesNode: null, file };
    throw error;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return {
    present: true,
    version: parsed && typeof parsed.version === 'string' ? parsed.version : null,
    enginesNode: parsed && parsed.engines && typeof parsed.engines.node === 'string' ? parsed.engines.node : null,
    file,
  };
}

function cliVersionChanged(found) {
  return new ShopifyCliError(
    `the adapter's Shopify CLI is ${found || 'unreadable'}, not the tested ${SHOPIFY_CLI_VERSION}. Nothing was read. Run the Shopify session check with --install to reinstall ${SHOPIFY_CLI_VERSION} (with the operator's consent), then run the step again.`,
    { code: 'shopify_cli_version_changed' },
  );
}

// Rule 3: before every `store execute`. Anything but the pinned version stops the step.
function assertInstalledVersion(toolsDir = defaultToolsDir()) {
  const installed = readInstalledPackage(toolsDir);
  if (!installed.present) {
    throw new ShopifyCliError(
      `the adapter's Shopify CLI ${SHOPIFY_CLI_VERSION} is not installed. Nothing was read. Run the Shopify session check (it installs the CLI with the operator's consent), then run the step again.`,
      { code: 'shopify_cli_not_installed' },
    );
  }
  if (installed.version !== SHOPIFY_CLI_VERSION) throw cliVersionChanged(installed.version);
  return installed;
}

// ---------------------------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------------------------

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

// Numeric major.minor.patch comparison: 22.9.0 < 22.12.0.
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`cannot compare versions ${left} and ${right}`);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function nodeRuntimeMessage(nodeVersion) {
  return `Shopify CLI ${SHOPIFY_CLI_VERSION} needs Node.js 22.12 or later; this migration is running on Node.js ${nodeVersion}. Switch this terminal to Node.js 22.12 or later (for example the current LTS) with your usual Node.js installer or version manager, check with \`node --version\`, then run the Shopify session check again. Nothing was installed or read.`;
}

function checkNodeRuntime(nodeVersion = process.versions.node) {
  const supported = parseVersion(nodeVersion) !== null && compareVersions(nodeVersion, SHOPIFY_CLI_NODE_MIN) >= 0;
  if (!supported) throw new ShopifyCliError(nodeRuntimeMessage(nodeVersion), { code: 'shopify_cli_node_unsupported' });
  return { nodePath: process.execPath, nodeVersion: String(nodeVersion) };
}

// ---------------------------------------------------------------------------------------------
// Process start: one environment rule for every CLI process
// ---------------------------------------------------------------------------------------------

// The parent environment with CI=1 (4.8.3 skips its upgrade attempt) and without the variable that
// would force it. Applied to whatever parent environment is passed, including a test's.
function cliChildEnv(parent = process.env) {
  const env = { ...parent };
  env.CI = '1';
  delete env.SHOPIFY_CLI_FORCE_AUTO_UPGRADE;
  return env;
}

function runFile(file, args, options) {
  if (options && options.stdio === 'inherit') {
    return new Promise((resolve) => {
      const child = spawn(file, args, { env: options.env, stdio: 'inherit', windowsHide: true });
      child.on('error', (error) => resolve({ error, stdout: '', stderr: '' }));
      child.on('close', (code) => resolve({ error: code === 0 ? null : Object.assign(new Error(`exited with ${code}`), { code }), stdout: '', stderr: '' }));
    });
  }
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// Starts one CLI process. `inherit` hands the terminal to it (the browser approval).
async function startCliProcess(args, { command = null, toolsDir = defaultToolsDir(), env = process.env, run = runFile, timeoutMs = DEFAULT_TIMEOUT_MS, inherit = false, onCall = null } = {}) {
  const argv = command || adapterCommand(toolsDir);
  const fullArgs = [...argv.slice(1), ...args];
  const childEnv = cliChildEnv(env);
  if (typeof onCall === 'function') onCall({ file: argv[0], args: [...fullArgs], env: childEnv });
  const options = inherit
    ? { env: childEnv, stdio: 'inherit', windowsHide: true }
    : { env: childEnv, timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true };
  const result = await run(argv[0], fullArgs, options);
  const exitCode = result.error ? (typeof result.error.code === 'number' ? result.error.code : null) : 0;
  return { ...result, exitCode, file: argv[0] };
}

// ---------------------------------------------------------------------------------------------
// Output parsing and failure classes
// ---------------------------------------------------------------------------------------------

// The operation keyword of the first definition, after comments. Shorthand `{ ... }` is a query.
function operationKind(document) {
  const text = String(document || '').replace(/#[^\n]*/g, ' ').trim();
  const match = /^(query|mutation|subscription)\b/.exec(text);
  return match ? match[1] : 'query';
}

function parseJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

// On a GraphQL failure the CLI exits non-zero with "GraphQL operation failed." and the response's
// `errors` array as JSON. Recover that array; when the JSON is wrapped by terminal rendering, fall
// back to the `code`/`message` pairs it carries.
function graphqlErrorsFrom(stderr) {
  const text = String(stderr || '');
  if (!/GraphQL operation failed/i.test(text) && !/"errors"\s*:/.test(text)) return null;
  const parsed = parseJsonText(text);
  if (parsed && Array.isArray(parsed.errors) && parsed.errors.length) return parsed.errors;
  const codes = [...text.matchAll(/"code"\s*:\s*"([A-Z_]+)"/g)].map((match) => match[1]);
  const messages = [...text.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
  if (!codes.length && !messages.length) return null;
  const count = Math.max(codes.length, messages.length);
  return Array.from({ length: count }, (_, i) => ({
    message: messages[i] || 'GraphQL error',
    ...(codes[i] ? { extensions: { code: codes[i] } } : {}),
  }));
}

function unwrapData(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.includes('data') && keys.every((key) => ['data', 'errors', 'extensions'].includes(key))) {
      return { data: parsed.data, errors: Array.isArray(parsed.errors) ? parsed.errors : [] };
    }
  }
  return { data: parsed, errors: [] };
}

// GraphQL error codes, deduplicated, for evidence pointers and stop reasons.
function errorCodes(errors) {
  return [...new Set((errors || []).map((error) => (error && error.extensions && error.extensions.code) || 'GRAPHQL_ERROR'))];
}

function isThrottled(errors) {
  return Array.isArray(errors) && errors.length > 0 && errorCodes(errors).includes('THROTTLED');
}

// The CLI messages these patterns match are read from the shipped 4.8.3 code: "No stored app
// authentication found for <store>." and "Stored app authentication for <store> is no longer
// valid." (both followed by "to (re-)authenticate"), and "Invalid API version: <v>". The live
// expiry text is not captured yet: an unmatched failure is shopify_cli_failed, a stop.
const AUTH_PATTERNS = [
  /No stored app authentication found/i,
  /Stored app authentication for \S+ is no longer valid/i,
  /to re-?authenticate/i,
];
const INCOMPATIBLE_PATTERNS = [
  /command\s+\S*store\S*\s+not found/i,
  /is not a shopify command/i,
  /Unknown command/i,
];

function classifyCliFailure(text) {
  const value = String(text || '');
  if (/Invalid API version/i.test(value)) return 'shopify_api_version_unsupported';
  if (AUTH_PATTERNS.some((pattern) => pattern.test(value))) return 'source_auth_expired';
  if (INCOMPATIBLE_PATTERNS.some((pattern) => pattern.test(value))) return 'shopify_cli_incompatible';
  return 'shopify_cli_failed';
}

const CLASS_MESSAGES = {
  source_auth_expired: 'the Shopify connection for this store expired or is missing',
  shopify_api_version_unsupported: `the Shopify CLI rejected the pinned Admin API version ${SHOPIFY_ADMIN_API_VERSION}`,
  shopify_cli_incompatible: 'the Shopify CLI has no store commands',
};

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------------------------
// store execute
// ---------------------------------------------------------------------------------------------

// `command`, `env`, `run` and `toolsDir` are injectable for tests only; product callers pass just
// `store`. The installed version is checked before every call whenever the command is the
// adapter's own install (an explicit test `command` has no package to check).
function createStoreExecutor({
  store,
  command = null,
  apiVersion = SHOPIFY_ADMIN_API_VERSION,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  run = runFile,
  onCall = null,
  toolsDir = defaultToolsDir(),
  sleep = defaultSleep,
  throttleWaitsMs = THROTTLE_WAITS_MS,
} = {}) {
  if (typeof store !== 'string' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(store)) {
    throw new ShopifyCliError('store must be the *.myshopify.com domain the Shopify CLI session is bound to', { code: 'shopify_store_invalid' });
  }
  if (command !== null && (!Array.isArray(command) || command.length === 0)) throw new ShopifyCliError('command must be a non-empty argv prefix', { code: 'shopify_cli_invalid' });
  const checkVersion = command === null;

  async function once(query, variables, { allowMutations = false } = {}) {
    if (checkVersion) assertInstalledVersion(toolsDir);
    const args = ['store', 'execute', '--store', store, '--query', query, '--json', '--no-color'];
    if (variables && Object.keys(variables).length) args.push('--variables', JSON.stringify(variables));
    if (allowMutations) args.push('--allow-mutations');
    if (apiVersion) args.push('--version', apiVersion);
    const { error, stdout, stderr, exitCode, file } = await startCliProcess(args, { command, toolsDir, env, run, timeoutMs, onCall });
    if (error) {
      const errors = graphqlErrorsFrom(stderr) || graphqlErrorsFrom(stdout);
      if (errors) return { data: null, errors };
      const cls = error.code === 'ENOENT' ? 'shopify_cli_failed' : classifyCliFailure(`${stderr}\n${stdout}`);
      const why = error.code === 'ENOENT'
        ? `the Shopify CLI was not found (${file})`
        : CLASS_MESSAGES[cls] || `the Shopify CLI exited${exitCode === null ? '' : ` with ${exitCode}`}`;
      throw new ShopifyCliError(`${why} without a GraphQL answer`, { code: cls, exitCode, stderr });
    }
    const parsed = parseJsonText(stdout);
    if (parsed === undefined) throw new ShopifyCliError('the Shopify CLI printed no JSON result', { stderr });
    return unwrapData(parsed);
  }

  // One read: the first call plus at most throttleWaitsMs.length retries, only on THROTTLED.
  async function withThrottleRetries(query, variables, options) {
    for (let attempt = 0; ; attempt += 1) {
      const result = await once(query, variables, options);
      if (!isThrottled(result.errors)) return result;
      if (attempt >= throttleWaitsMs.length) {
        throw new ShopifyCliError(`Shopify throttled this read on all ${attempt + 1} calls`, { code: 'shopify_throttled', errors: result.errors });
      }
      await sleep(throttleWaitsMs[attempt]);
    }
  }

  async function execute(query, variables = null) {
    if (operationKind(query) !== 'query') {
      throw new ShopifyCliError('this adapter is read-only: only GraphQL queries may be executed', { code: 'shopify_mutation_refused' });
    }
    return withThrottleRetries(query, variables, {});
  }

  // A caller with its own approved retry schedule (the gift-card read-bound count gate) uses
  // one physical CLI call at a time, so its advertised three attempts are exactly three calls
  // rather than three nested six-call throttle budgets.
  execute.once = async function executeOnce(query, variables = null) {
    if (operationKind(query) !== 'query') {
      throw new ShopifyCliError('this adapter is read-only: only GraphQL queries may be executed', { code: 'shopify_mutation_refused' });
    }
    return once(query, variables, {});
  };

  // Starts one bulk read job. The mutation document is the constant above;
  // `bulkQuery` is data and must itself be a plain query, so nothing else can ride on the flag.
  execute.startBulkOperation = async function startBulkOperation(bulkQuery) {
    if (typeof bulkQuery !== 'string' || operationKind(bulkQuery) !== 'query') {
      throw new ShopifyCliError('a bulk operation runs only a GraphQL query', { code: 'shopify_mutation_refused' });
    }
    return withThrottleRetries(BULK_RUN_MUTATION, { query: bulkQuery }, { allowMutations: true });
  };

  return execute;
}

// Paged read: first: 250 with cursors and a fixed gap between paged calls. Each page is its own
// read with its own throttle budget. `connectionPath` names the connection in `data`; the query
// must take `$first` and `$after` and select `pageInfo { hasNextPage endCursor }`.
async function readAllPages(execute, query, { connectionPath, variables = {}, sleep = defaultSleep, gapMs = PAGE_GAP_MS, pageSize = PAGE_SIZE } = {}) {
  const nodes = [];
  let after = null;
  for (let page = 0; ; page += 1) {
    if (page > 0) await sleep(gapMs);
    const result = await execute(query, { ...variables, first: pageSize, after });
    if (result.errors && result.errors.length) return { nodes, errors: result.errors, pages: page + 1 };
    const connection = connectionPath.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), result.data);
    if (!connection || !Array.isArray(connection.nodes)) {
      return { nodes, errors: [{ message: 'the paged read returned no connection at its path', extensions: { code: 'CONNECTION_MISSING' } }], pages: page + 1 };
    }
    nodes.push(...connection.nodes);
    const info = connection.pageInfo || {};
    if (!info.hasNextPage || !info.endCursor) return { nodes, errors: [], pages: page + 1 };
    after = info.endCursor;
  }
}

module.exports = {
  SHOPIFY_CLI_VERSION,
  SHOPIFY_CLI_NODE_MIN,
  SHOPIFY_CLI_ENGINES_NODE,
  SHOPIFY_ADMIN_API_VERSION,
  PAGE_SIZE,
  PAGE_GAP_MS,
  THROTTLE_WAITS_MS,
  BULK_RUN_MUTATION,
  ShopifyCliError,
  defaultToolsDir,
  cliInstallDir,
  cliPackageDir,
  cliEntryPath,
  adapterCommand,
  readInstalledPackage,
  assertInstalledVersion,
  cliVersionChanged,
  compareVersions,
  checkNodeRuntime,
  nodeRuntimeMessage,
  cliChildEnv,
  startCliProcess,
  runFile,
  operationKind,
  graphqlErrorsFrom,
  classifyCliFailure,
  createStoreExecutor,
  readAllPages,
  errorCodes,
};
