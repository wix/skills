'use strict';

// Every outcome and finding code the payments path can produce, in one frozen place.
//
// This exists because of a specific repeated failure: a writer gained an outcome, the report never
// gained a line for it, and a run could lose work while the approval read clean. It happened four
// times. The first fix was a hand-maintained list, which drifted. The second was a test that
// SCRAPED the writer source for `outcome: 'literal'`, which missed `invoice-number-only` because
// that one is produced by a ternary — a green test and a silently unreportable outcome, which is
// worse than the list it replaced.
//
// So: the codes live here, both sides import them, and neither can add one the other has not seen.
// A registry cannot be out of date with itself.

// Mutually exclusive per-order payment outcomes. Their sum must equal the discovered population,
// so a new reason belongs HERE rather than folded into an existing bucket.
const PAYMENT_OUTCOMES = Object.freeze([
  'payment-written',
  'payment-reconciled-existing',
  'payment-not-written-no-amount',
  'payment-not-written-no-paid-date',
  'payment-not-written-multi-payment',
  'payment-not-written-currency-mismatch',
  'payment-reconciliation-ambiguous',
  'payment-target-read-failed',
  'payment-failed',
]);

// Outcomes a writer returns that are NOT the per-order payment partition: refund results, invoice
// results, and internal bookkeeping. Everything a writer can hand back must appear in one of the
// three lists, or the report has nowhere to put it.
const WRITER_OUTCOMES = Object.freeze([
  'refund-written',
  'refund-reconciled-existing',
  'refund-without-payment',
  'refund-still-settling',
  'invoice-preserved',
  'invoice-already-preserved',
  'invoice-number-only',
  'invoice-none-found',
  'invoice-import-failed',
  'invoice-import-not-ready',
  'invoice-import-read-failed',
  // The Media file is READY but the order patch failed; the file id rides back as
  // pendingMediaFileId so the resume does not import a second copy.
  'invoice-fields-write-failed',
  'invoice-fields-not-provisioned',
  'invoice-preservation-not-approved',
  'invoice-preservation-declined',
  'invoice-document-url-unsafe',
  // The order-history composite's own outcomes. The ORDER stage has four; a stage that threw after
  // the order existed is a named partial-failure outcome rather than an exception, so a resumed
  // run reconciles the order and retries only what failed.
  'order-imported',
  'order-already-imported',
  'order-import-failed',
  'order-target-read-failed',
  'refund-failed',
  'invoice-failed',
  // The buyer stage -- which member, if any, an imported order was attributed to.
  // These PARTITION the order population (see BUYER_OUTCOMES); `buyer-not-resolved` is the
  // composite's answer when no buyer was supplied.
  'buyer-member-linked',
  'buyer-guest',
  'buyer-contact-only',
  'buyer-member-not-imported',
  'buyer-member-email-mismatch',
  'buyer-not-resolved',
  // Internal: a target read that carried no mapped payment, and the pre-create verdict.
  'target-read',
  'create',
]);

// Nested findings — attached to a result rather than returned as its outcome. They count too: an
// over-length link is a loss the merchant should see even though the document was preserved.
const FINDING_CODES = Object.freeze([
  'payment-status-conflict',
  'paid-date-disagreement',
  'paid-date-timezone-assumed',
  'paid-date-unparseable',
  'reference-without-paid-date',
  'no-transaction-reference',
  'ambiguous-transaction-reference',
  'incompatible-gateway-metadata',
  'unverified-gateway-key',
  'reference-over-length',
  'method-name-over-length',
  'card-display-over-length',
  'unclassified-method',
  'unmapped-gateway-family',
  'refund-weak-signal',
  'refund-date-not-preserved',
  'refund-line-detail-not-preserved',
  'invoice-link-over-length',
  'saved-cards-not-transferred',
  'redacted-source-values',
  // Order-history composite: the order's id came from a crosswalk row rather than being derived from the source
  // id -- an order imported before deterministic ids, or by another tool. Counted so a store
  // where every row says this is visibly a pre-0129 import rather than a derivation bug.
  'order-id-from-crosswalk',
  // Order-history composite: Import Order returned an id other than the one supplied. The target's id is adopted
  // and persisted so re-runs converge; the finding says the identity model did not hold here.
  'order-id-not-derived',
  // Order-history composite: a crosswalk row pointed at an order the target no longer has (a cleared migration),
  // so the order was imported again under the derived id and the row replaced.
  'order-reimported-after-deletion',
  // Order-history composite: a crosswalk row pointed at a missing order while the DERIVED-id order exists; the
  // existing order was adopted and the row replaced, nothing imported.
  'order-crosswalk-row-stale',
  // Order-history composite: a remembered Media file came from a different source URL and was not resumed.
  'invoice-pending-file-superseded',
  // Buyer stage: crosswalk values that could not be used as ids.
  'buyer-member-id-not-guid',
  'buyer-contact-id-not-guid',
]);

// Mutually exclusive per-order buyer outcomes. When a report carries any of them, they
// must sum to the order population, like the payment partition.
const BUYER_OUTCOMES = Object.freeze([
  'buyer-member-linked',
  'buyer-guest',
  'buyer-contact-only',
  'buyer-member-not-imported',
  'buyer-member-email-mismatch',
  'buyer-not-resolved',
]);

// Actions the invoice preservation plan assigns per document. They are not outcomes, but they
// travel the same chain -- plan action becomes the writer's approval -- so registering them keeps
// producer and consumer on one vocabulary rather than two that happen to agree.
const PLAN_ACTIONS = Object.freeze([
  'preserve',
  'offer-preservation',
  'reference-only',
  'refused',
]);

// Causes attached to a partial-failure outcome (`errors.<stage>.cause`) by the order-history composite.
// Not outcomes and not counted, but handed back to callers, so they are registered here rather than
// living as stray literals the scan cannot account for.
const CAUSE_CODES = Object.freeze([
  'order-not-imported',
  'add-payment-returned-no-id',
]);

// What the report must carry a line for: every writer outcome that is not internal bookkeeping,
// plus every nested finding. Zero-valued lines are emitted, so absence of a line is a defect.
const INTERNAL_ONLY = Object.freeze(['target-read', 'create']);
const REPORTABLE = Object.freeze([
  ...WRITER_OUTCOMES.filter((code) => !INTERNAL_ONLY.includes(code)),
  ...FINDING_CODES,
]);

module.exports = {
  PAYMENT_OUTCOMES,
  BUYER_OUTCOMES,
  PLAN_ACTIONS,
  CAUSE_CODES,
  WRITER_OUTCOMES,
  FINDING_CODES,
  INTERNAL_ONLY,
  REPORTABLE,
};
