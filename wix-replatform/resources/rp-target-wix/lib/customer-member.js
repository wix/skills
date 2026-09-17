'use strict';

// A source customer -> a Wix member.contact, and the phone/name/address mapping that decides
// what gets carried and what gets refused.
//
// Two traps this exists for:
//   * Create Member's `contact.phones[]` rejects anything that is not already E.164
//     (VERIFIED LIVE: "050-1234567" 400s INVALID_PHONE; "+972501234567" is accepted). WooCommerce
//     phones are local-format text, so every phone needs converting or dropping -- never sent
//     as-is, and never invented when the source shape can't be read with confidence.
//   * Contacts dedupe on phone number, and Create Member reuses whatever contact already carries
//     a matching phone -- VERIFIED LIVE: creating a second member with an unrelated name but the
//     same phone as a FIRST member (even after that first member was deleted -- deleting a member
//     does not delete its contact) returned the FIRST member's contactId, silently attaching the
//     second person's name onto the first person's contact record. Two different source customers
//     who share a phone number (a shared home line, a placeholder store number, a typo) would be
//     merged into one Wix identity. The caller (wix-writers.js ensureMember) is responsible for
//     checking Contacts for a phone collision before ever sending a phone on a CREATE.

// Calling code + whether the national number carries a leading trunk '0' to strip, for the
// countries this project has needed so far. Deliberately small: an unlisted country REFUSES the
// phone (findings, not a guess) rather than emitting a plausible-looking wrong number.
const COUNTRY_PHONE_RULES = Object.freeze({
  IL: { callingCode: '972', trunkPrefix: '0' },
  US: { callingCode: '1', trunkPrefix: null },
  CA: { callingCode: '1', trunkPrefix: null },
  GB: { callingCode: '44', trunkPrefix: '0' },
  FR: { callingCode: '33', trunkPrefix: '0' },
  DE: { callingCode: '49', trunkPrefix: '0' },
  IT: { callingCode: '39', trunkPrefix: null },
  ES: { callingCode: '34', trunkPrefix: null },
  AU: { callingCode: '61', trunkPrefix: '0' },
  NL: { callingCode: '31', trunkPrefix: '0' },
});

const E164 = /^\+[1-9]\d{6,14}$/;

// Never invents digits: either the input already carries a confident international shape, or it
// converts under an explicit, deterministic rule for a known country, or it is refused outright.
function normalizePhoneE164(rawPhone, countryCode) {
  const raw = rawPhone === undefined || rawPhone === null ? '' : String(rawPhone).trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const asIs = raw.replace(/[\s().-]/g, '');
  if (E164.test(asIs)) return { ok: true, phone: asIs };
  const country = countryCode ? String(countryCode).trim().toUpperCase() : '';
  const rule = COUNTRY_PHONE_RULES[country];
  if (!rule) return { ok: false, reason: country ? 'unsupported-country' : 'no-country-code' };
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'no-digits' };
  const national = rule.trunkPrefix && digits.startsWith(rule.trunkPrefix) ? digits.slice(rule.trunkPrefix.length) : digits;
  if (national.length < 4 || national.length > 14) return { ok: false, reason: 'implausible-length' };
  const candidate = `+${rule.callingCode}${national}`;
  if (!E164.test(candidate)) return { ok: false, reason: 'invalid-shape' };
  return { ok: true, phone: candidate };
}

// A generic customer -> Member.contact (Create Member's shape: firstName, lastName, phones[],
// addresses[], no email -- the login email is a sibling field, never here). Findings, not thrown
// errors: a field this can't carry is reported and dropped, the rest of the contact still writes.
// Trims BEFORE testing for presence, everywhere -- a whitespace-only value (" ") is truthy as a
// raw string, and review (2026-09-06) found the field-by-field checks below testing the raw value
// first: a source record with a lone space in a name or address field would have written that
// space through as if it were real data, rather than being treated as absent.
function nonEmpty(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function buildMemberContact({ firstName = null, lastName = null, phone = null, countryCode = null, address = null } = {}) {
  const findings = [];
  const contact = {};
  const first = nonEmpty(firstName); if (first) contact.firstName = first;
  const last = nonEmpty(lastName); if (last) contact.lastName = last;
  if (nonEmpty(phone)) {
    const normalized = normalizePhoneE164(phone, countryCode);
    if (normalized.ok) contact.phones = [normalized.phone];
    else findings.push({ code: 'member-phone-not-normalized', reason: normalized.reason });
  }
  if (address && typeof address === 'object') {
    const a = {};
    const addressLine = nonEmpty(address.addressLine); if (addressLine) a.addressLine = addressLine;
    const addressLine2 = nonEmpty(address.addressLine2); if (addressLine2) a.addressLine2 = addressLine2;
    const city = nonEmpty(address.city); if (city) a.city = city;
    // Free text: Members V1 stores an unrecognized code as `subdivisionFullname` rather than
    // rejecting it (verified live), so WooCommerce's state field -- sometimes an ISO subdivision
    // code, sometimes a free-text region name -- is passed through as-is, never validated here.
    const subdivision = nonEmpty(address.subdivision); if (subdivision) a.subdivision = subdivision;
    const country = nonEmpty(address.country); if (country) a.country = country.toUpperCase();
    const postalCode = nonEmpty(address.postalCode); if (postalCode) a.postalCode = postalCode;
    if (Object.keys(a).length > 0) contact.addresses = [a];
  }
  return { contact, findings };
}

// Mirrors tallyCouponWriteOutcomes / tallyPlanWriteOutcomes's shape, for a caller building its own
// report line before this gets a shared one (see spec's "not done" section).
function tallyMemberWriteOutcomes(outcomes = []) {
  const written = outcomes.filter((o) => o === 'member-written' || o === 'member-reconciled-existing').length;
  const skippedBy = {};
  for (const o of outcomes) {
    if (o === 'member-written' || o === 'member-reconciled-existing') continue;
    skippedBy[o] = (skippedBy[o] || 0) + 1;
  }
  return { 'members-written': written, 'members-skipped': outcomes.length - written, skippedBy };
}

module.exports = { COUNTRY_PHONE_RULES, normalizePhoneE164, buildMemberContact, tallyMemberWriteOutcomes };
