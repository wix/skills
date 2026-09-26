'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const LEDGER_FILE = 'EXPECTATIONS.md';

const STARTER = `# Migration expectations

Use this file to record anything you expected the migration to do differently: a
surprising question, a mapping you expected, or an outcome that did not match your
intent. Write freely anywhere in this document.

You can also tell the agent: \`add to expectations: <your note>\`. It will preserve
your note and add safe references to the current migration context. Do not put passwords,
tokens, customer data, or other secrets here.
`;

function ledgerPath(projectDir) {
  return path.join(path.resolve(projectDir), LEDGER_FILE);
}

async function ensureLedger(projectDir) {
  const file = ledgerPath(projectDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, STARTER, { encoding: 'utf8', flag: 'wx' });
    return { file, created: true };
  } catch (error) {
    if (error.code === 'EEXIST') return { file, created: false };
    throw error;
  }
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
    .replace(/\b(password|passwd|secret|token|api[-_ ]?key|authorization|cookie)\b\s*([:=])\s*[^\s,;]+/gi, '$1$2[REDACTED]');
}

function safeArtifactRef(projectDir, ref) {
  if (!ref) return null;
  const root = path.resolve(projectDir);
  const candidate = path.resolve(root, ref);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative || '.';
}

function nextId(contents) {
  const ids = [...contents.matchAll(/^##\s+E-(\d+)\b/gm)].map((match) => Number(match[1]));
  return `E-${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0')}`;
}

function formatContext(projectDir, context = {}) {
  const lines = [];
  for (const [label, value] of [
    ['Stage', context.phase],
    ['State', context.state],
    ['Active resource', context.resource],
    ['Source', context.source],
    ['Target', context.target],
    ['Decision or approval', context.decision],
  ]) {
    if (value) lines.push(`- ${label}: ${redactSensitiveText(value)}`);
  }
  for (const ref of context.artifactRefs || []) {
    const safeRef = safeArtifactRef(projectDir, ref);
    if (safeRef) lines.push(`- Artifact: \`${safeRef}\``);
  }
  return lines.length ? lines.join('\n') : '- No reliable run context was available when this was captured.';
}

async function appendExpectation(projectDir, expectation, context = {}, now = new Date()) {
  if (!String(expectation || '').trim()) throw new Error('expectation is required');
  const { file } = await ensureLedger(projectDir);
  const contents = await fs.readFile(file, 'utf8');
  const id = nextId(contents);
  const original = String(expectation).trim();
  const note = redactSensitiveText(original).trim();
  const heading = note === original ? 'User expectation (verbatim)' : 'User expectation (sensitive values redacted)';
  const entry = `\n## ${id} — ${now.toISOString()}\n\n### ${heading}\n\n${note}\n\n### Context captured by the agent\n\n${formatContext(projectDir, context)}\n`;
  await fs.appendFile(file, entry, 'utf8');
  return { file, id, redacted: note !== original };
}

module.exports = {
  LEDGER_FILE,
  STARTER,
  ledgerPath,
  ensureLedger,
  redactSensitiveText,
  safeArtifactRef,
  nextId,
  appendExpectation,
};
