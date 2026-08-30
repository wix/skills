'use strict';

const { isBlank } = require('./value-utils.js');
const { WIX_GIFT_CARDS_APP_ID } = require('./gift-card-build.js');

// rp-target-wix — spec 0042 Decision 4: given the spec-0040-bridge-plugin (Case 2) activity rows
// for one card, netted per source order, build the deterministic
// POST /ecom/v1/gift-cards/redeem request body: { code, amount, orderId, appId }.
//
// The mechanism itself is LIVE-VERIFIED IN ISOLATION 2026-08-17 (msid
// fd0ad9fb-d439-406f-8a00-b6c6ad0d95ab): a real Redeem Gift Card call against a real imported
// order correctly decremented a card's balance (10 -> 7) and returned a transactionId. What this
// module is BLOCKED on is the INPUT, not the mechanism: the activity row shape it consumes comes
// from spec 0040's bridge plugin, which is code-only and not yet installed/live-tested on any
// real WordPress site (see that spec's Open Questions 1/2). This builder is ready to consume that
// data the moment it exists — see spec 0042 Decision 4.
//
// Ordering requirement (spec 0042 Decision 4, steps 1-2): the source card's issuance must already
// be recorded in the crosswalk (gift-card-build.js ran first) and the order this redemption
// belongs to must already be imported (order-channel-build.js / Decision 1-2), before a
// redemption can be linked — this module does not check either precondition itself, it only
// requires the caller to already have both resolved ids in hand.

// A single activity row's `action` label is NOT independently confirmed against the plugin's
// exact stored string — spec 0040's evidence only documents the function name
// (`debit_gift_cards()`), not the literal VARCHAR value it writes. Classifying by the SIGN of
// `amount` instead is grounded directly in the plugin's own documented balance computation
// (balance = SUM(activity.amount) — see spec 0040 Case 2), not a guessed string.
function isRedemptionActivityRow(row) {
  return row != null && Number(row.amount) < 0;
}

// Fixed 2026-08-18 (PR review): a naive "replay every negative row" double-removes value the
// source has already restored. Most gift-card plugins (PW Gift Cards included, per its own
// debit/credit activity model — see spec 0040 Case 2) can credit a card back when an order tied
// to a prior debit is later cancelled, refunded, or fails — a -10/+10 pair for the SAME order
// must net to zero, not emit a 10.00 redemption. This exact reversal mechanism is not
// independently verified against the plugin's own PHP source in this repo yet, but netting per
// order is the only sound behavior regardless of the specific trigger, since ANY reversal for ANY
// reason produces exactly this shape: two-or-more rows, same order, opposite signs.
//
// Returns an array of 0 or 1 netted-activity objects (`{ orderId, amount, activityIds, rows }`) —
// an array, not a bare object, so a fully-reversed or never-redeemed order (net >= 0) can return
// "nothing to build" the same way a not-found lookup would, rather than a sentinel the caller has
// to remember to check.
function findRedemptionActivityForOrder(activityRows, sourceOrderId) {
  const rowsForOrder = (activityRows || []).filter(
    (row) => row != null && Number(row.order_id) === Number(sourceOrderId)
  );
  if (rowsForOrder.length === 0) return [];

  const net = rowsForOrder.reduce((sum, row) => {
    const rowAmount = Number(row.amount);
    return sum + (Number.isFinite(rowAmount) ? rowAmount : 0);
  }, 0);

  // net >= 0: no debit at all for this order, or a later reversal already restored it in full —
  // either way, nothing left to redeem in Wix.
  if (net >= 0) return [];

  return [{
    orderId: sourceOrderId,
    amount: net,
    activityIds: rowsForOrder.map((row) => row.activity_id),
    rows: rowsForOrder,
  }];
}

// Fixed 2026-08-18 (PR review, fourth pass): Policy C's own soundness has a precondition this
// module did not check. Replaying every order-linked redemption reaches the CORRECT final balance
// only when the drift between face value and the bridge's reported current balance is FULLY
// explained by order-linked activity. The bridge explicitly allows manual, non-order-linked
// adjustments (extract_order_id() returns null for these — see spec 0040 Case 2's evidence): a
// card can carry face value 25, a manual credit +5 (order_id null), and a real redemption -10
// (order-linked) — the bridge's own current balance is 20, but blindly replaying only the
// order-linked -10 debit would leave the Wix card at 25 - 10 = 15, silently wrong by 5.
//
// This is the pre-write reconciliation spec 0042 Decision 5 requires before Policy C may be used
// for a card: predict the final balance IF only order-linked activity is replayed (summing, per
// order, the same net-per-order computation findRedemptionActivityForOrder itself uses — a
// net-positive order, like the one that issued the card, correctly contributes nothing to
// replay, exactly the way findRedemptionActivityForOrder already treats it), then compare that
// prediction against the bridge's own reported CURRENT balance (which sums literally every row,
// order-linked or not — no need to specifically detect "the issuance row" or "manual rows"; any
// unaccounted-for activity of any kind surfaces as a mismatch here). A mismatch means Policy C is
// not safe for this card — it must gap for manual review, or fall back to Policy B (create
// directly at the bridge's verified current balance) instead.
function verifyPolicyCReplaySufficiency({ activityRows, faceValue, bridgeCurrentBalance } = {}) {
  const face = faceValue == null ? NaN : Number(faceValue);
  const bridgeBalance = bridgeCurrentBalance == null ? NaN : Number(bridgeCurrentBalance);
  if (!Number.isFinite(face) || !Number.isFinite(bridgeBalance)) {
    return {
      safe: false,
      gap: {
        code: 'policy-c-verification-missing-input',
        summary: `faceValue (${JSON.stringify(faceValue)}) and bridgeCurrentBalance (${JSON.stringify(bridgeCurrentBalance)}) must both be finite numbers to verify Policy C is safe for this card.`,
      },
    };
  }

  const orderIds = Array.from(
    new Set((activityRows || []).map((row) => (row == null ? null : row.order_id)).filter((orderId) => orderId != null))
  );

  const totalReplayAmount = orderIds.reduce((sum, orderId) => {
    const net = findRedemptionActivityForOrder(activityRows, orderId);
    return sum + net.reduce((s, entry) => s + Math.abs(entry.amount), 0);
  }, 0);

  const predictedFinalBalance = Math.round((face - totalReplayAmount) * 100) / 100;
  const roundedBridgeBalance = Math.round(bridgeBalance * 100) / 100;
  const drift = Math.round((roundedBridgeBalance - predictedFinalBalance) * 100) / 100;

  if (Math.abs(drift) > 0.005) {
    return {
      safe: false,
      predictedFinalBalance,
      bridgeCurrentBalance: roundedBridgeBalance,
      drift,
      gap: {
        code: 'policy-c-unexplained-activity',
        summary: `replaying only this card's order-linked activity would leave it at ${predictedFinalBalance}, but the bridge reports a current balance of ${roundedBridgeBalance} (drift ${drift}) — some activity (e.g. a manual, non-order-linked adjustment) is not accounted for by order-linked replay. Policy C is not safe for this card; either gap it for manual review, or use Policy B (create directly at the bridge's verified current balance) instead.`,
      },
    };
  }

  return { safe: true, predictedFinalBalance, bridgeCurrentBalance: roundedBridgeBalance };
}

// One order's redemption -> one Redeem Gift Card body. `sourceOrderId` is the WooCommerce order
// id whose redemption is being linked; the netted activity for it is DERIVED INTERNALLY from
// `options.activityRows` via findRedemptionActivityForOrder — see the fix note below for why this
// is no longer a caller-supplied parameter. `wixCode` is the code the card was actually CREATED
// with (gift-card-build.js's payload.code — after any options.normalizeCode stripping), resolved
// from the crosswalk row this card's issuance produced (sourceStableKey
// `woocommerce:giftCard:<number>`), never re-derived from the raw source number here. `wixOrderId`
// is the real Wix order id returned by Import Order for the order this redemption belongs to.
//
// Fixed 2026-08-18 (PR review, third pass): `options.balancePolicy` is now REQUIRED and must be
// `'C'` — the only one of spec 0042 Decision 5's three balance policies a redemption replay is
// safe under. Policy A is explicitly defined as "face value, no replay"; building a redemption
// for an 'A' card would contradict that policy's own accepted-overstatement design instead of
// implementing it (an 'A' card's overstatement is meant to be corrected manually, via
// disable-and-replace, or accepted — not silently patched by a redemption call the card's own
// policy never called for). Policy B already creates the card at its verified CURRENT balance —
// replaying the same historical redemption on a 'B' card would double-decrement it (once
// implicitly, by never having had the spend reflected in a face-value creation that never
// happened; once again by this call). 'C' is the one policy that means what a redemption call
// does: create at face value, then bring the balance down to correct by replaying real,
// order-linked redemptions — see gift-card-build.js's resolveCardBalance for its (identical to
// 'A') creation-time behavior.
//
// Fixed 2026-08-18 (PR review, fourth pass): declaring Policy C is not by itself proof that
// replay will reach the correct balance for THIS card — see verifyPolicyCReplaySufficiency's own
// comment for the manual-adjustment failure mode this closes. `options.activityRows`,
// `options.faceValue`, and `options.bridgeCurrentBalance` are now REQUIRED alongside
// `balancePolicy: 'C'`, and this function runs that verification itself on every call rather than
// trusting a boolean the caller claims to have already checked — a card that fails verification
// gets a named gap here, never a payload.
//
// Fixed 2026-08-18 (PR review, fifth pass): the fourth pass's own verification was DISCONNECTED
// from the payload it gated. `netActivity` used to be a second, independently caller-supplied
// argument — nothing checked that it was actually derived from the same `activityRows` the
// verification ran against, so a caller (or a bug) could pass activity rows that verify cleanly
// while separately passing a fabricated `netActivity.amount` and still get a real redemption
// payload built for an amount that was never verified at all. There is now exactly ONE source of
// truth: `sourceOrderId` plus `options.activityRows`, and this function derives the netted
// activity itself via `findRedemptionActivityForOrder` — the same call, on the same rows,
// `verifyPolicyCReplaySufficiency` already used — so the built payload can never diverge from
// what was verified.
function buildGiftCardRedemption(sourceOrderId, options) {
  const { wixCode, wixOrderId, wixAppId = WIX_GIFT_CARDS_APP_ID, balancePolicy, activityRows, faceValue, bridgeCurrentBalance } = options || {};
  const notes = [];

  if (balancePolicy !== 'C') {
    return {
      payload: null,
      gaps: [{
        code: 'redemption-replay-requires-policy-c',
        summary: `options.balancePolicy must be "C" to build a redemption — got ${JSON.stringify(balancePolicy)}. Policy A means "face value, no replay" (spec 0042 Decision 5); replaying a redemption on an 'A' card contradicts that policy instead of implementing it. Policy B already creates the card at its verified current balance; replaying the same redemption on a 'B' card would double-decrement it. Only a card explicitly declared Policy C — face value now, corrected later by replaying real order-linked redemptions — may be redeemed here.`,
      }],
      notes,
    };
  }

  const verification = verifyPolicyCReplaySufficiency({ activityRows, faceValue, bridgeCurrentBalance });
  if (!verification.safe) {
    return { payload: null, gaps: [verification.gap], notes };
  }

  if (isBlank(wixCode)) {
    return {
      payload: null,
      gaps: [{ code: 'missing-wix-code', summary: 'options.wixCode is required — resolve it from the crosswalk row this card was issued under (sourceStableKey woocommerce:giftCard:<number>) before building a redemption; never re-derive it from the raw source number, which may have been normalized at creation.' }],
      notes,
    };
  }
  if (isBlank(wixOrderId)) {
    return {
      payload: null,
      gaps: [{ code: 'missing-wix-order-id', summary: 'options.wixOrderId is required — the order this redemption is linked to must already be imported (spec 0042 Decision 1/2) before its redemptions can be recorded.' }],
      notes,
    };
  }

  // Derived from the SAME activityRows the verification above just ran against — never a
  // separately caller-supplied value (see the fifth-pass fix note above).
  const [netActivity = null] = findRedemptionActivityForOrder(activityRows, sourceOrderId);

  const netAmount = netActivity == null ? null : Number(netActivity.amount);
  if (netActivity == null || !Number.isFinite(netAmount) || netAmount >= 0) {
    return {
      payload: null,
      gaps: [{
        code: 'not-a-net-redemption',
        summary: `net activity for order ${sourceOrderId} is "${netActivity && netActivity.amount}" — not a negative net amount once every activity row for this order is netted together, so there is nothing to redeem (either no debit occurred, or a later same-order reversal already restored it).`,
      }],
      notes,
    };
  }

  const amount = Math.abs(netAmount);
  if (amount <= 0) {
    return {
      payload: null,
      gaps: [{ code: 'invalid-redemption-amount', summary: `net activity for order ${netActivity.orderId} has amount "${netActivity.amount}", not a positive value once its sign is taken.` }],
      notes,
    };
  }

  notes.push(`redemption sourced from netted bridge-plugin activity for order_id ${netActivity.orderId} (activity rows: ${JSON.stringify(netActivity.activityIds)}; spec 0040 Case 2) — net amount after any same-order reversal is ${netActivity.amount}.`);

  return {
    payload: {
      code: wixCode,
      amount: amount.toFixed(2),
      orderId: wixOrderId,
      appId: wixAppId,
    },
    gaps: [],
    notes,
  };
}

module.exports = {
  isRedemptionActivityRow,
  findRedemptionActivityForOrder,
  verifyPolicyCReplaySufficiency,
  buildGiftCardRedemption,
};
