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

function normalizeSourceMode(value) {
  if (value == null) return null;
  switch (value) {
    case 'private_authenticated':
      return 'private_data';
    case 'public_content_only':
      return 'public_content';
    default:
      return value;
  }
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

function isExplicitUserOneClick(decisions) {
  const entry = getDecisionEntry(decisions, 'automationMode');
  return Boolean(entry && entry.source === 'user' && normalizeAutomationMode(entry.value) === 'one_click');
}

module.exports = {
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
