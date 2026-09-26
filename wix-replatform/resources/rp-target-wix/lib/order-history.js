'use strict';

// An imported order's history as ONE composite write.
//
// Four writes with an ordering constraint, a shared identity, two inputs that come from neither
// the source nor the mapping plan, and one piece of state that must outlive a crash. The first
// caller to assemble that by hand -- with the whole spec in context -- made four mistakes in an
// afternoon, and two of them were silent: a mis-named gate parameter that reported a plausible
// zero, and a missing order crosswalk that would have duplicated the store. The writers were
// right every time. So the SEQUENCE lives here, and a caller supplies facts: a mapped order body
// and the source's evidence. No ordering, no reconciliation, no gate invocation, no state.
//
// THE ORDER WRITE'S IDENTITY. LIVE-VERIFIED 2026-09-05 against a disposable site (24 probes):
// Import Order ACCEPTS a
// caller-supplied `id` it has never seen and keeps it; a re-send with the same id fully replaces
// the order body; payments and extendedFields attached to the order SURVIVE the replace; a
// non-GUID id is refused with a 400. So the order id is DERIVED here from the source site and
// the source order id, which makes the order write idempotent on the target's own terms: a run
// that lost its crosswalk asks the target whether the derived id exists, and finds it. The
// crosswalk is still written -- before anything else -- but it is an accelerator and a report
// input, not the only thing standing between a crash and a duplicated store.
//
// What the probe ALSO showed, and why an existing order is never re-sent: a different order body
// with an existing id replaces it silently, and nothing distinguishes "replace mine" from
// "clobber a merchant's edits". So an order that already exists is RECONCILED (left alone) and
// its history continued, never re-imported. Search Orders is not used as an existence check: it
// read a stale number within a second of a change, and an id read is exact.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const w = require('./wix-writers.js');
const paymentMapping = require('./order-payment-mapping.js');
const localState = require('../../../lib/local-state.js');
const approvalStamp = require('../../../lib/preservation-approval-stamp.js');
const orderBuyer = require('./order-buyer.js');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_OUTCOMES = Object.freeze({
  IMPORTED: 'order-imported',
  ALREADY_IMPORTED: 'order-already-imported',
  IMPORT_FAILED: 'order-import-failed',
  TARGET_READ_FAILED: 'order-target-read-failed',
});

// The evidence contract. A key outside this list is REFUSED, not ignored: an ignored key is how
// `sourceAmount` for `amount` reported every order in a live store as never paid, with no reason.
const EVIDENCE_KEYS = Object.freeze([
  'amount', 'paidDate', 'altPaidDate', 'currency', 'status', 'distinctAmountCount', 'utcOffsetMinutes',
  'methodName', 'providerTransactionId', 'offlinePayment', 'cardDisplay',
  'refunds', 'invoice',
]);
const REFUND_KEYS = Object.freeze(['sourceId', 'amount', 'reason']);
const INVOICE_KEYS = Object.freeze(['approval', 'sourceUrl', 'invoiceNumber', 'pendingMediaFileId']);
// Names a caller is likely to reach for, and where each actually goes.
const MISNAMED = Object.freeze({
  sourceAmount: 'amount', total: 'amount', orderTotal: 'amount',
  sourcePaidDate: 'paidDate', datePaid: 'paidDate', date_paid: 'paidDate', date_paid_gmt: 'paidDate', paid: 'paidDate',
  sourceCurrency: 'currency',
  targetCurrency: 'nothing here -- the target currency is read from order.currency',
  transactionId: 'providerTransactionId', transaction_id: 'providerTransactionId', reference: 'providerTransactionId',
  method: 'methodName', paymentMethod: 'methodName', payment_method: 'methodName', payment_method_title: 'methodName',
  sourceStatus: 'status',
  refund: 'refunds (an array)', invoices: 'invoice (one document per order)',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(object, allowed, label) {
  if (!isPlainObject(object)) throw new Error(`${label} must be an object, got ${JSON.stringify(object)}`);
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  const hints = unknown.map((key) => (MISNAMED[key] ? `${key} (this contract calls it ${MISNAMED[key]})` : key));
  throw new Error(
    `${label} carries keys this contract does not read: ${hints.join(', ')}. Accepted: ${allowed.join(', ')}. `
    + 'Unknown keys are refused rather than ignored, because an ignored key reads exactly like a source that evidences nothing.',
  );
}

// Known keys with malformed VALUES are as silent as unknown keys: `offlinePayment: "false"` was
// dropped rather than read, a scalar `cardDisplay` lost the card evidence, and
// `distinctAmountCount: "unknown"` became NaN, which is "not more than one", which let a
// multi-payment order through the gate. Each is refused with the key and the value it got.
const EVIDENCE_TYPES = Object.freeze({
  amount: (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
  paidDate: (v) => typeof v === 'string',
  altPaidDate: (v) => typeof v === 'string',
  currency: (v) => typeof v === 'string',
  status: (v) => typeof v === 'string',
  distinctAmountCount: (v) => Number.isInteger(v) && v >= 1,
  // UTC-14 to UTC+14 is every offset that exists; 999999 accepted here moved a payment two years.
  utcOffsetMinutes: (v) => Number.isInteger(v) && v >= -840 && v <= 840,
  methodName: (v) => typeof v === 'string',
  providerTransactionId: (v) => typeof v === 'string',
  offlinePayment: (v) => typeof v === 'boolean',
  cardDisplay: (v) => isPlainObject(v)
    && Object.keys(v).every((k) => k === 'lastFourDigits' || k === 'brand')
    && Object.values(v).every((x) => x === null || x === undefined || typeof x === 'string'),
});
const EVIDENCE_TYPE_HINTS = Object.freeze({
  amount: 'a decimal string or finite number',
  paidDate: 'an ISO date-time string', altPaidDate: 'an ISO date-time string',
  currency: 'an ISO 4217 code string', status: 'a string',
  distinctAmountCount: 'a positive integer', utcOffsetMinutes: 'an integer between -840 and 840',
  methodName: 'a string', providerTransactionId: 'a string',
  offlinePayment: 'a real boolean (not the string "false")',
  cardDisplay: 'an object { lastFourDigits?, brand? } of strings',
});

function assertEvidence(evidence, { sourceId = null } = {}) {
  assertKeys(evidence, EVIDENCE_KEYS, 'evidence');
  // Internal: the source id the approval must name. Not a contract key -- set on a shallow copy.
  evidence = { ...evidence, __sourceId: sourceId };
  for (const [key, accepts] of Object.entries(EVIDENCE_TYPES)) {
    const value = evidence[key];
    if (value === undefined || value === null) continue;
    if (!accepts(value)) {
      throw new Error(`evidence.${key} must be ${EVIDENCE_TYPE_HINTS[key]}, got ${JSON.stringify(value)}`);
    }
  }
  if (evidence.refunds !== undefined) {
    if (!Array.isArray(evidence.refunds)) throw new Error('evidence.refunds must be an array (one entry per source refund)');
    evidence.refunds.forEach((refund, index) => {
      assertKeys(refund, REFUND_KEYS, `evidence.refunds[${index}]`);
      if (refund.sourceId === undefined || refund.sourceId === null || String(refund.sourceId).trim() === '') {
        throw new Error(`evidence.refunds[${index}] needs a sourceId; occurrence numbers are assigned by it and a re-run recognizes its own refunds through it`);
      }
      // A refund with no positive amount would reach Refund Payments as `amount: "undefined"` --
      // after the payment create it hangs off. Refused here, before any target call.
      const amount = paymentMapping.canonicalizeDecimal(refund.amount);
      if (amount === null || !(Number(amount) > 0)) {
        throw new Error(`evidence.refunds[${index}] needs a positive amount, got ${JSON.stringify(refund.amount)}`);
      }
    });
  }
  if (evidence.invoice !== undefined && evidence.invoice !== null) {
    const invoice = evidence.invoice;
    assertKeys(invoice, INVOICE_KEYS, 'evidence.invoice');
    // The approval must be the PLANNER's. The writer only insists on the stamp where an opt-in is
    // relied on; this composite insists everywhere, because a hand-built reference-only approval
    // with an object for a number wrote "[object Object]" onto an order in review. The plan is the
    // one producer, and it stamps everything it issues.
    if (!isPlainObject(invoice.approval) || !approvalStamp.verifyApprovalStamp(invoice.approval)) {
      throw new Error('evidence.invoice.approval must be an approval issued by resolvePreservationPlan() (it carries the plan\'s stamp); pass the plan\'s object, do not rebuild it');
    }
    // The planner's approvals name their order, and the stamp covers that name. One handed over
    // for a different source order would preserve somebody else's document onto this one (review
    // demonstrated it), and one with the order DELETED after stamping would fit any order (review
    // demonstrated that too) -- so the order is required, not merely compared when present.
    if (invoice.approval.orderId === undefined || invoice.approval.orderId === null || String(invoice.approval.orderId).trim() === '') {
      throw new Error('evidence.invoice.approval names no source order (orderId); resolvePreservationPlan() issues approvals per order, and one without an order could be handed to any');
    }
    if (String(invoice.approval.orderId) !== String(evidence.__sourceId)) {
      throw new Error(`evidence.invoice.approval is for source order ${invoice.approval.orderId}, not ${evidence.__sourceId}`);
    }
    const optional = (key, accepts, hint) => {
      const v = invoice[key];
      if (v === undefined || v === null) return;
      if (!accepts(v)) throw new Error(`evidence.invoice.${key} must be ${hint}, got ${JSON.stringify(v)}`);
    };
    optional('sourceUrl', (v) => typeof v === 'string', 'a URL string');
    optional('invoiceNumber', (v) => typeof v === 'string' || typeof v === 'number', 'a string or number');
    optional('pendingMediaFileId', (v) => typeof v === 'string' && v.trim() !== '', 'a Media file id string');
  }
}

// A stable GUID for a source order on this target. Version-5 style: a SHA-1 over a namespaced
// name with the version and variant bits set, which is what Import Order accepted live. The
// source SITE is part of the name so two stores importing "order 1042" into one Wix site cannot
// collide -- and so a migration re-run from the same store converges on the same order.
// `shop.example`, `https://shop.example/`, `SHOP.EXAMPLE:443` and `shop.example/wp` are one site.
// Four spellings deriving four ids would re-import a store the day a config string gained a
// scheme, so the host is normalized to its bare lowercase hostname (a non-default port is kept).
function normalizeSourceSiteHost(sourceSiteHost) {
  let text = String(sourceSiteHost === undefined || sourceSiteHost === null ? '' : sourceSiteHost).trim().toLowerCase();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch (error) { return ''; }
  return url.port && url.port !== '443' ? `${url.hostname}:${url.port}` : url.hostname;
}

function deriveImportedOrderId({ sourceSiteHost, sourceId } = {}) {
  const host = normalizeSourceSiteHost(sourceSiteHost);
  const id = sourceId === undefined || sourceId === null ? '' : String(sourceId).trim();
  if (!host) throw new Error('deriveImportedOrderId needs sourceSiteHost (a hostname, or a URL it can be read from): the id is namespaced by the source site');
  if (!id) throw new Error('deriveImportedOrderId needs the source order id');
  const hash = crypto.createHash('sha1').update(`replatform:ecom:order:${host}:${id}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Same rule as rp-source-wordpress's assignRefundOccurrences, kept target-side so this module does
// not depend on a source adapter: two source refunds of equal amount on one order are the first
// and second OCCURRENCE of that amount, ordered by source id, and reconcile as such. Pass ALL of an
// order's refunds in one call -- occurrences are relative to the list.
function withOccurrences(refunds) {
  const seen = new Map();
  return [...refunds]
    .sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)))
    .map((refund) => {
      const key = paymentMapping.canonicalizeDecimal(refund.amount) || String(refund.amount);
      const occurrence = (seen.get(key) || 0) + 1;
      seen.set(key, occurrence);
      return { ...refund, sourceOccurrence: occurrence };
    });
}

function describeError(error) {
  return {
    message: String((error && error.message) || error).slice(0, 300),
    ...(error && error.status ? { status: error.status } : {}),
    ...(error && error.applicationErrorCode ? { applicationErrorCode: error.applicationErrorCode } : {}),
  };
}

function assertCrosswalk(crosswalk) {
  const has = (name) => crosswalk && typeof crosswalk[name] === 'function';
  if (!has('get') || !has('set') || !has('getInvoiceFile') || !has('setInvoiceFile')) {
    throw new Error(
      'importOrderHistory needs a persisted crosswalk with get(sourceId), set(sourceId, orderId), '
      + 'getInvoiceFile(sourceId) and setInvoiceFile(sourceId, fileId). It is not optional: a run that '
      + 'forgets it re-imports the store, and one that forgets the invoice file imports a second copy of a '
      + 'tax document. createProjectOrderCrosswalk({ projectDir }) provides all four over state/crosswalk/.',
    );
  }
}

// Fill every remaining stage with a named outcome once the order stage has failed. Nothing else
// is attempted: with no order there is nothing to attach a payment or a document to, and a payment
// that was never attempted because of an import failure is a FAILURE, not an ineligibility.
function failRemaining(outcomes, errors, { gate, refunds, evidence, cause }) {
  outcomes.payment = gate.eligible ? 'payment-failed' : gate.outcome;
  if (gate.eligible) errors.payment = { cause };
  outcomes.refunds = refunds.map((refund) => ({
    sourceId: refund.sourceId,
    sourceOccurrence: refund.sourceOccurrence,
    outcome: gate.eligible ? 'refund-failed' : 'refund-without-payment',
    ...(gate.eligible ? { error: { cause } } : {}),
  }));
  outcomes.invoice = evidence.invoice ? 'invoice-failed' : 'invoice-none-found';
  if (evidence.invoice) errors.invoice = { cause };
}

// The composite. Returns outcomes; throws only for CALLER errors (a malformed contract), never for
// a target failure -- each stage's failure is a named outcome so a resumed run reconciles what
// landed and retries only what did not.
async function importOrderHistory(wix, {
  order,
  sourceId,
  sourceSiteHost,
  evidence,
  crosswalk,
  setupVerification = null,
  pacer = null,
  safeModeOptions = undefined,
  // The buyer, from resolveOrderBuyer -- stamped, so a hand-built memberId cannot reach
  // the order. Optional: an order with no buyer resolution imports with whatever contactId the
  // mapped body already carries, and never a memberId.
  buyer = null,
} = {}) {
  if (!wix || typeof wix.send !== 'function') throw new Error('importOrderHistory needs a Wix client');
  const findings_pre = [];
  if (!isPlainObject(order)) throw new Error('importOrderHistory needs the mapped target order body as `order`');
  assertCrosswalk(crosswalk);
  assertEvidence(evidence, { sourceId });
  const derivedId = deriveImportedOrderId({ sourceSiteHost, sourceId });
  if (order.id !== undefined && order.id !== derivedId) {
    throw new Error(`order.id is not the caller's to choose: got ${order.id}, this order derives to ${derivedId}. Omit it.`);
  }
  // buyerInfo.memberId is what member-facing reads authorize on, and Import Order stores any GUID
  // unvalidated (verified live 2026-09-05). So it is never the caller's to set on the body: it comes
  // through `buyer`, corroborated and stamped by resolveOrderBuyer, or not at all.
  orderBuyer.assertBodyBuyerInfo(order);
  // No buyer resolution is itself a counted outcome, so the buyer stage partitions the order
  // population like the payment stage does.
  let buyerOutcome = 'buyer-not-resolved';
  if (buyer !== null && buyer !== undefined) {
    if (!orderBuyer.verifyBuyerStamp(buyer)) throw new Error('`buyer` must be the unchanged result of resolveOrderBuyer (its stamp did not verify)');
    // The resolver corroborated the member against ONE order's billing email, and the stamp covers
    // that email. The BODY's email must be the same one: a result resolved for jane@ handed over
    // beside a body carrying victim@ would attribute the victim's order and invoice to Jane, with
    // the stamp verifying (review demonstrated it). Bound for every outcome -- a resolution made for
    // a different order is wrong whatever it decided -- and a linked result requires the body to
    // carry the email at all, so the two are never merely "both absent".
    const rawBodyEmail = order.buyerInfo && order.buyerInfo.email;
    const bodyEmail = orderBuyer.normalizeEmail(rawBodyEmail);
    const bodyHasEmail = rawBodyEmail !== undefined && rawBodyEmail !== null && String(rawBodyEmail).trim() !== '';
    if (buyer.email && bodyHasEmail && bodyEmail !== buyer.email) {
      throw new Error('`buyer` was resolved for a different billing email than order.buyerInfo.email carries; resolve the buyer from THIS order\'s billing email');
    }
    if (buyer.memberId && (!bodyHasEmail || bodyEmail !== buyer.email)) {
      throw new Error('a linked `buyer` requires order.buyerInfo.email to be the billing email the member was corroborated against; the body carries none or another');
    }
    const info = orderBuyer.buyerInfoFrom(buyer);
    // Replace, not merge: only the body's email survives beside what the resolver decided.
    const kept = order.buyerInfo && order.buyerInfo.email ? { email: order.buyerInfo.email } : {};
    order = { ...order, buyerInfo: { ...kept, ...(order.buyerInfo && order.buyerInfo.contactId && !info.contactId ? { contactId: order.buyerInfo.contactId } : {}), ...info } };
    buyerOutcome = buyer.outcome;
    for (const finding of buyer.findings || []) findings_pre.push(finding);
  }

  const findings = findings_pre;
  const errors = {};
  const outcomes = { order: null, payment: null, refunds: [], invoice: null, buyer: buyerOutcome };

  // The gate runs FIRST and from the evidence structure, so a caller cannot mis-name a parameter
  // into a silent zero. It is pure: no target read is spent on an order the source never paid.
  const gate = paymentMapping.evaluatePaymentEligibility({
    sourceAmount: evidence.amount === undefined ? null : evidence.amount,
    paidDate: evidence.paidDate === undefined ? null : evidence.paidDate,
    altPaidDate: evidence.altPaidDate === undefined ? null : evidence.altPaidDate,
    distinctAmountCount: evidence.distinctAmountCount === undefined ? 1 : evidence.distinctAmountCount,
    sourceCurrency: evidence.currency === undefined ? null : evidence.currency,
    targetCurrency: order.currency === undefined ? null : order.currency,
    utcOffsetMinutes: evidence.utcOffsetMinutes === undefined ? null : evidence.utcOffsetMinutes,
    sourceStatus: evidence.status === undefined ? null : evidence.status,
  });
  findings.push(...(gate.findings || []));

  let payment = null;
  if (gate.eligible) {
    const built = paymentMapping.buildPaymentRecord({
      amount: gate.amount,
      createdDate: gate.createdDate,
      methodName: evidence.methodName === undefined ? null : evidence.methodName,
      providerTransactionId: evidence.providerTransactionId === undefined ? null : evidence.providerTransactionId,
      offlinePayment: evidence.offlinePayment,
      cardDisplay: evidence.cardDisplay === undefined ? null : evidence.cardDisplay,
    });
    payment = built.payment;
    findings.push(...(built.findings || []));
  }
  const refunds = withOccurrences(evidence.refunds || []);

  // ---- 1. The order. Crosswalk hit or miss, the TARGET is asked once by id. -------------------
  // A hit is not proof: the docs' own use of Bulk Delete Imported Orders is "clear a faulty
  // migration before re-importing", and a crosswalk that survived that must not report an order
  // the target no longer has. One paced read per order, 404 meaning "not there".
  let orderId = derivedId;
  const readPacer = pacer || w.sharedTargetReadPacer();
  const existsOnTarget = async (id) => {
    const read = await readPacer.read(() => w.getOrder(wix, id));
    if (read.ok) return { exists: true };
    if (read.error && read.error.status === 404) return { exists: false };
    return { exists: null, error: read.error };
  };
  const known = await crosswalk.get(sourceId);
  // The crosswalk's answer is trusted as the order's identity, so its SHAPE is not: a row object
  // where a string was expected became `orders/[object Object]/add-payment` in review. Only a
  // GUID-shaped string may stand for an order; anything else is a broken crosswalk, which is a
  // caller problem and stops the run rather than continuing history onto a nonsense id.
  if (known !== null && known !== undefined && known !== '' && !GUID.test(String(known))) {
    throw new Error(`the crosswalk returned ${JSON.stringify(known)} for source order ${sourceId}; a crosswalk value must be the Wix order id (a GUID string) or null`);
  }
  // A row from before deterministic ids (a Wix-minted id) is still THE order: honouring it is what
  // keeps a pre-0129 migration from being re-imported under a derived id.
  const candidateId = known ? String(known) : derivedId;
  const probe = await existsOnTarget(candidateId);
  if (probe.exists === null) {
    // Cannot tell whether the order is there. Importing now could replace a merchant-edited order;
    // not importing loses nothing a retry cannot recover. So: a named outcome, no write.
    outcomes.order = ORDER_OUTCOMES.TARGET_READ_FAILED;
    errors.order = describeError(probe.error);
    failRemaining(outcomes, errors, { gate, refunds, evidence, cause: 'order-not-imported' });
    return { orderId: null, derivedId, outcomes, findings, errors, paymentId: null, invoice: null };
  }
  if (probe.exists) {
    orderId = candidateId;
    if (known && orderId !== derivedId) findings.push({ code: 'order-id-from-crosswalk', sourceId: String(sourceId), orderId });
    outcomes.order = ORDER_OUTCOMES.ALREADY_IMPORTED;
    if (!known) {
      // The crosswalk had lost it; adopt it.
      try { await crosswalk.set(sourceId, orderId); } catch (error) { errors.crosswalk = describeError(error); }
    }
  } else {
    let derivedExists = false;
    if (known) {
      // The crosswalk points at an order the target no longer has -- a cleared migration, or a
      // stale row. Before importing under the derived id, ask whether THAT order already exists:
      // Import Order with an existing id silently replaces it, and a merchant's edits with it
      // (review demonstrated exactly that). If it exists, adopt it and replace the row.
      const derivedProbe = await existsOnTarget(derivedId);
      if (derivedProbe.exists === null) {
        outcomes.order = ORDER_OUTCOMES.TARGET_READ_FAILED;
        errors.order = describeError(derivedProbe.error);
        failRemaining(outcomes, errors, { gate, refunds, evidence, cause: 'order-not-imported' });
        return { orderId: null, derivedId, outcomes, findings, errors, paymentId: null, invoice: null };
      }
      derivedExists = derivedProbe.exists === true;
      findings.push(derivedExists
        ? { code: 'order-crosswalk-row-stale', sourceId: String(sourceId), previousOrderId: String(known), orderId: derivedId }
        : { code: 'order-reimported-after-deletion', sourceId: String(sourceId), previousOrderId: String(known) });
    }
    if (derivedExists) {
      orderId = derivedId;
      outcomes.order = ORDER_OUTCOMES.ALREADY_IMPORTED;
    } else {
      try {
        const imported = await w.importOrder(wix, { ...order, id: derivedId }, safeModeOptions);
        if (!imported || !imported.id) {
          throw new Error('Import Order returned no order id');
        }
        if (imported.id !== derivedId && !GUID.test(String(imported.id))) {
          // Cannot be recorded (the crosswalk accepts only GUIDs) and cannot be trusted. Reported
          // with the id so a human can find the order by number; the run does not continue history
          // onto it.
          throw new Error(`Import Order returned a non-GUID id ${JSON.stringify(imported.id)} for source order ${sourceId} (number ${order.number}); the order may exist on the target under it`);
        }
        if (imported.id !== derivedId) {
          // The order EXISTS, under an id we did not choose. Reporting a failure here would leave
          // no crosswalk row, and every re-run would import it again -- the one outcome this
          // module exists to prevent. So the target's id is adopted and recorded, the order counts
          // as imported, and the finding says the identity model did not hold on this target.
          orderId = String(imported.id);
          findings.push({ code: 'order-id-not-derived', sourceId: String(sourceId), orderId, derivedId });
        }
        outcomes.order = ORDER_OUTCOMES.IMPORTED;
      } catch (error) {
        outcomes.order = ORDER_OUTCOMES.IMPORT_FAILED;
        errors.order = describeError(error);
        failRemaining(outcomes, errors, { gate, refunds, evidence, cause: 'order-not-imported' });
        return { orderId: null, derivedId, outcomes, findings, errors, paymentId: null, invoice: null };
      }
    }
      // Persisted BEFORE any further write. The one thing nothing else catches. If the write
      // itself fails the order is still on the target and the next run finds it by derived id, so
      // the run continues -- but the caller is told, because a crosswalk that silently stopped
      // persisting is a report that undercounts what landed.
      try {
        await crosswalk.set(sourceId, orderId);
      } catch (error) {
        errors.crosswalk = describeError(error);
      }
  }

  // ---- 2. Payment and refunds, from ONE reconciliation read. ---------------------------------
  let paymentId = null;
  if (!gate.eligible) {
    outcomes.payment = gate.outcome;
    outcomes.refunds = refunds.map((refund) => ({ sourceId: refund.sourceId, sourceOccurrence: refund.sourceOccurrence, outcome: 'refund-without-payment' }));
  } else {
    const reconciled = await w.reconcileOrderPaymentTarget(wix, { orderId, payment, pacer });
    let written = null;
    try {
      written = await w.writeOrderPayment(wix, { orderId, payment, pacer, reconciled });
      outcomes.payment = written.outcome;
      paymentId = written.paymentId || null;
      if (written.error) errors.payment = describeError(written.error);
      // "Written" with no id is not written: the refund path would see CREATE still standing and
      // add the payment a second time. Demonstrated in review with an empty `paymentsIds`.
      if (outcomes.payment === 'payment-written' && !paymentId) {
        outcomes.payment = 'payment-failed';
        errors.payment = { cause: 'add-payment-returned-no-id' };
      }
    } catch (error) {
      outcomes.payment = 'payment-failed';
      errors.payment = describeError(error);
    }
    // No payment id means no payment to hang anything off, whatever the outcome's name: ambiguous
    // reconciliation carries no error object from the writer, so the cause is recorded here.
    if (!paymentId && !errors.payment) errors.payment = { cause: outcomes.payment };
    // The refund path sees the same read, updated with the payment this run just created so it
    // does not create a second one. A payment stage that failed leaves nothing to refund against.
    const forRefunds = paymentId && reconciled.outcome === paymentMapping.RECONCILE.CREATE
      ? { ...reconciled, outcome: paymentMapping.RECONCILE.RECONCILED, paymentId, matchedBy: 'written-this-run' }
      : reconciled;
    for (const refund of refunds) {
      const line = { sourceId: refund.sourceId, sourceOccurrence: refund.sourceOccurrence, outcome: null, refundId: null, paymentId: null };
      if (!paymentId) {
        // Refunds are REFUND outcomes. Letting the writer answer here returned the payment stage's
        // own code as the refund's, which the report counts as a payment bucket and never as a
        // refund that did not land.
        line.outcome = 'refund-failed';
        line.error = { cause: outcomes.payment };
      } else {
        try {
          const result = await w.ensureOrderPaymentAndRefund(wix, {
            orderId,
            payment,
            refundAmount: refund.amount,
            reason: refund.reason,
            sourceRefundId: refund.sourceId,
            sourceOccurrence: refund.sourceOccurrence,
            pacer,
            reconciled: forRefunds,
          });
          line.outcome = result.outcome;
          line.refundId = result.refundId || (result.refund && result.refund.id) || null;
          line.paymentId = result.paymentId || null;
        } catch (error) {
          line.outcome = 'refund-failed';
          line.error = describeError(error);
        }
      }
      outcomes.refunds.push(line);
    }
  }

  // ---- 3. The invoice document. ---------------------------------------------------------------
  let invoice = null;
  if (!evidence.invoice) {
    outcomes.invoice = 'invoice-none-found';
  } else {
    // A document that reached Media but whose order patch failed is remembered HERE, in the same
    // persisted state as the order id, not by the caller: a generated importer following the
    // documented loop without persisting it imported a second copy in review. The caller may still
    // pass one explicitly (an older project's state); the crosswalk's answer is the fallback.
    let pendingMediaFileId = evidence.invoice.pendingMediaFileId || null;
    let rememberedPending = null;
    if (!pendingMediaFileId) {
      try {
        const remembered = await crosswalk.getInvoiceFile(sourceId);
        // Either a bare id (older rows) or { fileId, sourceUrl }. A remembered file is only THIS
        // document's if it was imported from the same URL: a re-issued invoice under a new link
        // must not be "resumed" onto the old bytes (review demonstrated it).
        const rememberedId = typeof remembered === 'string' ? remembered : remembered && remembered.fileId;
        const rememberedUrl = remembered && typeof remembered === 'object' ? remembered.sourceUrl || null : null;
        if (rememberedId && String(rememberedId).trim() !== '') {
          if (!rememberedUrl || rememberedUrl === (evidence.invoice.sourceUrl || null)) { pendingMediaFileId = String(rememberedId); rememberedPending = pendingMediaFileId; }
          else findings.push({ code: 'invoice-pending-file-superseded', sourceId: String(sourceId), note: 'a remembered Media file was imported from a different URL and was not resumed' });
        }
      } catch (error) {
        errors.crosswalk = errors.crosswalk || describeError(error);
      }
    }
    try {
      invoice = await w.preserveOrderInvoiceDocument(wix, {
        orderId,
        sourceUrl: evidence.invoice.sourceUrl,
        invoiceNumber: evidence.invoice.invoiceNumber,
        approval: evidence.invoice.approval,
        setupVerification,
        sourceSiteHost,
        pendingMediaFileId,
      });
      outcomes.invoice = invoice.outcome;
      // Remember a READY-but-unrecorded file (bound to its URL); CLEAR the memory once the document
      // is settled or the remembered import is dead. Left in place, a FAILED file id was resumed
      // forever and the document never imported (review finding).
      const settled = ['invoice-preserved', 'invoice-already-preserved', 'invoice-number-only', 'invoice-import-failed'].includes(invoice.outcome);
      try {
        if (invoice.pendingMediaFileId && invoice.pendingMediaFileId !== pendingMediaFileId) {
          await crosswalk.setInvoiceFile(sourceId, invoice.pendingMediaFileId, { sourceUrl: evidence.invoice.sourceUrl || null });
        } else if (settled && (rememberedPending || (invoice.outcome === 'invoice-import-failed' && pendingMediaFileId))) {
          await crosswalk.setInvoiceFile(sourceId, null, { sourceUrl: null });
        }
      } catch (error) {
        errors.crosswalk = errors.crosswalk || describeError(error);
      }
    } catch (error) {
      outcomes.invoice = 'invoice-failed';
      errors.invoice = describeError(error);
    }
  }

  return { orderId, derivedId, outcomes, findings, errors, paymentId, invoice };
}

// A crosswalk over the project's own state/crosswalk/crosswalk.ndjson, in the row shape and key
// convention the rest of the runtime uses (`<sourceSystem>:<sourceEntityType>:<sourceId>`, as in
// lib/import-recovery.js), so recovery tooling sees these rows and these rows see its. Loaded
// once, appended per order (O(1) -- the last row per key wins), so a large store does not rewrite
// its whole crosswalk seven thousand times.
//
// The loader is deliberately NOT lib/local-state's: that one throws on any unparsable line and on
// any invalid row of any entity type, which turns a process killed mid-append -- the crash this
// module exists to survive -- into a run that fails every order after it. Here a TRAILING partial
// line (no newline terminator, not parseable) is dropped and reported; any other bad line still
// throws, because that is corruption, not a crash.
function createProjectOrderCrosswalk({ projectDir, sourceSystem = 'wordpress', sourceEntityType = 'order' } = {}) {
  if (!projectDir) throw new Error('createProjectOrderCrosswalk needs the migration projectDir');
  const filePath = localState.crosswalkPath(projectDir);
  const pendingPath = path.join(path.dirname(filePath), 'pending-invoice-files.ndjson');
  const key = (sourceId) => `${sourceSystem}:${sourceEntityType}:${String(sourceId)}`;
  const index = new Map();
  // Bytes of COMPLETE lines already indexed. The file is append-only, so a refresh reads from here
  // rather than re-parsing seven thousand rows -- and a MISS always refreshes first, because
  // another process (or lib/local-state's upsert) may have appended a row since we last looked.
  // Review demonstrated the alternative: a cached index returning null for a legacy row written
  // moments earlier, and a second order imported.
  let offset = 0;
  let lineCount = 0;
  let loaded = false;
  let inode = null;
  const state = { droppedPartialLine: null, droppedPendingPartialLine: null };

  // The file is append-only for THIS adapter, but lib/local-state's upsertCrosswalkRow rewrites
  // and compacts it (temp file + rename). A rewrite that shrank the file below our offset made the
  // incremental read return nothing and a legacy row stay invisible -- review demonstrated a
  // second order imported that way. So every refresh stats first: a new inode or a smaller file
  // means "start over", not "nothing new".
  async function statFile() {
    try {
      const st = await fs.stat(filePath);
      return { size: st.size, ino: st.ino };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { size: 0, ino: null };
      throw error;
    }
  }

  async function readFrom(position) {
    let handle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch (error) {
      if (error && error.code === 'ENOENT') return '';
      throw error;
    }
    try {
      const { size } = await handle.stat();
      if (size <= position) return '';
      const buffer = Buffer.alloc(size - position);
      await handle.read(buffer, 0, buffer.length, position);
      return buffer;
    } finally {
      await handle.close();
    }
  }

  async function refresh() {
    const st = await statFile();
    if ((inode !== null && st.ino !== inode) || st.size < offset) {
      index.clear();
      offset = 0;
      lineCount = 0;
    }
    inode = st.ino;
    const chunkBuffer = await readFrom(offset);
    if (!chunkBuffer || chunkBuffer.length === 0) return;
    // Split on the BYTE, not the decoded string: a tail torn inside a multibyte character decodes
    // to U+FFFD and mis-measures the bytes to truncate (review demonstrated a glued, fatal file).
    const lastNewline = chunkBuffer.lastIndexOf(0x0a);
    const completeBytes = lastNewline === -1 ? 0 : lastNewline + 1;
    const tailBytes = chunkBuffer.length - completeBytes;
    const parts = completeBytes > 0 ? chunkBuffer.subarray(0, completeBytes).toString('utf8').split('\n') : [''];
    if (completeBytes > 0) parts.pop(); // the trailing '' after the final newline
    const tail = tailBytes > 0 ? chunkBuffer.subarray(completeBytes).toString('utf8') : '';
    for (const raw of parts) {
      lineCount += 1;
      const line = raw.replace(/\r$/, '').trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${lineCount} invalid NDJSON: ${error.message}`);
      }
      if (row && row.targetEntityType === 'ecom/order' && typeof row.sourceStableKey === 'string' && typeof row.targetId === 'string') {
        index.set(row.sourceStableKey, row.targetId);
      }
    }
    offset += completeBytes;
    if (tailBytes > 0 && tail.trim()) {
      // A last line with no newline: either a complete row from a writer that omits the
      // terminator, or a line torn by a kill mid-append. A torn line is TRUNCATED on disk, not just
      // skipped -- skipped, the next append would glue a row onto it and corrupt the file for every
      // later reader (review demonstrated this too).
      let row = null;
      try { row = JSON.parse(tail.trim()); } catch (error) { row = null; }
      if (row) {
        // A complete row another writer left unterminated. Indexed; the terminator is added by
        // set() just before our next append, so the file is never touched only to tidy it.
        lineCount += 1;
        if (row.targetEntityType === 'ecom/order' && typeof row.sourceStableKey === 'string' && typeof row.targetId === 'string') {
          index.set(row.sourceStableKey, row.targetId);
        }
        offset += tailBytes;
        needsTerminator = true;
      } else {
        // Truncate only if nothing has been appended since we read: a neighbour's row landing
        // between the read and the truncate would otherwise be deleted. One process per project
        // crosswalk is the supported model (lib/local-state has a state lock for the runtime); this
        // check narrows the window, it does not close it.
        const now = await statFile();
        if (now.ino === inode && now.size === offset + tailBytes) {
          await fs.truncate(filePath, offset);
          state.droppedPartialLine = { line: lineCount + 1, length: tail.length };
        }
      }
    }
  }
  let needsTerminator = false;

  // The pending-invoice sibling file gets the SAME crash discipline as the main crosswalk. Review
  // demonstrated the alternative: a row torn by a kill, the next append glued onto it, one
  // unparsable line holding two pending file ids, both silently ignored -- and a tax document
  // imported twice. A torn TAIL is truncated on disk; a bad line anywhere else is corruption and
  // throws; a complete row left unterminated is read and terminated before the next append.
  async function readPendingRows() {
    let buffer;
    try {
      buffer = await fs.readFile(pendingPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      return { rows: [], needsTerminator: false };
    }
    const lastNewline = buffer.lastIndexOf(0x0a);
    const completeBytes = lastNewline === -1 ? 0 : lastNewline + 1;
    const complete = completeBytes > 0 ? buffer.subarray(0, completeBytes).toString('utf8').split('\n') : [];
    if (complete.length > 0) complete.pop(); // the '' after the final newline
    const rows = [];
    complete.forEach((raw, i) => {
      const line = raw.replace(/\r$/, '').trim();
      if (!line) return;
      try { rows.push(JSON.parse(line)); } catch (error) { throw new Error(`${pendingPath}:${i + 1} invalid NDJSON: ${error.message}`); }
    });
    const tail = buffer.subarray(completeBytes).toString('utf8');
    let pendingNeedsTerminator = false;
    if (tail.trim()) {
      let row = null;
      try { row = JSON.parse(tail.trim()); } catch (error) { row = null; }
      if (row) {
        rows.push(row);
        pendingNeedsTerminator = true;
      } else {
        await fs.truncate(pendingPath, completeBytes);
        state.droppedPendingPartialLine = { line: complete.length + 1, length: tail.length };
      }
    }
    return { rows, needsTerminator: pendingNeedsTerminator };
  }

  async function ensureLoaded() {
    if (!loaded) {
      await refresh();
      loaded = true;
    }
  }

  return {
    async get(sourceId) {
      await ensureLoaded();
      const hit = index.get(key(sourceId));
      if (hit) return hit;
      await refresh();
      return index.get(key(sourceId)) || null;
    },
    async set(sourceId, targetId) {
      await ensureLoaded();
      if (needsTerminator) {
        await fs.appendFile(filePath, '\n', 'utf8');
        needsTerminator = false;
      }
      await localState.appendCrosswalkRow(projectDir, {
        schemaVersion: localState.SCHEMA_VERSION,
        sourceSystem,
        sourceEntityType,
        sourceId: String(sourceId),
        sourceStableKey: key(sourceId),
        targetSystem: 'wix',
        targetEntityType: 'ecom/order',
        targetId: String(targetId),
        status: 'imported',
        updatedAt: new Date().toISOString(),
      });
      index.set(key(sourceId), String(targetId));
      await refresh(); // pick up our own row's bytes (and anything a neighbour appended)
    },
    // A Media file that reached READY but whose order patch failed, remembered per source order so
    // the resume records THAT file rather than importing another. Kept in a sibling file, read in
    // full on every ask: it only ever holds the failures, so it stays small, and a stale in-memory
    // copy here would cost a duplicated tax document.
    async getInvoiceFile(sourceId) {
      const { rows } = await readPendingRows();
      let found = null;
      for (const row of rows) {
        if (row && row.sourceStableKey === key(sourceId)) found = row.fileId ? { fileId: row.fileId, sourceUrl: row.sourceUrl || null } : null; // last row wins; a null row clears
      }
      return found;
    },
    async setInvoiceFile(sourceId, fileId, { sourceUrl = null } = {}) {
      // Repair first: a torn tail is truncated and an unterminated complete row gets its newline,
      // so this append always starts a clean line.
      const { needsTerminator } = await readPendingRows();
      await fs.mkdir(path.dirname(pendingPath), { recursive: true });
      if (needsTerminator) await fs.appendFile(pendingPath, '\n', 'utf8');
      await fs.appendFile(pendingPath, `${JSON.stringify({ sourceStableKey: key(sourceId), fileId: fileId === null ? null : String(fileId), sourceUrl: sourceUrl === null ? null : String(sourceUrl), updatedAt: new Date().toISOString() })}\n`, 'utf8');
    },
    // What the loaders had to drop, if anything -- a caller may want to report it.
    droppedPartialLine() { return state.droppedPartialLine; },
    droppedPendingPartialLine() { return state.droppedPendingPartialLine; },
  };
}

module.exports = {
  ORDER_OUTCOMES,
  EVIDENCE_KEYS,
  REFUND_KEYS,
  INVOICE_KEYS,
  deriveImportedOrderId,
  normalizeSourceSiteHost,
  assertEvidence,
  importOrderHistory,
  createProjectOrderCrosswalk,
};
