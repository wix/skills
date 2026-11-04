'use strict';

// What generated import code records for each importBookingsAddOn / importBooking result: the
// attempt-journal status (and crosswalk target), and the cutover operator actions for the
// completion report, which the website handoff carries. Deterministic, so no run decides it.
//
//   const row = bookingsJournalRow('bookings/booking', result, { sourceId });
//   ...append the attempt row (and a crosswalk row when row.targetId and status is imported)...
//   createCompletionReport({ ..., operatorActions: [...own, ...bookingsOperatorActions(entity, rows)] })
//
// An outcome whose write may have landed is never a failure: `unknown-outcome` is
// succeeded_unverified, so recovery reads Wix back instead of re-sending.

const ENTITIES = new Set(['bookings/service-add-on', 'bookings/booking']);
const targetOf = (entity, result) => (entity === 'bookings/booking' ? result.bookingId : result.addOnId) || null;

function failure(entity, result, { sourceId, outcome, code, message }) {
  return {
    sourceId: String(sourceId),
    operation: 'create',
    message,
    outcome,
    targetEntityId: targetOf(entity, result),
    errorCode: code,
    scopeGroupName: null,
    httpStatus: Number.isInteger(result.error?.status) ? result.error.status : null,
  };
}

// One writer result -> { status, targetId, failure? }.
function bookingsJournalRow(entity, result, { sourceId } = {}) {
  if (!ENTITIES.has(entity)) throw new Error(`bookingsJournalRow: unknown entity ${entity}`);
  if (sourceId === undefined || sourceId === null || sourceId === '') throw new Error('bookingsJournalRow needs the source id');
  const targetId = targetOf(entity, result), f = (outcome, code, message) => failure(entity, result, { sourceId, outcome, code, message });
  switch (result?.outcome) {
    case 'written':
    case 'reconciled-existing':
      return { status: 'imported', targetId };
    case 'unknown-outcome':
      return { status: 'succeeded_unverified', targetId: null, failure: f('unresolved', 'unknown-outcome', 'The create may have landed; read Wix back before any re-send.') };
    case 'partially-written':
      // The booking exists and a confirm or cancel step failed, or the add-on exists and placing it
      // in a service's group failed. A re-run resumes it by its key (the add-on by its fields).
      return { status: 'failed_retryable', targetId, failure: f('failed_retryable', result.error?.applicationErrorCode || 'partially-written', entity === 'bookings/booking'
        ? 'The booking exists but a status step failed; re-run to resume it.'
        : 'The add-on exists but placing it in a service group failed; re-run to place it.') };
    case 'target-read-failed':
      return { status: 'failed_retryable', targetId: null, failure: f('failed_retryable', result.error?.applicationErrorCode || 'target-read-failed', 'The lookup before create failed; nothing was written.') };
    case 'reconciliation-ambiguous':
    case 'target-drift':
    case 'read-back-mismatch':
      return { status: 'needs_verification', targetId, failure: f('unresolved', result.outcome, 'Wix holds a record for this source row that the writer could not confirm; a cutover operator decides.') };
    case 'class-session-missing':
      return { status: 'failed_terminal', targetId: null, failure: f('failed_terminal', 'class-session-missing', 'A class-session booking is not imported: no import produces the session.') };
    case 'failed':
      return result.error?.outcomeKnown === false
        ? { status: 'succeeded_unverified', targetId: null, failure: f('unresolved', 'unknown-outcome', 'The create may have landed; read Wix back before any re-send.') }
        : { status: 'failed_terminal', targetId: null, failure: f('failed_terminal', result.error?.applicationErrorCode || result.error?.code || 'failed', 'Wix refused the write.') };
    default:
      throw new Error(`bookingsJournalRow: unknown outcome ${result?.outcome}`);
  }
}

// Operator actions, one per kind, over all results of one entity. `results` are
// { sourceId, result } pairs. Empty when nothing needs a person.
const ACTIONS = {
  'add-on-ungrouped': {
    entity: 'bookings/service-add-on', severity: 'medium',
    action: 'Some add-ons were imported but are not bookable: their service already shows 7 add-ons, the Wix limit. In Business Manager > Bookings > Services, open each listed service and choose which add-ons customers see.',
    deadlineReason: 'Customers cannot pick these extras until they are in a group.',
    resolutionEvidence: 'Each listed service shows the add-ons the merchant chose.',
  },
  'bookings-record-unconfirmed': {
    severity: 'high',
    action: 'Wix holds a record for these source rows that the import could not confirm (a duplicate, a change in the source after import, or a read-back that differs). Compare each listed Wix record with the source in Business Manager, then keep, fix or delete it.',
    deadlineReason: 'A duplicate or stale booking or add-on would show to customers and staff.',
    resolutionEvidence: 'Each listed record matches the source, or was removed.',
  },
  'class-session-booking-not-imported': {
    entity: 'bookings/booking', severity: 'medium',
    action: 'Bookings of class sessions were not imported. In Business Manager > Bookings, create the class session if needed, then add the listed customers to it.',
    deadlineReason: 'These customers expect a place in the class.',
    resolutionEvidence: 'Each listed customer is booked into the class session, or the merchant accepted the loss.',
  },
};
function bookingsOperatorActions(entity, results) {
  if (!ENTITIES.has(entity)) throw new Error(`bookingsOperatorActions: unknown entity ${entity}`);
  const ids = { 'add-on-ungrouped': new Set(), 'bookings-record-unconfirmed': new Set(), 'class-session-booking-not-imported': new Set() };
  for (const { sourceId, result } of results || []) {
    const target = targetOf(entity, result);
    if (entity === 'bookings/service-add-on' && ['written', 'reconciled-existing'].includes(result.outcome) && result.ungroupedServiceIds?.length) for (const serviceId of result.ungroupedServiceIds) ids['add-on-ungrouped'].add(`${target}@${serviceId}`);
    if (['reconciliation-ambiguous', 'target-drift', 'read-back-mismatch'].includes(result.outcome)) for (const id of [target, ...(result.candidateIds || [])].filter(Boolean)) ids['bookings-record-unconfirmed'].add(id);
    if (result.outcome === 'class-session-missing') ids['class-session-booking-not-imported'].add(String(sourceId));
  }
  return Object.entries(ids).filter(([, set]) => set.size).map(([code, set]) => {
    const spec = ACTIONS[code];
    return { code, severity: spec.severity, action: spec.action, deadlineReason: spec.deadlineReason, entity: spec.entity || entity, affectedCount: set.size,
      actionId: `${code}:${entity}`, role: 'cutover-operator', affectedIds: [...set].sort(), resolutionEvidence: spec.resolutionEvidence };
  });
}

module.exports = { bookingsJournalRow, bookingsOperatorActions };
