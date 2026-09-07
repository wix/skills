'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { statEnvKeys } = require('./config-env.js');
const { getDecisionValue } = require('./orchestration-decisions.js');

const SCHEMA_VERSION = 1;
const execFileAsync = promisify(execFile);

const SOURCE_CONFIG_BY_PLATFORM = {
  wordpress: ['WP_BASE_URL'],
  woocommerce: ['WP_BASE_URL'],
  shopify: ['SHOPIFY_STORE_URL'],
  // CSV is a file-provided flow: source.csv.env holds only optional
  // delimiter/encoding/vendor/rewrite hints, so no key is required. The
  // files_only branch above enforces fileInputPaths instead.
  csv: [],
};

const PRIVATE_SOURCE_CONFIG_BY_PLATFORM = {
  wordpress: ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD'],
  woocommerce: ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD'],
};

function makeCheck(id, label, status, message, details = {}) {
  return { id, label, status, message, ...details };
}

async function defaultProbeWixCli() {
  try {
    const { stdout } = await execFileAsync('npx', ['@wix/cli@latest', 'whoami'], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const output = String(stdout || '').trim();
    if (!output) {
      return { available: true, authState: 'unknown', reason: 'wix whoami returned empty output' };
    }
    return {
      available: true,
      authState: 'authenticated',
      email: output,
    };
  } catch (error) {
    return {
      available: false,
      authState: 'unknown',
      reason: error && error.message ? error.message : String(error),
    };
  }
}

function configFileForPlatform(projectDir, platform) {
  return path.join(projectDir, 'config', `source.${platform}.env`);
}

async function runPreflight(projectDir, artifacts, options = {}) {
  const probeWixCli = options.probeWixCli || defaultProbeWixCli;
  const progress = options.progress || null;
  const checks = [];
  const decisions = artifacts.decisions || {};
  const sourceMode = getDecisionValue(decisions, 'sourceMode');
  const sourcePlatform = getDecisionValue(decisions, 'sourcePlatform');
  const deliveryMode = getDecisionValue(decisions, 'deliveryMode');
  const targetSiteStrategy = getDecisionValue(decisions, 'targetSiteStrategy');
  const fileInputPaths = getDecisionValue(decisions, 'fileInputPaths');
  const credentialRef = getDecisionValue(decisions, 'sourceCredentialRef');

  checks.push(
    sourceMode
      ? makeCheck('source_mode', 'Source acquisition mode', 'pass', `sourceMode=${sourceMode}`)
      : makeCheck('source_mode', 'Source acquisition mode', 'blocked', 'sourceMode decision is missing'),
  );
  progress?.progress('Checked source acquisition mode', { phase: 'preflight', step: 'source-mode' });

  if ((sourceMode === 'private_data' || sourceMode === 'authenticated_api') && !(sourcePlatform in PRIVATE_SOURCE_CONFIG_BY_PLATFORM)) {
    checks.push(
      credentialRef
        ? makeCheck('source_credentials', 'Source credential reference', 'pass', 'credential reference present')
        : makeCheck('source_credentials', 'Source credential reference', 'blocked', 'private/authenticated mode requires sourceCredentialRef'),
    );
    progress?.progress('Checked source credential reference', { phase: 'preflight', step: 'source-credentials' });
  }

  if (sourceMode === 'files_only' || getDecisionValue(decisions, 'includeAdditionalFiles') === true) {
    const files = Array.isArray(fileInputPaths) ? fileInputPaths : [];
    checks.push(
      files.length > 0
        ? makeCheck('file_inputs', 'Input files', 'pass', `${files.length} file input path(s) recorded`)
        : makeCheck('file_inputs', 'Input files', 'blocked', 'file-based flow requires fileInputPaths'),
    );
    progress?.progress('Checked file inputs', { phase: 'preflight', step: 'file-inputs' });
  }

  checks.push(
    deliveryMode
      ? makeCheck('delivery_mode', 'Delivery mode', 'pass', `deliveryMode=${deliveryMode}`)
      : makeCheck('delivery_mode', 'Delivery mode', 'blocked', 'deliveryMode decision is missing'),
  );
  checks.push(
    targetSiteStrategy
      ? makeCheck('target_site_strategy', 'Target site strategy', 'pass', `targetSiteStrategy=${targetSiteStrategy}`)
      : makeCheck('target_site_strategy', 'Target site strategy', 'blocked', 'targetSiteStrategy decision is missing'),
  );
  progress?.progress('Checked delivery and target site decisions', { phase: 'preflight', step: 'target-decisions' });

  const wixEnv = await statEnvKeys(path.join(projectDir, 'config', 'wix.env'), ['WIX_SITE_STRATEGY', 'WIX_SITE_ID', 'WIX_AUTH_TOKEN']);
  checks.push(makeCheck('wix_env', 'Wix config file', wixEnv.exists ? 'pass' : 'blocked', wixEnv.exists ? 'wix.env exists' : 'wix.env is missing', { keyStatus: wixEnv.keys }));
  progress?.progress('Checked Wix config file', { phase: 'preflight', step: 'wix-env' });

  if (targetSiteStrategy === 'existing_site') {
    const siteIdStatus = wixEnv.keys.WIX_SITE_ID;
    checks.push(
      siteIdStatus === 'present'
        ? makeCheck('wix_site_id', 'Existing site id', 'pass', 'WIX_SITE_ID present')
        : makeCheck('wix_site_id', 'Existing site id', 'blocked', `WIX_SITE_ID is ${siteIdStatus}`),
    );
    progress?.progress('Checked existing Wix site id', { phase: 'preflight', step: 'wix-site-id' });
  }

  if (sourcePlatform) {
    const requiredSourceKeys =
      (sourceMode === 'private_data' || sourceMode === 'authenticated_api')
        ? (PRIVATE_SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || [])
        : (SOURCE_CONFIG_BY_PLATFORM[sourcePlatform] || []);
    if (requiredSourceKeys.length > 0) {
      const sourceEnv = await statEnvKeys(configFileForPlatform(projectDir, sourcePlatform), requiredSourceKeys);
      const allGood = Object.values(sourceEnv.keys).every((status) => status === 'present');
      checks.push(
        makeCheck(
          'source_env',
          'Source config file',
          allGood ? 'pass' : 'blocked',
          sourceEnv.exists ? `checked source.${sourcePlatform}.env` : `source.${sourcePlatform}.env is missing`,
          { keyStatus: sourceEnv.keys },
        ),
      );
      progress?.progress(`Checked source ${sourcePlatform} config file`, { phase: 'preflight', step: 'source-env', entity: sourcePlatform });
    }
  }

  progress?.progress('Wix CLI probe started', { phase: 'preflight', step: 'wix-cli' });
  const wixCli = progress
    ? await progress.withHeartbeat({ phase: 'preflight', step: 'wix-cli', message: 'Still probing Wix CLI' }, probeWixCli)
    : await probeWixCli();
  checks.push(
    wixCli.available
      ? makeCheck('wix_cli_available', 'Wix CLI availability', 'pass', 'Wix CLI probe succeeded', { cli: wixCli })
      : makeCheck('wix_cli_available', 'Wix CLI availability', 'blocked', wixCli.reason || 'Wix CLI probe failed', { cli: wixCli }),
  );
  checks.push(
    wixCli.authState === 'authenticated'
      ? makeCheck('wix_cli_auth', 'Wix CLI auth state', 'pass', 'Wix CLI is authenticated', { cli: wixCli })
      : makeCheck('wix_cli_auth', 'Wix CLI auth state', 'blocked', wixCli.reason || 'Wix CLI auth could not be confirmed', { cli: wixCli }),
  );
  progress?.progress('Checked Wix CLI availability and auth', { phase: 'preflight', step: 'wix-cli' });

  const blocked = checks.filter((check) => check.status === 'blocked');
  const failed = checks.filter((check) => check.status === 'failed');
  const status = failed.length > 0 ? 'failed' : blocked.length > 0 ? 'blocked' : 'pass';

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    updatedAt: new Date().toISOString(),
    checks,
  };
}

module.exports = {
  SCHEMA_VERSION,
  runPreflight,
};
