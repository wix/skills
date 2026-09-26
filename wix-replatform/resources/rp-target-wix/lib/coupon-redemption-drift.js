'use strict';

// A spent coupon must not import redeemable, and a migrated coupon must be identifiable.
//
// A bearer voucher is money: a fixed amount off, single use, no scope, no minimum, no expiry.
// Whoever holds the code can spend it. rp-source-wordpress/lib/coupon-discovery.js already gets
// the STATIC rule right (exhausted at capture -> imported inactive, because Wix starts its own
// usage count at zero). This module covers the TEMPORAL half, which nothing else does:
//
//   * the snapshot the import reads is dated, and a stale one is refused rather than imported;
//   * a voucher spent between capture and write is not written at all;
//   * a voucher spent AFTER the import is reconciled at cutover against a fresh source read.
//
// THE UPDATE RULE, measured live against a disposable store with throwaway codes, all deleted
// afterwards. Update Coupon WORKS, and the trap is the request shape:
//
//   PATCH /stores/v2/coupons/{id}
//     body { specification: { active: false } }  + fieldMask                 -> WRITES
//       fieldMask may be `?fieldMask=active`, `?fieldMask.paths=active`, or body
//       `fieldMask: { paths: ['active'] }`. Paths are specification field names (`active`,
//       `tags`) WITHOUT a `specification.` prefix -- `specification.active` 500s.
//     body { specification: { active: false } }  with NO fieldMask           -> 400, named clearly
//     body { specification: <THE WHOLE SPEC>  }  + fieldMask: ['active']     -> 200, body {}, NO-OP
//
// THAT LAST LINE IS THE WHOLE HAZARD. Send only the fields being changed. Sending the full
// specification alongside a narrow field mask is accepted with 200 and an empty body and changes
// nothing -- re-read at +15s, +45s and +150s confirmed no change, which is far longer than this
// surface's own read lag. A repair pass built that way reports thousands of vouchers closed while
// every one stays spendable: a false pass on money. Hence verifyRemedyApplied below, which
// refuses to call any 2xx an applied remedy without a post-settle read-back.
//
// PUT /stores/v2/coupons/{id} is 404 (no such route) and there is no v3 coupons surface.
// DELETE /stores/v2/coupons/{id} works (200, gone within ~4s), and a deleted CODE can be
// re-created -- but re-creating mints a new coupon id, so deactivating in place is preferred.
//
// One call can set `active` and `tags` together: `?fieldMask=active,tags`. Verified.
//
// Pure: no I/O, no clock of its own. Every function takes `now` and the already-read data, so the
// same inputs always give the same verdict.

const OUTCOMES = Object.freeze({
  // Pre-write, Decision 2/3.
  WRITE_OK: 'voucher-still-redeemable-at-write',
  SPENT_AFTER_CAPTURE: 'coupons-spent-after-capture',
  UNDECIDABLE: 'voucher-usage-unknown-at-write',
  PRECISION_UNSUPPORTED: 'voucher-face-value-precision-unsupported',
  // Post-import, Decision 4.
  RECONCILED_MATCH: 'voucher-drift-reconciled',
  REMEDY_PENDING: 'voucher-drift-remedy-pending',
  SOURCE_GONE: 'voucher-source-row-missing',
  TARGET_GONE: 'voucher-target-row-missing',
  TARGET_STATE_UNREADABLE: 'voucher-target-state-unreadable',
});

// The remedies the platform actually offers, in preference order. DEACTIVATE is first because it
// keeps the coupon id, the code, the dates and the amount -- the merchant keeps a readable record
// of a voucher that can no longer be cashed, and nothing that referenced the coupon id is
// orphaned. DELETE stays available because it is the only option if a code must disappear
// entirely; note it frees the code for re-creation but mints a new id.
const REMEDY = Object.freeze({
  DEACTIVATE: 'deactivate-on-target',
  DELETE: 'delete-on-target',
  NONE: 'no-action-needed',
  ASK: 'owner-decision-required',
});

// The tag vocabulary, frozen here so two passes cannot invent variants of the same word. `tags` is a real validated field on the coupon specification
// (array<string>, max 100 items, max 255 chars each) and it is settable at create AND updatable
// in place through the same minimal-specification PATCH as `active`.
const TAGS = Object.freeze({
  IMPORTED: 'Imported',
  ALREADY_USED: 'Already_Used',
  PARTIALLY_USED: 'Partially_Used',
  DISABLED_AT_SOURCE: 'Disabled_At_Source',
});
const KNOWN_TAGS = Object.freeze(Object.values(TAGS));

const SNAPSHOT = Object.freeze({
  FRESH: 'snapshot-fresh',
  STALE: 'snapshot-stale',
  UNDATED: 'snapshot-undated',
});

// A usage LIMIT: 0, '' and null all mean UNLIMITED in WooCommerce, never "no uses allowed".
// The source adapter already applies this; repeating it here is deliberate, because this module
// re-reads the source directly and a limit that changed to unlimited between the two reads came
// back as 0 and read as "exhausted" -- proposing to switch off a coupon the merchant had just
// made unlimited.
function usageLimitOrUnlimited(value) {
  const n = integerOrNull(value);
  return n === null || n === 0 ? null : n;
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function epochMsOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  // WooCommerce `*_gmt` fields carry no timezone suffix and are UTC. Same rule as
  // coupon-discovery.js, repeated here rather than imported: this module must not depend on a
  // source adapter.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

// Money is carried EXACTLY, never rounded into shape. `Number(text).toFixed(2)` turns a source
// value of 19.999 into 20.00 and 1.004 into 1.00, and a reconciliation built on that reports a
// source and a target that differ as equal -- false verified equality on money, which is the one
// result a reconciliation must never produce. So: parse, keep every digit, and count the decimal
// places so a caller can refuse what the target cannot represent rather than round into it.
function exactAmount(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const bare = text.startsWith('-') ? text.slice(1) : text;
  const [whole, frac = ''] = bare.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return {
    // Canonical, and lossless: trailing zeros are not precision, so 150.00 and 150 are one value.
    exact: trimmed ? `${String(BigInt(whole))}.${trimmed}` : String(BigInt(whole)),
    decimals: trimmed.length,
  };
}

// The target stores money to 2 decimal places. More than that is not a rounding decision we get
// to make on the merchant's behalf -- it is a value the target cannot hold, and it is reported.
const TARGET_DECIMALS = 2;

// Minor units as a BigInt, so a total of thousands of coupons cannot drift the way a float sum
// does. Returns null when any value carries precision the target cannot represent.
function toMinorUnits(amount) {
  const parsed = exactAmount(amount);
  if (parsed === null || parsed.decimals > TARGET_DECIMALS) return null;
  const [whole, frac = ''] = parsed.exact.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
}
// How a face value is REPORTED. Representable amounts render as money (two places, so 150 and
// 150.00 read alike); anything the target cannot hold keeps every digit it came with, so the gap
// names the real value rather than a tidied one.
function displayAmount(value) {
  const parsed = exactAmount(value);
  if (parsed === null) return null;
  if (parsed.decimals > TARGET_DECIMALS) return parsed.exact;
  return minorUnitsToDecimal(toMinorUnits(parsed.exact));
}

function minorUnitsToDecimal(minor) {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// Decision 2's narrowing. A bearer voucher is the money-instrument shape and NOT every coupon:
// a percentage promo re-imported after being spent is a discount someone gets twice, which does
// not earn a per-coupon fresh read. Reads a WooCommerce coupon row.
function isBearerVoucher(coupon) {
  if (!coupon || typeof coupon !== 'object') return false;
  const type = String(coupon.discount_type || '').trim();
  if (type !== 'fixed_cart') return false;
  if (coupon.free_shipping === true) return false;
  // Minor units, not a float: "is there a money amount here" must not depend on parsing money
  // through a double. A value too precise for the target is still a money amount -- the narrowing
  // decides what KIND of coupon this is; the precision gap is reported elsewhere.
  const parsed = exactAmount(coupon.amount);
  if (parsed === null || BigInt(parsed.exact.replace('.', '').replace(/^0+(?=\d)/, '') || '0') === 0n) return false;
  const scoped = (Array.isArray(coupon.product_ids) && coupon.product_ids.length > 0)
    || (Array.isArray(coupon.product_categories) && coupon.product_categories.length > 0);
  if (scoped) return false;
  const minimum = exactAmount(coupon.minimum_amount);
  if (minimum !== null && BigInt(minimum.exact.replace('.', '').replace(/^0+(?=\d)/, '') || '0') > 0n) return false;
  // Single use is what makes it a bearer instrument rather than a standing promo. `usage_limit`
  // 0 or empty is UNLIMITED in WooCommerce (the trap coupon-discovery.js documents), so an
  // unlimited code is explicitly NOT a voucher.
  return integerOrNull(coupon.usage_limit) === 1;
}

// A snapshot that cannot be dated is refused exactly like a stale one: "we do not
// know when this was captured" and "this was captured too long ago" are the same risk for a money
// instrument, and neither may be treated as fresh.
function classifySnapshot({ capturedAt, now, maxAgeMs } = {}) {
  const captured = epochMsOrNull(capturedAt);
  const at = epochMsOrNull(now);
  if (at === null) throw new Error('classifySnapshot needs `now`');
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('classifySnapshot needs a positive integer maxAgeMs (the run\'s freshness budget)');
  if (captured === null) {
    return { verdict: SNAPSHOT.UNDATED, capturedAt: null, ageMs: null, maxAgeMs, fresh: false, reason: 'the source snapshot carries no capture time, so its redeemability values cannot be dated' };
  }
  const ageMs = at - captured;
  if (ageMs > maxAgeMs) {
    return { verdict: SNAPSHOT.STALE, capturedAt: captured, ageMs, maxAgeMs, fresh: false, reason: `the source snapshot is ${Math.round(ageMs / 3600000)}h old and the run's budget is ${Math.round(maxAgeMs / 3600000)}h; a voucher spent since capture would import fully redeemable` };
  }
  return { verdict: SNAPSHOT.FRESH, capturedAt: captured, ageMs, maxAgeMs, fresh: true, reason: null };
}

// Decision 2 and 3, per voucher, immediately before the write. `snapshotCoupon` is the row the
// plan was built from; `freshCoupon` is the row just re-read from the source, or null when the
// re-read failed. A failed re-read is UNDECIDABLE and writes nothing -- an undecidable money
// instrument written active is a giveaway.
function classifyPreWriteDrift({ snapshotCoupon, freshCoupon } = {}) {
  if (!snapshotCoupon || !snapshotCoupon.code) throw new Error('classifyPreWriteDrift needs the snapshot coupon row (with a code)');
  const code = String(snapshotCoupon.code);
  const parsed = exactAmount(snapshotCoupon.amount);
  const faceValue = displayAmount(snapshotCoupon.amount);
  const facePrecisionUnsupported = parsed !== null && parsed.decimals > TARGET_DECIMALS;
  const base = { code, faceValue, facePrecisionUnsupported, remedy: REMEDY.NONE };

  // A face value the target cannot hold is refused BEFORE anything else. Writing it means the
  // target silently holds a different amount from the source while every check reports a match,
  // and that is worse than not writing the coupon at all.
  if (facePrecisionUnsupported) {
    return { ...base, outcome: OUTCOMES.PRECISION_UNSUPPORTED, write: false, reason: `the face value ${faceValue} carries more than ${TARGET_DECIMALS} decimal places, which the target cannot hold. Report it; do not round it into the target` };
  }
  if (!freshCoupon) {
    return { ...base, outcome: OUTCOMES.UNDECIDABLE, write: false, reason: 'the pre-write re-read of this coupon did not return a row; redeemability is unknown and unknown is not written' };
  }
  const limit = usageLimitOrUnlimited(freshCoupon.usage_limit);
  const rawLimit = integerOrNull(freshCoupon.usage_limit);
  const count = integerOrNull(freshCoupon.usage_count);
  if (count === null || (rawLimit === null && freshCoupon.usage_limit !== 0 && freshCoupon.usage_limit !== null && freshCoupon.usage_limit !== undefined && String(freshCoupon.usage_limit).trim() !== '')) {
    return { ...base, outcome: OUTCOMES.UNDECIDABLE, write: false, reason: 'the re-read row has unreadable usage fields', usageLimit: freshCoupon.usage_limit, usageCount: freshCoupon.usage_count };
  }
  // Unlimited is never exhausted, however high the count.
  if (limit === null) {
    return { ...base, outcome: OUTCOMES.WRITE_OK, write: true, writeActive: true, setTags: [TAGS.IMPORTED], usageCount: count, usageLimit: null, usageUnlimited: true };
  }
  const snapshotCount = integerOrNull(snapshotCoupon.usage_count) || 0;
  if (count >= limit) {
    // Decision 1: an exhausted coupon is WRITTEN, switched off. Skipping it loses the record and
    // loses the crosswalk row that historical orders referencing this code need. It keeps a
    // positive limit because the target rejects a limit of zero.
    return {
      ...base,
      outcome: count > snapshotCount ? OUTCOMES.SPENT_AFTER_CAPTURE : OUTCOMES.WRITE_OK,
      write: true,
      writeActive: false,
      setTags: [TAGS.IMPORTED, TAGS.ALREADY_USED],
      usageCount: count,
      usageLimit: limit,
      spentSinceCapture: count > snapshotCount,
      reason: count > snapshotCount
        ? `spent at source after the snapshot was captured (${snapshotCount} -> ${count} of ${limit}); written switched off so ${faceValue || 'its value'} cannot be redeemed again, and the record survives`
        : `already used up at capture (${count} of ${limit}); written switched off as a record of the promotion`,
    };
  }
  const remaining = limit - count;
  return {
    ...base,
    outcome: OUTCOMES.WRITE_OK,
    write: true,
    writeActive: true,
    // Decision 1: the uses the holder has LEFT, never the original limit.
    writeUsageLimit: remaining,
    setTags: count > 0 ? [TAGS.IMPORTED, TAGS.PARTIALLY_USED] : [TAGS.IMPORTED],
    usageCount: count,
    usageLimit: limit,
  };
}

// Decision 4, per already-written voucher, at cutover. `receipt` is the import receipt
// ({ code, wixId, kind }); `freshCoupon` is the source row re-read now, or null; `targetCoupon`
// is the coupon as it reads back on Wix, or null.
function classifyPostImportDrift({ receipt, freshCoupon, targetCoupon } = {}) {
  if (!receipt || !receipt.code) throw new Error('classifyPostImportDrift needs an import receipt with a code');
  const code = String(receipt.code);
  const wixId = receipt.wixId ? String(receipt.wixId) : null;
  const rawAmount = exactAmount(freshCoupon && freshCoupon.amount) !== null ? (freshCoupon && freshCoupon.amount) : receipt.faceValue;
  const parsed = exactAmount(rawAmount);
  const faceValue = displayAmount(rawAmount);
  // A face value the target cannot hold is a GAP, never a rounded number that reads as agreement.
  const facePrecisionUnsupported = parsed !== null && parsed.decimals > TARGET_DECIMALS;
  const base = { code, wixId, faceValue, facePrecisionUnsupported };

  if (!targetCoupon) {
    // Not "fine": this surface's read lag is long enough that absent is UNKNOWN, never gone.
    return { ...base, outcome: OUTCOMES.TARGET_GONE, remedy: REMEDY.ASK, reason: 'the coupon did not read back from the target; this surface\'s read lag makes absent indistinguishable from deleted, so re-read before concluding anything' };
  }
  // FINDING 1: `active` must be an explicit boolean. An object with no `active` at all read as
  // "not true" and therefore as "already switched off" -- a partial or truncated read-back
  // silently reported a coupon as handled. Absent is UNKNOWN, always.
  const targetSpec = targetCoupon.specification || targetCoupon;
  const targetActive = typeof targetSpec.active === 'boolean' ? targetSpec.active : null;
  if (targetActive === null) {
    return { ...base, outcome: OUTCOMES.TARGET_STATE_UNREADABLE, remedy: REMEDY.ASK, reason: 'the target row came back without a readable `active` flag, so whether it is redeemable is unknown; re-read rather than assuming either state' };
  }
  if (!freshCoupon) {
    return { ...base, outcome: OUTCOMES.SOURCE_GONE, remedy: REMEDY.ASK, targetActive: targetActive === true, reason: 'the source row for this code was not found in the fresh read; it may have been deleted at source, which is a different decision from being spent' };
  }
  const count = integerOrNull(freshCoupon.usage_count);
  const rawLimit = freshCoupon.usage_limit;
  const limitReadable = rawLimit === null || rawLimit === undefined || String(rawLimit).trim() === '' || integerOrNull(rawLimit) !== null;
  if (count === null || !limitReadable) {
    return { ...base, outcome: OUTCOMES.SOURCE_GONE, remedy: REMEDY.ASK, targetActive, reason: 'the fresh source row has unreadable usage fields, so drift cannot be decided' };
  }
  // FINDING 4: 0 / empty means UNLIMITED, so an unlimited coupon is never "spent".
  const limit = usageLimitOrUnlimited(rawLimit);
  const spentAtSource = limit !== null && count >= limit;
  if (spentAtSource && targetActive === true) {
    return {
      ...base,
      outcome: OUTCOMES.REMEDY_PENDING,
      remedy: REMEDY.DEACTIVATE,
      targetActive: true,
      usageCount: count,
      usageLimit: limit,
      sourceRedeemedAt: freshCoupon.date_modified_gmt || freshCoupon.date_modified || null,
      // switch it off and say why in the same call, so the record survives
      // and is self-explanatory in the dashboard.
      setTags: [TAGS.IMPORTED, TAGS.ALREADY_USED],
      reason: `spent at source (${count} of ${limit}) and still active on the target, so ${faceValue || 'its value'} is redeemable a second time. Remedy: deactivate in place and tag ${TAGS.ALREADY_USED} -- the coupon id, code, dates and amount all survive`,
    };
  }
  if (spentAtSource && targetActive === false) {
    return { ...base, outcome: OUTCOMES.RECONCILED_MATCH, remedy: REMEDY.NONE, targetActive: false, usageCount: count, usageLimit: limit, reason: 'used up at source and already switched off on the target' };
  }
  return { ...base, outcome: OUTCOMES.RECONCILED_MATCH, remedy: REMEDY.NONE, targetActive, usageCount: count, usageLimit: limit, usageUnlimited: limit === null, reason: limit === null ? 'unlimited at source and still redeemable on the target' : 'still redeemable at source and still redeemable on the target' };
}

// Turns the per-voucher verdicts into the remedy plan a human approves: counts,
// the money still live on the target, and one row per code with everything needed to rule on it.
// Read-only by construction — this returns a plan, it does not apply one.
function buildVoucherDriftPlan({ verdicts = [], ordersByCouponCode = {}, currency = null } = {}) {
  if (!Array.isArray(verdicts)) throw new Error('buildVoucherDriftPlan needs an array of verdicts');
  const counts = {
    [OUTCOMES.RECONCILED_MATCH]: 0,
    [OUTCOMES.REMEDY_PENDING]: 0,
    [OUTCOMES.SOURCE_GONE]: 0,
    [OUTCOMES.TARGET_GONE]: 0,
    [OUTCOMES.TARGET_STATE_UNREADABLE]: 0,
  };
  const rows = [];
  // FINDING 2: precision is judged across ALL verdicts, including the reconciled ones that never
  // reach `rows`. A coupon whose face value the target cannot hold is a gap whatever its drift
  // verdict says, and filtering it out before the check produced an approvable plan with no row.
  const precisionGaps = verdicts.filter((v) => v && v.facePrecisionUnsupported === true)
    .map((v) => ({ code: v.code, faceValue: v.faceValue, outcome: v.outcome }));
  let liveLiability = 0n;
  let liabilityUnknownFor = 0;
  for (const v of verdicts) {
    if (!v || !v.outcome) throw new Error('every verdict needs an outcome');
    if (counts[v.outcome] === undefined) throw new Error(`buildVoucherDriftPlan got a pre-write outcome it cannot plan for: ${v.outcome}`);
    counts[v.outcome] += 1;
    if (v.outcome !== OUTCOMES.REMEDY_PENDING && v.remedy === REMEDY.NONE) continue;
    if (v.outcome === OUTCOMES.REMEDY_PENDING) {
      // Exact integer arithmetic, and a value the target cannot represent is NOT folded into the
      // total: a liability figure that quietly rounded its inputs is worse than one that says
      // which codes it could not count.
      const minor = v.faceValue === null || v.faceValue === undefined ? null : toMinorUnits(v.faceValue);
      if (minor === null) liabilityUnknownFor += 1;
      else liveLiability += minor;
    }
    const affectedOrders = ordersByCouponCode[v.code] || [];
    rows.push({
      code: v.code,
      wixId: v.wixId || null,
      faceValue: v.faceValue === undefined ? null : v.faceValue,
      facePrecisionUnsupported: v.facePrecisionUnsupported === true,
      outcome: v.outcome,
      remedy: v.remedy,
      targetActive: v.targetActive === true,
      sourceRedeemedAt: v.sourceRedeemedAt || null,
      setTags: Array.isArray(v.setTags) ? [...v.setTags] : null,
      // deleting removes a record an imported order points at through
      // appliedDiscounts[].coupon.id. The owner rules with that list visible, not after.
      affectedOrders: [...affectedOrders],
      reason: v.reason || null,
    });
  }
  rows.sort((a, b) => {
    const bm = toMinorUnits(b.faceValue) ?? -1n;
    const am = toMinorUnits(a.faceValue) ?? -1n;
    return bm === am ? a.code.localeCompare(b.code) : (bm > am ? 1 : -1);
  });

  const blocking = [];
  if (precisionGaps.length > 0) {
    blocking.push({ code: 'voucher-face-value-precision-unsupported', detail: `${precisionGaps.length} coupon(s) carry a face value with more than ${TARGET_DECIMALS} decimal places, which the target cannot hold: ${precisionGaps.slice(0, 5).map((r) => `${r.code} (${r.faceValue})`).join(', ')}. Report the gap — do NOT round it into the target and do not count it in the liability` });
  }
  if (counts[OUTCOMES.TARGET_STATE_UNREADABLE] > 0) {
    blocking.push({ code: 'voucher-target-state-unreadable', detail: `${counts[OUTCOMES.TARGET_STATE_UNREADABLE]} coupon(s) came back without a readable \`active\` flag. Whether they are redeemable is unknown — re-read before approving a plan built on them` });
  }
  if (counts[OUTCOMES.TARGET_GONE] > 0) {
    blocking.push({ code: 'voucher-target-read-incomplete', detail: `${counts[OUTCOMES.TARGET_GONE]} voucher(s) did not read back from the target. Absent is UNKNOWN on this surface, not deleted — re-read after a settle before approving a plan built on it` });
  }
  return {
    counts,
    rows,
    // the count and the money are the same fact, and only one of them gets decided on.
    liability: {
      currency: currency ? String(currency) : null,
      live: minorUnitsToDecimal(liveLiability),
      codes: counts[OUTCOMES.REMEDY_PENDING],
      // Codes whose face value could not be counted exactly -- unreadable, or carrying more
      // precision than the target can hold. The total above EXCLUDES them, and saying so is the
      // point: a total that silently absorbed them would look complete.
      unknownValueFor: liabilityUnknownFor,
    },
    blocking,
    approvable: blocking.length === 0,
    // There is no apply path in this module on purpose. A caller that wants to act reads
    // `rows[].remedy`, gets an explicit owner decision per Decision 5, and verifies per Decision 6.
    readOnly: true,
  };
}

// Builds the Update Coupon request for a remedy, in the ONE shape that actually
// writes: a specification carrying ONLY the changed fields, plus a field mask naming them.
// Refusing to build any other shape is the point -- a caller that spreads the existing
// specification in gets a 200 and a silent no-op, which is the defect this whole module guards.
function buildRemedyRequest({ couponId, remedy, setTags } = {}) {
  if (!couponId) throw new Error('buildRemedyRequest needs the target couponId');
  if (remedy === REMEDY.DELETE) {
    return { method: 'DELETE', url: `/stores/v2/coupons/${encodeURIComponent(couponId)}` };
  }
  if (remedy !== REMEDY.DEACTIVATE) throw new Error(`buildRemedyRequest knows ${REMEDY.DEACTIVATE} and ${REMEDY.DELETE}, not ${String(remedy)}`);
  const specification = { active: false };
  const paths = ['active'];
  if (setTags !== undefined && setTags !== null) {
    if (!Array.isArray(setTags) || setTags.some((t) => typeof t !== 'string' || !t)) throw new Error('setTags must be an array of non-empty strings');
    const unknown = setTags.filter((t) => !KNOWN_TAGS.includes(t));
    // The vocabulary is frozen on purpose: `tags` cannot be edited without another update, and a
    // typo'd tag is indistinguishable from a real one to whoever reads the dashboard later.
    if (unknown.length > 0) throw new Error(`unknown tag(s) ${unknown.join(', ')}; the frozen vocabulary is ${KNOWN_TAGS.join(', ')}`);
    specification.tags = [...setTags];
    paths.push('tags');
  }
  return {
    method: 'PATCH',
    url: `/stores/v2/coupons/${encodeURIComponent(couponId)}`,
    // ONLY the changed fields. Never the full specification -- see the header block.
    body: { specification, fieldMask: { paths } },
  };
}

// The one thing a caller must never do is believe the status code. Given the response
// of a remedy call and a read-back taken after a settle, say what actually happened.
function verifyRemedyApplied({ remedy, responseStatus, readBackAfterSettle, settleMs } = {}) {
  if (remedy !== REMEDY.DELETE && remedy !== REMEDY.DEACTIVATE) {
    throw new Error(`verifyRemedyApplied knows ${REMEDY.DEACTIVATE} and ${REMEDY.DELETE}, not ${String(remedy)} `);
  }
  const ok = responseStatus === 200 || responseStatus === 204;
  if (!ok) return { applied: false, verdict: 'remedy-failed', reason: `the ${remedy === REMEDY.DELETE ? 'delete' : 'update'} returned ${String(responseStatus)}` };
  if (readBackAfterSettle === undefined) {
    return { applied: false, verdict: 'remedy-unverified', reason: 'a 2xx is not evidence of a change on this surface -- a PATCH carrying the FULL specification alongside a narrow field mask returns 200 with an empty body and writes nothing; pass the post-settle read-back' };
  }
  const settleS = Math.round((settleMs || 0) / 1000);
  if (remedy === REMEDY.DELETE) {
    if (readBackAfterSettle === null) return { applied: true, verdict: 'remedy-applied', reason: `the code is absent from the target after ~${settleS}s, which is what a delete looks like` };
    return { applied: false, verdict: 'remedy-unverified', reason: 'the coupon still reads back after the delete; treat as UNKNOWN and re-read, do not re-issue' };
  }
  // DEACTIVATE: absent is NOT success here. A deactivated coupon must still be readable; an
  // absent one means something deleted it, which is a different outcome than the one requested.
  if (readBackAfterSettle === null) {
    return { applied: false, verdict: 'remedy-unverified', reason: `the coupon did not read back after ~${settleS}s. A deactivate leaves the record in place, so absent is UNKNOWN (this surface's read lag), never "switched off"` };
  }
  const spec = readBackAfterSettle.specification || readBackAfterSettle;
  // FINDING 1: only an explicit `false` is proof. `{}` and `{active: undefined}` previously fell
  // through to "applied" -- a truncated or partial read-back reported a coupon as switched off
  // when nothing had been read at all.
  if (spec.active === false) {
    return { applied: true, verdict: 'remedy-applied', reason: `active reads back false after ~${settleS}s${Array.isArray(spec.tags) ? `, tags ${JSON.stringify(spec.tags)}` : ''}` };
  }
  if (spec.active === true) {
    return { applied: false, verdict: 'remedy-unverified', reason: `the update returned 2xx and the coupon still reads back active after ~${settleS}s -- the signature of a full-specification PATCH being silently ignored. Re-send with ONLY the changed fields` };
  }
  return { applied: false, verdict: 'remedy-unverified', reason: `the read-back carried no readable \`active\` flag after ~${settleS}s, so nothing was confirmed. Re-read; absent is never proof of a change` };
}

module.exports = {
  OUTCOMES,
  REMEDY,
  TAGS,
  KNOWN_TAGS,
  SNAPSHOT,
  isBearerVoucher,
  exactAmount,
  toMinorUnits,
  displayAmount,
  classifySnapshot,
  classifyPreWriteDrift,
  classifyPostImportDrift,
  buildVoucherDriftPlan,
  buildRemedyRequest,
  verifyRemedyApplied,
};
