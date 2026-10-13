#!/usr/bin/env node
'use strict';

// oxlint-disable no-console preserve-caught-error

/**
 * Accessibility review for Editor React Components: one command, one JSON report.
 *
 *   node <SKILL_ROOT>/scripts/scan-a11y-review.cjs <component-dir | files...>
 *
 * Runs the jsx-a11y ESLint scanner and the Babel semantic/contract scanner in
 * process, spawns the render audit (SSR + jsdom + axe-core) per component
 * folder, and groups the findings by rule.
 *
 * Exit codes: 0 every scanner ran and found nothing, 1 findings, 2 a scanner
 * could not run or could not load the component (never treat 2 as clean).
 * Test hook: `A11Y_SKIP_RENDER=1` skips the render audit; the review is then
 * inconclusive (exit 2) even with no findings.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const RENDER_SCRIPT = path.join(__dirname, 'scan-a11y-render.cjs');
const RENDER_TIMEOUT_MS = Number(process.env.A11Y_RENDER_TIMEOUT_MS) || 20_000;
const MAX_LOCATIONS_PER_GROUP = 5;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2, unknown: 3 };

// ─────────────────────────────────────────────────────────────────────────────
// Arguments and discovery
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { targets: [], render: process.env.A11Y_SKIP_RENDER !== '1' };
  for (const arg of argv) {
    if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    options.targets.push(arg);
  }
  return options;
}

const isSource = (name) =>
  /\.(tsx|jsx)$/.test(name) && !/\.(stories|test|spec)\.[jt]sx$/.test(name);

function listSources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') listSources(full, acc);
    } else if (entry.isFile() && isSource(entry.name)) acc.push(full);
  }
  return acc;
}

function isComponentDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const names = fs.readdirSync(dir);
  return names.includes('component.tsx') || names.some((name) => name.endsWith('.props.ts'));
}

function findComponentDir(file) {
  let dir = path.dirname(file);
  for (let depth = 0; depth < 6 && !isComponentDir(dir); depth++) {
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
  return isComponentDir(dir) ? dir : path.dirname(file);
}

/** Expand targets (component folders, a components root, or files) into files and component folders. */
function discoverFiles(targets) {
  const files = new Set();
  const componentDirs = new Set();
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) throw new Error(`Path not found: ${target}`);
    if (fs.statSync(resolved).isDirectory()) {
      if (isComponentDir(resolved)) componentDirs.add(resolved);
      else {
        for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
          const child = path.join(resolved, entry.name);
          if (entry.isDirectory() && isComponentDir(child)) componentDirs.add(child);
        }
      }
      for (const file of listSources(resolved)) files.add(file);
    } else {
      files.add(resolved);
      componentDirs.add(findComponentDir(resolved));
    }
  }
  return { files: [...files].toSorted(), componentDirs: [...componentDirs].toSorted() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanners
// ─────────────────────────────────────────────────────────────────────────────

async function runScanner(name, load) {
  const started = Date.now();
  try {
    const value = await load();
    const parseErrors = (value.meta && value.meta.parseErrors) || [];
    if (parseErrors.length) {
      throw new Error(parseErrors.map((e) => `${e.file}: ${e.message}`).join('; '));
    }
    return { ok: true, ms: Date.now() - started, value };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return { ok: false, ms: Date.now() - started, error: `${name}: ${message}` };
  }
}

function eslintFindings(report) {
  return report.findings.map((f) => ({
    rule: f.rule,
    source: 'eslint',
    severity: 'high',
    confidence: 'high',
    message: f.message,
    at: `${f.file}:${f.line}:${f.column}`,
  }));
}

function semanticFindings(report) {
  return report.findings.map((f) => {
    const contract = f.sourceKind === 'contract';
    const severity =
      contract || f.confidence === 'high' ? 'high' : f.confidence === 'medium' ? 'medium' : 'low';
    return {
      rule: f.rule,
      source: contract ? 'contract' : 'semantic',
      severity,
      confidence: f.confidence,
      message: f.message,
      detail: contract ? null : f.evidence,
      at: `${f.file}:${f.line}:${f.column}`,
    };
  });
}

function runRenderChild(componentDir) {
  const relativeDir = path.relative(ROOT, componentDir) || '.';
  const started = Date.now();
  const result = spawnSync(process.execPath, [RENDER_SCRIPT, componentDir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  });
  const base = { componentDir: relativeDir, ms: Date.now() - started };

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return {
      ...base,
      ok: false,
      reason: 'timeout',
      findings: [
        {
          rule: 'render-timeout',
          source: 'render',
          severity: 'high',
          confidence: 'high',
          message: `Rendering ${relativeDir} did not finish within ${RENDER_TIMEOUT_MS} ms. Rerun once; if it repeats, the first render never settles.`,
        },
      ],
    };
  }

  let report = null;
  try {
    const lastLine = String(result.stdout || '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop();
    report = lastLine ? JSON.parse(lastLine) : null;
  } catch {
    report = null;
  }
  if (!report) {
    const error = truncate(result.stderr || `exit ${result.status}`, 400);
    return { ...base, ok: false, reason: 'crash', error, findings: [] };
  }
  if (!report.ok) {
    return {
      ...base,
      ok: false,
      reason: report.reason || 'error',
      error: report.error || null,
      findings: [],
    };
  }
  return {
    ...base,
    ok: true,
    entry: report.entry,
    preview: report.preview,
    ssr: report.ssr,
    axeRules: report.axe ? report.axe.rulesRun : null,
    notChecked: report.notChecked || [],
    findings: report.findings.map((f) => ({
      ...f,
      source: 'render',
      at: f.target ? `${relativeDir} ${f.target}` : relativeDir,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

function truncate(text, length) {
  const compact = String(text || '').replace(/\s+/g, ' ');
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

/** One entry per (source, rule, message); repeated nodes become a count plus a few locations. */
function groupFindings(findings, { capPerGroup = MAX_LOCATIONS_PER_GROUP } = {}) {
  const groups = new Map();
  for (const f of findings) {
    const severity = f.severity in SEVERITY_RANK ? f.severity : 'medium';
    const confidence = f.confidence in CONFIDENCE_RANK ? f.confidence : 'medium';
    const key = `${f.source}|${f.rule}|${f.message}`;
    if (!groups.has(key)) {
      groups.set(key, {
        rule: f.rule,
        src: f.source,
        sev: severity,
        conf: confidence,
        n: 0,
        at: [],
        html: f.html || null,
        msg: f.message,
        detail: f.detail || null,
        helpUrl: f.helpUrl || null,
      });
    }
    const group = groups.get(key);
    group.n++;
    if (f.at && group.at.length < capPerGroup && !group.at.includes(f.at)) group.at.push(f.at);
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[group.sev]) group.sev = severity;
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[group.conf]) group.conf = confidence;
  }
  return [...groups.values()].toSorted(
    (a, b) =>
      SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev] ||
      CONFIDENCE_RANK[a.conf] - CONFIDENCE_RANK[b.conf] ||
      b.n - a.n ||
      a.rule.localeCompare(b.rule),
  );
}

function renderLabel(result) {
  if (result.ok) {
    if (!result.ssr || !result.ssr.ok) return `render: ssr FAILED (${result.entry || '?'})`;
    return `render ok (${result.entry || '?'}, axe ${result.axeRules ?? '-'})`;
  }
  return `render FAILED (${result.reason})`;
}

function buildSummary(groups, scanners, { renderEnabled = true } = {}) {
  const counts = { high: 0, medium: 0, low: 0, groups: groups.length, findings: 0 };
  for (const group of groups) {
    counts[group.sev] += group.n;
    counts.findings += group.n;
  }
  // A timeout is itself a finding; any other render failure (missing tooling,
  // a module the audit cannot load) or a skipped render means the audit did
  // not run, never clean.
  const staticFailed = !scanners.eslint.ok || !scanners.semantic.ok;
  const renderBroken =
    !renderEnabled || scanners.render.some((r) => !r.ok && r.reason !== 'timeout');
  const status =
    staticFailed || renderBroken ? 'error' : counts.findings > 0 ? 'findings' : 'clean';
  const severities = ['high', 'medium', 'low']
    .filter((level) => counts[level] > 0)
    .map((level) => `${counts[level]} ${level}`);
  const line = [
    `A11Y ${counts.groups} groups/${counts.findings} findings${severities.length ? ` (${severities.join(', ')})` : ''}`,
    `eslint ${scanners.eslint.ok ? 'ok' : 'FAILED'}`,
    `semantic ${scanners.semantic.ok ? 'ok' : 'FAILED'}`,
    renderEnabled
      ? scanners.render.map(renderLabel).join(' · ') || 'render: no component folder'
      : 'render SKIPPED (inconclusive)',
  ].join(' · ');
  return { status, line, counts };
}

const computeExitCode = (summary) =>
  summary.status === 'error' ? 2 : summary.counts.findings > 0 ? 1 : 0;

async function review(options) {
  const { files, componentDirs } = discoverFiles(options.targets);
  // A wrong path (a typo, a parent folder) must never read as clean.
  if (componentDirs.length === 0) {
    throw new Error(
      `No component folder under ${options.targets.join(', ')}: expected component.tsx or *.props.ts.`,
    );
  }

  // ESLint rejects an empty file list; a folder with no JSX still gets its render audit.
  const eslint = await runScanner('eslint', () =>
    files.length ? require('./scan-a11y-eslint.cjs').scan(files) : { findings: [] },
  );
  const semantic = await runScanner('semantic', () =>
    files.length ? require('./scan-a11y-code.cjs').scan(files) : { findings: [] },
  );
  const render = options.render ? componentDirs.map(runRenderChild) : [];

  const findings = [
    ...(eslint.ok ? eslintFindings(eslint.value) : []),
    ...(semantic.ok ? semanticFindings(semantic.value) : []),
    ...render.flatMap((r) => r.findings),
  ];
  const groups = groupFindings(findings);

  const notChecked = new Set(options.render ? [] : ['render audit (skipped)']);
  for (const r of render) {
    for (const item of r.notChecked || []) notChecked.add(item);
  }

  const scanners = {
    eslint: { ok: eslint.ok, ms: eslint.ms, error: eslint.error || null },
    semantic: { ok: semantic.ok, ms: semantic.ms, error: semantic.error || null },
    render: render.map(({ findings: _findings, notChecked: _notChecked, ...rest }) => rest),
  };
  const summary = buildSummary(groups, scanners, { renderEnabled: options.render });
  return {
    summary,
    findings: groups,
    scanners,
    files: files.map((file) => path.relative(ROOT, file)),
    notChecked: [...notChecked],
    exitCode: computeExitCode(summary),
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.targets.length === 0) throw new Error('No component directory or files specified.');
  } catch (error) {
    console.error(
      `${error.message}\nUsage: node <SKILL_ROOT>/scripts/scan-a11y-review.cjs <component-dir | files...>`,
    );
    process.exit(2);
  }
  try {
    const report = await review(options);
    console.log(JSON.stringify(report));
    process.exit(report.exitCode);
  } catch (error) {
    console.log(
      JSON.stringify({
        summary: { status: 'error', line: error.message, counts: { findings: 0 } },
        findings: [],
      }),
    );
    process.exit(2);
  }
}

module.exports = { review, discoverFiles, groupFindings, buildSummary, computeExitCode };

if (require.main === module) main();
