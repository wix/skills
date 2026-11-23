'use strict';

// Review normalization belongs before the Wix bulk request. Wix identifies a review by
// product + contact, while source feeds may expose one logical review more than once. This
// module keeps that source identity separate from the one canonical payload sent to Wix.
const crypto = require('node:crypto');
const writers = require('./wix-writers');

const text = value => value == null ? '' : String(value).trim();
const emailOf = record => text(record?.reviewerEmail || record?.email || record?.reviewer?.email
  || record?.author?.email || record?.review?.reviewerEmail || record?.review?.email || record?.review?.author?.email).toLowerCase();
const productOf = record => text(record?.sourceProductId || record?.productId || record?.sourceProduct?.id
  || record?.product?.sourceId || record?.review?.sourceProductId || record?.review?.productId);
const dateOf = record => text(record?.reviewDate || record?.date || record?.createdAt || record?.review?.reviewDate
  || record?.review?.date || record?.review?.createdAt);
const contentOf = record => record?.content || record?.review?.content || {
  title: record?.title || record?.review?.title || '',
  body: record?.body || record?.review?.body || record?.text || record?.review?.text || '',
  rating: record?.rating ?? record?.review?.rating ?? null,
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}

function reviewDedupeKey(record) {
  const product = productOf(record), email = emailOf(record);
  if (!product || !email) throw new Error('review dedupe requires source product id and reviewer email');
  return stableJson({ product, email, date: dateOf(record), content: contentOf(record) });
}

// Returns canonical records in first-seen order. Every canonical record carries all source
// stable keys, so callers can publish one target id to every source row's crosswalk entry.
function dedupeReviewRecords(records) {
  if (!Array.isArray(records)) throw new Error('dedupeReviewRecords requires an array');
  const byKey = new Map(), canonical = [], duplicates = [], duplicateByCanonical = new Map(), sourceToCanonical = new Map(), gaps = [];
  for (const record of records) {
    const sourceStableKey = text(record?.sourceStableKey || record?.sourceKey);
    if (!sourceStableKey) throw new Error('every review needs a sourceStableKey before dedupe');
    const product = productOf(record), email = emailOf(record);
    if (!product || !email) {
      const reason = !email ? 'guest-review-email-missing' : 'review-source-product-missing';
      gaps.push({ sourceStableKeys: [sourceStableKey], reason });
      sourceToCanonical.set(sourceStableKey, null);
      continue;
    }
    const key = reviewDedupeKey(record);
    const existing = byKey.get(key);
    if (!existing) {
      const item = { ...record, sourceStableKeys: [sourceStableKey], sourceIds: [record.sourceId ?? sourceStableKey] };
      byKey.set(key, item); canonical.push(item); sourceToCanonical.set(sourceStableKey, sourceStableKey);
      continue;
    }
    existing.sourceStableKeys.push(sourceStableKey);
    existing.sourceIds.push(record.sourceId ?? sourceStableKey);
    sourceToCanonical.set(sourceStableKey, existing.sourceStableKey);
    let duplicate = duplicateByCanonical.get(existing.sourceStableKey);
    if (!duplicate) { duplicate = { canonicalSourceStableKey: existing.sourceStableKey, sourceStableKeys: [existing.sourceStableKey] }; duplicateByCanonical.set(existing.sourceStableKey, duplicate); duplicates.push(duplicate); }
    duplicate.sourceStableKeys.push(sourceStableKey);
  }
  return { records: canonical, duplicates, sourceToCanonical, gaps };
}

function guestName(record) {
  const value = record?.reviewerName || record?.name || record?.reviewer?.name || record?.review?.reviewerName
    || record?.review?.authorName || record?.review?.author?.authorName || '';
  if (value && typeof value === 'object') return { first: text(value.first || value.givenName), last: text(value.last || value.familyName) };
  const parts = text(value).split(/\s+/).filter(Boolean);
  return { first: parts.shift() || 'Guest', last: parts.join(' ') };
}

function guestReviewContactRows(records, { sourceMarker = 'replatform:guest-review', sourceSystem = 'source' } = {}) {
  if (!Array.isArray(records)) throw new Error('guestReviewContactRows requires an array');
  const byEmail = new Map(), missing = [];
  for (const record of records) {
    const keys = Array.isArray(record?.sourceStableKeys) ? record.sourceStableKeys : [record?.sourceStableKey || record?.sourceKey];
    const email = emailOf(record);
    if (!email) { missing.push({ sourceStableKeys: keys.filter(Boolean), reason: 'guest-review-email-missing' }); continue; }
    const current = byEmail.get(email);
    if (current) { current.reviewSourceStableKeys.push(...keys.filter(Boolean)); continue; }
    const digest = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
    const sourceKey = `${sourceMarker}:${digest}`.slice(0, 100);
    byEmail.set(email, { sourceKey, sourceId: sourceKey, sourceSystem, sourceEntityType: 'guest-review-contact', reviewSourceStableKeys: keys.filter(Boolean),
      contact: { externalId: sourceKey, name: guestName(record), email: { email } }, updateMember: false });
  }
  return { rows: [...byEmail.values()], missing, byEmail };
}

async function requireMutedSiteForReviewContacts(wix) {
  const state = await writers.getSiteMuteState(wix);
  if (state?.muted !== true) throw Object.assign(new Error('guest review contacts require site notifications to be muted'), { code: 'REVIEW_GUEST_CONTACTS_REQUIRE_MUTED_SITE' });
  return state;
}

module.exports = { stableJson, reviewDedupeKey, dedupeReviewRecords, guestReviewContactRows, requireMutedSiteForReviewContacts };
