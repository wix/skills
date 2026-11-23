'use strict';

const crypto = require('node:crypto');

const WIX_COLLECTION_ID_MAX_LENGTH = 36;
const WIX_COLLECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
const ARCHIVE_PREFIX = 'ImportArchive_';
const ARCHIVE_HASH_LENGTH = 8;

function sourceEntityText(sourceEntityName) {
  if (typeof sourceEntityName !== 'string' || !sourceEntityName.trim()) {
    throw new TypeError('source entity name is required to build a CMS archive collection id');
  }
  return sourceEntityName.trim();
}

function isWixCollectionId(value) {
  return typeof value === 'string' && WIX_COLLECTION_ID_PATTERN.test(value);
}

function assertWixCollectionId(value, label = 'CMS collection id') {
  if (!isWixCollectionId(value)) {
    throw new Error(`${label} must contain only letters, numbers, _ or - and be 1-36 characters`);
  }
  return value;
}

// Wix Data accepts only [A-Za-z0-9_-], with a maximum length of 36. The readable
// prefix is deliberately bounded, while the digest keeps names that normalize to
// the same slug distinct (for example, "a/b" and "a_b").
function buildCmsArchiveCollectionId(sourceEntityName) {
  const source = sourceEntityText(sourceEntityName);
  const hash = crypto.createHash('sha256').update(source, 'utf8').digest('hex').slice(0, ARCHIVE_HASH_LENGTH);
  const slug = source.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_]+|[-_]+$/g, '') || 'Entity';
  const suffix = `_${hash}`;
  const readableLength = WIX_COLLECTION_ID_MAX_LENGTH - ARCHIVE_PREFIX.length - suffix.length;
  return `${ARCHIVE_PREFIX}${slug.slice(0, readableLength)}${suffix}`;
}

function archiveCollectionIdMatchesSource(collectionId, sourceEntityName) {
  return isWixCollectionId(collectionId) && collectionId === buildCmsArchiveCollectionId(sourceEntityName);
}

module.exports = {
  WIX_COLLECTION_ID_MAX_LENGTH,
  WIX_COLLECTION_ID_PATTERN,
  buildCmsArchiveCollectionId,
  archiveCollectionIdMatchesSource,
  isWixCollectionId,
  assertWixCollectionId,
};
