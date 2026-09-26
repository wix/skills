'use strict';

// The Node half of spec 0122 §4's secret-shaped value guard.
//
// There are two implementations of this guard and there have to be: this one runs on the
// migration host (spec 0123's gateway wrapper reads gateway configuration here, in
// JavaScript), and the other runs inside the WordPress plugin, in PHP
// (plugins/wix-wp-plugin-v2/includes/class-wmh2-secret-value-guard.php). PHP and Node share
// no runtime, so "import the same module" is not available to them. What IS shared is one
// canonical manifest, one restricted regex dialect, and one conformance corpus:
//
//   manifest  ../secret-value-patterns.v1.json, vendored from the canonical copy at
//             plugins/wix-wp-plugin-v2/schemas/secret-value-patterns.v1.json
//   corpus    tests/fixtures/secret-patterns/conformance.json
//   dialect   anchors, character classes, alternation, quantifiers. NOTHING else --
//             no lookaround, no backreferences, no named groups, no inline flags,
//             no \p{...}, and no `~` (the PHP side's pattern delimiter).
//
// The dialect is not stylistic. It is the set of constructs that mean the SAME thing in
// PCRE and in JavaScript, which is the only reason one pattern string can drive both
// engines. assertRestrictedDialect() below is the machine-checkable statement of it, and
// the contract test runs it over every manifest entry.
//
// CI verifies THIS side against the corpus. The PHP side has no interpreter in this
// pipeline (spec 0101 Open item 1) and is established by code review against the same
// corpus plus the live smoke. Said out loud because an unverified second implementation of
// a security control reads as covered and is not.
//
// And the standing caveat, the same one the PHP file carries: this is DEFENCE IN DEPTH,
// NOT A GUARANTEE. It is a pattern list; a secret in an unrecognized format passes
// through. A credential that can be named in advance gets a deterministic denial instead
// (the plugin's COLUMN_DENYLIST) and must never be left to this file.

const fs = require('node:fs');
const path = require('node:path');

const REDACTED = '[REDACTED:secret-shaped]';

// VENDORED INSIDE THE SKILL, deliberately. `skills/` is the published product and is
// installed on its own, so anything under it that reaches up into the monorepo -- as this
// once did, via ../../../../../plugins/wix-wp-plugin-v2/schemas/ -- resolves fine in this
// repo and dies with ENOENT the moment a user installs the bundle. Caught by external
// review round 3 by copying the skill tree alone and calling the guard.
//
// The plugin's copy at plugins/wix-wp-plugin-v2/schemas/secret-value-patterns.v1.json stays
// CANONICAL: it is the one the security spec points at, and the PHP evaluator reads it from
// inside the plugin zip for the same no-network reason. So there are now three copies of one
// file -- canonical, plugin zip, skill bundle -- and all three are asserted byte-identical
// by tests/plugins/wmh2-eav-access-contract-test.js. Drift fails CI rather than producing
// guards that disagree.
const MANIFEST_PATH = path.join(__dirname, '..', 'secret-value-patterns.v1.json');

// Constructs that do NOT survive the PCRE/JavaScript round trip, or that would break the
// PHP side's `~` delimiter. Checked as source-text patterns because the point is to reject
// the pattern STRING before either engine ever compiles it.
const FORBIDDEN_DIALECT_CONSTRUCTS = [
  { id: 'lookaround', test: /\((\?=|\?!|\?<=|\?<!)/, why: 'lookahead/lookbehind' },
  { id: 'named-group', test: /\(\?</, why: 'named capture group' },
  { id: 'inline-flags', test: /\(\?[a-zA-Z]*[-:)]/, why: 'inline flag / non-capturing modifier group' },
  { id: 'unicode-property', test: /\\[pP]\{/, why: '\\p{...} unicode property' },
  { id: 'backreference', test: /\\[1-9]/, why: 'backreference' },
  { id: 'php-delimiter', test: /~/, why: '`~`, the PHP side\'s pattern delimiter' },
];

/**
 * Throws unless `regex` uses only constructs that mean the same thing in PCRE and in JS.
 * Returns the compiled RegExp so a caller cannot accidentally validate one string and
 * compile another.
 */
function assertRestrictedDialect(regex, id) {
  const label = id ? `denyPatterns[${id}]` : 'pattern';
  if (typeof regex !== 'string' || regex === '') {
    throw new Error(`${label}: regex must be a non-empty string`);
  }
  for (const construct of FORBIDDEN_DIALECT_CONSTRUCTS) {
    if (construct.test.test(regex)) {
      throw new Error(`${label}: ${construct.why} is outside the restricted dialect (${construct.id})`);
    }
  }
  try {
    // No flags, deliberately. `m` would change what `^`/`$` mean; `i` would change what
    // the character classes mean; either would desynchronize the two engines.
    return new RegExp(regex);
  } catch (error) {
    throw new Error(`${label}: not a valid regular expression (${error.message})`);
  }
}

const MANIFEST_KEYS = ['schemaVersion', 'allowPrefixes', 'denyPrefixes', 'denyPatterns'];

/**
 * STRICT, AND WHOLE-FILE: any defect THROWS, rather than dropping the bad entry and carrying
 * on with what is left.
 *
 * The lenient version of this function was a security hole and a quiet one. `Array.isArray(x)
 * ? x : []` turned a `denyPrefixes` corrupted to a string into a manifest with NO deny
 * prefixes; nothing threw, nothing reported a problem, and `whsec_...` came back unredacted
 * from a guard that looked healthy. Partial corruption is not a lesser problem than total
 * corruption — it is the same problem, harder to notice. External review round 4 caught it.
 */
function loadManifest(manifestPath = MANIFEST_PATH) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`secret-value manifest at ${manifestPath} could not be read as JSON: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('secret-value manifest must be a JSON object');
  }
  const keys = Object.keys(raw).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...MANIFEST_KEYS].sort())) {
    throw new Error(`secret-value manifest keys must be exactly: ${MANIFEST_KEYS.join(', ')} (got: ${keys.join(', ') || 'none'})`);
  }
  if (raw.schemaVersion !== 1) {
    throw new Error(`secret-value manifest schemaVersion ${JSON.stringify(raw.schemaVersion)} is unsupported (this evaluator understands 1)`);
  }
  const stringList = (name) => {
    const list = raw[name];
    if (!Array.isArray(list) || list.length === 0) throw new Error(`secret-value manifest ${name} must be a non-empty array`);
    for (const entry of list) {
      if (typeof entry !== 'string' || entry === '') throw new Error(`secret-value manifest ${name} must contain only non-empty strings`);
    }
    return [...list];
  };
  const allowPrefixes = stringList('allowPrefixes');
  const denyPrefixes = stringList('denyPrefixes');
  if (!Array.isArray(raw.denyPatterns) || raw.denyPatterns.length === 0) {
    throw new Error('secret-value manifest denyPatterns must be a non-empty array');
  }
  const denyPatterns = raw.denyPatterns.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('every denyPatterns entry must be an object');
    const entryKeys = Object.keys(entry).sort();
    if (JSON.stringify(entryKeys) !== JSON.stringify(['id', 'regex'])) {
      throw new Error(`every denyPatterns entry must have exactly id and regex (got: ${entryKeys.join(', ') || 'none'})`);
    }
    if (typeof entry.id !== 'string' || entry.id === '') throw new Error('denyPatterns id must be a non-empty string');
    return { id: entry.id, regex: entry.regex, compiled: assertRestrictedDialect(entry.regex, entry.id) };
  });
  return { schemaVersion: raw.schemaVersion, allowPrefixes, denyPrefixes, denyPatterns };
}

let cachedManifest = null;
let cachedError = null;
function manifest() {
  if (cachedError !== null) throw cachedError;
  if (cachedManifest === null) {
    try {
      cachedManifest = loadManifest();
    } catch (error) {
      // Cached so the SECOND call fails identically to the first. A guard that throws once and
      // then quietly succeeds is worse than one that consistently refuses.
      cachedError = error;
      throw error;
    }
  }
  return cachedManifest;
}

/**
 * Is the guard operational? The Node counterpart of the plugin's `is_usable()`.
 *
 * This did not exist before review round 4, and its absence was the actual leak: the PHP side
 * refused a read when its manifest was broken, while this side loaded an empty pattern set and
 * returned values unredacted. Two implementations of one control disagreeing about whether the
 * control is even running is the worst version of the two-runtime problem.
 *
 * Callers that must not proceed unguarded — spec 0123's gateway wrapper above all — should
 * check this before reading, rather than relying on isSecretShaped() to throw mid-loop.
 */
function isUsable() {
  try {
    manifest();
    return true;
  } catch {
    return false;
  }
}

/** Why the guard is unusable, or null when it is fine. */
function unusableReason() {
  try {
    manifest();
    return null;
  } catch (error) {
    return error.message;
  }
}

/**
 * The verdict for one value, and the whole guard.
 *
 * ORDER IS THE RULE: allowPrefixes first, and as a PREFIX, never a substring. That
 * ordering is what keeps the payment pointers this effort exists to migrate intact — a
 * 44-character `card_...` id is precisely what the `long-opaque` pattern would otherwise
 * eat. Prefix-not-substring is also what stops the allow list becoming a bypass: a value
 * cannot smuggle `sk_live_...` through by containing `pm_` somewhere inside it.
 *
 * Non-strings are never secret-shaped. Coercing an integer column to a string to test it
 * would only invent false positives on long numeric ids.
 */
function isSecretShaped(value, loaded = manifest()) {
  // Note the default argument: a broken manifest THROWS here rather than reporting "not
  // secret-shaped". Refusing loudly is the only safe answer a boolean-returning function can
  // give when it cannot actually evaluate the question.
  if (typeof value !== 'string' || value === '') return false;
  for (const prefix of loaded.allowPrefixes) {
    if (value.startsWith(prefix)) return false;
  }
  for (const prefix of loaded.denyPrefixes) {
    if (value.startsWith(prefix)) return true;
  }
  for (const pattern of loaded.denyPatterns) {
    if (pattern.compiled.test(value)) return true;
  }
  return false;
}

/** `[REDACTED:secret-shaped]` — never a hash, never a prefix, never the length. */
function redact(value, loaded = manifest()) {
  return isSecretShaped(value, loaded) ? REDACTED : value;
}

module.exports = {
  REDACTED,
  MANIFEST_PATH,
  isUsable,
  unusableReason,
  FORBIDDEN_DIALECT_CONSTRUCTS,
  assertRestrictedDialect,
  loadManifest,
  isSecretShaped,
  redact,
};
