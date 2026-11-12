'use strict';

// The source media record, not a product payload's filename, is the proof that a
// WordPress-family product picture is the uploaded file. This module deliberately owns both the
// read provenance and the gallery provenance so neither side can be forged by a caller.

const MEDIA_READ_CHUNK_SIZE = 100;
const MEDIA_READ_DEADLINE_MS = 60000;
const GUARDED_MEDIA_SOURCES = new Set(['woocommerce', 'wordpress']);
const REASON_ORDER = ['no-source-id', 'no-source-record', 'source-unreadable'];

const trustedReads = new WeakSet();
const confirmedGalleries = new WeakSet();
let declaredMediaSource;

function sourceIdOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function freezeList(values) {
  return Object.freeze(values.slice());
}

function freezeGallery(items) {
  const gallery = items.map((item) => Object.freeze({ ...item }));
  Object.freeze(gallery);
  confirmedGalleries.add(gallery);
  return gallery;
}

async function readSourceMediaRecords({ ids, source } = {}) {
  if (!Array.isArray(ids)) throw new TypeError('readSourceMediaRecords: ids must be an array');
  if (!source || !isNonEmptyString(source.baseUrl) || typeof source.request !== 'function') {
    throw new TypeError('readSourceMediaRecords: source must provide baseUrl and request');
  }

  const distinctIds = Array.from(new Set(ids.map(sourceIdOf).filter(Boolean))).sort((a, b) => a - b);
  const files = Object.create(null);
  const missing = [];
  const unreadable = [];

  for (let offset = 0; offset < distinctIds.length; offset += MEDIA_READ_CHUNK_SIZE) {
    const chunk = distinctIds.slice(offset, offset + MEDIA_READ_CHUNK_SIZE);
    let response;
    try {
      response = await source.request(source.baseUrl, '/wp/v2/media', {
        method: 'GET',
        query: { include: chunk.join(','), per_page: MEDIA_READ_CHUNK_SIZE },
        deadlineMs: MEDIA_READ_DEADLINE_MS,
      });
    } catch {
      unreadable.push(...chunk);
      continue;
    }

    if (!response || response.ok !== true || !Array.isArray(response.json)) {
      unreadable.push(...chunk);
      continue;
    }

    const returned = new Map();
    for (const record of response.json) {
      const id = sourceIdOf(record && record.id);
      if (id !== null && chunk.includes(id) && isHttpUrl(record.source_url)) {
        returned.set(id, new URL(record.source_url).toString());
      }
    }
    for (const id of chunk) {
      if (returned.has(id)) files[id] = returned.get(id);
      else missing.push(id);
    }
  }

  const read = Object.freeze({
    files: Object.freeze(files),
    missing: freezeList(missing),
    unreadable: freezeList(unreadable),
  });
  trustedReads.add(read);
  return read;
}

function sameHostAndPath(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.host.toLowerCase() === b.host.toLowerCase() && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

function confirmPictures({ pictures, read } = {}) {
  if (!trustedReads.has(read)) {
    throw new Error('confirmPictures: read must be the unmodified result of readSourceMediaRecords');
  }
  if (!Array.isArray(pictures)) throw new TypeError('confirmPictures: pictures must be an array');

  const confirmed = [];
  const reasons = [];
  const missing = new Set(read.missing);
  const unreadable = new Set(read.unreadable);

  for (const picture of pictures) {
    const sourceId = sourceIdOf(picture && picture.sourceId);
    let reason = null;
    if (sourceId === null) reason = 'no-source-id';
    else if (missing.has(sourceId)) reason = 'no-source-record';
    else if (unreadable.has(sourceId)) reason = 'source-unreadable';
    else if (!Object.prototype.hasOwnProperty.call(read.files, sourceId)) reason = 'no-source-record';

    if (reason) {
      reasons.push(Object.freeze({ sourceId, reason }));
      continue;
    }

    const sourceUrl = read.files[sourceId];
    const url = sameHostAndPath(picture.url, sourceUrl) ? picture.url : sourceUrl;
    confirmed.push({ ...picture, sourceId, url });
  }

  if (reasons.length > 0) {
    const firstReason = REASON_ORDER.find((candidate) => reasons.some((entry) => entry.reason === candidate));
    return Object.freeze({
      confirmed: false,
      pictures: Object.freeze([]),
      reasons: freezeList(reasons),
      reason: firstReason,
    });
  }

  return Object.freeze({
    confirmed: true,
    pictures: freezeGallery(confirmed),
    reasons: Object.freeze([]),
    reason: null,
  });
}

function declareMediaSource(source) {
  if (!isNonEmptyString(source)) throw new TypeError('declareMediaSource: source must be a non-empty string');
  const normalized = source.trim();
  if (declaredMediaSource === undefined) {
    declaredMediaSource = normalized;
    return normalized;
  }
  if (declaredMediaSource !== normalized) {
    throw new Error(`declareMediaSource: source is already ${declaredMediaSource}; refusing to change it to ${normalized}`);
  }
  return declaredMediaSource;
}

function isConfirmedGallery(list) {
  return confirmedGalleries.has(list);
}

function deriveConfirmed(source, items) {
  if (!confirmedGalleries.has(source)) {
    throw new Error('deriveConfirmed: source is not a confirmed gallery');
  }
  if (!Array.isArray(items) || items.length !== source.length) {
    throw new Error('deriveConfirmed: derived gallery must keep every confirmed URL in order');
  }
  for (let index = 0; index < source.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['url', 'altText', 'displayName'].includes(key))) {
      throw new Error('deriveConfirmed: only altText and displayName may differ from the confirmed URL items');
    }
    if (source[index].url !== item.url) {
      throw new Error('deriveConfirmed: derived gallery must keep every confirmed URL in order');
    }
  }
  return freezeGallery(items);
}

function mediaSourceRequiresConfirmation() {
  return GUARDED_MEDIA_SOURCES.has(declaredMediaSource);
}

// Keep the module's public export list at the five-capability boundary. The
// writer may inspect the declaration through the declaration function, but gains no additional
// way to mutate it or to bless a gallery. The inspection hook is immutable: changing a property
// on the declaration function must not be another way to switch the run-wide guard off.
Object.defineProperty(declareMediaSource, 'requiresConfirmation', {
  value: mediaSourceRequiresConfirmation,
  writable: false,
  configurable: false,
});

module.exports = {
  readSourceMediaRecords,
  confirmPictures,
  declareMediaSource,
  isConfirmedGallery,
  deriveConfirmed,
};
