'use strict';

// Shared scalar-value helpers used across the rp-target-wix builders (tax-build.js,
// shipping-build.js, gift-card-build.js, ...). Kept tiny and dependency-free on purpose — this is
// not a general utils dumping ground, just the one helper that was independently duplicated
// byte-for-byte in three builder files.

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

module.exports = {
  isBlank,
};
