'use strict';

// The router's destination gate. It reads the creation receipt before the
// WIX_SITE_ID check (an Editor site's ID is written to config/wix.env before verification
// finishes), and it requires an explicit site type before a fresh new-site creation.
// Returns a route, or null to continue with the router's existing destination checks.
const fs = require('node:fs/promises');
const path = require('node:path');
const { isEditorSiteType, isNewSiteStrategy, readSiteTypeDecision } = require('./orchestration-decisions.js');
const { readReceipt, validateReceipt } = require('./destination.js');

const RESOURCE = 'resources/rp-destination/';

async function recoveryAnswered(projectDir, receipt) {
  const requestId = receipt.recovery && receipt.recovery.requestId;
  if (!requestId || !/^uar_[0-9a-f-]+$/.test(requestId)) return false;
  try {
    const request = JSON.parse(await fs.readFile(path.join(projectDir, 'orchestration', 'user-actions', `${requestId}.json`), 'utf8'));
    return request.status === 'answered';
  } catch {
    return false;
  }
}

async function destinationGate(projectDir, decisions, { targetSiteStrategy, siteIdValue, scaffoldStatus }) {
  const choice = readSiteTypeDecision(decisions);
  const receipt = await readReceipt(projectDir);
  if (receipt) {
    const errors = validateReceipt(receipt);
    if (errors.length) return { ok: false, nextState: 'failed', nextResource: RESOURCE, reason: 'destination_receipt_invalid', errors };
    if (choice && !choice.errors.length && choice.siteType !== receipt.requestedSiteType) {
      return { ok: true, nextState: 'blocked', nextResource: RESOURCE, reason: 'destination_type_conflict', blocking: true, errors: [{ receipt: receipt.requestedSiteType, decision: choice.siteType }] };
    }
    // Headless keeps the wrapper's WIX_SCAFFOLD_STATUS contract unchanged.
    if (!isEditorSiteType(receipt.requestedSiteType)) return null;
    switch (receipt.status) {
      case 'verified':
        if (!siteIdValue) return { ok: true, nextState: 'destination_running', nextResource: RESOURCE, reason: 'destination_binding_pending' };
        if (siteIdValue !== receipt.metaSiteId) return { ok: true, nextState: 'blocked', nextResource: RESOURCE, reason: 'destination_binding_conflict', blocking: true };
        return null;
      case 'in_progress':
      case 'created':
        // The coordinator resumes without a second create (an interrupted attempt becomes ambiguous).
        return { ok: true, nextState: 'destination_running', nextResource: RESOURCE, reason: 'destination_creation_resumable' };
      default:
        if (await recoveryAnswered(projectDir, receipt)) {
          return { ok: true, nextState: 'destination_running', nextResource: RESOURCE, reason: 'destination_recovery_answered' };
        }
        return {
          ok: true,
          nextState: 'blocked',
          nextResource: RESOURCE,
          reason: `destination_${receipt.status}`,
          blocking: true,
          errors: receipt.error ? [{ code: receipt.error.code, requestId: receipt.recovery ? receipt.recovery.requestId : null }] : [],
        };
    }
  }
  // Legacy/confirmed destinations and prior Headless wrapper attempts keep the existing checks:
  // a missing historical choice is never reinterpreted as a new-site request.
  if (siteIdValue || scaffoldStatus !== undefined) return null;
  if (!isNewSiteStrategy(targetSiteStrategy)) return null;
  if (!choice) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: RESOURCE, reason: 'missing_target_site_type' };
  }
  if (choice.errors.length) {
    return { ok: false, nextState: 'failed', nextResource: 'resources/rp-project-intake/', reason: 'invalid_target_site_type', errors: choice.errors };
  }
  return null;
}

// A later resume repeats the readback before setup. The router has no network access,
// so it requires the receipt's last `unpublished` readback to be recent whenever the next step
// would write to a receipt-backed Editor site (setup or import). Otherwise it routes to
// rp-destination, whose coordinator runs one fresh readback (never a create) and either
// re-verifies or blocks with the publication recovery request.
const PUBLICATION_FRESH_MS = 10 * 60_000;
const DOWNSTREAM_STATES = new Set(['executing_setup', 'executing_import']);

async function publicationRecheckGate(projectDir, route, { now = Date.now() } = {}) {
  if (!route || !DOWNSTREAM_STATES.has(route.nextState)) return route;
  let receipt;
  try { receipt = await readReceipt(projectDir); } catch { receipt = null; }
  if (!receipt || receipt.invalid || !isEditorSiteType(receipt.requestedSiteType) || receipt.status !== 'verified') return route;
  const publication = receipt.publication || {};
  const checkedAt = Date.parse(publication.checkedAt);
  const age = now - checkedAt;
  if (publication.state === 'unpublished' && Number.isFinite(checkedAt) && age >= 0 && age <= PUBLICATION_FRESH_MS) return route;
  return {
    ok: true,
    nextState: 'destination_running',
    nextResource: RESOURCE,
    reason: 'destination_publication_recheck',
    deferredState: route.nextState,
  };
}

module.exports = { PUBLICATION_FRESH_MS, destinationGate, publicationRecheckGate };
