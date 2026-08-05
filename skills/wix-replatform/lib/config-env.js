'use strict';

const fs = require('node:fs/promises');

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

async function statEnvKeys(filePath, requiredKeys) {
  try {
    const values = await readEnvFile(filePath);
    const keys = {};
    for (const key of requiredKeys) {
      if (!(key in values)) {
        keys[key] = 'missing';
      } else if (String(values[key]).trim() === '') {
        keys[key] = 'blank';
      } else {
        keys[key] = 'present';
      }
    }
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

module.exports = {
  parseEnvText,
  readEnvFile,
  statEnvKeys,
};
