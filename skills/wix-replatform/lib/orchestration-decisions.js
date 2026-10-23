'use strict';

const DECISION_ALIASES = {
  sourceUrl: ['sourceSiteUrl', 'sourceUrl'],
  sourceMode: ['sourceMode', 'sourceAcquisitionMode'],
  targetSiteStrategy: ['targetSiteStrategy', 'destinationStrategy'],
  deliveryMode: ['deliveryMode'],
  automationMode: ['automationMode', 'interactionMode', 'runMode'],
  websiteScope: ['websiteScope', 'frontendScope'],
  faceliftMode: ['faceliftMode', 'facelift'],
  fileInputPaths: ['fileInputPaths'],
  sourcePlatform: ['sourcePlatform'],
  sourceCredentialRef: ['sourceCredentialRef'],
  managementImportMode: ['managementImportMode', 'importMode'],
  includeAdditionalFiles: ['includeAdditionalFiles'],
  targetSiteType: ['targetSiteType'],
  targetSiteBusinessType: ['targetSiteBusinessType'],
  editorWebsiteDecision: ['editorWebsiteDecision'],
};

function readDecisionValue(decisions, keys) {
  for (const key of keys) {
    const entry = decisions && decisions[key];
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'value') && entry.value != null) {
      return entry.value;
    }
  }
  return null;
}

function getDecisionEntry(decisions, canonicalKey) {
  const keys = DECISION_ALIASES[canonicalKey] || [canonicalKey];
  for (const key of keys) {
    const entry = decisions && decisions[key];
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'value') && entry.value != null) {
      return entry;
    }
  }
  return null;
}

// The only sourceMode values the router and preflight understand. Anything else is an
// intake error: an unknown mode must never fall through to the public credential set.
const CANONICAL_SOURCE_MODES = Object.freeze(['private_data', 'public_content', 'files_only']);

// `authenticated_api` is an alias because preflight already treats it as private mode.
const SOURCE_MODE_ALIASES = Object.freeze({
  private_authenticated: 'private_data',
  public_content_only: 'public_content',
  authenticated_api: 'private_data',
});

// Decision keys that record sourceMode (see DECISION_ALIASES.sourceMode).
const SOURCE_MODE_DECISION_KEYS = Object.freeze([...DECISION_ALIASES.sourceMode]);

// Returns the canonical mode for a known value or alias, and the raw value otherwise.
// Never throws: callers check validity with isKnownSourceMode().
function normalizeSourceMode(value) {
  if (value == null) return null;
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_MODE_ALIASES, value)) {
    return SOURCE_MODE_ALIASES[value];
  }
  return value;
}

function isKnownSourceMode(value) {
  if (typeof value !== 'string') return false;
  return CANONICAL_SOURCE_MODES.includes(value) || Object.prototype.hasOwnProperty.call(SOURCE_MODE_ALIASES, value);
}

function invalidSourceModeMessage(value) {
  const aliases = Object.entries(SOURCE_MODE_ALIASES).map(([alias, target]) => `${alias} -> ${target}`).join(', ');
  return `invalid sourceMode ${JSON.stringify(value)}; use one of ${CANONICAL_SOURCE_MODES.join(', ')} (aliases: ${aliases})`;
}

function normalizeTargetSiteStrategy(value) {
  if (value == null) return null;
  switch (value) {
    case 'new':
      return 'new_site';
    case 'existing':
      return 'existing_site';
    default:
      return value;
  }
}

function normalizeAutomationMode(value) {
  if (value == null) return null;
  switch (value) {
    case '1-click':
    case '1click':
    case 'one-click':
    case 'one_click':
      return 'one_click';
    case 'manual':
      return 'manual';
    default:
      return value;
  }
}

function normalizeDeliveryMode(value) {
  if (value == null) return null;
  switch (String(value).trim().toLowerCase()) {
    case 'both':
    case 'management+website':
    case 'management_and_website':
      return 'management_and_website';
    case 'management':
    case 'website':
      return String(value).trim().toLowerCase();
    default:
      return value;
  }
}

function normalizeManagementImportMode(value) {
  if (value == null) return null;
  switch (String(value).trim().toLowerCase()) {
    case 'quick':
    case 'quick_mode':
      return 'quick';
    case 'standard':
    case 'normal':
      return 'standard';
    default:
      return value;
  }
}

function normalizeFaceliftMode(value) {
  if (value === true) return 'requested';
  if (value === false || value == null) return 'off';
  return ['requested', 'facelift', 'on', 'true'].includes(String(value).trim().toLowerCase()) ? 'requested' : 'off';
}

function getDecisionValue(decisions, canonicalKey) {
  const keys = DECISION_ALIASES[canonicalKey] || [canonicalKey];
  const value = readDecisionValue(decisions, keys);
  if (canonicalKey === 'sourceMode') {
    return normalizeSourceMode(value);
  }
  if (canonicalKey === 'targetSiteStrategy') {
    return normalizeTargetSiteStrategy(value);
  }
  if (canonicalKey === 'automationMode') {
    return normalizeAutomationMode(value);
  }
  if (canonicalKey === 'deliveryMode') {
    return normalizeDeliveryMode(value);
  }
  if (canonicalKey === 'managementImportMode') {
    return normalizeManagementImportMode(value);
  }
  if (canonicalKey === 'faceliftMode') return normalizeFaceliftMode(value);
  return value;
}

// The destination site type is an explicit operator choice for a new site.
// "editor" is deliberately not a value: it is an incomplete answer until Studio or Harmony
// is known, and the classic Wix Editor is not a supported choice.
const SITE_TYPES = Object.freeze(['headless', 'studio', 'harmony']);
const EDITOR_SITE_TYPES = Object.freeze(['studio', 'harmony']);
const SITE_BUSINESS_TYPES = Object.freeze(['store', 'bookings', 'other', 'unknown']);
const SITE_BUSINESS_TYPE_SOURCES = Object.freeze(['user', 'context', 'not_asked']);

// The one site-type request's choice ids, each mapped to the decision pair it records.
const SITE_TYPE_CHOICES = Object.freeze({
  headless: { siteType: 'headless', businessType: null },
  studio: { siteType: 'studio', businessType: null },
  harmony_store: { siteType: 'harmony', businessType: 'store' },
  harmony_bookings: { siteType: 'harmony', businessType: 'bookings' },
  harmony_other: { siteType: 'harmony', businessType: 'other' },
  harmony: { siteType: 'harmony', businessType: 'unknown' },
});

function isNewSiteStrategy(value) {
  return normalizeTargetSiteStrategy(value) === 'new_site';
}

function isEditorSiteType(value) {
  return EDITOR_SITE_TYPES.includes(value);
}

// Returns the persisted pair, or null when no type is recorded. `errors` names a recorded
// value the router must not act on (unknown type, Harmony without its business type, or a
// business type recorded for a non-Harmony site).
function readSiteTypeDecision(decisions) {
  const typeEntry = getDecisionEntry(decisions, 'targetSiteType');
  const businessEntry = getDecisionEntry(decisions, 'targetSiteBusinessType');
  if (!typeEntry) {
    return businessEntry
      ? { siteType: null, businessType: null, errors: ['targetSiteBusinessType is recorded without targetSiteType'] }
      : null;
  }
  const errors = [];
  const siteType = typeEntry.value;
  if (!SITE_TYPES.includes(siteType)) errors.push(`targetSiteType must be one of ${SITE_TYPES.join(', ')} (got ${JSON.stringify(siteType)})`);
  let businessType = null;
  let businessTypeSource = null;
  if (businessEntry) {
    businessType = businessEntry.value;
    businessTypeSource = businessEntry.source;
    if (siteType !== 'harmony') errors.push('targetSiteBusinessType is valid only with targetSiteType=harmony');
    if (!SITE_BUSINESS_TYPES.includes(businessType)) errors.push(`targetSiteBusinessType must be one of ${SITE_BUSINESS_TYPES.join(', ')} (got ${JSON.stringify(businessType)})`);
    if (!SITE_BUSINESS_TYPE_SOURCES.includes(businessTypeSource)) errors.push(`targetSiteBusinessType source must be one of ${SITE_BUSINESS_TYPE_SOURCES.join(', ')}`);
  } else if (siteType === 'harmony') {
    errors.push('targetSiteType=harmony requires targetSiteBusinessType in the same decision write');
  }
  return {
    siteType,
    businessType,
    businessTypeSource,
    businessTypeEvidenceRef: businessEntry && businessEntry.evidenceRef ? businessEntry.evidenceRef : null,
    errors,
  };
}

function isExplicitUserOneClick(decisions) {
  const entry = getDecisionEntry(decisions, 'automationMode');
  return Boolean(entry && entry.source === 'user' && normalizeAutomationMode(entry.value) === 'one_click');
}

module.exports = {
  EDITOR_SITE_TYPES,
  SITE_BUSINESS_TYPES,
  SITE_BUSINESS_TYPE_SOURCES,
  SITE_TYPE_CHOICES,
  SITE_TYPES,
  isEditorSiteType,
  isNewSiteStrategy,
  readSiteTypeDecision,
  CANONICAL_SOURCE_MODES,
  SOURCE_MODE_ALIASES,
  SOURCE_MODE_DECISION_KEYS,
  invalidSourceModeMessage,
  isKnownSourceMode,
  getDecisionEntry,
  getDecisionValue,
  isExplicitUserOneClick,
  normalizeAutomationMode,
  normalizeDeliveryMode,
  normalizeManagementImportMode,
  normalizeFaceliftMode,
  normalizeSourceMode,
  normalizeTargetSiteStrategy,
};
