'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — the DETERMINISTIC "PW WooCommerce Gift Cards" issuance line item -> Wix
// gift-cards/v1 Create Gift Card payload builder. Companion to discount-rule-build.js / tax-build.js;
// implements domains/gift-cards/entities/gift-card.json's mappingGuidance/pitfalls as code.
//
// Input is one WooCommerce order (as returned by GET /wc/v3/orders/{id}) plus the specific
// line_item on it that carries pw_gift_card_number in its meta_data (see
// plugins/pw-woocommerce-gift-cards.json's gift-card entity for how that meta gets there and why
// it only exists once the order has reached processing/completed).
//
// LIVE-VERIFIED 2026-08-17 against poratus (source: WooCommerce REST API + a headless storefront
// checkout; target: msid fd0ad9fb-d439-406f-8a00-b6c6ad0d95ab). 3 real orders were completed via
// the WooCommerce REST API (not the storefront) with pw_gift_card_amount/to/from/message set on
// the line item exactly as the plugin's own checkout hook would set them; each produced a real
// pw_gift_card_number on completion. A 4th order redeemed one of those cards through a headless
// storefront checkout. See tests/fixtures/wordpress/pw-gift-card-orders.json for the (trimmed)
// real payloads this was built against, and tests/target-wix/gift-card-build-test.js for the
// pinned contract. The Wix side was exercised too: this builder's output was POSTed to a real
// POST /gift-cards/v1/gift-cards on that site (after installing the Wix Gift Cards app,
// appDefId d80111c5-a0f4-47a8-b63a-65b54d774a27 — see domains/gift-cards/domain.json's
// gift-card-app-required pitfall) and read back successfully.
//
// CORRECTED 2026-08-18 (PR review): `pw_gift_card_number` is a REPEATED meta key, not a single
// value — for line-item quantity N, the plugin's own add_gift_cards_to_order() calls
// wc_add_order_item_meta(..., $unique = false) once per card, so the same key appears N times with
// N different codes. The main entry point below (buildGiftCardsFromOrderLineItem) always returns
// an ARRAY, one entry per issued card, never just the first. See spec 0042 Decision 3 for the full
// cardinality/recipient-correlation analysis this implements.
//
// What this module deliberately does NOT do: resolve a redeemed/partial balance on its own.
// Redemption is a custom order-item type ('pw_gift_card') that the stock WooCommerce REST Orders
// controller never serializes (verified live — see plugins/pw-woocommerce-gift-cards.json's
// gift-card-activity entity, redemption-invisible-even-in-order-rest-data pitfall) — there is no
// source signal this builder could read to know a card was later spent. Every card is built at its
// original face value (spec 0042 Decision 5, Policy A) unless the caller supplies a validated
// `remainingBalance` from some out-of-band reconciliation (Policy B — spec 0040's bridge plugin, or
// a merchant-supplied list). The two policies are mutually exclusive per card; this module does not
// enforce that across calls, only validates a single call's input (see validateRemainingBalance).

const ORDER_STATUSES_WITH_ISSUED_CARDS = new Set(['processing', 'completed']);
const CODE_MIN_LENGTH = 8;
const CODE_MAX_LENGTH = 20;
// VERIFIED LIVE 2026-08-17: Wix rejects any non-alphanumeric character in giftCard.code outright
// (428 INVALID_CODE), independent of length — see gift-card.json's code-alphanumeric-only pitfall.
const CODE_ALLOWED_CHARS = /^[A-Za-z0-9]+$/;
// Wix money amounts are decimal strings with at most 2 decimal places (gift-card.json
// mappingGuidance) — enforced on any caller-supplied remainingBalance override.
const MAX_MONEY_DECIMALS = 2;
// WooCommerce order.currency is always a 3-letter ISO 4217 code; Wix giftCard.currency rejects
// anything else with a 400. Checked here so a missing/malformed order.currency surfaces as a
// named gap instead of a payload that only fails later against the live endpoint.
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
// The Wix Gift Cards app's own appDefId — VERIFIED LIVE 2026-08-17 via Get Gift Card, which
// returns the CREATING app's id for a card built by this module (source: 'MANUAL'), not an
// external provider's (see domains/gift-cards/domain.json's gift-card-app-required pitfall).
// Create Gift Card itself has no explicit appId field (this constant isn't used above) — it's
// exported here because gift-card-redemption-build.js's Redeem Gift Card call needs it, and this
// is the one place that constant is already live-verified.
const WIX_GIFT_CARDS_APP_ID = 'd80111c5-a0f4-47a8-b63a-65b54d774a27';

// Every value stored under `key`, in meta_data array order — WooCommerce/WordPress's own meta
// retrieval is ORDER BY meta_id ASC, and the plugin appends one pw_gift_card_number row per card
// in creation order, so this order is the plugin's own creation order, not an arbitrary one.
function metaValues(metaData, key) {
  return (metaData || []).filter((m) => m.key === key).map((m) => m.value);
}

function metaValue(metaData, key) {
  return metaValues(metaData, key)[0];
}

// Mirrors add_gift_cards_to_order()'s own fallback in pw-gift-cards-purchasing.php: when
// pw_gift_card_amount is missing/non-numeric, the plugin itself falls back to
// subtotal / quantity. A reader has to apply the same fallback or it will under-read older orders.
// This amount is per-card (the plugin sets it from the unit price), shared by every card issued
// from the same line item — there is no per-card amount variant to resolve separately.
function resolveFaceValue(lineItem, metaData) {
  const metaAmount = metaValue(metaData, 'pw_gift_card_amount');
  if (!isBlank(metaAmount) && Number.isFinite(Number(metaAmount))) {
    const numeric = Number(metaAmount);
    if (numeric < 0) {
      return {
        amount: null,
        source: null,
        gap: {
          code: 'invalid-gift-card-amount',
          summary: `pw_gift_card_amount (${numeric}) on line item ${lineItem.id} is negative — a gift card face value cannot be negative.`,
        },
      };
    }
    // A zero meta value is treated the same as missing/blank, not a real $0.00 face value: PHP's
    // own empty() (which the plugin's meta checks are built on) is true for "0"/0, so
    // pw_gift_card_amount = "0" falls through to the SAME subtotal/quantity fallback as a
    // genuinely missing value would, rather than minting a $0.00 card for a real purchase.
    if (numeric !== 0) {
      return { amount: numeric, source: 'pw_gift_card_amount meta' };
    }
  }
  const subtotal = Number(lineItem.subtotal);
  const quantity = Number(lineItem.quantity);
  if (Number.isFinite(subtotal) && Number.isFinite(quantity) && quantity > 0) {
    return { amount: Math.round((subtotal / quantity) * 100) / 100, source: 'subtotal / quantity fallback (pw_gift_card_amount was missing or zero)' };
  }
  return { amount: null, source: null };
}

// spec 0042 Decision 3's recipient-correlation rule. pw_gift_card_to is ONE string that may list
// several whitespace/comma-separated recipients; the plugin sets cart quantity = recipient count
// ONLY when that count is greater than 1, so:
//   - recipients.length === cardCount: zip 1:1 by position (both are creation-order lists).
//   - recipients.length is 0 or 1: that single recipient (or none) applies to every card.
//   - anything else is not a shape the plugin's own code produces under normal use — a gap, not a
//     guessed pairing.
function resolveRecipients(metaData, cardCount) {
  const raw = metaValue(metaData, 'pw_gift_card_to');
  if (isBlank(raw)) return { recipients: new Array(cardCount).fill(undefined) };
  const split = String(raw).split(/[\s,]+/).filter(Boolean);
  if (split.length === cardCount) return { recipients: split };
  if (split.length <= 1) return { recipients: new Array(cardCount).fill(split[0]) };
  return {
    recipients: null,
    gap: {
      code: 'recipient-card-count-mismatch',
      summary: `pw_gift_card_to lists ${split.length} recipient(s) but ${cardCount} card(s) were issued on this line item — cannot safely pair recipients to cards (spec 0042 Decision 3). This is not a shape the plugin's own code produces under normal use; treat it as a data-integrity gap, not something to guess a pairing for.`,
    },
  };
}

// spec 0042 Decision 5's validation for one already-resolved balance override value (Policy B).
// Never throws, never silently coerces an invalid value into a number — returns a named gap
// instead.
function validateRemainingBalance(remainingBalance, faceValue) {
  if (typeof remainingBalance === 'string' && remainingBalance.trim() === '') {
    return { gap: { code: 'invalid-remaining-balance', summary: 'the resolved remainingBalance was an empty/whitespace string.' } };
  }
  const numeric = Number(remainingBalance);
  if (!Number.isFinite(numeric)) {
    return { gap: { code: 'invalid-remaining-balance', summary: `the resolved remainingBalance "${remainingBalance}" is not a finite number (NaN/Infinity/non-numeric text are all rejected) — see spec 0042 Decision 5.` } };
  }
  if (numeric < 0) {
    return { gap: { code: 'invalid-remaining-balance', summary: `the resolved remainingBalance (${numeric}) is negative — a gift card balance cannot be negative.` } };
  }
  const scaled = numeric * 10 ** MAX_MONEY_DECIMALS;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    return { gap: { code: 'invalid-remaining-balance', summary: `the resolved remainingBalance (${numeric}) has more than ${MAX_MONEY_DECIMALS} decimal places — Wix money amounts are decimal strings with at most 2 decimal places.` } };
  }
  if (faceValue != null && numeric > faceValue) {
    return {
      gap: {
        code: 'remaining-balance-exceeds-face-value',
        summary: `the resolved remainingBalance (${numeric}) is greater than the card's face value (${faceValue}) — a stored-value card's balance cannot legitimately exceed what it was issued for in this migration's model (spec 0042 Decision 5). This indicates a source data-quality problem needing its own investigation, not a value to pass through.`,
      },
    };
  }
  return { amount: numeric };
}

// spec 0042 Decision 5, per card, fixed 2026-08-18 (PR review): the balance-policy signal is now
// EXPLICIT (`options.balancePolicy`) instead of inferred from whether `remainingBalance` happens
// to be set — a Policy B lookup that came back empty must fail closed as its own gap, never fall
// through to Policy A's face-value path undetected (both used to look identical: an omitted
// value). The override itself is resolved PER SOURCE CARD (`options.remainingBalanceByCard`,
// keyed by the raw `pw_gift_card_number`), not one scalar shared across every card on a
// multi-quantity line — two cards from the same line can have been independently, differently
// spent, and sharing one balance would silently misprice one of them.
// Shared by every per-card lookup map this module accepts (remainingBalanceByCard,
// lifecycleByCard, ...): both a plain object and a Map are accepted, keyed by the raw
// `pw_gift_card_number`. `has` is distinct from `value` so a map that explicitly sets an entry to
// `null`/`undefined` (a lookup that ran and found nothing) is still visible as "present but
// empty," not indistinguishable from "never looked up."
function lookupByCard(map, sourceNumber) {
  if (map instanceof Map) return { has: map.has(sourceNumber), value: map.get(sourceNumber) };
  const has = map != null && Object.prototype.hasOwnProperty.call(map, sourceNumber);
  return { has, value: has ? map[sourceNumber] : undefined };
}

function hasOwn(object, field) {
  return object != null && Object.prototype.hasOwnProperty.call(object, field);
}

// Fixed 2026-08-18 (PR review, third pass): Policy A ("face value, no replay" — spec 0042
// Decision 5) and Policy B ("verified remaining balance at creation") are the only two policies
// gift-card-build.js itself needs to know about — both simply decide whether THIS create call
// uses face value or an override. Policy C ("face value now, then bring it down to the correct
// balance by replaying each real order-linked redemption via gift-card-redemption-build.js") is
// declared here too, in the same enum, purely so a caller can record the decision — but its
// resolveCardBalance() behavior is IDENTICAL to Policy A's (face value at creation; the
// correction happens later, via a separate redeem call, not here). The corresponding safety rule
// lives in gift-card-redemption-build.js: it accepts a redemption ONLY for a card explicitly
// declared Policy C, and rejects A (contradicts "no replay") and B (would double-decrement a
// card already created at its correct balance) outright.
function resolveCardBalance(sourceNumber, faceValue, options) {
  const { balancePolicy, remainingBalanceByCard } = options || {};
  const { has: hasOverrideEntry, value: rawValue } = lookupByCard(remainingBalanceByCard, sourceNumber);

  if (balancePolicy == null || balancePolicy === 'A' || balancePolicy === 'C') {
    if (hasOverrideEntry) {
      return {
        amount: null,
        note: `options.remainingBalanceByCard has an entry for card ${sourceNumber}, but options.balancePolicy is not "B" — it was IGNORED; set balancePolicy: 'B' to actually apply it (spec 0042 Decision 5).`,
      };
    }
    return { amount: null };
  }

  if (balancePolicy !== 'B') {
    return { gap: { code: 'invalid-balance-policy', summary: `options.balancePolicy must be "A", "B", or "C" (spec 0042 Decision 5) — got ${JSON.stringify(balancePolicy)}.` } };
  }

  if (!hasOverrideEntry) {
    return {
      gap: {
        code: 'unavailable-remaining-balance',
        summary: `options.balancePolicy is "B" but options.remainingBalanceByCard has no entry for card ${sourceNumber} (spec 0042 Decision 5) — a failed/missing balance lookup must never fall back to face value silently; the caller must explicitly decide to skip this card, supply its verified balance, or halt the run.`,
      },
    };
  }

  if (isBlank(rawValue)) {
    return {
      gap: {
        code: 'unavailable-remaining-balance',
        summary: `options.balancePolicy is "B" but the resolved remainingBalance for card ${sourceNumber} is blank/null (spec 0042 Decision 5) — a failed lookup must be reported as unavailable, never treated as "use face value".`,
      },
    };
  }

  return validateRemainingBalance(rawValue, faceValue);
}

// A Wix date-time field, per the documented Gift Card Object (RFC 3339, e.g.
// "2026-11-11T00:00:00Z") — NOT the bare "YYYY-MM-DD" shape spec 0040's bridge plugin's
// expiration_date column returns. Requires an explicit time-of-day and zone designator so a
// caller can never forward the raw MySQL DATE value unconverted.
const EXPIRATION_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const REQUIRED_VERIFIED_LIFECYCLE_FIELDS = ['active', 'expirationDate', 'expirationDateConversionError'];

// Fixed 2026-08-18 (PR review): the source card's own lifecycle facts (`active`, `expiration_date`
// — only reachable via spec 0040's bridge plugin, never from order/line-item data this module
// otherwise reads) were previously dropped entirely, silently recreating an expired or
// admin-disabled source card as a normal, active, non-expiring Wix card — resurrecting unusable
// customer value.
//
// Fixed 2026-08-18 (PR review, third pass) — two more gaps in this same fix:
//
// 1. **A missing per-card lookup entry was itself indistinguishable from "verified active, no
//    expiration"** — the exact same silent-fallback shape already fixed for Policy B balances.
//    `options.lifecyclePolicy` now makes the caller's intent explicit, mirroring `balancePolicy`.
// 2. **A resolved `expirationDate` was forwarded to the create payload without validating its
//    shape.** Wix's Gift Card Object documents `expirationDate` as an RFC 3339 date-time (e.g.
//    `"2026-11-11T00:00:00Z"`), not the bare `"2027-01-01"` date spec 0040's bridge plugin's
//    `expiration_date` column returns. `EXPIRATION_DATE_TIME_PATTERN` now rejects anything that
//    isn't already a real date-time with a zone designator.
//
// Fixed 2026-08-18 (PR review, fifth pass): `options.expirationDateByCard`/`options.activeByCard`
// used to be TWO SEPARATE per-card maps. Spec 0040's bridge exposes `expiration_date_gmt` and
// `expiration_date_conversion_error` as a PAIR — `expiration_date_gmt` is `null` both for a
// genuine "no expiration" AND for a failed conversion, distinguished only by the sibling flag —
// but nothing forced a caller assembling two independent maps to actually carry that flag through
// at all. A caller who copied `expiration_date_gmt` into `expirationDateByCard` while dropping
// `expiration_date_conversion_error` would have a failed conversion silently accepted as a
// verified "no expiration" under `lifecyclePolicy: 'verified'` — the exact same class of bug this
// whole fix exists to prevent, just moved one level up. There is now ONE per-card map,
// `options.lifecycleByCard` (see `lookupByCard`), each entry a single record: `{ active,
// expirationDate, expirationDateConversionError }`. A follow-up review closed the remaining hole
// in that shape: under `lifecyclePolicy: 'verified'`, all three fields are required and the
// conversion status must be present; whenever active or conversion status is supplied under any
// policy it must be boolean, so malformed safety signals cannot silently become active/no-error.
//
// `active: false` has no direct create-time equivalent: Wix's Create Gift Card has no
// "create disabled" option (see spec 0042's no-credit-API-adjacent capability list — create, send
// email, query/search, disable, find-by-email), and this repo has not live-verified a Disable
// Gift Card request shape to build a real follow-up call from. Rather than guess one, or silently
// create the card active anyway, an inactive source card fails closed as a named gap by default —
// the caller must explicitly opt in (`options.allowInactiveCardCreation`) to accept creating it
// active with a manual Disable Gift Card follow-up still owed, or exclude the card instead.
function resolveCardLifecycle(sourceNumber, options) {
  const { lifecycleByCard, allowInactiveCardCreation = false, lifecyclePolicy } = options || {};

  if (lifecyclePolicy != null && lifecyclePolicy !== 'not-tracked' && lifecyclePolicy !== 'verified') {
    return { gap: { code: 'invalid-lifecycle-policy', summary: `options.lifecyclePolicy must be "not-tracked" or "verified" — got ${JSON.stringify(lifecyclePolicy)}.` } };
  }

  // Fixed 2026-08-18 (PR review, fourth pass): an OMITTED lifecyclePolicy still defaults to
  // 'not-tracked' (breaking every existing caller to force an explicit value was judged too
  // disruptive), but that default is no longer silent — every card built this way carries a
  // prominent note recording the decision, instead of the fidelity loss being invisible unless a
  // reader already knows to go looking for it.
  const notes = [];
  if (lifecyclePolicy == null) {
    notes.push(`options.lifecyclePolicy was not set for card ${sourceNumber} — defaulting to "not-tracked": this card's active/expiration state was NOT verified against the source (spec 0042). Pass lifecyclePolicy: "verified" with a real lifecycleByCard record if source lifecycle fidelity matters for this migration.`);
  }

  const { has: hasRecord, value: record } = lookupByCard(lifecycleByCard, sourceNumber);
  const missingRequiredFields = REQUIRED_VERIFIED_LIFECYCLE_FIELDS.filter((field) => !hasOwn(record, field));
  const active = hasOwn(record, 'active') ? record.active : undefined;
  const expirationDate = hasOwn(record, 'expirationDate') ? record.expirationDate : undefined;
  const conversionError = hasOwn(record, 'expirationDateConversionError') ? record.expirationDateConversionError : undefined;

  if (lifecyclePolicy === 'verified' && (!hasRecord || missingRequiredFields.length > 0)) {
    return {
      gap: {
        code: 'unavailable-lifecycle-data',
        summary: `options.lifecyclePolicy is "verified" but card ${sourceNumber} is missing required lifecycleByCard data (${missingRequiredFields.join(', ') || 'record'}) — a missing/failed lifecycle lookup must never be treated as "active, no expiration"; supply "active", "expirationDate", and "expirationDateConversionError" (expirationDate may be explicitly null only when expirationDateConversionError is explicitly false), or use lifecyclePolicy: "not-tracked" as an explicit, visible decision to accept the fidelity loss for this card.`,
      },
    };
  }

  // Unlike expiration shape/status, inactive state is honored regardless of lifecyclePolicy (see
  // the active===false gate below). Therefore a supplied active value must always be a boolean:
  // accepting "false" or 0 would silently recreate an inactive source card as active.
  if (hasOwn(record, 'active') && typeof active !== 'boolean') {
    return {
      gap: {
        code: 'invalid-lifecycle-data',
        summary: `card ${sourceNumber}'s lifecycleByCard record has active ${JSON.stringify(active)} — this field must be an explicit boolean so an inactive source card can never be recreated as active through coercion.`,
      },
    };
  }

  if (hasOwn(record, 'expirationDateConversionError') && typeof conversionError !== 'boolean') {
    return {
      gap: {
        code: 'invalid-lifecycle-data',
        summary: `card ${sourceNumber}'s lifecycleByCard record has expirationDateConversionError ${JSON.stringify(conversionError)} — this field must be an explicit boolean so conversion failure cannot be confused with a "no expiration" value.`,
      },
    };
  }

  if (lifecyclePolicy === 'verified' && expirationDate !== null && (typeof expirationDate !== 'string' || isBlank(expirationDate))) {
    return {
      gap: {
        code: 'invalid-lifecycle-data',
        summary: `card ${sourceNumber}'s verified lifecycleByCard record has expirationDate ${JSON.stringify(expirationDate)} — this field must be either an explicit null (verified no expiration) or a nonblank RFC 3339 date-time string.`,
      },
    };
  }

  // Checked regardless of lifecyclePolicy, same as the active===false check below: if the
  // caller's own data says the conversion failed, that is real signal to honor, not something a
  // policy setting should be able to suppress. This is exactly the case the bridge's
  // expiration_date_conversion_error field exists to report (spec 0040 Case 2) — a non-null
  // source expiration_date that could not be converted must never be treated as "no expiration."
  if (conversionError === true) {
    return {
      gap: {
        code: 'expiration-date-conversion-failed',
        summary: `card ${sourceNumber}'s lifecycleByCard record has expirationDateConversionError: true — the source's expiration date failed to convert to a usable value and must never be treated as "no expiration" or silently dropped. Investigate the source data (see spec 0040's expiration_date_conversion_error) before proceeding with this card.`,
      },
    };
  }

  if (!isBlank(expirationDate) && !EXPIRATION_DATE_TIME_PATTERN.test(expirationDate)) {
    return {
      gap: {
        code: 'invalid-expiration-date-shape',
        summary: `options.lifecycleByCard's record for card ${sourceNumber} has expirationDate "${expirationDate}", which is not an RFC 3339 date-time (e.g. "2026-11-11T00:00:00Z") — Wix's Gift Card Object requires a date-time, not a bare date. Never forward spec 0040's bridge plugin's raw expiration_date (a MySQL DATE) directly; use its expiration_date_gmt (preserving end-of-day/site-timezone semantics) instead.`,
      },
    };
  }

  if (active === false) {
    if (!allowInactiveCardCreation) {
      return {
        gap: {
          code: 'inactive-source-card',
          summary: `card ${sourceNumber} is inactive at the source (active: false) — Wix's Create Gift Card has no "create disabled" option, so creating it normally would resurrect deactivated customer value as a live, spendable card. Set options.allowInactiveCardCreation to explicitly accept creating it active anyway (with a manual Disable Gift Card follow-up still owed), or exclude this card from the migration.`,
        },
      };
    }
    notes.push(`card ${sourceNumber} is inactive at the source but was created anyway per options.allowInactiveCardCreation — it now exists as an ACTIVE Wix gift card; a manual Disable Gift Card follow-up is required to match the source state (no verified Disable Gift Card request shape is recorded in this repo yet).`);
    return { expirationDate, note: notes.join(' ') };
  }

  return { expirationDate, note: notes.length ? notes.join(' ') : undefined };
}

// Main entry: one WooCommerce order + one of its pw-gift-card line items -> an ARRAY of Wix
// POST /gift-cards/v1/gift-cards create results, one per issued card (a line item at quantity N
// issues N cards — see the cardinality note above). Each array entry is
// { sourceNumber, payload, gaps, notes }; `payload` is null when `gaps` is non-empty.
//
// `options.balancePolicy` — 'A', 'B', or 'C' (spec 0042 Decision 5), chosen once per migration run
// per card, never inferred. 'A' and 'C' both create at face value here (identical behavior in
// THIS builder); they differ only in what happens next: 'A' accepts the resulting overstatement
// as a known consequence (manual disable-and-replace to correct it), while 'C' declares that the
// correct balance will be reached afterward by replaying real order-linked redemptions via
// gift-card-redemption-build.js (which only accepts a redemption for a card declared 'C' — 'A'
// and 'B' are both rejected there, for different reasons: 'A' contradicts its own "no replay"
// rule, and 'B' would double-decrement a card already created at its correct balance). Under 'B',
// `options.remainingBalanceByCard` (a plain object or Map keyed by the raw `pw_gift_card_number`)
// must carry a verified current balance for EACH card being built here — a missing entry is a
// named gap, never a silent fall-through to face value, and a scalar override is never broadcast
// across every card on a multi-quantity line (two cards from the same line can have been spent
// by different amounts).
//
// `options.lifecyclePolicy` — 'not-tracked' (default/omitted) or 'verified', mirroring
// `balancePolicy`'s explicit-signal shape. `options.lifecycleByCard` (a plain object or Map keyed
// by the raw `pw_gift_card_number`) carries ONE combined record per card — `{ active,
// expirationDate, expirationDateConversionError }` — never split across separate maps (see
// resolveCardLifecycle's own comment). Under 'not-tracked', a card with no `lifecycleByCard`
// record is simply created active/non-expiring (today's behavior, now an explicit, visible
// decision rather than an implicit default). Under 'verified', EVERY card must carry a record with
// `active`, `expirationDate`, and boolean `expirationDateConversionError` fields present (an
// explicit `null` expiration is a valid, verified "no expiration" only alongside an explicit
// `false` conversion status) — a missing record or field fails closed as a named gap rather than
// silently assuming active/non-expiring. A record with `expirationDateConversionError: true` is
// always a hard gap, regardless of `lifecyclePolicy`. See resolveCardLifecycle for the inactive-
// card and expiration-date-shape rules this also enforces.
//
// `options.normalizeCode` — set true to strip non-alphanumeric characters from a source code that
// Wix would otherwise reject (see CODE_ALLOWED_CHARS above). Off by default: this changes the code
// a customer may already hold printed/emailed, so it must be an explicit, visible decision (a
// `notes` entry records exactly what changed), never a silent default — same principle as
// `balancePolicy`/`lifecyclePolicy`.
function buildGiftCardsFromOrderLineItem(order, lineItem, options) {
  const opts = options || {};
  const { normalizeCode = false } = opts;

  if (!ORDER_STATUSES_WITH_ISSUED_CARDS.has(order.status)) {
    return [{
      sourceNumber: null,
      payload: null,
      gaps: [{
        code: 'order-not-yet-completed',
        summary: `order ${order.id} has status "${order.status}" — PW WooCommerce Gift Cards only mints a card number once an order reaches processing/completed (see gift-card.json's issuance-is-core-meta-not-db-only pitfall). Re-check after the order progresses.`,
      }],
      notes: [],
    }];
  }

  const metaData = lineItem.meta_data || [];
  const sourceNumbers = metaValues(metaData, 'pw_gift_card_number');
  if (sourceNumbers.length === 0) {
    return [{
      sourceNumber: null,
      payload: null,
      gaps: [{ code: 'no-gift-card-number', summary: `line item ${lineItem.id} on order ${order.id} has no pw_gift_card_number meta — it is not a gift-card issuance line, or the order hasn't triggered issuance yet.` }],
      notes: [],
    }];
  }

  const { amount, source: amountSource, gap: faceValueGap } = resolveFaceValue(lineItem, metaData);
  if (faceValueGap) {
    return [{ sourceNumber: null, payload: null, gaps: [faceValueGap], notes: [] }];
  }
  if (amount == null) {
    return [{
      sourceNumber: null,
      payload: null,
      gaps: [{ code: 'unresolvable-amount', summary: `could not resolve a face value for line item ${lineItem.id} on order ${order.id} from either pw_gift_card_amount meta or subtotal/quantity.` }],
      notes: [],
    }];
  }

  const { recipients, gap: recipientGap } = resolveRecipients(metaData, sourceNumbers.length);
  const buyerEmail = order.billing && order.billing.email;
  const currencyGap = CURRENCY_CODE_PATTERN.test(order.currency)
    ? null
    : { code: 'invalid-currency', summary: `order ${order.id} has currency "${order.currency}" — expected a 3-letter ISO 4217 code (e.g. "USD"); Wix giftCard.currency rejects anything else.` };

  return sourceNumbers.map((sourceNumber, index) => {
    const notes = [];
    if (amountSource !== 'pw_gift_card_amount meta') notes.push(`face value for card ${sourceNumber} used the ${amountSource}.`);

    // Resolved PER CARD, not once for the whole line item — see resolveCardBalance's own comment.
    const { amount: overrideAmount, gap: balanceGap, note: balanceNote } = resolveCardBalance(sourceNumber, amount, opts);
    if (balanceNote) notes.push(balanceNote);
    const { expirationDate, gap: lifecycleGap, note: lifecycleNote } = resolveCardLifecycle(sourceNumber, opts);
    if (lifecycleNote) notes.push(lifecycleNote);

    if (recipientGap) return { sourceNumber, payload: null, gaps: [recipientGap], notes };
    if (balanceGap) return { sourceNumber, payload: null, gaps: [balanceGap], notes };
    if (currencyGap) return { sourceNumber, payload: null, gaps: [currencyGap], notes };
    if (lifecycleGap) return { sourceNumber, payload: null, gaps: [lifecycleGap], notes };

    let code = sourceNumber;
    if (isBlank(code)) {
      return { sourceNumber, payload: null, gaps: [{ code: 'no-gift-card-number', summary: `card #${index + 1} on line item ${lineItem.id} has a blank pw_gift_card_number value.` }], notes };
    }

    if (!CODE_ALLOWED_CHARS.test(code)) {
      if (!normalizeCode) {
        return {
          sourceNumber,
          payload: null,
          gaps: [{ code: 'code-contains-disallowed-characters', summary: `source code "${code}" contains characters Wix's giftCard.code rejects (letters/numbers only — see gift-card.json's code-alphanumeric-only pitfall). Pass options.normalizeCode to strip them, but that changes the code the customer already holds — get an explicit decision first.` }],
          notes,
        };
      }
      const stripped = code.replace(/[^A-Za-z0-9]/g, '');
      notes.push(`code normalized for Wix (stripped non-alphanumeric characters): source "${code}" -> "${stripped}" — this changes the code the customer already holds; only done because options.normalizeCode was explicitly set.`);
      code = stripped;
    }

    if (code.length < CODE_MIN_LENGTH || code.length > CODE_MAX_LENGTH) {
      return { sourceNumber, payload: null, gaps: [{ code: 'code-length-out-of-range', summary: `code "${code}" is ${code.length} characters; Wix giftCard.code must be 8-20 characters and is immutable. Report this card instead of rewriting a code the customer already holds.` }], notes };
    }

    let initialValueAmount = amount;
    if (overrideAmount != null) {
      initialValueAmount = overrideAmount;
      notes.push(`imported at the caller-resolved remainingBalanceByCard entry (${overrideAmount}) instead of face value (${amount}) — balance-policy decision made by the caller, not this builder (spec 0042 Decision 5, Policy B).`);
    } else {
      notes.push(`imported at face value (${amount}); redemption/balance history is not readable from source data (see plugins/pw-woocommerce-gift-cards.json's gift-card-activity redemption-invisible-even-in-order-rest-data pitfall) — if this card is known to have been partially spent, pass options.balancePolicy: 'B' with a verified remainingBalanceByCard entry (spec 0042 Decision 5).`);
    }

    const recipient = recipients[index];
    if (!isBlank(recipient) && recipient !== buyerEmail) {
      notes.push(`recipient ("${recipient}") differs from the buyer (billing.email "${buyerEmail}") — the Create Gift Card API has no documented recipient/contactId field, so this is carried as a note for a human CRM-linking step, not sent in the payload.`);
    }

    const payload = {
      code,
      // CORRECTED 2026-08-17 (live 400 on the real endpoint): `currency` is top-level on giftCard,
      // NOT nested inside `initialValue` — see gift-card.json's mappingGuidance.
      initialValue: { amount: initialValueAmount.toFixed(2) },
      currency: order.currency,
      // Required, and distinguishes an imported card from one bought through a Wix order — see
      // gift-cards/gift-card.json's mappingGuidance.
      source: 'MANUAL',
      // Stable per SOURCE CARD, not just per order+line-item — quantity > 1 issues multiple cards
      // from the same line item, which would otherwise collide on the same key (spec 0042
      // Decision 3).
      idempotencyKey: `pw-gift-card:order-${order.id}:item-${lineItem.id}:number-${sourceNumber}`,
    };

    // Only set when options.lifecycleByCard has a real record for this card (see
    // resolveCardLifecycle) — an absent record omits the field entirely rather than guessing
    // "no expiration," since this builder has no access to the source card's own expiration_date
    // without a caller-supplied lookup (spec 0040's bridge plugin).
    if (!isBlank(expirationDate)) payload.expirationDate = expirationDate;

    // Deliberately absent: `notificationInfo`. Including it emails the recipient immediately
    // (notificationDate empty) — a historical import would re-mail every card holder. See
    // gift-cards/gift-card.json's suppress-recipient-email-on-import pitfall.

    return { sourceNumber, payload, gaps: [], notes };
  });
}

// Convenience: fan out every pw-gift-card line item found on an order, and every card issued from
// each of them.
function buildGiftCardsFromOrder(order, options) {
  const giftCardLineItems = (order.line_items || []).filter(
    (li) => metaValues(li.meta_data, 'pw_gift_card_number').length > 0 || !isBlank(metaValue(li.meta_data, 'pw_gift_card_amount'))
  );
  return giftCardLineItems.flatMap((lineItem) =>
    buildGiftCardsFromOrderLineItem(order, lineItem, options).map((result) => ({ lineItemId: lineItem.id, ...result }))
  );
}

module.exports = {
  ORDER_STATUSES_WITH_ISSUED_CARDS,
  CODE_MIN_LENGTH,
  CODE_MAX_LENGTH,
  CODE_ALLOWED_CHARS,
  MAX_MONEY_DECIMALS,
  CURRENCY_CODE_PATTERN,
  WIX_GIFT_CARDS_APP_ID,
  resolveRecipients,
  validateRemainingBalance,
  resolveCardBalance,
  resolveCardLifecycle,
  buildGiftCardsFromOrderLineItem,
  buildGiftCardsFromOrder,
};
