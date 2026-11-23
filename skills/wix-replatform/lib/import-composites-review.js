'use strict';

// Design v2 K2: product reviews run inside the shared loop (import-task-runner.js runRecordTask).
// Generated code gives only build(record, lookups):
//   { review: { namespace: 'stores', entityId, author: { contactId, authorName }, content, reviewDate },
//     authorEmail, loopInput: { moderation: 'APPROVED' | 'REJECTED' } }
// with entityId from lookups.ref('stores/product', …, 'entityId') and the author from
// lookups.contactByEmail(email, 'author.contactId') (the loop finds the contact: a customer with
// that email, else the guest review contact the contact task wrote). Which fields go where and the
// moderation mapping are plan choices; this file is the fixed part:
//   - the author check: a review whose email names no contact row at all is held with a cutover
//     item (never written without its author, never sent to a guessed contact);
//   - create: createStoresReviews, one review per call with the record's own grant. Wix keeps one
//     review per author per product: an ALREADY_EXISTS answer is adopted (read back), so a retry
//     never duplicates; adopting a review another source review already landed on is recorded as
//     a merge and a cutover item (no silent loss);
//   - moderation: a follow-up step, read back (moderateStoresReviews); a step that does not finish
//     leaves the review imported with the step owed, resumed next pass (A1's partial-failure rule).
// The loop writes the crosswalk (`ownsCrosswalk: false`).

const STEP_DONE = 'done';
const writers = () => require('../resources/rp-target-wix/lib/wix-writers');

const review = {
  operation: 'createStoresReviews', steps: ['create', 'moderation'], ownsCrosswalk: false,
  // Inside the gate, after build. The gated body is the bare review item: the gate and the bulk
  // send check (one item per source key) both read entityId and author.contactId on it.
  async check(record, body, c) {
    const wrapped = body && typeof body === 'object' && Object.hasOwn(body, 'review');
    const item = wrapped ? body.review : body;
    if (!item || typeof item !== 'object') return { body: item };
    if (item.author?.contactId) return { body: item };
    const email = wrapped ? body.authorEmail : undefined;
    // A contact row exists but has not landed yet: the gate waits for it (the lookup's blocker).
    if (email && c.contactKeyByEmail(email)) return { body: item };
    const code = email ? 'review-author-contact-missing' : 'review-author-email-missing';
    await c.recordGap(code, { severity: 'low',
      action: email
        ? 'These reviews were not imported: no contact (customer or guest reviewer) has the reviewer\'s email, so Wix has no author for them. Add the reviewer as a guest review contact (the contact task\'s derived-guest-review-contact rows) and rerun the contact and review imports, or accept the loss.'
        : 'These reviews were not imported: the source review has no reviewer email, and a Wix review needs an author contact. Add the review by hand in Business Manager → Reviews if it matters, or accept the loss.',
      detail: {} });
    return { status: 'held', holds: [{ decisionId: 'review-author', code }] };
  },
  async send(client, payload, record, c) {
    const steps = {}, findings = [], input = c.loopInput || {};
    let targetId = c.existingTargetId || null;
    if (!targetId || !c.done.create) {
      const [row] = await c.primitives.createReviews(c.taskClient, { records: [{ sourceStableKey: c.key, review: payload }], readinessGrant: c.grant });
      const outcome = row?.outcome;
      if (outcome === 'created' || outcome === 'adopted') {
        targetId = String(row.reviewId || row.targetId);
        const owner = await c.targetOwner(targetId);
        if (outcome === 'adopted' && owner && owner !== c.key) {
          findings.push({ code: 'review-merged-one-per-author-product', canonicalSourceStableKey: owner });
          await c.recordGap('review-merged-one-per-author-product', { operatorRole: 'Cutover Operator', severity: 'low',
            action: 'Wix keeps one review per customer per product. These source reviews are by an author who already has a review of the same product, so each now points to that one review (listed). Nothing else to do unless the other review\'s text matters; then add it to the kept review\'s text in Business Manager → Reviews.',
            detail: { targetId, canonicalSourceStableKey: owner } });
        }
      } else if (outcome === 'unknown') {
        return { base: { outcome: 'review-write-unknown', unverified: true, error: Object.assign(new Error(String(row?.errorMessage || row?.error?.message || 'review outcome unknown')), { outcomeKnown: false }) }, steps };
      } else {
        const error = Object.assign(new Error(String(row?.errorMessage || row?.error?.message || 'review write failed')), { code: row?.errorCode || 'review-write-failed' },
          Number.isInteger(row?.error?.status) ? { status: row.error.status } : {}, row?.error?.requestSent === false ? { requestSent: false } : {});
        return { base: { outcome: row?.errorCode || 'review-write-failed', error }, steps };
      }
    }
    steps.create = STEP_DONE;
    if (!input.moderation || c.done.moderation) steps.moderation = STEP_DONE;
    else {
      let moderated;
      try { [moderated] = await c.primitives.moderateReviews([{ wix: client, reviewId: targetId, status: input.moderation }]); }
      catch (error) { if (c.isInterruption?.(error)) throw error; moderated = { outcome: 'moderation-failed' }; }
      steps.moderation = moderated?.outcome === 'moderated' ? STEP_DONE : moderated?.outcome || 'moderation-failed';
    }
    return { base: { targetId, outcome: 'review-imported' }, steps, findings };
  },
};

const primitives = {
  createReviews: (wix, options) => writers().createStoresReviews(wix, options),
  moderateReviews: items => writers().moderateStoresReviews(items),
};

module.exports = { COMPOSITES: { 'stores/review': review }, primitives };
