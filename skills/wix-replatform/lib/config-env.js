'use strict';

const fs = require('node:fs/promises');

const PLACEHOLDER_VALUE = 'REPLACE_WITH_REAL_VALUE';

// Values the toolkit writes are shell-safe: anything beyond a plain word is single-quoted, with an
// embedded ' written as '\'' (POSIX), so a shell `source` can never split a secret at a space.
// The parser decodes exactly that form; every other value is read as before.
const PLAIN_ENV_VALUE = /^[A-Za-z0-9_./:@%+,=-]*$/;
const SINGLE_QUOTED_ENV_VALUE = /^'((?:[^']|'\\'')*)'$/;

function quoteEnvValue(value) {
  const text = String(value);
  return PLAIN_ENV_VALUE.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function unquoteEnvValue(value) {
  const match = String(value).trim().match(SINGLE_QUOTED_ENV_VALUE);
  return match ? match[1].replaceAll("'\\''", "'") : value;
}

function parseEnvText(text) {
  const values = {};
  const lines = String(text).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    values[key] = unquoteEnvValue(line.slice(idx + 1));
  }
  return values;
}

async function readEnvFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseEnvText(raw);
}

function statEnvValues(values, requiredKeys, options = {}) {
  const placeholder = options.placeholder || PLACEHOLDER_VALUE;
  const keys = {};
  for (const key of requiredKeys) {
    if (!(key in values)) {
      keys[key] = 'missing';
    } else if (String(values[key]).trim() === '') {
      keys[key] = 'blank';
    } else if (String(values[key]) === placeholder) {
      keys[key] = 'placeholder';
    } else {
      keys[key] = 'present';
    }
  }
  return keys;
}

async function statEnvKeys(filePath, requiredKeys, options = {}) {
  try {
    const values = await readEnvFile(filePath);
    const keys = statEnvValues(values, requiredKeys, options);
    return { exists: true, keys };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const keys = {};
      for (const key of requiredKeys) {
        keys[key] = 'missing';
      }
      return { exists: false, keys };
    }
    throw error;
  }
}

function assertEnvValueSafe(value, key) {
  if (String(value).includes('\n') || String(value).includes('\r')) {
    throw new Error(`${key} contains a newline and cannot be written to simple .env syntax`);
  }
}

function renderEnvLine(key, value) {
  assertEnvValueSafe(value, key);
  return `${key}=${quoteEnvValue(value)}`;
}

function upsertEnvText(text, updates) {
  const updateKeys = Object.keys(updates);
  const seen = new Set();
  const source = String(text);
  const hasTrailingNewline = /\r?\n$/.test(source);
  const lines = source === '' ? [] : source.split(/\r?\n/);
  if (hasTrailingNewline && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const rendered = lines.map((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return rawLine;
    }
    const idx = rawLine.indexOf('=');
    if (idx === -1) {
      return rawLine;
    }
    const key = rawLine.slice(0, idx).trim();
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      return rawLine;
    }
    seen.add(key);
    return renderEnvLine(key, updates[key]);
  });

  for (const key of updateKeys) {
    if (!seen.has(key)) {
      rendered.push(renderEnvLine(key, updates[key]));
    }
  }

  const out = rendered.join('\n');
  return hasTrailingNewline || updateKeys.some((key) => !seen.has(key)) ? `${out.replace(/\n$/, '')}\n` : out;
}

async function upsertEnvFile(filePath, updates) {
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.mkdir(require('node:path').dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, upsertEnvText(raw, updates), 'utf8');
}

// A Map, so inherited keys (constructor, __proto__) stay unknown.
const DRY_RUN_VALUES = new Map(Object.entries({ true: true, 1: true, yes: true, on: true, false: false, 0: false, no: false, off: false }));
// One DRY_RUN reading for generated entrypoints: config/wix.env, then a non-blank process
// value, then --dry-run/--no-dry-run. Unknown values fail closed instead of writing live.
async function resolveDryRun(projectDir, { env = process.env, argv = process.argv.slice(2) } = {}) {
  let file = {};
  try { file = await readEnvFile(require('node:path').join(projectDir, 'config', 'wix.env')); }
  catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
  const raw = String(env.DRY_RUN ?? '').trim() || String(file.DRY_RUN ?? '').trim();
  let dryRun = raw ? DRY_RUN_VALUES.get(raw.toLowerCase()) : false;
  if (dryRun === undefined) throw new Error(`DRY_RUN must be one of true, 1, yes, on, false, 0, no, off; got ${JSON.stringify(raw)}`);
  for (const arg of argv) { if (arg === '--dry-run') dryRun = true; if (arg === '--no-dry-run') dryRun = false; }
  return dryRun;
}

// The run flags an operator or agent may set in config/wix.env. Only these keys, only boolean
// values (written as true/false), and only what was asked: nothing here picks a default.
const RUN_FLAG_KEYS = Object.freeze(['DRY_RUN']);

async function setRunFlag(projectDir, key, value) {
  if (key === 'SAFE_MODE') throw new Error('SAFE_MODE was removed: imports send real contact data and rely on the site mute');
  if (!RUN_FLAG_KEYS.includes(key)) throw new Error(`key must be one of ${RUN_FLAG_KEYS.join(', ')}; got ${JSON.stringify(key)}`);
  const flag = DRY_RUN_VALUES.get(String(value ?? '').trim().toLowerCase());
  if (flag === undefined) throw new Error(`${key} must be one of true, 1, yes, on, false, 0, no, off; got ${JSON.stringify(value)}`);
  await upsertEnvFile(require('node:path').join(projectDir, 'config', 'wix.env'), { [key]: String(flag) });
  return { key, value: flag };
}

module.exports = {
  PLACEHOLDER_VALUE,
  RUN_FLAG_KEYS,
  setRunFlag,
  resolveDryRun,
  parseEnvText,
  quoteEnvValue,
  readEnvFile,
  statEnvValues,
  statEnvKeys,
  upsertEnvText,
  upsertEnvFile,
};
