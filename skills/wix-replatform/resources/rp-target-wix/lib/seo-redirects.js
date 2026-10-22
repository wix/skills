'use strict';

// Wix SEO Redirects (seo-redirects-service/v1, Developer Preview): request builders and the
// safe, resumable apply loop for exact same-site 301 rules.
//
// List/Bulk Create/read-back and duplicate success without an ID passed a live Wix-user
// API probe. Public serving remains unverified. The 100-item maximum is schema-based,
// not a live stress-test; each outcome is correlated by itemMetadata.originalIndex.
//
// Safety rules encoded here:
//   - Writes use Bulk Create only. Single Create resolves a loop by DELETING the loop-closing
//     rule; Bulk Create fails that item instead. `forceReplace` is never sent.
//   - Writes need an APP or WIX_USER identity with Manage SEO Settings on the site.
//     MEMBER/unknown identities are rejected before recording any write intent.
//   - Every write is preceded by a durable `write_intent` row and followed by List Redirects
//     reconciliation: HTTP 200, a missing result or a success without an id is not proof.
//   - A changed inventory between batches means someone else is editing redirects: stop.

const planLib = require('../../../lib/url-redirect-plan.js');
const state = require('../../../lib/url-preservation-state.js');

const WIXAPIS = 'https://www.wixapis.com';
const BASE = `${WIXAPIS}/seo-redirects-service/v1`;
const BULK_CREATE_MAX = 100;

function buildListRedirectsRequest() {
  return { method: 'GET', url: `${BASE}/redirects`, operation: 'seo.redirects.list', verification: 'unverified' };
}

function assertSafeExactRule(rule, index) {
  const label = `redirects[${index}]`;
  if (!rule || typeof rule.from !== 'string' || typeof rule.to !== 'string') throw new Error(`${label} needs from/to strings`);
  const from = planLib.parseAddress(rule.from);
  const to = planLib.parseAddress(rule.to);
  if (!from.ok || from.external || !to.ok || to.external) throw new Error(`${label} must be a same-site relative rule`);
  if (from.conflictPath === '/') throw new Error(`${label}.from cannot be the site root`);
  if (from.query || from.fragment) throw new Error(`${label}.from cannot carry a query or fragment`);
  if (rule.options || rule.language || rule.forceReplace) throw new Error(`${label} may not pass group, language or replace options`);
}

function buildBulkCreateRedirectsRequest(rules) {
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('bulk create needs at least one redirect');
  if (rules.length > BULK_CREATE_MAX) throw new Error(`bulk create is capped at ${BULK_CREATE_MAX} redirects`);
  rules.forEach(assertSafeExactRule);
  return {
    method: 'POST',
    url: `${BASE}/bulk/redirects/create`,
    operation: 'seo.redirects.bulk-create',
    verification: 'unverified',
    body: { redirects: rules.map((rule) => ({ from: rule.from, to: rule.to })), returnFullEntity: true },
  };
}

function isExactMatch(existing, rule) {
  const ex = planLib.normalizeInventoryRule(existing);
  const to = planLib.parseAddress(rule.to);
  return ex.fromConflict === rule.fromConflict && !ex.scope.groupRedirect && ex.scope.language === '*'
    && !ex.toExternal && ex.toConflict === to.conflictPath && !ex.toQuery;
}

// Per-item outcomes by originalIndex. Missing entries and undetailed failures are unknown.
function correlateBulkCreate(response, inputs) {
  const outcomes = inputs.map(() => ({ reported: null, errorCode: null, id: null }));
  const results = Array.isArray(response && response.results) ? response.results : [];
  const seen = new Set();
  for (const result of results) {
    const meta = (result && result.itemMetadata) || {};
    const index = meta.originalIndex;
    if (!Number.isInteger(index) || index < 0 || index >= inputs.length || seen.has(index)) continue;
    seen.add(index);
    outcomes[index] = {
      reported: meta.success === true ? 'success' : meta.success === false ? 'failure' : null,
      errorCode: (meta.error && meta.error.code) || null,
      id: meta.id || (result.item && result.item.id) || null,
    };
  }
  const undetailed = Number((response && response.bulkActionMetadata && response.bulkActionMetadata.undetailedFailures) || 0);
  return { outcomes, undetailedFailures: undetailed, needsReconciliation: true };
}

function classifyHttpError(error) {
  const status = error && Number.isInteger(error.status) ? error.status : null;
  if (status === 401 || status === 403) return 'permission';
  if (status === 400 || status === 404 || status === 422) return 'schema';
  if (status === 429 || (status && status >= 500) || status === null) return 'transient';
  return 'schema';
}

async function listWithBackoff(client, { retries = 3, sleep, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const response = await client.send(buildListRedirectsRequest());
      if (!response || !Array.isArray(response.redirects)) {
        throw Object.assign(new Error('List Redirects returned no redirects[] array'), { status: 422 });
      }
      return response.redirects;
    } catch (error) {
      const kind = classifyHttpError(error);
      if (kind !== 'transient' || attempt >= retries) throw Object.assign(error, { failureKind: kind });
      attempt += 1;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

function credentialProblem(credential, siteId) {
  if (!credential || !credential.token) return 'missing';
  if (!['APP', 'WIX_USER'].includes(credential.identity)) return 'unsupported_identity';
  if (credential.siteId !== siteId) return 'site_mismatch';
  return null;
}

function action(code, severity, text, deadlineReason, affectedCount, entity = 'url-redirects') {
  return { code, severity, action: text, deadlineReason, entity, affectedCount };
}

function ruleIdentity(rule) {
  return JSON.stringify([rule.id || null, rule.from, rule.to, planLib.apiScopeOf(rule)]);
}

function inventoryDrift(before, after, batch) {
  const beforeIds = new Set(before.map(ruleIdentity));
  const afterIds = new Set(after.map(ruleIdentity));
  const added = after.filter((rule) => !beforeIds.has(ruleIdentity(rule)) && !batch.some((mine) => isExactMatch(rule, mine)));
  const removed = before.filter((rule) => !afterIds.has(ruleIdentity(rule)));
  return { added, removed };
}

// Fold execution rows into the latest per remote key.
function latestByKey(executionRows) {
  const byKey = new Map();
  for (const row of executionRows) byKey.set(row.ruleKey, row);
  return byKey;
}

// Apply the current plan. `readClient` may use user/member authorization; `writeClient`
// must be built from the site's declared APP or WIX_USER credential. Returns counts and operator actions only.
async function applyRedirectPlan(options) {
  const {
    projectDir,
    plan,
    readClient,
    initialInventory = null,
    initialInventoryError = null,
    writeClient = null,
    credential = null,
    launchPlan = null,
    exclusiveEditWindowConfirmed = false,
    runId,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => new Date().toISOString(),
    batchSize = BULK_CREATE_MAX,
  } = options;
  const summary = { installed: 0, alreadyPresent: 0, failed: 0, outcomeUnknown: 0, manualReview: 0, writesAttempted: 0, batches: 0, stopped: null };
  const actions = [];
  const report = () => ({ summary, operatorActions: actions });
  const size = Math.min(batchSize, BULK_CREATE_MAX);

  // Gates that must hold before any write intent exists.
  const credentialIssue = credentialProblem(credential, plan.siteId);
  if (credentialIssue) {
    summary.stopped = 'redirect_write_credential_missing';
    actions.push(action('redirect_write_credential_missing', 'high',
      `Configure a Wix app or Wix user credential with Manage SEO Settings for this destination site (site-member credentials are not supported) (problem: ${credentialIssue}); redirect planning and read-only inventory still work. See execution/url-preservation-report.md.`,
      'old links are not protected until redirects can be written', plan.remoteRules.filter((r) => r.disposition === 'write_candidate').length));
    return report();
  }
  if (!launchPlan || launchPlan.siteId !== plan.siteId || launchPlan.deploymentId !== plan.deploymentId) {
    summary.stopped = 'launch_plan_mismatch';
    actions.push(action('redirect_launch_plan_mismatch', 'high', 'Record a launch plan for this destination site and deployment before applying redirects. See execution/url-preservation-report.md.', 'redirects must target the deployment that will serve the production domain', 1));
    return report();
  }
  if (launchPlan.productionHostname !== plan.productionHostname) {
    summary.stopped = 'production_hostname_mismatch';
    actions.push(action('redirect_production_hostname_mismatch', 'critical', 'The launch plan names a different production hostname than the declared source domains. Changing the production hostname is a separate decision; fix the launch plan.', 'links on the unchanged production domain would not be protected', 1));
    return report();
  }
  if (launchPlan.frontend.redirectSupport !== 'honors_wix_redirects') {
    summary.stopped = 'redirect_frontend_unsupported';
    const affected = plan.remoteRules.filter((r) => r.disposition === 'write_candidate').length;
    actions.push(action('redirect_frontend_unsupported', 'high',
      `The selected frontend (${launchPlan.frontend.model}) is not shown to serve Wix redirect rules (${launchPlan.frontend.redirectSupport}). Give its hosting owner the redirect list in execution/url-preservation-report.md to configure there; no Wix rules were written.`,
      'Wix rules that the frontend ignores would not protect visitors', affected));
    return report();
  }
  if (!exclusiveEditWindowConfirmed) {
    summary.stopped = 'redirect_edit_window_required';
    actions.push(action('redirect_edit_window_required', 'medium', 'Confirm that nobody else edits redirects on the destination site during apply (exclusive edit window), or hand the rule list over for manual entry. See execution/url-preservation-report.md.', 'the redirect service has no compare-and-swap protection against concurrent edits', 1));
    return report();
  }

  const executionFile = await state.loadRedirectExecution(projectDir);
  let latest = latestByKey(executionFile.rows);

  let inventory;
  try {
    if (initialInventoryError) throw initialInventoryError;
    inventory = initialInventory || await listWithBackoff(readClient, { sleep });
  } catch (error) {
    summary.stopped = `inventory_${error.failureKind || 'failed'}`;
    actions.push(action('redirect_inventory_unreadable', 'high', 'Existing redirects on the destination site could not be listed; nothing was written. Check the read credential and retry apply.', 'writing without an inventory could replace or delete existing rules', 1));
    return report();
  }

  const append = async (rule, disposition, extra = {}) => {
    const row = {
      schemaVersion: state.SCHEMA_VERSION,
      runId,
      planDigest: plan.planDigest,
      deploymentId: plan.deploymentId,
      siteId: plan.siteId,
      ruleKey: rule.ruleKey,
      from: rule.from,
      to: rule.to || '',
      origins: rule.origins || [],
      obligationKeys: rule.obligationKeys || [],
      disposition,
      reasonCodes: extra.reasonCodes || [],
      recordedAt: now(),
      ...(extra.inventoryDigest ? { inventoryDigest: extra.inventoryDigest } : {}),
      ...(extra.remoteId ? { remoteId: extra.remoteId } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    };
    await state.appendRedirectExecutionRow(projectDir, row);
    latest.set(rule.ruleKey, row);
    return row;
  };

  // Recovery: an intent or unknown outcome from an earlier run is resolved by exact semantics
  // against the live inventory, never by a blind retry.
  for (const row of latest.values()) {
    if (row.disposition !== 'write_intent' && row.disposition !== 'outcome_unknown') continue;
    const rule = { ruleKey: row.ruleKey, from: row.from, to: row.to, origins: row.origins, obligationKeys: row.obligationKeys, fromConflict: planLib.parseAddress(row.from).conflictPath };
    const match = inventory.find((existing) => isExactMatch(existing, rule));
    if (match) await append(rule, 'installed', { remoteId: match.id || undefined, reasonCodes: ['reconciled_after_interruption'] });
    else await append(rule, 'failed', { reasonCodes: ['confirmed_absent_after_interruption'] });
  }

  const preflight = planLib.preflightAgainstInventory(plan.remoteRules, inventory, plan.siteId);
  const candidates = [];
  for (const rule of preflight.rules) {
    if (rule.disposition === 'already_present') {
      const prior = latest.get(rule.ruleKey);
      if (!prior || !['installed', 'already_present'].includes(prior.disposition)) {
        await append(rule, 'already_present', { remoteId: rule.remoteId || undefined });
      }
      summary.alreadyPresent += 1;
    } else if (rule.disposition === 'manual_review') {
      const prior = latest.get(rule.ruleKey);
      if (!prior || prior.disposition !== 'manual_review' || JSON.stringify(prior.reasonCodes) !== JSON.stringify(rule.reasonCodes)) {
        await append(rule, 'manual_review', { reasonCodes: rule.reasonCodes });
      }
      summary.manualReview += 1;
    } else if (rule.disposition === 'write_candidate') {
      candidates.push(rule);
    }
  }

  let expectedDigest = preflight.inventoryDigest;
  for (let offset = 0; offset < candidates.length; offset += size) {
    const batch = candidates.slice(offset, offset + size);
    if (offset > 0) {
      try {
        inventory = await listWithBackoff(readClient, { sleep });
      } catch (error) {
        summary.stopped = `inventory_${error.failureKind || 'failed'}`;
        break;
      }
      if (planLib.inventoryDigest(inventory) !== expectedDigest) {
        summary.stopped = 'concurrent_redirect_change';
        actions.push(action('redirect_concurrent_change', 'high', 'Redirects on the destination site changed while apply was running; it stopped before the next batch. Re-run plan and apply inside an exclusive edit window.', 'another editor could have created conflicting rules', candidates.length - offset));
        break;
      }
    }
    for (const rule of batch) await append(rule, 'write_intent', { inventoryDigest: expectedDigest });
    summary.batches += 1;
    summary.writesAttempted += batch.length;
    let response = null;
    let sendError = null;
    try {
      response = await writeClient.send(buildBulkCreateRedirectsRequest(batch.map((rule) => ({ from: rule.from, to: rule.to }))));
    } catch (error) {
      sendError = error;
    }
    if (sendError && classifyHttpError(sendError) !== 'transient') {
      const kind = classifyHttpError(sendError);
      for (const rule of batch) await append(rule, 'failed', { reasonCodes: [`write_${kind}_error`], error: { status: sendError.status || null, code: kind } });
      summary.failed += batch.length;
      summary.stopped = kind === 'permission' ? 'redirect_permission_denied' : 'redirect_request_rejected';
      actions.push(action(summary.stopped, 'high', kind === 'permission'
        ? 'The destination site rejected the redirect write credential. Check that the app is installed on this site with Manage SEO Settings, then re-run apply.'
        : 'The redirect service rejected the request shape. Re-check the current API schema before retrying.', 'no further redirects were written', candidates.length - offset));
      break;
    }
    const correlated = response ? correlateBulkCreate(response, batch) : null;
    let after;
    try {
      after = await listWithBackoff(readClient, { sleep });
    } catch {
      for (const rule of batch) await append(rule, 'outcome_unknown', { reasonCodes: ['reconciliation_list_failed'] });
      summary.outcomeUnknown += batch.length;
      summary.stopped = 'reconciliation_unavailable';
      actions.push(action('redirect_outcome_unknown', 'high', 'Redirect writes were sent but could not be confirmed. Re-run apply to reconcile them against the site before anything else changes redirects.', 'an unconfirmed write may or may not protect the old link', batch.length));
      break;
    }
    batch.forEach((rule, index) => {
      rule.outcome = correlated ? correlated.outcomes[index] : null;
    });
    for (const rule of batch) {
      const match = after.find((existing) => isExactMatch(existing, rule));
      if (match) {
        await append(rule, 'installed', { remoteId: match.id || undefined });
        summary.installed += 1;
      } else {
        const code = (rule.outcome && rule.outcome.errorCode) || (sendError ? 'transient_send_error' : 'absent_after_write');
        await append(rule, 'failed', { reasonCodes: ['confirmed_absent_after_write'], error: { code } });
        summary.failed += 1;
      }
    }
    // Our own confirmed writes are the only expected change. Any other new rule, or an
    // existing rule that disappeared (for example a loop-closing deletion), means the site
    // changed underneath us: stop before the next batch.
    const drift = inventoryDrift(inventory, after, batch);
    if (drift.added.length || drift.removed.length) {
      summary.stopped = 'concurrent_redirect_change';
      actions.push(action('redirect_concurrent_change', drift.removed.length ? 'critical' : 'high',
        `Redirects on the destination site changed during apply (${drift.added.length} unexpected new, ${drift.removed.length} missing existing rule(s)); it stopped. Review the site's redirects, then re-run plan and apply inside an exclusive edit window.`,
        'another editor or a service-side deletion could have changed existing rules', drift.added.length + drift.removed.length));
      break;
    }
    inventory = after;
    expectedDigest = planLib.inventoryDigest(after);
    if (sendError) {
      summary.stopped = 'transient_write_error';
      break;
    }
  }
  return report();
}

module.exports = {
  BASE,
  BULK_CREATE_MAX,
  buildListRedirectsRequest,
  buildBulkCreateRedirectsRequest,
  correlateBulkCreate,
  classifyHttpError,
  listWithBackoff,
  isExactMatch,
  credentialProblem,
  applyRedirectPlan,
};
