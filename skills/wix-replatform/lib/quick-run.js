'use strict';

// One command for a quick import (Shopify or WooCommerce, new Wix site). It runs the scripts the
// skill already has, in the order the skill documents, each as a child process, and ends with a
// short review. It adds no import logic: nothing an adapter reads, maps, writes or verifies runs
// here. The router is only read (never written) to learn where the project is.
//
// The only input it needs from a person is the site type. No approval, no account confirmation,
// no questions: a missing site type stops the command before anything is created.

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { getDecisionValue } = require('./orchestration-decisions.js');
const { readEnvFile, upsertEnvFile } = require('./config-env.js');
const sourceRegional = require('./source-regional.js');
const { resolveSiteTypePair } = require('./destination-choice.js');

const SKILL_DIR = path.resolve(__dirname, '..');
const PLATFORMS = Object.freeze({
  shopify: { sourceKey: 'SHOPIFY_STORE_URL', crosswalk: 'state/crosswalk/quick-shopify.json' },
  woocommerce: { sourceKey: 'WP_BASE_URL', crosswalk: 'state/crosswalk/quick-mode.json' },
});

const EXIT = Object.freeze({
  completed: 0, completed_with_issues: 16, needs_input: 11, blocked: 12, failed: 13, needs_agent: 14, in_progress: 15, auth_expired: 75,
});
const WIX_AUTH_EXIT_CODE = 75;

// No time limit unless one is asked for (`--budget-seconds`): a command run from a shell has no tool ceiling to stay under.
const MAX_STEP_MS = 12 * 3600_000;
const FLUSH_MS = 10_000; // always left to print the answer
const SHORT_STEP_MS = 60_000;
const SETUP_MS = 180_000;
const SETUP_MIN_MS = 60_000;
const IMPORT_MIN_MS = 90_000;

// The router reasons a quick project can be at, each with the step that clears it. A guard before a
// step accepts a reason at or after that step; anything else is not the command's to drive.
const ROUTE_STEP = Object.freeze({
  preflight_missing: 4, preflight_source_env_changed: 4, preflight_inputs_changed: 4, preflight_blocked: 4,
  quick_mode_preflight_missing: 5, quick_mode_plan_missing: 5, quick_mode_execution_manifest_missing: 5,
  quick_mode_setup_plan_missing: 6,
  missing_setup_verification: 9,
  quick_mode_import_required: 10,
});

class Stop extends Error {
  constructor(status, fields = {}) {
    super(fields.message || status);
    this.status = status;
    this.fields = fields;
  }
}

// ---- small helpers ---------------------------------------------------------------------------

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
const last = (text, n = 3) => String(text || '').trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' | ').slice(0, 600);

// Parse a script's stdout: the whole text is JSON, or its last line is.
function parseOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const line = text.split(/\r?\n/).filter(Boolean).pop();
  try { return JSON.parse(line); } catch { return null; }
}

// Every running step, so none outlives the command: a step is in its own process group (so a hung step
// dies with everything it started) and is killed here when the command is stopped or exits.
const ACTIVE = new Set();
function killActive() {
  for (const pid of ACTIVE) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
  ACTIVE.clear();
}
function installStopHandlers() {
  process.on('exit', killActive);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { killActive(); process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[signal]); });
}

// Runs a command in its own process group so a hung step is killed with everything it started.
function runChild(command, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    ACTIVE.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const keep = (current, chunk) => `${current}${chunk}`.slice(-1_000_000);
    child.stdout.on('data', (chunk) => { stdout = keep(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = keep(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    }, Math.max(1_000, timeoutMs || SHORT_STEP_MS));
    const finish = (code) => { clearTimeout(timer); ACTIVE.delete(child.pid); resolve({ code, stdout, stderr, timedOut, ms: Date.now() - startedAt }); };
    child.on('error', (error) => { stderr = keep(stderr, error.message); finish(127); });
    child.on('close', (code) => finish(code === null ? 137 : code));
  });
}

// ---- the run ----------------------------------------------------------------------------------

function usage() {
  return [
    'Usage: node scripts/quick-run.js <projectDir> --source-url <url> --platform shopify|woocommerce --site-type <type>',
    '                                 [--business-type <store|bookings|other|unknown> --business-type-source <user|context|not_asked>]',
    '                                 [--budget-seconds <n>]',
    '',
    'Runs a quick import (new Wix site) from the source address to a short review, with no questions.',
    'It runs to the end. Pass --budget-seconds (at least 60) from a tool that has its own time ceiling: the command then',
    'stops cleanly between steps (or stops the import) before it, with status in_progress, and running it again continues.',
    'The site type is the only input it needs. Prints one JSON line; the exit code is the status:',
    '  0 completed, 16 completed_with_issues, 11 needs_input, 12 blocked, 13 failed, 14 needs_agent,',
    '  15 in_progress (only with --budget-seconds; run it again), 75 auth_expired.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { _: [] };
  const flags = new Set(['--source-url', '--platform', '--site-type', '--business-type', '--business-type-source', '--budget-seconds']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (flags.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Stop('needs_input', { message: `${arg} needs a value`, field: arg });
      out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Stop('needs_input', { message: `unknown option ${arg}`, field: arg });
    out._.push(arg);
  }
  return out;
}

async function run(argv, deps = {}) {
  const env = {
    runChild: deps.runChild || runChild,
    now: deps.now || (() => Date.now()),
    budgetMs: deps.budgetMs || Infinity,
    skillDir: deps.skillDir || SKILL_DIR,
    node: deps.node || process.execPath,
  };
  const startedAt = env.now();
  const ctx = { env, startedAt, steps: [], warnings: [], projectDir: null, platform: null };
  try {
    const args = parseArgs(argv);
    if (args.help) return { status: 'help', exitCode: 0, text: usage() };
    if (args.budgetSeconds !== undefined) {
      const seconds = Number(args.budgetSeconds);
      if (!Number.isFinite(seconds) || seconds < 60) throw new Stop('needs_input', { message: '--budget-seconds must be a number of at least 60', field: '--budget-seconds' });
      if (!deps.budgetMs) env.budgetMs = seconds * 1000;
    }
    return await drive(ctx, args);
  } catch (error) {
    if (!(error instanceof Stop)) {
      return result(ctx, 'failed', { step: ctx.currentStep || null, message: `the command failed unexpectedly: ${String(error && error.message || error).slice(0, 400)}` });
    }
    return result(ctx, error.status, error.fields);
  }
}

function result(ctx, status, fields = {}) {
  const out = { status, ...(ctx.review || {}), ...fields, elapsedMs: ctx.env.now() - ctx.startedAt, steps: ctx.steps.map(({ name, ms }) => ({ name, ms })) };
  if (ctx.warnings.length) out.warnings = ctx.warnings;
  if (ctx.route) out.route = ctx.route;
  return { ...out, exitCode: EXIT[status] };
}

function timeLeft(ctx) { return ctx.env.budgetMs - (ctx.env.now() - ctx.startedAt); }

// The step record covers every invocation on the project: a resume adds its steps after the earlier ones.
async function recordSteps(ctx) {
  if (!ctx.projectDir) return;
  try {
    const file = path.join(ctx.projectDir, 'execution', 'quick-run-steps.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (!ctx.priorSteps) {
      const earlier = await readJson(file);
      ctx.priorSteps = earlier && Array.isArray(earlier.steps) ? earlier.steps : [];
      ctx.runNumber = ctx.priorSteps.reduce((max, step) => Math.max(max, step.run || 1), 0) + 1;
    }
    const steps = [...ctx.priorSteps, ...ctx.steps.map((step) => ({ ...step, run: ctx.runNumber }))];
    await fs.writeFile(file, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date(ctx.env.now()).toISOString(), steps }, null, 2)}\n`);
  } catch { /* the record is best effort */ }
}

// Runs one child script. `minMs` refuses to start a step that cannot finish; the kill timeout never
// takes the time the command needs to print its answer.
async function exec(ctx, name, scriptRel, args, { timeoutMs = SHORT_STEP_MS, minMs = 0, bash = false } = {}) {
  const left = timeLeft(ctx);
  if (left - FLUSH_MS < Math.max(minMs, 1_000)) throw new Stop('in_progress', { step: name, message: `the time budget ran out before ${name}; run the same command again to continue` });
  ctx.currentStep = name;
  const script = path.isAbsolute(scriptRel) ? scriptRel : path.join(ctx.env.skillDir, scriptRel);
  const cmd = bash ? 'bash' : ctx.env.node;
  const out = await ctx.env.runChild(cmd, [script, ...args], { cwd: ctx.projectDir || process.cwd(), timeoutMs: Math.min(timeoutMs, left - FLUSH_MS, MAX_STEP_MS) });
  ctx.steps.push({ name, ms: out.ms, code: out.code, ...(out.timedOut ? { timedOut: true } : {}) });
  await recordSteps(ctx);
  return { ...out, json: parseOutput(out.stdout) };
}

function fail(step, out, extra = {}) {
  return new Stop('failed', { step, message: `${step} failed (exit ${out.code}${out.timedOut ? ', timed out' : ''}): ${last(out.stderr || out.stdout)}`, ...extra });
}

// ---- decisions ----------------------------------------------------------------------------------

async function readDecisions(projectDir) {
  return (await readJson(path.join(projectDir, 'orchestration', 'decisions.json'))) || {};
}

function wanted(args, platform) {
  const list = [
    ['automationMode', 'one_click', 'user'],
    ['managementImportMode', 'quick', 'user'],
    ['sourceMode', 'public_content', 'deterministic_inference'],
    ['sourcePlatform', platform, 'user'],
    ['deliveryMode', 'management', 'deterministic_inference'],
    ['targetSiteStrategy', 'new_site', 'deterministic_inference'],
    ['sourceUrl', args.sourceUrl, 'user'],
  ];
  return list;
}

// A recorded decision equals the wanted one when they name the same thing: a source address by its origin
// (a trailing slash is the same store); everything else by value (aliases are already normalised by the reader).
function sameDecision(key, current, value) {
  if (key === 'sourceUrl') {
    try { return new URL(String(current)).origin === new URL(String(value)).origin; } catch { return String(current) === String(value); }
  }
  return String(current) === String(value);
}

async function recordDecisions(ctx, args) {
  const projectDir = ctx.projectDir;
  const decisions = await readDecisions(projectDir);
  const check = (key, value) => {
    const current = getDecisionValue(decisions, key);
    if (current === undefined || current === null || current === '') return 'missing';
    if (!sameDecision(key, current, value)) throw new Stop('blocked', { step: 'decide', message: `decision ${key} is already recorded as "${current}", not "${value}"; nothing was changed`, field: key });
    return 'same';
  };
  for (const [key, value, source] of wanted(args, ctx.platform)) {
    if (check(key, value) === 'same') continue;
    const out = await exec(ctx, `decide:${key}`, 'scripts/orchestration-state.js', ['decide', '--project-dir', projectDir, '--key', key, '--value', value, '--source', source]);
    if (out.code !== 0) throw fail(`decide ${key}`, out);
  }
  // No flag and a recorded type: the recorded one is used. A flag must equal what is recorded.
  const typeState = args.siteType ? check('targetSiteType', args.siteType) : 'same';
  if (typeState === 'missing') {
    const flags = ['decide', '--project-dir', projectDir, '--key', 'targetSiteType', '--value', args.siteType, '--source', 'user'];
    if (args.businessType) flags.push('--business-type', args.businessType);
    if (args.businessTypeSource) flags.push('--business-type-source', args.businessTypeSource);
    const out = await exec(ctx, 'decide:targetSiteType', 'scripts/orchestration-state.js', flags);
    if (out.code !== 0) throw new Stop('needs_input', { step: 'decide', message: `the site type was not accepted: ${last(out.stderr || out.stdout)}`, field: '--site-type' });
  }
}

// ---- the router guard (read only) --------------------------------------------------------------

async function route(ctx, step) {
  const out = await ctx.env.runChild(ctx.env.node, [path.join(ctx.env.skillDir, 'scripts', 'orchestration-route.js'), ctx.projectDir], { cwd: ctx.projectDir, timeoutMs: Math.min(SHORT_STEP_MS, Math.max(1_000, timeLeft(ctx) - FLUSH_MS)) });
  const json = parseOutput(out.stdout);
  if (!json) throw new Stop('failed', { step: `route before ${step}`, message: `the router gave no answer: ${last(out.stderr)}` });
  ctx.route = { reason: json.reason, nextState: json.nextState, nextResource: json.nextResource };
  return json;
}

// Accepts a route reason only when it is one this command drives, at or after the step about to run.
async function guard(ctx, stepNumber, name) {
  let answer = await route(ctx, name);
  // The router wants the destination's "still unpublished" read-back to be recent before it lets setup or
  // import write to the site. A resume after a while gets one fresh read (never a create), then asks again.
  if (answer.reason === 'destination_publication_recheck' && !ctx.rechecked) {
    ctx.rechecked = true;
    await destination(ctx);
    answer = await route(ctx, name);
  }
  const reason = answer.reason;
  const index = Object.hasOwn(ROUTE_STEP, reason) ? ROUTE_STEP[reason] : null;
  if (index === null || index < stepNumber || (answer.ok === false)) {
    const blocking = answer.blocking || answer.nextState === 'blocked';
    throw new Stop(blocking ? 'blocked' : 'needs_agent', { step: name, message: `the project is at a state this command does not drive (${reason || 'unknown'}); continue by hand from the route`, ...(answer.errors ? { detail: answer.errors } : {}) });
  }
  return answer;
}

// ---- steps -------------------------------------------------------------------------------------

async function startProject(ctx, args) {
  const dir = ctx.projectDir;
  await fs.mkdir(dir, { recursive: true });
  if (!(await exists(path.join(dir, 'orchestration', 'run.json')))) {
    const out = await exec(ctx, 'init', 'scripts/orchestration-state.js', ['init', '--project-dir', dir]);
    if (out.code !== 0) throw fail('init', out);
  }
  if (!(await exists(path.join(dir, 'run-telemetry.json')))) {
    const dims = JSON.stringify({ source_platform: ctx.platform, delivery_mode: 'management', destination_strategy: 'new_site' });
    const out = await exec(ctx, 'telemetry-start', 'resources/rp-telemetry/scripts/rp-telemetry.js', ['start', dims, '--project', dir]);
    if (out.code !== 0) ctx.warnings.push(`telemetry did not start: ${last(out.stderr || out.stdout, 1)}`);
  }
}

async function destination(ctx) {
  const dir = ctx.projectDir;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const out = await exec(ctx, attempt ? 'destination:after-account' : 'destination', 'scripts/wix-destination.js', ['ensure', '--project-dir', dir], { timeoutMs: 120_000 });
    const outcome = out.json && out.json.outcome;
    if (['verified', 'created', 'existing_destination'].includes(outcome)) return out.json;
    if (outcome === 'awaiting_account_confirmation' && attempt === 0 && out.json.requestId) {
      // The operator chose this run, so the account the Wix CLI is logged in with is the account.
      const answer = await exec(ctx, 'confirm-account', 'scripts/user-action.js', ['answer', '--project', dir, '--request', out.json.requestId, '--choice', 'confirm_account']);
      if (answer.code !== 0) throw fail('confirm account', answer);
      continue;
    }
    const status = ['blocked', 'locked', 'awaiting_recovery', 'ambiguous', 'failed_before_create'].includes(outcome) || (out.code === 3 || out.code === 4) ? 'blocked' : 'failed';
    throw new Stop(status, { step: 'destination', message: `the destination step ended as "${outcome || `exit ${out.code}`}"${out.json && out.json.reason ? `: ${out.json.reason}` : ''}${out.json && out.json.error ? `: ${JSON.stringify(out.json.error).slice(0, 300)}` : ''}`, outcome });
  }
  throw new Stop('blocked', { step: 'destination', message: 'the account confirmation was answered but the destination is still waiting' });
}

async function sourceConfig(ctx, args) {
  const key = PLATFORMS[ctx.platform].sourceKey;
  const file = path.join(ctx.projectDir, 'config', `source.${ctx.platform}.env`);
  let values = {};
  try { values = await readEnvFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!values[key]) await upsertEnvFile(file, { [key]: new URL(args.sourceUrl).origin });
}

async function stepPreflight(ctx) {
  const dir = ctx.projectDir;
  const preflight = await readJson(path.join(dir, 'orchestration', 'preflight.json'));
  if (preflight && preflight.status === 'pass') return;
  await guard(ctx, 4, 'preflight');
  const out = await exec(ctx, 'preflight', 'scripts/orchestration-preflight.js', [dir], { timeoutMs: 90_000 });
  const result = out.json;
  if (out.code !== 0 || !result || result.status !== 'pass') {
    const blocked = result && Array.isArray(result.checks) ? result.checks.filter((c) => c && c.status === 'blocked').map((c) => `${c.id}${c.message ? `: ${c.message}` : ''}`).slice(0, 4) : [];
    throw new Stop(out.code === 1 && result ? 'blocked' : 'failed', { step: 'preflight', message: `preflight did not pass${blocked.length ? ` (${blocked.join('; ')})` : `: ${last(out.stderr)}`}` });
  }
}

const quickMode = (platform) => `resources/rp-quick-${platform}/scripts/quick-mode.js`;

async function stepQuickPlan(ctx) {
  const dir = ctx.projectDir;
  const quickPreflight = await readJson(path.join(dir, 'quick-mode', 'preflight.json'));
  if (!quickPreflight || quickPreflight.status !== 'passed') {
    await guard(ctx, 5, 'quick-preflight');
    const out = await exec(ctx, 'quick-preflight', quickMode(ctx.platform), ['preflight', dir], { timeoutMs: 120_000 });
    if (out.code !== 0) throw fail('quick preflight', out);
    const written = await readJson(path.join(dir, 'quick-mode', 'preflight.json'));
    if (!written || written.status !== 'passed') {
      const bad = ((written && written.checks) || []).filter((c) => !c.ok).map((c) => `${c.entity || c.id} (${c.status || 'failed'})`).slice(0, 4);
      throw new Stop('blocked', { step: 'quick-preflight', message: `the source is not reachable for a quick import${bad.length ? `: ${bad.join(', ')}` : ''}; it stays on the standard path` });
    }
  }
  if (!(await exists(path.join(dir, 'quick-mode', 'plan.json'))) || !(await exists(path.join(dir, 'execution', 'execution-manifest.json')))) {
    await guard(ctx, 5, 'quick-plan');
    const out = await exec(ctx, 'quick-plan', quickMode(ctx.platform), ['plan', dir]);
    if (out.code !== 0) throw fail('quick plan', out);
  }
}

// Currency, language and locale must be known (a currency is never guessed). The time zone may stay
// the site's own: that is recorded in the file and the review lists it for cutover.
async function stepLocale(ctx) {
  const dir = ctx.projectDir;
  let file;
  try { file = await sourceRegional.readSourceRegional(dir); } catch (error) {
    throw new Stop('failed', { step: 'locale', message: `discovery/source-locale.json is not usable: ${error.message}` });
  }
  if (!file) throw new Stop('failed', { step: 'locale', message: 'the plan wrote no discovery/source-locale.json' });
  const missing = ['currency', 'language', 'locale'].filter((field) => sourceRegional.settingValue(file, field) === null);
  if (missing.length) throw new Stop('failed', { step: 'locale', message: `the store does not state its ${missing.join(', ')}; the command never guesses these. Nothing was imported. To continue, set each in discovery/source-locale.json as {"state":"supplied","value":...,"evidence":"merchant input","suppliedBy":"operator"} and run this command again.`, field: missing.join(',') });
  if (!(await exists(path.join(dir, 'setup', 'setup-plan.json'))) || !(await exists(path.join(dir, 'setup', 'setup-requirements.json')))) {
    await guard(ctx, 6, 'setup-plan');
    const out = await exec(ctx, 'setup-plan', 'resources/rp-setup-discovery/scripts/quick-setup-plan.js', [dir]);
    if (out.code !== 0) throw fail('setup plan', out);
  }
}

async function stepExtract(ctx) {
  const dir = ctx.projectDir;
  if (!(await exists(path.join(dir, 'data', 'source-extract', 'manifest.json')))) {
    await guard(ctx, 7, 'extract');
    const out = await exec(ctx, 'extract', quickMode(ctx.platform), ['extract', dir], { timeoutMs: 120_000 });
    if (out.code !== 0) throw fail('extract', out);
  }
  for (const type of ['mapping', 'execution']) {
    const out = await exec(ctx, `approve:${type}`, 'scripts/orchestration-state.js', ['auto-approve', '--project-dir', dir, '--type', type]);
    if (out.code !== 0) throw fail(`auto-approve ${type}`, out);
  }
}

// The token helper reads config/wix.env relative to its own folder, which a quick project does not
// have until it is copied in. It always mints: a present token proves nothing (it may be expired).
async function stepToken(ctx) {
  const dir = ctx.projectDir;
  const target = path.join(dir, 'scripts', 'mint-token.sh');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(ctx.env.skillDir, 'resources', 'rp-execute-setup', 'scripts', 'mint-token.sh'), target);
  const out = await exec(ctx, 'token', target, [], { bash: true, timeoutMs: 90_000 });
  if (out.code !== 0) {
    // Only an empty answer from `wix token` means the login is the problem; any other failure keeps its own words.
    if (/token command returned empty output/.test(out.stderr)) {
      throw new Stop('auth_expired', { step: 'token', message: 'the Wix site token could not be minted: run `npx --no-install wix whoami` (log in if asked), then run this command again' });
    }
    throw fail('token', out);
  }
}

async function stepSetup(ctx) {
  const answer = await guard(ctx, 9, 'setup');
  if (answer.reason !== 'missing_setup_verification') return;
  await stepToken(ctx);
  const out = await exec(ctx, 'setup', 'resources/rp-execute-setup/scripts/execute-setup.js', [ctx.projectDir], { timeoutMs: SETUP_MS, minMs: SETUP_MIN_MS });
  if (out.code === WIX_AUTH_EXIT_CODE) throw new Stop('auth_expired', { step: 'setup', message: 'the Wix token expired during setup: run `npx --no-install wix whoami`, then run this command again' });
  if (out.code !== 0) throw fail('setup', out, { setupReason: last(out.stderr || out.stdout, 2) });
  const after = await route(ctx, 'setup check');
  if (after.reason === 'missing_setup_verification') {
    throw new Stop('failed', { step: 'setup', message: `setup did not verify${out.json && out.json.reason ? `: ${out.json.reason}` : ''}; nothing was imported. Run the command again to send the install again.` });
  }
}

async function stepImport(ctx, tokenMinted) {
  const answer = await guard(ctx, 10, 'import');
  if (answer.reason !== 'quick_mode_import_required') return;
  if (!tokenMinted.done) await stepToken(ctx);
  const out = await exec(ctx, 'import', quickMode(ctx.platform), ['import', ctx.projectDir], { timeoutMs: timeLeft(ctx), minMs: IMPORT_MIN_MS });
  if (out.code === WIX_AUTH_EXIT_CODE) throw new Stop('auth_expired', { step: 'import', message: 'the Wix token expired during the import: run `npx --no-install wix whoami`, then run this command again to continue' });
  if (out.timedOut) throw new Stop('in_progress', { step: 'import', message: 'the import was stopped at the time budget; run the same command again to continue it' });
  if (out.code !== 0) throw fail('import', out);
  if (out.json && out.json.warning) ctx.warnings.push(out.json.warning);
}

// ---- finish: the review ---------------------------------------------------------------------

async function readNdjson(file) {
  try { return (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

// Why product-to-collection links were not made: their collection or their product was not imported.
async function explainMissing(dir, platform, id, missing, unverified) {
  const generic = 'counted in the source but not imported and not reported as skipped';
  if (id !== 'collection_product') return generic;
  const edges = await readNdjson(path.join(dir, 'data', 'source-extract', 'collection_product.ndjson'));
  const crosswalk = (await readJson(path.join(dir, PLATFORMS[platform].crosswalk))) || {};
  if (!edges.length || !crosswalk.collection) return generic;
  const collections = new Set(Object.keys(crosswalk.collection).map(String));
  const products = new Set(Object.keys(crosswalk.product || {}).map(String));
  for (const row of Array.isArray(unverified.product) ? unverified.product : []) products.add(String(row.sourceId));
  let noCollection = 0;
  let noProduct = 0;
  for (const edge of edges) {
    if (!collections.has(String(edge.collectionId))) noCollection += 1;
    else if (!products.has(String(edge.productId))) noProduct += 1;
  }
  const rest = Math.max(0, missing - noCollection - noProduct);
  return `${noCollection} link(s) belong to a collection that was not imported, ${noProduct} to a product that was not imported${rest ? `, ${rest} not explained` : ''}`;
}

async function buildReview(ctx) {
  const dir = ctx.projectDir;
  const report = await readJson(path.join(dir, 'execution', 'completion-report.json'));
  if (!report) throw new Stop('failed', { step: 'finish', message: 'the import wrote no execution/completion-report.json' });
  const manifest = await readJson(path.join(dir, 'data', 'source-extract', 'manifest.json'));
  const unverified = (report.writtenUnverified && typeof report.writtenUnverified === 'object') ? report.writtenUnverified : {};
  const entities = Object.keys({ ...(manifest && manifest.entities), ...report.imported });
  const counts = {};
  for (const id of entities) {
    const written = Number(report.imported && report.imported[id]) || 0;
    const toCheck = Array.isArray(unverified[id]) ? unverified[id].length : 0;
    const skipped = Array.isArray(report.skipped && report.skipped[id]) ? report.skipped[id].length : 0;
    counts[id] = { found: manifest && manifest.entities && manifest.entities[id] ? manifest.entities[id].recordCount : null, onSite: written + toCheck, skipped: Math.max(0, skipped - toCheck) };
  }
  const skippedReasons = {};
  for (const [entity, rows] of Object.entries(report.skipped || {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (Array.isArray(unverified[entity]) && unverified[entity].some((u) => String(u.sourceId) === String(row.sourceId))) continue;
      const key = `${entity}: ${String(row.reason || 'no reason recorded').slice(0, 140)}`;
      skippedReasons[key] = (skippedReasons[key] || 0) + 1;
    }
  }
  // Records the adapter counted but neither imported nor reported as skipped (a link to something that was not
  // imported): say how many, and why when the extract shows it.
  for (const [id, c] of Object.entries(counts)) {
    const missing = c.found === null ? 0 : c.found - c.onSite - c.skipped;
    if (missing <= 0) continue;
    c.notImported = missing;
    skippedReasons[`${id}: ${await explainMissing(dir, ctx.platform, id, missing, unverified)}`] = missing;
  }
  const recoveries = await readNdjson(path.join(dir, 'execution', 'quick-limit-recoveries.ndjson'));
  // The ledger is append-only and a resumed import writes a product's lines again: count each variant once.
  const stockAssumed = [...new Map(recoveries.filter((r) => r.code === 'stock-assumed-in-stock').map((r) => [`${r.sourceId}:${r.variantId}`, r])).values()];
  const inventory = (await readJson(path.join(dir, 'state', 'inventory-report.json'))) || report.inventory || {};
  const crosswalk = (await readJson(path.join(dir, PLATFORMS[ctx.platform].crosswalk))) || {};
  const created = new Set(Object.keys(crosswalk.product_candidate || {}).concat(Object.keys(crosswalk.product || {})).map(String));
  const stockToCheck = [...new Set((inventory.gaps || []).map((gap) => String(gap.sourceProductId)).filter((id) => created.has(id)))];
  const productsToCheck = (unverified.product || []).map((p) => ({ sourceId: String(p.sourceId), name: p.name, failedFields: p.failedFields || [] }));
  const timeZone = await timeZoneNote(dir);
  // Actions the importer's own report asks a person to take (for example a store item left over from the install).
  const operatorActions = (Array.isArray(report.operatorActions) ? report.operatorActions : []).map((a) => ({ code: String(a.code || a.actionId || 'action'), severity: a.severity || null, action: String(a.action || '').slice(0, 400) }));
  const lines = [];
  for (const [id, c] of Object.entries(counts)) lines.push(`${id}: ${c.onSite} on the site${c.found !== null ? ` of ${c.found} found` : ''}${c.skipped ? `, ${c.skipped} skipped` : ''}${c.notImported ? `, ${c.notImported} not imported` : ''}`);
  if (productsToCheck.length) lines.push(`${productsToCheck.length} product(s) to check: a field differs from the source`);
  if (stockAssumed.length) lines.push(`${stockAssumed.length} variant(s) were imported in stock because the store did not say; check their stock`);
  if (stockToCheck.length) lines.push(`${stockToCheck.length} product(s) were created but their stock could not be set; set it in Business Manager`);
  for (const item of operatorActions) lines.push(`${item.code}: ${item.action}`);
  if (timeZone) lines.push(timeZone.confirm === 'cutover' ? `time zone: ${timeZone.value}; confirm it at cutover` : `time zone: ${timeZone.value}`);
  if (Object.keys(skippedReasons).length) lines.push(`skipped: ${Object.entries(skippedReasons).map(([k, n]) => `${k} (${n})`).join('; ')}`);
  // Only the Shopify importer writes `status`; the WooCommerce one does not, so a missing status is judged by the counts below.
  const complete = (report.status === undefined || report.status === 'complete') && !operatorActions.length && !Object.values(counts).some((c) => c.notImported) && !productsToCheck.length && !stockToCheck.length && !Object.keys(skippedReasons).length;
  ctx.review = {
    counts,
    skipped: skippedReasons,
    productsToCheck,
    collectionsNotMigrated: (report.excludedCollections || []).map((c) => ({ title: c.title || c.handle, sourceId: String(c.sourceId) })),
    stockAssumed: stockAssumed.length,
    stockToCheck,
    operatorActions,
    inferred: timeZone ? [timeZone] : [],
    destination: await destinationSummary(ctx),
    message: lines.join('\n'),
  };
  ctx.importStatus = report.status;
  ctx.report = report;
  ctx.manifest = manifest;
  ctx.counts = counts;
  return complete ? 'completed' : 'completed_with_issues';
}

// What the command chose for the time zone, read back from the locale file: a named zone, or the site's own.
async function timeZoneNote(dir) {
  let file = null;
  try { file = await sourceRegional.readSourceRegional(dir); } catch { return null; }
  if (!file || !file.timeZone) return null;
  const basis = (file.timeZone.inference && file.timeZone.inference.basis) || 'source';
  if (sourceRegional.settingValue(file, 'timeZone') === null) return { field: 'timeZone', value: 'the site keeps its own time zone', basis, confirm: 'cutover' };
  return { field: 'timeZone', value: file.timeZone.value, basis, confirm: file.timeZone.inference ? 'cutover' : null };
}

async function destinationSummary(ctx) {
  const env = await readEnvFile(path.join(ctx.projectDir, 'config', 'wix.env')).catch(() => ({}));
  const receipt = await readJson(path.join(ctx.projectDir, 'orchestration', 'destination.json'));
  const siteId = env.WIX_SITE_ID || (receipt && receipt.metaSiteId) || null;
  let dashboardUrl = null;
  try { if (siteId) dashboardUrl = require('./wix-dashboard-url.js').buildWixDashboardUrl(siteId); } catch { /* optional */ }
  return { siteId, dashboardUrl };
}

// One row per entity, attempted = succeeded + failed (the recorder's invariant).
function telemetryRollup(ctx) {
  const volumes = Object.entries(ctx.counts).map(([entity, c]) => {
    const found = c.found === null ? c.onSite + c.skipped : c.found;
    const succeeded = c.onSite;
    const failed = c.skipped;
    return { entity_type: entity, target: 'native', discovered: found, planned: found, attempted: succeeded + failed, succeeded, failed, skipped: Math.max(0, found - succeeded - failed), already_imported: 0 };
  });
  return { terminal_state: 'completed', volumes };
}

async function finish(ctx) {
  const status = await buildReview(ctx);
  if (!(await exists(path.join(ctx.projectDir, 'run-telemetry.json'))) && ctx.importStatus !== 'no-data' && ctx.importStatus !== 'simulated') {
    const out = await exec(ctx, 'telemetry-finalize', 'resources/rp-telemetry/scripts/rp-telemetry.js', ['finalize', JSON.stringify(telemetryRollup(ctx)), '--project', ctx.projectDir], { timeoutMs: 45_000 }).catch(() => null);
    if (!out || out.code !== 0) ctx.warnings.push(`telemetry was not closed: ${out ? last(out.stderr || out.stdout, 1) : 'no time left'}`);
  }
  if (ctx.importStatus === 'no-data') throw new Stop('needs_agent', { step: 'finish', message: 'nothing was imported: the store has no data the quick import reads' });
  if (ctx.importStatus === 'simulated') throw new Stop('failed', { step: 'finish', message: 'the import ran as a dry run, which this command never asks for' });
  return result(ctx, status, { message: ctx.review.message });
}

// ---- drive ---------------------------------------------------------------------------------------

async function drive(ctx, args) {
  if (!args._[0]) throw new Stop('needs_input', { message: 'the project folder is required', field: 'projectDir' });
  if (!args.platform) throw new Stop('needs_input', { message: '--platform is required (shopify or woocommerce)', field: '--platform' });
  if (!Object.hasOwn(PLATFORMS, args.platform)) throw new Stop('needs_agent', { message: `platform "${args.platform}" is not driven by this command (Shopify and WooCommerce only); continue with the step-by-step skill`, field: '--platform' });
  if (!args.sourceUrl) throw new Stop('needs_input', { message: '--source-url is required', field: '--source-url' });
  try {
    const url = new URL(args.sourceUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('not http(s)');
  } catch { throw new Stop('needs_input', { message: `--source-url is not an http(s) address: ${args.sourceUrl}`, field: '--source-url' }); }
  ctx.projectDir = path.resolve(args._[0]);
  ctx.platform = args.platform;
  // A site type the skill would refuse is caught here, before anything is written.
  if (args.siteType) {
    try { resolveSiteTypePair({ siteType: args.siteType, businessType: args.businessType, businessTypeSource: args.businessTypeSource }); } catch (error) {
      throw new Stop('needs_input', { message: `the site type was not accepted: ${error.message}`, field: '--site-type' });
    }
  }

  // The site type is the one answer needed from a person; stop before anything is written without it.
  const recorded = getDecisionValue(await readDecisions(ctx.projectDir), 'targetSiteType');
  if (!args.siteType && !recorded) throw new Stop('needs_input', { message: '--site-type is required (harmony, studio, studio2 or headless); it is the only thing this command asks for', field: '--site-type' });

  // A finished project is answered from its own report; nothing runs and no second telemetry attempt opens.
  const finishedReport = await readJson(path.join(ctx.projectDir, 'execution', 'completion-report.json'));
  if (finishedReport && !finishedReport.interruption && !finishedReport.dryRun) {
    return finish(ctx);
  }

  await startProject(ctx, args);
  await recordDecisions(ctx, args);
  await destination(ctx);
  await sourceConfig(ctx, args);
  await stepPreflight(ctx);
  await stepQuickPlan(ctx);
  await stepLocale(ctx);
  await stepExtract(ctx);
  const tokenMinted = { done: false };
  const setupBefore = ctx.steps.length;
  await stepSetup(ctx);
  tokenMinted.done = ctx.steps.slice(setupBefore).some((step) => step.name === 'token');
  await stepImport(ctx, tokenMinted);
  return finish(ctx);
}

module.exports = { installStopHandlers, killActive, run, usage, parseArgs, EXIT, ROUTE_STEP, Stop, runChild, parseOutput };
