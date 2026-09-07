'use strict';

const path = require('node:path');
const {
  PLACEHOLDER_VALUE,
  readEnvFile,
  statEnvValues,
  upsertEnvFile,
} = require('./config-env.js');
const { buildWixDashboardUrl } = require('./wix-dashboard-url.js');

const SECRET_NAME_RE = /^[A-Za-z0-9_+=@#$-]+$/;
const DEFAULT_BASE_URL = 'https://www.wixapis.com';
const API_PATH = '/_api/cloud-secrets-vault-server/api/v1/secrets';

function authHeaderValue(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    throw new Error('Wix auth token is required');
  }
  if (/^Bearer\s+/i.test(trimmed)) return trimmed;
  if (/^IST\./.test(trimmed)) return trimmed;
  return `Bearer ${trimmed}`;
}

function assertSecretName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('secret name is required');
  }
  if (name.length > 50) {
    throw new Error(`secret name "${name}" exceeds Wix's 50 character limit`);
  }
  if (!SECRET_NAME_RE.test(name)) {
    throw new Error(`secret name "${name}" contains unsupported characters`);
  }
}

function normalizeKeySpec(spec) {
  if (typeof spec === 'string') {
    assertSecretName(spec);
    return { key: spec, secretName: spec };
  }
  if (!spec || typeof spec !== 'object' || !spec.key) {
    throw new Error('key specs must be strings or objects with a key');
  }
  const key = String(spec.key);
  const secretName = String(spec.secretName || spec.key);
  assertSecretName(secretName);
  return { key, secretName };
}

function isUsableSecretValue(value, placeholder = PLACEHOLDER_VALUE) {
  return value != null && String(value).trim() !== '' && String(value) !== placeholder;
}

function safeJsonError(error) {
  if (!error) return 'request failed';
  return error.message || String(error);
}

function createWixSecretsClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; run on Node 18+ or provide fetchImpl');
  }
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const authorization = authHeaderValue(options.authToken);
  const siteId = options.siteId || null;

  function headers(extra = {}) {
    return {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...(siteId ? { 'wix-site-id': siteId } : {}),
      ...extra,
    };
  }

  async function request(method, requestPath, body) {
    const response = await fetchImpl(`${baseUrl}${requestPath}`, {
      method,
      headers: headers(),
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      const error = new Error(`Wix Secrets API ${method} ${requestPath} failed with ${response.status}`);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json || {};
  }

  return {
    async listSecretInfo() {
      const json = await request('GET', API_PATH);
      return Array.isArray(json.secrets) ? json.secrets : [];
    },
    async getSecretValue(name) {
      assertSecretName(name);
      try {
        const json = await request('GET', `${API_PATH}/name/${encodeURIComponent(name)}`);
        return { exists: true, value: json.value };
      } catch (error) {
        if (error && error.status === 404) {
          return { exists: false };
        }
        throw error;
      }
    },
    async createSecret({ name, value, description }) {
      assertSecretName(name);
      const json = await request('POST', API_PATH, {
        secret: {
          name,
          value,
          ...(description ? { description: String(description).slice(0, 200) } : {}),
        },
      });
      return { id: json.id || null };
    },
  };
}

async function resolveSourceSecrets(options) {
  const envFilePath = options.envFilePath ? path.resolve(options.envFilePath) : null;
  if (!envFilePath) {
    throw new Error('envFilePath is required');
  }
  const keySpecs = (options.keys || []).map(normalizeKeySpec);
  if (keySpecs.length === 0) {
    throw new Error('at least one key is required');
  }
  const placeholder = options.placeholder || PLACEHOLDER_VALUE;
  const createPlaceholders = options.createPlaceholders !== false;
  const hydrate = options.hydrate !== false;
  const project = options.project || 'migration';
  const client = options.client;
  if (!client) {
    throw new Error('client is required');
  }

  let envValues = {};
  try {
    envValues = await readEnvFile(envFilePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const envStatuses = statEnvValues(envValues, keySpecs.map((spec) => spec.key), { placeholder });
  const updates = {};
  const result = {
    ok: true,
    placeholder,
    dashboardUrl: options.metaSiteId
      ? buildWixDashboardUrl(options.metaSiteId, { path: 'developer-tools/secrets-manager' })
      : null,
    keys: {},
    unresolvedKeys: [],
    hydratedKeys: [],
    localPresentKeys: [],
  };

  for (const spec of keySpecs) {
    const localStatus = envStatuses[spec.key];
    const item = {
      key: spec.key,
      secretName: spec.secretName,
      localStatus,
      status: localStatus === 'present' ? 'local_present' : 'missing',
    };

    if (localStatus === 'present') {
      result.localPresentKeys.push(spec.key);
      result.keys[spec.key] = item;
      continue;
    }

    let secretRead;
    try {
      secretRead = await client.getSecretValue(spec.secretName);
    } catch (error) {
      item.status = 'unreadable';
      item.error = safeJsonError(error);
      result.unresolvedKeys.push(spec.key);
      result.ok = false;
      result.keys[spec.key] = item;
      continue;
    }

    if (secretRead.exists && isUsableSecretValue(secretRead.value, placeholder)) {
      if (hydrate) {
        updates[spec.key] = secretRead.value;
        result.hydratedKeys.push(spec.key);
        item.status = 'hydrated';
      } else {
        item.status = 'secret_present';
      }
      result.keys[spec.key] = item;
      continue;
    }

    if (secretRead.exists) {
      item.status = 'placeholder';
      result.unresolvedKeys.push(spec.key);
      result.keys[spec.key] = item;
      continue;
    }

    if (!createPlaceholders) {
      item.status = 'missing';
      result.unresolvedKeys.push(spec.key);
      result.keys[spec.key] = item;
      continue;
    }

    try {
      await client.createSecret({
        name: spec.secretName,
        value: placeholder,
        description: `RePlatform source credential for ${project}: ${spec.key}`,
      });
      item.status = 'created';
      result.unresolvedKeys.push(spec.key);
    } catch (error) {
      item.status = 'failed';
      item.error = safeJsonError(error);
      result.unresolvedKeys.push(spec.key);
      result.ok = false;
    }
    result.keys[spec.key] = item;
  }

  if (Object.keys(updates).length > 0) {
    await upsertEnvFile(envFilePath, updates);
  }

  result.needsUser = result.unresolvedKeys.length > 0;
  if (result.needsUser) {
    result.instruction = [
      result.dashboardUrl ? `Open ${result.dashboardUrl}` : 'Open the site dashboard Secrets Manager.',
      `Keys: ${result.unresolvedKeys.join(', ')}`,
      'For each key click the 3 dots --> edit --> Retrieve value --> set the real value --> click Change secret',
    ].join('\n');
  }

  return result;
}

module.exports = {
  PLACEHOLDER_VALUE,
  authHeaderValue,
  createWixSecretsClient,
  isUsableSecretValue,
  normalizeKeySpec,
  resolveSourceSecrets,
};
