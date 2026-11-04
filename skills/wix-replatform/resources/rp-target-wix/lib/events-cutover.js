'use strict';

// The Events import's cutover items, as structured completion-report
// `operatorActions`. The generated importer collects the ids while it writes and passes this
// function's rows into `createCompletionReport()` input (merge by `code`). Ids only; no titles,
// guest names or emails.

const ACTIONS = Object.freeze({
  draftEventIds: {
    code: 'events_drafts_review', severity: 'low', entity: 'events/event',
    action: 'In Business Manager → Events → Drafts, publish any imported draft event the merchant now wants listed; leave the rest as drafts. These were drafts in the source.',
    deadlineReason: 'At cutover. The events stay unlisted until someone publishes them.',
    resolutionEvidence: 'Each listed event reads back published, or the operator records that it stays a draft.',
  },
  publishedForRsvpEventIds: {
    code: 'events_published_for_rsvps', severity: 'medium', entity: 'events/event',
    action: 'These events were drafts in the source but were published so their RSVPs could be imported (Wix accepts RSVPs only on published events). In Business Manager → Events, review each one; if it should stay hidden, unpublish or hide it (its guest list stays).',
    deadlineReason: 'Before the site is published; they become visible when the site goes live.',
    resolutionEvidence: 'The operator marks each listed event reviewed.',
  },
  reviewChosenFeeTicketIds: {
    code: 'events_ticket_fee_confirm', severity: 'high', entity: 'events/ticket-definition',
    action: 'These paid ticket types got their fee mode or tax from the mapping review, not from the source. In Business Manager → Events, check each event\'s ticket fee setting and tax setting with the merchant.',
    deadlineReason: 'Before the site is published; buyers pay what these settings say.',
    resolutionEvidence: 'The merchant confirms the settings, or the operator records the change made.',
  },
  rsvpOverrideEventIds: {
    code: 'events_rsvp_overrides', severity: 'low', entity: 'events/rsvp',
    action: 'Historical RSVPs were loaded with the event\'s registration rules overridden (closed registration and guest limits). In Business Manager → Events → Guests, review the guest list of each listed event; counts may exceed the event\'s limit.',
    deadlineReason: 'At cutover.',
    resolutionEvidence: 'The operator marks each listed event reviewed.',
  },
});

function eventsOperatorActions(input = {}) {
  const rows = [];
  for (const [field, template] of Object.entries(ACTIONS)) {
    const ids = [...new Set((input[field] || []).map(String))].sort();
    if (!ids.length) continue;
    rows.push({ ...template, actionId: template.code, role: 'cutover-operator', affectedCount: ids.length, affectedIds: ids });
  }
  return rows;
}

module.exports = { eventsOperatorActions, EVENTS_OPERATOR_ACTION_CODES: Object.freeze(Object.values(ACTIONS).map(row => row.code)) };
