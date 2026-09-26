'use strict';

// An imported order carries its buyer's member id, resolved from the member crosswalk
// and corroborated, or it carries nothing.
//
// `buyerInfo.memberId` is what member-facing reads authorize on: a member-identity Get Order
// returns an order only if that member placed it, and the invoice download backend checks the
// same field. So an imported order with no memberId is invisible to its own buyer (dormant, no
// leak), and one with the WRONG memberId hands that member someone else's order and invoice, with
// both checks agreeing. Import Order stores whatever GUID it is given (verified live 2026-09-05:
// a memberId that is not a member is accepted and read back as-is). Nothing downstream catches a
// bad link, so this module fails CLOSED: a member id is set only when the crosswalk names it AND
// the member's login email is the order's billing email.
//
// Pure. The caller supplies the source order's customer id and billing email, and crosswalk
// lookups; this decides and stamps.

const crypto = require('node:crypto');

const OUTCOMES = Object.freeze({
  LINKED: 'buyer-member-linked',
  GUEST: 'buyer-guest',
  NOT_IMPORTED: 'buyer-member-not-imported',
  EMAIL_MISMATCH: 'buyer-member-email-mismatch',
  CONTACT_ONLY: 'buyer-contact-only',
});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP_VERSION = 'rp-order-buyer:v2';
// ASCII `local@domain.tld` only. Case-folding non-ASCII (the Kelvin sign folds to `k`) can make two
// distinct addresses equal, and a false link is the harm here; a non-ASCII address is simply not
// comparable and links nothing. Plus-addressing, dots and IDN forms are NOT normalized either --
// strict on purpose: a missed link is a reported finding, a wrong one is a leak.
const ASCII_EMAIL = /^[\x21-\x7e]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function normalizeEmail(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  // ASCII is checked BEFORE case-folding: `toLowerCase()` turns the Kelvin sign into `k`, and a
  // check after folding would have accepted it (the review's demonstration, reproduced in tests).
  if (!/^[\x21-\x7e]+$/.test(raw)) return null;
  const text = raw.toLowerCase();
  return ASCII_EMAIL.test(text) && text.indexOf('@') === text.lastIndexOf('@') ? text : null;
}

// JSON-encoded (no delimiter to inject), and covering the OUTCOME and finding codes as well as the
// ids: a review swapped `outcome` to "linked" on a mismatch result and the stamp still verified,
// so the report would have said linked while the body carried nothing.
function stampInput(buyer) {
  return JSON.stringify([STAMP_VERSION, buyer.outcome || null, buyer.memberId || null, buyer.contactId || null, buyer.sourceCustomerId === undefined || buyer.sourceCustomerId === null ? null : String(buyer.sourceCustomerId), buyer.email || null, (buyer.findings || []).map((f) => f && f.code).sort()]);
}
function computeBuyerStamp(buyer) {
  return crypto.createHash('sha256').update(stampInput(buyer)).digest('hex');
}
function verifyBuyerStamp(buyer) {
  return Boolean(buyer && typeof buyer === 'object' && typeof buyer.buyerStamp === 'string' && buyer.buyerStamp === computeBuyerStamp(buyer));
}

// `memberCrosswalk.get(sourceCustomerId)` -> { memberId, loginEmail } | null -- what this migration
// created (0089's Create Member by loginEmail) keyed by the source user id.
// `contactCrosswalk.get(key)` -> contactId | null, keyed by source customer id, else by email.
async function resolveOrderBuyer({ sourceCustomerId = null, billingEmail = null, memberCrosswalk = null, contactCrosswalk = null } = {}) {
  const findings = [];
  const email = normalizeEmail(billingEmail);
  // A WooCommerce customer id is a positive integer, possibly stringified, possibly zero-padded
  // by a CSV. Anything else is a caller error, not a guest: `true` stringifies to "true" and a row
  // keyed "true" would never exist, which silently under-links.
  let customerId = null;
  if (sourceCustomerId !== undefined && sourceCustomerId !== null && String(sourceCustomerId).trim() !== '') {
    // A number above 2^53 has ALREADY been rounded by whoever parsed it; it cannot name a customer.
    if (typeof sourceCustomerId === 'number' && !Number.isSafeInteger(sourceCustomerId)) throw new Error(`sourceCustomerId ${sourceCustomerId} is not a safe integer; pass large ids as strings`);
    const raw = typeof sourceCustomerId === 'number' ? String(sourceCustomerId) : String(sourceCustomerId).trim();
    if (!/^\d+(\.0+)?$/.test(raw)) throw new Error(`sourceCustomerId must be a non-negative integer (WooCommerce customer id), got ${JSON.stringify(sourceCustomerId)}`);
    // Normalized as a STRING, never through Number(): above 2^53 that rounds, and review
    // demonstrated "9007199254740993" keyed as ...992 -- another customer's row, and so another
    // customer's order and invoice handed to the wrong member.
    const digits = raw.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
    customerId = digits === '0' ? null : digits;
  }
  let contactId = null;
  if (contactCrosswalk && typeof contactCrosswalk.get === 'function') {
    const byCustomer = customerId ? await contactCrosswalk.get(customerId) : null;
    const byEmail = !byCustomer && email ? await contactCrosswalk.get(email) : null;
    const found = byCustomer || byEmail;
    if (found && GUID.test(String(found))) contactId = String(found);
    else if (found) findings.push({ code: 'buyer-contact-id-not-guid', value: String(found).slice(0, 40) });
  }
  const finish = (outcome, memberId) => {
    const buyer = { outcome, memberId: memberId || null, contactId, sourceCustomerId: customerId, email, findings };
    buyer.buyerStamp = computeBuyerStamp(buyer);
    return buyer;
  };
  if (!customerId) return finish(contactId ? OUTCOMES.CONTACT_ONLY : OUTCOMES.GUEST, null);
  if (!memberCrosswalk || typeof memberCrosswalk.get !== 'function') throw new Error('resolveOrderBuyer needs a memberCrosswalk with get(sourceCustomerId) when the order has a customer id');
  const row = await memberCrosswalk.get(customerId);
  if (!row || !row.memberId) {
    findings.push({ code: OUTCOMES.NOT_IMPORTED, sourceCustomerId: customerId });
    return finish(OUTCOMES.NOT_IMPORTED, null);
  }
  if (!GUID.test(String(row.memberId))) {
    findings.push({ code: 'buyer-member-id-not-guid', sourceCustomerId: customerId });
    return finish(OUTCOMES.NOT_IMPORTED, null);
  }
  // Corroboration: the member the crosswalk names must be the person who placed the order. The
  // login email is the identity Create Member deduplicated on; a row whose email disagrees with
  // the order's billing email is a crosswalk pointing at the wrong person, which is the one
  // outcome nothing downstream would catch.
  const loginEmail = normalizeEmail(row.loginEmail);
  if (!email || !loginEmail || email !== loginEmail) {
    findings.push({ code: OUTCOMES.EMAIL_MISMATCH, sourceCustomerId: customerId, orderEmailPresent: Boolean(email), memberEmailPresent: Boolean(loginEmail) });
    return finish(OUTCOMES.EMAIL_MISMATCH, null);
  }
  return finish(OUTCOMES.LINKED, String(row.memberId));
}

// The buyerInfo to put on the Import Order body, from a STAMPED resolver result. Refuses anything
// else, so a hand-built { memberId } cannot reach the order.
function buyerInfoFrom(buyer) {
  if (!verifyBuyerStamp(buyer)) throw new Error('buyerInfo must come from resolveOrderBuyer (its stamp did not verify); a hand-built memberId is exactly the wrong-attribution risk this exists to prevent');
  const info = {};
  if (buyer.contactId) info.contactId = buyer.contactId;
  if (buyer.memberId) info.memberId = buyer.memberId;
  return info;
}

// The only keys a mapped order body may carry under buyerInfo BEFORE the composite sets the
// buyer: an email, and a contactId the contact import resolved. Everything else -- memberId under
// any spelling, visitorId, snake_case siblings -- is refused, because Wix's proto-JSON accepts
// `member_id` as readily as `memberId` and a refusal that checks one spelling checks nothing.
const BODY_BUYER_KEYS = Object.freeze(['contactId', 'email']);
function assertBodyBuyerInfo(order) {
  for (const key of Object.keys(order || {})) {
    if (/buyer/i.test(key) && key !== 'buyerInfo') throw new Error(`order.${key} is not accepted; the buyer goes through \`buyer\` from resolveOrderBuyer`);
  }
  const info = order && order.buyerInfo;
  if (info === undefined || info === null) return;
  if (typeof info !== 'object' || Array.isArray(info)) throw new Error('order.buyerInfo must be an object');
  const bad = Object.keys(info).filter((k) => !BODY_BUYER_KEYS.includes(k));
  if (bad.length > 0) throw new Error(`order.buyerInfo may only carry ${BODY_BUYER_KEYS.join(', ')} before the composite sets the buyer; got ${bad.join(', ')} -- a member id is never the caller's to set`);
}

module.exports = { OUTCOMES, BODY_BUYER_KEYS, normalizeEmail, resolveOrderBuyer, buyerInfoFrom, assertBodyBuyerInfo, computeBuyerStamp, verifyBuyerStamp };
