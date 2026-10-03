'use strict';

// A provenance stamp for invoice-preservation approvals (specs 0124, 0129).
//
// The writer that imports a third-party invoice document relies on `approval.merchantOptedIn`,
// and that field is a plain boolean on a plain object. Review demonstrated the obvious consequence:
// a caller could hand-build `{ documentUrl, action: 'offer-preservation', merchantOptedIn: true }`
// and import a merchant's tax documents out of their provider's archive on nobody's authority --
// the exact counterfeit-approval path the planner/writer split was supposed to close.
//
// So the planner STAMPS what it approves, and the writer believes an opt-in only when the stamp
// verifies. The stamp is a hash over the fields the decision rests on, with a module constant, so
// it survives the plan being written to disk and read back by another process. It is not a secret
// and does not pretend to be: anyone who reads this file can forge it. What it prevents is the
// realistic failure -- an approval assembled by hand, or by reaching into the plan's `refused`
// list -- rather than a determined adversary with the source in front of them.

const crypto = require('node:crypto');

const STAMP_VERSION = 'rp-preservation-approval:v2';

// JSON-encoded (no delimiter to inject) over the URL, the action, the opt-in AND the source order
// the approval was issued for. Review demonstrated an approval for order A re-bound to order B by
// editing `orderId` after stamping, with the stamp still verifying: the order is part of what the
// planner decided, so it is part of what the stamp covers.
function stampInput(approval) {
  const text = (value) => (value === undefined || value === null ? '' : String(value));
  return JSON.stringify([
    STAMP_VERSION,
    text(approval.documentUrl),
    text(approval.action),
    approval.merchantOptedIn === true ? 'opted-in' : 'not-opted-in',
    text(approval.orderId),
  ]);
}

function computeApprovalStamp(approval) {
  return crypto.createHash('sha256').update(stampInput(approval)).digest('hex');
}

// Returns a COPY carrying the stamp; the planner's approvals go through this.
function stampApproval(approval) {
  if (!approval || typeof approval !== 'object') throw new Error('stampApproval needs an approval object');
  return { ...approval, approvalStamp: computeApprovalStamp(approval) };
}

// True only when the stamp is present and matches the fields it was computed over. Changing the
// URL, the action, the opt-in or the order after stamping invalidates it.
function verifyApprovalStamp(approval) {
  if (!approval || typeof approval !== 'object' || typeof approval.approvalStamp !== 'string') return false;
  return approval.approvalStamp === computeApprovalStamp(approval);
}

module.exports = { STAMP_VERSION, computeApprovalStamp, stampApproval, verifyApprovalStamp };
