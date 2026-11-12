'use strict';

// Vendor detection from the header row.
//
// The header read at discovery time is authoritative; a vendor profile only
// (a) identifies the vendor and (b) pre-fills mappings the LLM would otherwise
// propose. A stale profile can therefore make the pre-fill less complete, but
// can never cause a wrong import — see SKILL.md → Profile drift & resilience.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeHeaderName } = require('./csv-parse.js');

const VENDORS_DIR = path.join(__dirname, '..', 'vendors');

// Scoring constants. Deliberately conservative: falling back to `custom` costs
// the user a less complete mapping pre-fill, while a wrong vendor match costs
// them a wrong layout.
const BASE_REQUIRED = 0.5;
const STRONG_WEIGHT = 0.5;
const PARTIAL_FACTOR = 0.6;
const NEGATIVE_PENALTY = 0.35;
const MATCH_THRESHOLD = 0.7;
const MARGIN = 0.15;
const MIN_STRONG_HITS = 2;
const NEAR_MISS_FLOOR = 0.25;
const NEAR_MISS_STRONG_RATIO = 0.6;

const CUSTOM_VENDOR = 'custom';

function normalizedSet(columns) {
  const set = new Set();
  for (const column of columns || []) {
    const normalized = normalizeHeaderName(column);
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
}

function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile is not an object'] };
  }
  if (!profile.vendor || typeof profile.vendor !== 'string') {
    errors.push('vendor must be a non-empty string');
  }
  if (!profile.profileVersion) {
    errors.push('profileVersion is required (provenance for drift)');
  }
  if (!profile.sourceOfTruth) {
    errors.push('sourceOfTruth is required');
  }
  const anchors = profile.anchors || {};
  if (!Array.isArray(anchors.required) || anchors.required.length === 0) {
    errors.push('anchors.required must be a non-empty array');
  }
  if (!Array.isArray(anchors.strong) || anchors.strong.length < MIN_STRONG_HITS) {
    errors.push(`anchors.strong must hold at least ${MIN_STRONG_HITS} columns`);
  }
  if (!profile.layout || typeof profile.layout.pattern !== 'string') {
    errors.push('layout.pattern is required');
  }
  if (profile.columnMap && !Array.isArray(profile.columnMap)) {
    errors.push('columnMap must be an array when present');
  }
  for (const entry of profile.columnMap || []) {
    if (!entry.wixTarget || !Array.isArray(entry.aliases) || entry.aliases.length === 0) {
      errors.push(`columnMap entry ${JSON.stringify(entry.wixTarget)} needs a wixTarget and a non-empty aliases array`);
    }
  }
  for (const derived of profile.derived || []) {
    if (!derived.entity || !derived.fromColumn) {
      errors.push('each derived entry needs entity + fromColumn');
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadVendorProfiles(dir = VENDORS_DIR) {
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const profile = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const validation = validateProfile(profile);
    if (!validation.ok) {
      throw new Error(`Invalid vendor profile ${file}: ${validation.errors.join('; ')}`);
    }
    return profile;
  });
}

function aliasIndex(profile) {
  // normalized column name -> wixTarget, built from columnMap only.
  const index = new Map();
  for (const entry of profile.columnMap || []) {
    for (const alias of entry.aliases) {
      const normalized = normalizeHeaderName(alias);
      if (normalized && !index.has(normalized)) {
        index.set(normalized, { wixTarget: entry.wixTarget, alias });
      }
    }
  }
  return index;
}

// Anchors match by normalized EXACT equality and never through columnMap
// aliases. Aliases exist to be permissive for mapping; permissiveness is poison
// for identification — Shopify's variant.sku aliases include a bare "SKU",
// which every WooCommerce and Magento export also has.
function scoreProfile(headerColumns, profile) {
  const header = normalizedSet(headerColumns);
  const anchors = profile.anchors || {};
  const required = anchors.required || [];
  const strong = anchors.strong || [];
  const negative = anchors.negative || [];

  const matchedRequired = required.filter((column) => header.has(normalizeHeaderName(column)));
  const missingRequired = required.filter((column) => !header.has(normalizeHeaderName(column)));
  const matchedStrong = strong.filter((column) => header.has(normalizeHeaderName(column)));
  const missingStrong = strong.filter((column) => !header.has(normalizeHeaderName(column)));
  const negativeHits = negative.filter((column) => header.has(normalizeHeaderName(column)));

  const requiredRatio = required.length === 0 ? 0 : matchedRequired.length / required.length;
  const strongRatio = strong.length === 0 ? 0 : matchedStrong.length / strong.length;

  const core = BASE_REQUIRED + STRONG_WEIGHT * strongRatio;
  let score = requiredRatio === 1 ? core : PARTIAL_FACTOR * requiredRatio * core;
  if (negativeHits.length > 0) {
    score *= NEGATIVE_PENALTY;
  }

  // Evidence only — deliberately NOT part of the score. Coupling identification
  // to columnMap completeness would mean adding a mapping alias could change
  // which vendor a file is detected as.
  const aliases = aliasIndex(profile);
  const anchorNames = normalizedSet([...required, ...strong]);
  const knownColumns = (headerColumns || []).filter((column) => {
    const normalized = normalizeHeaderName(column);
    return anchorNames.has(normalized) || aliases.has(normalized);
  });
  const vocabularyCoverage = headerColumns && headerColumns.length > 0
    ? knownColumns.length / headerColumns.length
    : 0;

  return {
    vendor: profile.vendor,
    score: Number(score.toFixed(4)),
    requiredRatio,
    strongRatio,
    matchedRequired,
    missingRequired,
    matchedStrong,
    missingStrong,
    negativeHits,
    vocabularyCoverage: Number(vocabularyCoverage.toFixed(4)),
  };
}

function evidenceLine(winner, runnerUp) {
  const parts = [
    `required ${winner.matchedRequired.length}/${winner.matchedRequired.length + winner.missingRequired.length}`,
    `strong ${winner.matchedStrong.length}/${winner.matchedStrong.length + winner.missingStrong.length}`,
    `score ${winner.score}`,
  ];
  if (winner.negativeHits.length > 0) {
    parts.push(`negative anchors present: ${winner.negativeHits.join(', ')}`);
  }
  parts.push(runnerUp ? `runner-up ${runnerUp.vendor} ${runnerUp.score}` : 'no runner-up');
  return parts.join('; ');
}

function detectVendor(headerColumns, profiles, { statedVendor = null } = {}) {
  const scores = profiles
    .map((profile) => scoreProfile(headerColumns, profile))
    .sort((a, b) => b.score - a.score || a.vendor.localeCompare(b.vendor));

  const winner = scores[0] || null;
  const runnerUp = scores[1] || null;
  const profileByVendor = new Map(profiles.map((profile) => [profile.vendor, profile]));

  let reason = 'match';
  let matched = Boolean(winner);
  if (!winner || winner.score < MATCH_THRESHOLD) {
    matched = false;
    reason = 'below-threshold';
  } else if (winner.matchedStrong.length < MIN_STRONG_HITS) {
    matched = false;
    reason = 'insufficient-strong-anchors';
  } else if (runnerUp && winner.score - runnerUp.score < MARGIN) {
    matched = false;
    reason = 'ambiguous';
  }

  // A drifted vendor export should become a user question, not silence.
  let nearMiss = null;
  if (!matched) {
    const candidate = scores.find((entry) => entry.score >= NEAR_MISS_FLOOR
      && entry.strongRatio >= NEAR_MISS_STRONG_RATIO
      && entry.requiredRatio > 0
      && entry.negativeHits.length === 0);
    if (candidate) {
      nearMiss = {
        vendor: candidate.vendor,
        score: candidate.score,
        missingRequired: candidate.missingRequired,
        missingStrong: candidate.missingStrong,
      };
    }
  }

  const detectedVendor = matched ? winner.vendor : CUSTOM_VENDOR;

  // A user-stated vendor wins, but detection still runs so a disagreement is
  // visible rather than silently overridden.
  if (statedVendor) {
    const stated = String(statedVendor).toLowerCase();
    if (stated !== CUSTOM_VENDOR && !profileByVendor.has(stated)) {
      throw new Error(`Unknown vendor "${statedVendor}". Known vendors: ${[...profileByVendor.keys()].join(', ')}, ${CUSTOM_VENDOR}.`);
    }
    const statedScore = scores.find((entry) => entry.vendor === stated) || null;
    return {
      vendor: stated,
      profile: profileByVendor.get(stated) || null,
      confidence: statedScore ? statedScore.score : 1,
      source: 'user',
      reason: 'user-stated',
      evidence: `vendor stated by the user${statedScore ? `; fingerprint would score it ${statedScore.score}` : ''}`,
      scores,
      runnerUp,
      nearMiss,
      conflict: detectedVendor !== stated ? { stated, detected: detectedVendor } : null,
    };
  }

  return {
    vendor: detectedVendor,
    profile: matched ? profileByVendor.get(winner.vendor) : null,
    confidence: winner ? winner.score : 0,
    source: matched ? 'fingerprint' : 'fallback',
    reason,
    evidence: winner ? evidenceLine(winner, runnerUp) : 'no vendor profiles available',
    scores,
    runnerUp,
    nearMiss,
    conflict: null,
  };
}

// The two drift lists are scoped differently on purpose: `unmappedColumns` is
// about mapping coverage (anchors + columnMap), `missingExpectedColumns` is
// about format drift (anchors only — including every columnMap alias would
// make the list enormous and useless).
function diffProfile(headerColumns, profile) {
  if (!profile) {
    return { unmappedColumns: [...(headerColumns || [])], missingExpectedColumns: [] };
  }
  const aliases = aliasIndex(profile);
  const anchors = profile.anchors || {};
  const anchorNames = normalizedSet([...(anchors.required || []), ...(anchors.strong || [])]);
  const header = normalizedSet(headerColumns);

  const unmappedColumns = (headerColumns || []).filter((column) => {
    const normalized = normalizeHeaderName(column);
    return normalized && !anchorNames.has(normalized) && !aliases.has(normalized);
  });
  const missingExpectedColumns = [...(anchors.required || []), ...(anchors.strong || [])]
    .filter((column) => !header.has(normalizeHeaderName(column)));

  return { unmappedColumns, missingExpectedColumns };
}

// Advisory pre-fill for rp-mapper. Every column this does not cover still flows
// through discovery → mapper → user unchanged.
function prefillColumnMap(headerColumns, profile) {
  if (!profile) {
    return [];
  }
  const aliases = aliasIndex(profile);
  const hints = [];
  for (const column of headerColumns || []) {
    const hit = aliases.get(normalizeHeaderName(column));
    if (hit) {
      hints.push({ column, wixTarget: hit.wixTarget, matchedAlias: hit.alias });
    }
  }
  return hints;
}

module.exports = {
  VENDORS_DIR,
  BASE_REQUIRED,
  STRONG_WEIGHT,
  PARTIAL_FACTOR,
  NEGATIVE_PENALTY,
  MATCH_THRESHOLD,
  MARGIN,
  MIN_STRONG_HITS,
  NEAR_MISS_FLOOR,
  CUSTOM_VENDOR,
  loadVendorProfiles,
  validateProfile,
  scoreProfile,
  detectVendor,
  diffProfile,
  prefillColumnMap,
};
