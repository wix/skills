'use strict';

const fs = require('node:fs/promises');

const PLACEHOLDER_VALUE = 'REPLACE_WITH_REAL_VALUE';

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
    const value = line.slice(idx + 1);
    values[key] = value;
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
  return `${key}=${value}`;
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

module.exports = {
  PLACEHOLDER_VALUE,
  parseEnvText,
  readEnvFile,
  statEnvValues,
  statEnvKeys,
  upsertEnvText,
  upsertEnvFile,
};
