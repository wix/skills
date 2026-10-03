#!/usr/bin/env node
'use strict';

// Captures the source store's OWN configuration — business address, currency, which countries
// it sells to, whether tax is calculated — into the run's data directory.
//
//   node capture-store-settings.js <projectDir>
//   -> <projectDir>/data/store-settings-general.json
//
// WHY THIS IS A SCRIPT AND NOT A DISCOVERY RULE. Two independent reasons the generic sweep
// can never reach this route, each of which looks like a dead end on its own:
//
//   1. The REST index advertises only the PARAMETERIZED form `/wc/v3/settings/(?P<group>...)`,
//      never the literal group route. Nothing in the generic sweep resolves a route template
//      into its concrete groups, so `/wc/v3/settings/general` is never a candidate. Same shape
//      as a shipping zone's /locations and /methods sub-resources: parent-scoped, read directly.
//
//   2. The WooCommerce consumer key returns 401 `woocommerce_rest_cannot_view` here, while the
//      WordPress application password returns 200. A reader that tries only the store key gets
//      a plausible "no permission" and moves on.
//
// Together those two are why this route was never sampled on any run, and why every migrated
// site published with an empty business address without anyone noticing. The fix has to be a
// deliberate step, not a classifier tweak — hence this file.
//
// Reads WP_BASE_URL, WP_USERNAME and WP_APPLICATION_PASSWORD from
// <projectDir>/config/source.woocommerce.env. Never prints the credential.

const fs = require('node:fs');
const path = require('node:path');

const GROUP = 'general';
const ROUTE = `/wp-json/wc/v3/settings/${GROUP}`;
const OUTPUT_NAME = 'store-settings-general.json';

function readEnvFile(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function captureStoreSettings(projectDir) {
  const configPath = path.join(projectDir, 'config', 'source.woocommerce.env');
  if (!fs.existsSync(configPath)) {
    throw new Error(`capture-store-settings: source config not found at ${configPath}`);
  }
  const env = readEnvFile(configPath);
  for (const key of ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD']) {
    if (!env[key]) {
      throw new Error(`capture-store-settings: ${key} is missing from ${configPath} — the store consumer key cannot read this route, only the WordPress application password can`);
    }
  }

  const base = env.WP_BASE_URL.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${env.WP_USERNAME}:${env.WP_APPLICATION_PASSWORD}`).toString('base64')}`;
  const response = await fetch(base + ROUTE, { headers: { Authorization: auth } });
  const body = await response.json().catch(() => null);

  if (!response.ok || !Array.isArray(body)) {
    const code = body && body.code ? ` (${body.code})` : '';
    throw new Error(`capture-store-settings: GET ${ROUTE} returned ${response.status}${code}. If this is a 401, the run is using the WooCommerce consumer key — this route needs the WordPress application password.`);
  }

  const outputDir = path.join(projectDir, 'data');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_NAME);
  fs.writeFileSync(outputPath, `${JSON.stringify(body, null, 2)}\n`);
  return { outputPath, count: body.length, settings: body };
}

async function main() {
  const projectDir = path.resolve(process.argv[2] || process.cwd());
  const { outputPath, count } = await captureStoreSettings(projectDir);
  process.stdout.write(`captured ${count} store settings -> ${outputPath}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { captureStoreSettings, GROUP, ROUTE, OUTPUT_NAME };
