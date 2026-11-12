'use strict';

// Old-address verification: deterministic HTTP checks that each known old URL reaches its
// intended page. No model call per URL; the caller receives counts and exceptions only, and
// response bodies never leave this module (only a bounded status/location trace is stored).
//
// Stages:
//   preparation      before the DNS switch, against the destination deployment through a
//                    host/SNI connect override. Never satisfies the public check.
//   verified_public  after the DNS switch, against the original public URLs via public DNS.
//                    The only stage that can earn a verified result.

const http = require('node:http');
const https = require('node:https');
const state = require('./url-preservation-state.js');
const planLib = require('./url-redirect-plan.js');

const STAGES = new Set(['preparation', 'verified_public']);
const PERMANENT = new Set([301, 308]);
const TEMPORARY = new Set([302, 303, 307]);
const TRANSIENT_REASONS = new Set(['timeout', 'connection_error', 'server_error', 'dns_unresolved']);
const MAX_BODY_BYTES = 512 * 1024;
const MAX_EXCEPTIONS_RETURNED = 50;

function endpointFor(origin, endpoint) {
  const target = endpoint.mode === 'connect_override'
    ? `override:${endpoint.connectHost}:${endpoint.connectPort || origin.effectivePort}`
    : 'public-dns';
  return `${origin.scheme}://${origin.hostname}:${origin.effectivePort}@${target}`;
}

function checkpointKeyOf({ obligationKey, planDigest, deploymentId, stage, effectiveEndpoint }) {
  return [obligationKey, planDigest, deploymentId, stage, effectiveEndpoint].join('␟');
}

// A checkpoint satisfies only an identical key. A preparation row can never stand in for a
// verified_public check, whatever endpoint it used; the caller's claim is not trusted.
function checkpointSatisfies(row, wanted) {
  if (!row || row.stage !== wanted.stage) return false;
  if (wanted.stage === 'verified_public' && row.stage !== 'verified_public') return false;
  return row.checkpointKey === checkpointKeyOf(wanted);
}

function executionDigestFor(obligation, executionByKey) {
  if (obligation.externalTarget) return planLib.digest([
    obligation.externalTarget, obligation.externalEvidenceDigest, obligation.externalSetup,
  ]);
  const row = obligation.remoteRuleKey ? executionByKey[obligation.remoteRuleKey] : null;
  return planLib.digest(row ? [row.ruleKey, row.disposition, row.to, row.remoteId || null] : null);
}

function classifyError(error) {
  const code = (error && (error.code || error.name)) || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_unresolved';
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS/i.test(code)) return 'certificate_error';
  if (code === 'ETIMEDOUT' || code === 'TimeoutError' || code === 'ESOCKETTIMEDOUT' || code === 'timeout') return 'timeout';
  return 'connection_error';
}

// Default transport: one GET, no redirect following, no credentials, bounded body.
function nodeHttpGet({ url, connect, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      hostname: connect ? connect.host : parsed.hostname,
      port: connect ? connect.port : (parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      path: `${parsed.pathname}${parsed.search}`,
      headers: { Host: parsed.host, 'User-Agent': 'replatform-url-verification/1', Accept: 'text/html,*/*' },
      servername: parsed.hostname,
      timeout: timeoutMs,
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (size < MAX_BODY_BYTES) { chunks.push(chunk); size += chunk.length; }
      });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

function defaultPort(scheme) {
  return scheme === 'https' ? 443 : 80;
}

// Declared origins are identified by scheme, hostname and effective port: a same-host origin
// on another port is a different origin, and an undeclared port is off-site.
function originKeyOfUrl(url) {
  const scheme = url.protocol.slice(0, -1);
  return `${scheme}://${url.hostname}:${url.port ? Number(url.port) : defaultPort(scheme)}`;
}

function originUrlBase(origin) {
  return `${origin.scheme}://${origin.hostname}${origin.effectivePort === defaultPort(origin.scheme) ? '' : `:${origin.effectivePort}`}`;
}

// Query semantics compare as an order-insensitive multiset of decoded name/value pairs.
function querySignature(search) {
  return JSON.stringify([...new URLSearchParams(search || '').entries()].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function checkOne({ obligation, origin, endpoint, originsByKey, httpGet, timeoutMs, maxHops, rateGate }) {
  const start = new URL(`${originUrlBase(origin)}${obligation.path}${obligation.query || ''}`);
  const trace = [];
  if (obligation.disposition === 'external_redirect') {
    const connect = endpoint.mode === 'connect_override'
      ? { host: endpoint.connectHost, port: endpoint.connectPort || origin.effectivePort } : null;
    await rateGate(start.hostname);
    let response;
    try { response = await httpGet({ url: start.href, connect, timeoutMs }); }
    catch (error) { return { result: 'not_verified', reason: classifyError(error), trace: [{ url: start.href, error: classifyError(error) }] }; }
    trace.push({ url: start.href, status: response.status, location: response.location || null });
    if (response.status !== 301) return { result: 'failed', reason: 'external_source_status_mismatch', trace };
    if (!response.location) return { result: 'failed', reason: 'redirect_without_location', trace };
    let actual;
    try { actual = new URL(response.location, start); }
    catch { return { result: 'failed', reason: 'redirect_malformed_location', trace }; }
    if (actual.href !== new URL(obligation.externalTarget).href) {
      return { result: 'failed', reason: 'external_location_mismatch', trace };
    }
    return { result: 'verified_redirect', reason: null, trace };
  }
  let current = start;
  let permanentOnly = true;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const host = current.hostname;
    const hopOrigin = originsByKey.get(originKeyOfUrl(current));
    if (!hopOrigin) return { result: 'failed', reason: 'redirect_off_site', trace };
    const connect = endpoint.mode === 'connect_override'
      ? { host: endpoint.connectHost, port: endpoint.connectPort || hopOrigin.effectivePort }
      : null;
    await rateGate(host);
    let response;
    try {
      response = await httpGet({ url: current.href, connect, timeoutMs });
    } catch (error) {
      trace.push({ url: current.href, error: classifyError(error) });
      return { result: 'not_verified', reason: classifyError(error), trace };
    }
    trace.push({ url: current.href, status: response.status, location: response.location || null });
    if (PERMANENT.has(response.status) || TEMPORARY.has(response.status)) {
      if (TEMPORARY.has(response.status)) permanentOnly = false;
      if (!response.location) return { result: 'failed', reason: 'redirect_without_location', trace };
      let next;
      try {
        next = new URL(response.location, current);
      } catch {
        return { result: 'failed', reason: 'redirect_malformed_location', trace };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return { result: 'failed', reason: 'redirect_non_http', trace };
      if (next.username || next.password) return { result: 'failed', reason: 'redirect_with_credentials', trace };
      current = next;
      continue;
    }
    if (response.status === 404 || response.status === 410) return { result: 'failed', reason: 'not_found', trace };
    if (response.status >= 500) return { result: 'not_verified', reason: 'server_error', trace };
    if (response.status !== 200) return { result: 'failed', reason: `http_${response.status}`, trace };
    const finalPath = planLib.conflictPath(current.pathname.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()));
    if (finalPath !== obligation.expected.conflictPath) return { result: 'failed', reason: 'wrong_final_route', trace };
    const expectedQuery = obligation.expected.query !== undefined ? obligation.expected.query : (obligation.query || '');
    if (querySignature(current.search) !== querySignature(expectedQuery)) return { result: 'failed', reason: 'final_query_mismatch', trace };
    const body = String(response.body || '');
    if (!body.includes(obligation.expected.pageMarker)) return { result: 'failed', reason: 'page_marker_missing', trace };
    if (obligation.fragment) {
      const anchor = escapeRegExp(decodeURIComponent(obligation.fragment.slice(1)));
      if (!new RegExp(`(id|name)=["']${anchor}["']`).test(body)) return { result: 'failed', reason: 'fragment_anchor_missing', trace };
    }
    if (trace.length > 1 && !permanentOnly) return { result: 'failed', reason: 'non_permanent_redirect', trace };
    return { result: trace.length > 1 ? 'verified_redirect' : 'verified_direct', reason: null, trace };
  }
  return { result: 'failed', reason: 'too_many_redirects', trace };
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function verifyUrls(options) {
  const {
    projectDir,
    plan,
    sourceDomains,
    stage,
    endpoint = { mode: 'public' },
    afterDnsSwitch = false,
    httpGet = nodeHttpGet,
    concurrency = 8,
    timeoutMs = 10000,
    retryBudget = 2,
    perHostIntervalMs = 50,
    maxHops = 5,
    runId,
    now = () => new Date().toISOString(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  if (!STAGES.has(stage)) throw new Error(`stage must be one of: ${[...STAGES].join(', ')}`);
  if (stage === 'verified_public' && (!afterDnsSwitch || endpoint.mode !== 'public')) {
    throw new Error('verified_public runs only after the DNS switch, against public DNS for the original URLs');
  }
  if (stage === 'preparation' && endpoint.mode === 'public') {
    throw new Error('preparation checks must target the destination deployment through a connect override; public DNS still reaches the source site');
  }
  if (!plan.websiteBuilt) throw new Error('no final route manifest: verification needs a built destination website');
  const startedAt = Date.now();
  const origins = sourceDomains.origins;
  const originsByKey = new Map(origins.map((o) => [`${o.scheme}://${o.hostname}:${o.effectivePort}`, o]));
  const execution = await state.loadRedirectExecution(projectDir);
  const existing = await state.loadUrlVerification(projectDir);
  const lastByHost = new Map();
  const rateGate = async (host) => {
    const wait = (lastByHost.get(host) || 0) + perHostIntervalMs - Date.now();
    lastByHost.set(host, Math.max(Date.now(), (lastByHost.get(host) || 0) + perHostIntervalMs));
    if (wait > 0) await sleep(wait);
  };

  const inScope = plan.obligations.filter((ob) => ob.disposition === 'direct' || ob.disposition === 'redirect' ||
    (ob.disposition === 'external_redirect' && ob.externalSetup));
  const work = [];
  for (const obligation of inScope) {
    for (const key of obligation.origins) {
      const origin = origins.find((o) => `${o.scheme}://${o.hostname}:${o.effectivePort}` === key);
      if (!origin) continue;
      const effectiveEndpoint = endpointFor(origin, endpoint);
      const wanted = { obligationKey: obligation.obligationKey, planDigest: plan.planDigest, deploymentId: plan.deploymentId, stage, effectiveEndpoint };
      const checkpointKey = checkpointKeyOf(wanted);
      const execDigest = executionDigestFor(obligation, execution.byKey);
      const prior = existing.byCheckpoint[checkpointKey];
      const reusable = checkpointSatisfies(prior, wanted) && prior.executionDigest === execDigest && (
        prior.result === 'verified_direct' || prior.result === 'verified_redirect'
        || (stage === 'verified_public' && prior.result === 'failed'));
      work.push({ obligation, origin, effectiveEndpoint, checkpointKey, execDigest, skip: reusable });
    }
  }

  const summary = { stage, checks: 0, skippedFromCheckpoint: 0, retries: 0, results: { verified_direct: 0, verified_redirect: 0, failed: 0, not_verified: 0 }, durationMs: 0 };
  const exceptions = [];
  await runPool(work, concurrency, async (item) => {
    if (item.skip) { summary.skippedFromCheckpoint += 1; return; }
    let outcome = null;
    // The public pass tests the switched domain only; an origin still serving the source site
    // cannot produce destination proof, so nothing is sent to it.
    if (stage === 'verified_public' && item.origin.cutoverStatus !== 'destination_serving') {
      outcome = { result: 'not_verified', reason: 'origin_not_cut_over', trace: [] };
    }
    for (let attempt = 0; !outcome || (outcome.result === 'not_verified' && TRANSIENT_REASONS.has(outcome.reason) && attempt <= retryBudget); attempt += 1) {
      if (outcome) { summary.retries += 1; await sleep(200 * 2 ** (attempt - 1)); }
      outcome = await checkOne({ obligation: item.obligation, origin: item.origin, endpoint, originsByKey, httpGet, timeoutMs, maxHops, rateGate });
    }
    summary.checks += 1;
    summary.results[outcome.result] += 1;
    const row = {
      schemaVersion: state.SCHEMA_VERSION,
      checkpointKey: item.checkpointKey,
      obligationKey: item.obligation.obligationKey,
      planDigest: plan.planDigest,
      deploymentId: plan.deploymentId,
      executionDigest: item.execDigest,
      stage,
      effectiveEndpoint: item.effectiveEndpoint,
      origin: `${item.origin.scheme}://${item.origin.hostname}:${item.origin.effectivePort}`,
      originalUrl: `${originUrlBase(item.origin)}${item.obligation.path}${item.obligation.query || ''}${item.obligation.fragment || ''}`,
      expected: item.obligation.externalTarget
        ? { externalTarget: item.obligation.externalTarget, setup: item.obligation.externalSetup }
        : { targetEntityType: item.obligation.expected.targetEntityType, targetEntityId: item.obligation.expected.targetEntityId, relativeUrl: item.obligation.expected.relativeUrl },
      result: outcome.result,
      reason: outcome.reason,
      trace: outcome.trace.slice(0, maxHops + 1),
      runId,
      checkedAt: now(),
    };
    await state.appendUrlVerificationRow(projectDir, row);
    if (outcome.result !== 'verified_direct' && outcome.result !== 'verified_redirect') {
      exceptions.push({ obligationKey: row.obligationKey, origin: row.origin, result: row.result, reason: row.reason });
    }
  });
  summary.durationMs = Date.now() - startedAt;
  exceptions.sort((a, b) => `${a.obligationKey}${a.origin}`.localeCompare(`${b.obligationKey}${b.origin}`));
  return {
    summary,
    exceptionCount: exceptions.length,
    exceptions: exceptions.slice(0, MAX_EXCEPTIONS_RETURNED),
    evidence: state.relativeStatePath('urlVerification'),
  };
}

module.exports = {
  STAGES,
  endpointFor,
  checkpointKeyOf,
  checkpointSatisfies,
  executionDigestFor,
  classifyError,
  querySignature,
  nodeHttpGet,
  verifyUrls,
};
