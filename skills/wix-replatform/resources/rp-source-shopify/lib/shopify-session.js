'use strict';

// The Shopify CLI connection: the required scopes, the session check and its receipt,
// the first-connection question, the staff-account record, and the re-approval request.
//
// Session check, in this order, stopping at the first failure:
//   1. Node.js runtime >= 22.12 -- before any install prompt or CLI process;
//   2. the adapter's own CLI install at exactly 4.8.3, its engines.node, `version`, and the
//      `store` commands; installing only with the operator's consent;
//   3. the connection is live and Shopify's scope readback holds every required scope;
//   4. the API-version canary: Shopify lists 2026-10 as supported;
//   5. the receipt, written through a temp file and a rename.
// A receipt on disk therefore means the most recent check passed: the previous one is removed
// before the check starts. It holds no secret and no personal data, and no approval references it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createUserAction, readUserAction } = require('../../../lib/user-actions.js');
const {
  STAFF_ACCESS_FILE,
  SESSION_RECEIPT_FILE,
  STAFF_REMOVAL_CONFIRMATION,
  readStaffAccess,
  writeStaffAccess,
  writeJsonAtomicSync,
  readSessionReceipt,
  passingReceipt,
} = require('../../../lib/source-access.js');
const cli = require('./shopify-cli.js');
const { ALL_READS, ORDER_WINDOW_READS } = require('./discovery-reads.js');

const QUERIES_DIR = path.join(__dirname, '..', 'queries');
const SESSION_CHECK = 'shopify-session-check.js';
const CONNECT_HINT = `\`node scripts/${SESSION_CHECK} --project <project> --connect\``;
const STORE_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

class ShopifySessionStop extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ShopifySessionStop';
    this.code = code;
    this.details = details;
  }
}

function normalizeDomain(store) {
  const value = typeof store === 'string' ? store.trim().toLowerCase() : '';
  if (!STORE_PATTERN.test(value)) {
    throw new ShopifySessionStop('shopify_store_invalid', 'SHOPIFY_SHOP_DOMAIN must be the *.myshopify.com domain of the store');
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Required scopes: derived from the reads, never listed by hand
// ---------------------------------------------------------------------------------------------

// `# scopes: read_orders, read_customers` -- the header line of a bulk query file.
function parseScopesHeader(text) {
  const match = /^#\s*scopes:\s*(.*)$/m.exec(String(text || ''));
  if (!match) return null;
  return match[1].split(',').map((scope) => scope.trim()).filter(Boolean);
}

function queryFileScopes(dir = QUERIES_DIR) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.graphql')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.map((name) => ({ file: name, scopes: parseScopesHeader(fs.readFileSync(path.join(dir, name), 'utf8')) }));
}

function deriveRequiredScopes({ reads = [...ALL_READS, ...ORDER_WINDOW_READS], queriesDir = QUERIES_DIR } = {}) {
  const scopes = new Set();
  for (const read of reads) for (const scope of read.scopes || []) scopes.add(scope);
  for (const entry of queryFileScopes(queriesDir)) for (const scope of entry.scopes || []) scopes.add(scope);
  return Object.freeze([...scopes].sort());
}

const SHOPIFY_REQUIRED_SCOPES = deriveRequiredScopes();

// ---------------------------------------------------------------------------------------------
// User actions: the first-connection question and the re-approval request
// ---------------------------------------------------------------------------------------------

function sequencedRequestId(namespace, key, n) {
  const hex = crypto.createHash('sha256').update(`${namespace}\0${key}\0${n}`).digest('hex');
  return `uar_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function readIfExists(projectDir, requestId) {
  try {
    return await readUserAction(projectDir, requestId);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The actions of one sequence, oldest first: ids 1, 2, ... until the first missing one.
async function sequence(projectDir, namespace, key) {
  const actions = [];
  for (let n = 1; ; n += 1) {
    const action = await readIfExists(projectDir, sequencedRequestId(namespace, key, n));
    if (!action) return actions;
    actions.push(action);
  }
}

const FIRST_CONNECTION_NS = 'shopify-first-connection';
const FIRST_CONNECTION_QUESTION = 'Was the Shopify connection approved from a staff account the store owner created for this migration (Administrator role, or a custom role with app and channel management)?';
const FIRST_CONNECTION_RETRY = `Ask the store owner to create a dedicated migration staff account (Administrator role, or a custom role with app and channel management), run ${CONNECT_HINT} while signed in to the store as that account in the browser, then answer again.`;
const FIRST_CONNECTION_CHOICES = Object.freeze([
  { id: 'dedicated-account', label: 'Yes — a dedicated migration staff account' },
  { id: 'other-account', label: 'No — another account (for example the owner\'s own)' },
]);

async function firstConnectionState(projectDir, domain) {
  const actions = await sequence(projectDir, FIRST_CONNECTION_NS, domain);
  const latest = actions.length ? actions[actions.length - 1] : null;
  const answer = latest && latest.status === 'answered' && latest.answer ? latest.answer.choice || null : null;
  return { count: actions.length, latest, answer, answeredAny: actions.some((action) => action.status === 'answered') };
}

// Creates the question when none exists, and a replacement after an `other-account` answer.
async function ensureFirstConnectionAction(projectDir, domain) {
  const state = await firstConnectionState(projectDir, domain);
  if (state.count > 0 && state.answer !== 'other-account') return state;
  await createUserAction(projectDir, {
    requestId: sequencedRequestId(FIRST_CONNECTION_NS, domain, state.count + 1),
    kind: 'question',
    stage: 'discovery',
    title: `Shopify connection account for ${domain}`,
    prompt: state.count === 0 ? FIRST_CONNECTION_QUESTION : `${FIRST_CONNECTION_RETRY} ${FIRST_CONNECTION_QUESTION}`,
    response: { mode: 'choice' },
    choices: FIRST_CONNECTION_CHOICES,
  });
  return firstConnectionState(projectDir, domain);
}

const AUTH_EXPIRED_NS = 'shopify-auth-expired';
const AUTH_EXPIRED_PROMPT = `The Shopify connection for this migration expired. Run the Shopify session check; if asked, run ${CONNECT_HINT} and approve in the browser; then answer this request to resume. Finished datasets are not read again.`;

// source_auth_expired: the stopping script records a manual action with the step's own stage;
// while it is pending the run holds at awaiting_user_action. A still-pending request is reused.
async function recordAuthExpired(projectDir, { stage, store }) {
  if (stage !== 'discovery' && stage !== 'execution') throw new Error('recordAuthExpired: stage must be discovery or execution');
  const key = `${stage}\0${store}`;
  const actions = await sequence(projectDir, AUTH_EXPIRED_NS, key);
  const latest = actions.length ? actions[actions.length - 1] : null;
  if (latest && latest.status === 'pending') return latest;
  return createUserAction(projectDir, {
    requestId: sequencedRequestId(AUTH_EXPIRED_NS, key, actions.length + 1),
    kind: 'manual_action',
    stage,
    title: `Re-approve the Shopify connection for ${store}`,
    prompt: AUTH_EXPIRED_PROMPT,
    response: { mode: 'none' },
    choices: [],
  });
}

// ---------------------------------------------------------------------------------------------
// The staff-account record
// ---------------------------------------------------------------------------------------------

// Creates a pending entry for the domain unless one exists; never rewrites an existing entry and
// never touches an unreadable file (the repair command handles that).
function ensureStaffEntry(projectDir, domain, createdAt, { io = fs } = {}) {
  const record = readStaffAccess(projectDir);
  if (record.state === 'unreadable') return { changed: false, state: 'unreadable' };
  if (record.accounts.some((entry) => entry.shopDomain === domain)) return { changed: false, state: 'ok' };
  writeStaffAccess(projectDir, [...record.accounts, { shopDomain: domain, state: 'pending', createdAt }], { io });
  return { changed: true, state: 'ok' };
}

function repairHint() {
  return `run \`node scripts/${SESSION_CHECK} --project <project> --repair-staff-access\` first`;
}

function confirmStaffRemoval(projectDir, domain, value, { now = () => new Date().toISOString(), io = fs } = {}) {
  if (value !== STAFF_REMOVAL_CONFIRMATION) {
    throw new ShopifySessionStop('shopify_staff_confirmation_invalid', `the only accepted confirmation is ${STAFF_REMOVAL_CONFIRMATION}: the store owner confirmed the migration staff account was removed. Nothing was changed.`);
  }
  const record = readStaffAccess(projectDir);
  if (record.state !== 'ok') {
    throw new ShopifySessionStop(`shopify_staff_record_${record.state}`, `${STAFF_ACCESS_FILE} is ${record.state}; ${repairHint()}, then confirm again. Nothing was changed.`);
  }
  const index = record.accounts.findIndex((entry) => entry.shopDomain === domain && entry.state === 'pending');
  if (index === -1) {
    throw new ShopifySessionStop('shopify_staff_entry_not_pending', `${STAFF_ACCESS_FILE} has no pending staff-account entry for ${domain}. Nothing was changed.`);
  }
  const accounts = record.accounts.map((entry, i) => (i === index ? { ...entry, state: 'confirmed', confirmedAt: now(), confirmation: STAFF_REMOVAL_CONFIRMATION } : entry));
  writeStaffAccess(projectDir, accounts, { io });
  return accounts[index];
}

// Deterministic, no Shopify call. Never writes `confirmed`.
async function repairStaffAccess(projectDir, domain, { now = () => new Date().toISOString(), io = fs } = {}) {
  const receipt = readSessionReceipt(projectDir);
  const connected = passingReceipt(receipt) && receipt.shopDomain === domain;
  const confirmedAccount = (await firstConnectionState(projectDir, domain)).answeredAny;
  if (!connected && !confirmedAccount) {
    throw new ShopifySessionStop('shopify_staff_repair_no_evidence', `nothing in this project shows a Shopify connection for ${domain} (no passing session receipt and no answered first-connection question). Nothing was changed.`);
  }
  const record = readStaffAccess(projectDir);
  if (record.state === 'ok' && record.accounts.some((entry) => entry.shopDomain === domain)) return { changed: false };
  const at = now();
  let setAside = null;
  let accounts = record.state === 'ok' ? record.accounts : [];
  if (record.state === 'unreadable') {
    const file = path.join(projectDir, STAFF_ACCESS_FILE);
    setAside = `${file}.unreadable-${at.replace(/:/g, '-')}`;
    io.renameSync(file, setAside);
    accounts = [];
  }
  writeStaffAccess(projectDir, [...accounts, { shopDomain: domain, state: 'pending', createdAt: at, reconstructed: true }], { io });
  return { changed: true, setAside };
}

// ---------------------------------------------------------------------------------------------
// The CLI install
// ---------------------------------------------------------------------------------------------

// The npm beside the running Node.js when present, otherwise npm on PATH. Never given -g.
function resolveNpm(execPath = process.execPath, exists = fs.existsSync) {
  const beside = path.join(path.dirname(execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return exists(beside) ? beside : 'npm';
}

function installArgs(toolsDir) {
  return ['install', '--prefix', cli.cliInstallDir(toolsDir), '--save-exact', `@shopify/cli@${cli.SHOPIFY_CLI_VERSION}`];
}

function runNpm(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function installCli({ toolsDir, npmCommand = resolveNpm(), runInstall = runNpm, env = process.env }) {
  const result = await runInstall(npmCommand, installArgs(toolsDir), { env, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error) {
    throw new ShopifySessionStop('shopify_cli_install_failed', `installing Shopify CLI ${cli.SHOPIFY_CLI_VERSION} into ${cli.cliInstallDir(toolsDir)} failed: ${String(result.stderr || result.error.message).slice(-500)}`);
  }
}

function incompatible(message) {
  return new ShopifySessionStop('shopify_cli_incompatible', `${message} Nothing was read.`);
}

// Step 2: install and version checks. Returns the installed package.
async function checkInstall({ toolsDir, install, npmCommand, runInstall, env, run }) {
  let installed = cli.readInstalledPackage(toolsDir);
  const needsInstall = !installed.present || installed.version !== cli.SHOPIFY_CLI_VERSION;
  if (needsInstall && !install) {
    if (!installed.present) {
      throw new ShopifySessionStop('shopify_cli_not_installed', `the adapter installs its own Shopify CLI ${cli.SHOPIFY_CLI_VERSION} into ${cli.cliInstallDir(toolsDir)} (about 52 MB, no global change). Ask the operator; with their consent run the session check again with --install. Nothing was installed or read.`);
    }
    throw new ShopifySessionStop('shopify_cli_version_changed', `the adapter's Shopify CLI is ${installed.version || 'unreadable'}, not the tested ${cli.SHOPIFY_CLI_VERSION}. With the operator's consent run the session check again with --install to reinstall ${cli.SHOPIFY_CLI_VERSION}. Nothing was read.`);
  }
  if (needsInstall) {
    await installCli({ toolsDir, npmCommand, runInstall, env });
    installed = cli.readInstalledPackage(toolsDir);
    if (!installed.present) throw new ShopifySessionStop('shopify_cli_install_failed', `the install finished but ${cli.cliPackageDir(toolsDir)} holds no package.`);
    if (installed.version !== cli.SHOPIFY_CLI_VERSION) throw new ShopifySessionStop('shopify_cli_version_changed', `the install produced Shopify CLI ${installed.version}, not ${cli.SHOPIFY_CLI_VERSION}. Nothing was read.`);
  }
  if (installed.enginesNode !== cli.SHOPIFY_CLI_ENGINES_NODE) {
    throw incompatible(`the installed Shopify CLI declares engines.node ${installed.enginesNode || '(none)'}, not ${cli.SHOPIFY_CLI_ENGINES_NODE}; the pin and SHOPIFY_CLI_NODE_MIN moved apart.`);
  }
  const version = await cli.startCliProcess(['version'], { toolsDir, env, run });
  if (version.error) throw incompatible('the Shopify CLI refused `version`.');
  const printed = String(version.stdout || '').trim();
  if (!printed.split(/\s+/).includes(cli.SHOPIFY_CLI_VERSION)) {
    throw new ShopifySessionStop('shopify_cli_version_changed', `the Shopify CLI reports version ${printed || '(nothing)'}, not ${cli.SHOPIFY_CLI_VERSION}. Nothing was read.`);
  }
  const help = await cli.startCliProcess(['store', 'execute', '--help'], { toolsDir, env, run });
  if (help.error || !/--store\b/.test(`${help.stdout}\n${help.stderr}`)) throw incompatible('the Shopify CLI has no `store` commands.');
  return installed;
}

// ---------------------------------------------------------------------------------------------
// The session check
// ---------------------------------------------------------------------------------------------

const SCOPES_QUERY = 'query RpShopifySessionScopes { currentAppInstallation { accessScopes { handle } } }';
const CANARY_QUERY = 'query RpShopifySessionCanary { shop { id createdAt } publicApiVersions { handle supported } }';

function sessionMissing(domain, detail) {
  return new ShopifySessionStop('shopify_session_missing', `there is no valid Shopify connection for ${domain} (${detail}). Run ${CONNECT_HINT} and approve in the browser while signed in as the dedicated migration staff account, then run the check again. Nothing was read.`);
}

function receiptPath(projectDir) {
  return path.join(projectDir, SESSION_RECEIPT_FILE);
}

async function runSessionCheck({
  projectDir,
  store,
  nodeVersion = process.versions.node,
  toolsDir = cli.defaultToolsDir(),
  env = process.env,
  run,
  install = false,
  npmCommand,
  runInstall,
  connect = false,
  askFirstConnection = true,
  requiredScopes = SHOPIFY_REQUIRED_SCOPES,
  now = () => new Date().toISOString(),
  sleep,
  io = fs,
} = {}) {
  if (!projectDir) throw new Error('projectDir is required');
  const domain = normalizeDomain(store);
  const runOption = run ? { run } : {};

  // Keep the staff-account record from a previous passing receipt before that receipt goes, so a
  // failed check never erases the only evidence of a connection.
  const prior = readSessionReceipt(projectDir);
  const before = await firstConnectionState(projectDir, domain);
  if (passingReceipt(prior) && prior.shopDomain === domain && before.answer === 'dedicated-account') ensureStaffEntry(projectDir, domain, prior.checkedAt || now(), { io });
  fs.rmSync(receiptPath(projectDir), { force: true });
  const firstConnection = askFirstConnection ? await ensureFirstConnectionAction(projectDir, domain) : before;

  // 1. Runtime, before any install prompt or CLI process.
  const runtime = cli.checkNodeRuntime(nodeVersion);
  // 2. Install and version.
  await checkInstall({ toolsDir, install, npmCommand, runInstall, env, ...runOption });
  if (connect) {
    const auth = await cli.startCliProcess(['store', 'auth', '--store', domain, '--scopes', requiredScopes.join(',')], { toolsDir, env, inherit: true, ...runOption });
    if (auth.error) {
      throw new ShopifySessionStop('shopify_connect_failed', `the browser approval did not complete (the Shopify CLI exited ${auth.exitCode === null ? 'abnormally' : `with ${auth.exitCode}`}). Run ${CONNECT_HINT} again and approve in the browser. Nothing was read.`);
    }
  }
  const execute = cli.createStoreExecutor({ store: domain, toolsDir, env, ...runOption, ...(sleep ? { sleep } : {}) });
  // 3. Connection and scope readback.
  let scopes;
  try {
    scopes = await execute(SCOPES_QUERY);
  } catch (error) {
    if (error.code === 'source_auth_expired') throw sessionMissing(domain, 'the Shopify CLI has no stored session for it');
    throw error;
  }
  if (scopes.errors && scopes.errors.length) throw sessionMissing(domain, `the scope readback failed: ${cli.errorCodes(scopes.errors).join(', ')}`);
  const installation = scopes.data && scopes.data.currentAppInstallation;
  const granted = installation && Array.isArray(installation.accessScopes)
    ? [...new Set(installation.accessScopes.map((scope) => scope && scope.handle).filter((handle) => typeof handle === 'string'))].sort()
    : [];
  const missing = requiredScopes.filter((scope) => !granted.includes(scope));
  if (missing.length) {
    throw new ShopifySessionStop('shopify_scopes_missing', `Shopify did not grant ${missing.join(', ')}. Run ${CONNECT_HINT} (it requests the full list) and approve in the browser, then run the check again. Nothing was read.`, { missingScopes: missing, grantedScopes: granted });
  }
  // 4. The API-version canary.
  const canary = await execute(CANARY_QUERY);
  if (canary.errors && canary.errors.length) {
    throw new ShopifySessionStop('shopify_canary_failed', `the API-version canary read failed: ${cli.errorCodes(canary.errors).join(', ')}. Nothing was read.`);
  }
  const versions = canary.data && Array.isArray(canary.data.publicApiVersions) ? canary.data.publicApiVersions : [];
  const pinned = versions.find((entry) => entry && entry.handle === cli.SHOPIFY_ADMIN_API_VERSION);
  if (!pinned || pinned.supported !== true) {
    throw new ShopifySessionStop('shopify_api_version_unsupported', `Shopify ${pinned ? 'lists' : 'does not list'} the pinned Admin API version ${cli.SHOPIFY_ADMIN_API_VERSION}${pinned ? ' as unsupported' : ''}. Moving the pin is its own tested change. Nothing was read.`);
  }
  // 5. The receipt.
  const receipt = {
    shopDomain: domain,
    cliVersion: cli.SHOPIFY_CLI_VERSION,
    cliPath: cli.cliEntryPath(toolsDir),
    nodePath: runtime.nodePath,
    nodeVersion: runtime.nodeVersion,
    apiVersion: cli.SHOPIFY_ADMIN_API_VERSION,
    grantedScopes: granted,
    missingScopes: [],
    checkedAt: now(),
  };
  writeJsonAtomicSync(receiptPath(projectDir), receipt, io);
  let staffAccess = null;
  if (firstConnection.answer === 'dedicated-account') staffAccess = ensureStaffEntry(projectDir, domain, receipt.checkedAt, { io });
  return { receipt, firstConnection: { answer: firstConnection.answer, requestId: firstConnection.latest ? firstConnection.latest.requestId : null }, staffAccess };
}

// Discovery and the extract start only when the latest first-connection answer is
// `dedicated-account` and the receipt passes for this domain.
async function assertConnectionReady(projectDir, store) {
  const domain = normalizeDomain(store);
  const state = await firstConnectionState(projectDir, domain);
  if (state.answer !== 'dedicated-account') {
    throw new ShopifySessionStop('shopify_first_connection_unconfirmed', `the Shopify connection for ${domain} is not confirmed as approved from a dedicated migration staff account${state.latest ? ` (request ${state.latest.requestId} is ${state.latest.status === 'pending' ? 'pending' : `answered ${state.answer}`})` : ''}. Run the Shopify session check and answer its first-connection question. Nothing was read.`);
  }
  const receipt = readSessionReceipt(projectDir);
  if (!passingReceipt(receipt) || receipt.shopDomain !== domain) {
    throw new ShopifySessionStop('shopify_session_not_checked', `no passing Shopify session check for ${domain} is recorded. Run \`node scripts/${SESSION_CHECK} --project <project>\` first. Nothing was read.`);
  }
  return receipt;
}

module.exports = {
  QUERIES_DIR,
  SHOPIFY_REQUIRED_SCOPES,
  SCOPES_QUERY,
  CANARY_QUERY,
  FIRST_CONNECTION_CHOICES,
  ShopifySessionStop,
  normalizeDomain,
  parseScopesHeader,
  queryFileScopes,
  deriveRequiredScopes,
  sequencedRequestId,
  firstConnectionState,
  ensureFirstConnectionAction,
  recordAuthExpired,
  ensureStaffEntry,
  confirmStaffRemoval,
  repairStaffAccess,
  resolveNpm,
  installArgs,
  installCli,
  runSessionCheck,
  assertConnectionReady,
};
