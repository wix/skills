'use strict';

// The destination site-type choice. Business type is part of the one
// site-type answer, never its own request, and both decisions are persisted in one write.
const path = require('node:path');
const {
  SITE_BUSINESS_TYPES,
  SITE_TYPE_CHOICES,
  SITE_TYPES,
  getDecisionEntry,
} = require('./orchestration-decisions.js');
const { loadArtifacts, writeJsonAtomic, updateDecisionObject, nowIso } = require('./orchestration-state.js');

const KNOWN_BUSINESS_TYPES = Object.freeze(['store', 'bookings', 'other']);

const CHOICE_LABELS = Object.freeze({
  headless: { label: 'Headless', description: 'A website developed in code (Wix Managed Headless).' },
  studio: { label: 'Wix Studio', description: 'A website designed in the Wix Studio editor.' },
  harmony_store: { label: 'Wix Harmony — store', description: 'Harmony editor; the business sells products.' },
  harmony_bookings: { label: 'Wix Harmony — bookings/services', description: 'Harmony editor; the business sells appointments, classes or services.' },
  harmony_other: { label: 'Wix Harmony — another kind of business', description: 'Harmony editor; neither a store nor a bookings business.' },
  harmony: { label: 'Wix Harmony — not sure, start blank', description: 'Harmony editor, starting from the blank template.' },
});

const CONTEXT_HARMONY_LABEL = { label: 'Wix Harmony', description: 'A website designed in the Wix Harmony editor.' };

// Validates and returns the decision pair a set of inputs describes. Throws on an unknown
// value, a business type for a non-Harmony site, or a CLI-style business type with no type.
function resolveSiteTypePair({ siteType, businessType = undefined, businessTypeSource = undefined, evidenceRef = null }) {
  if (siteType === 'editor') throw new Error('site type "editor" is incomplete: choose studio or harmony');
  if (!SITE_TYPES.includes(siteType)) throw new Error(`site type must be one of ${SITE_TYPES.join(', ')}`);
  if (siteType !== 'harmony') {
    if (businessType !== undefined && businessType !== null) throw new Error('a site business type is valid only with site type harmony');
    return { siteType, businessType: null, businessTypeSource: null, evidenceRef: null };
  }
  const value = businessType === undefined || businessType === null || businessType === '' ? 'unknown' : businessType;
  if (!SITE_BUSINESS_TYPES.includes(value)) throw new Error(`site business type must be one of ${SITE_BUSINESS_TYPES.join(', ')}`);
  const source = businessTypeSource || 'user';
  if (source === 'context' && (!KNOWN_BUSINESS_TYPES.includes(value) || !evidenceRef)) {
    throw new Error('a context business type needs a known value and an evidence reference');
  }
  return { siteType, businessType: value, businessTypeSource: source, evidenceRef: source === 'context' ? evidenceRef : null };
}

// Writes the pair into `decisions` (in memory). A different recorded pair is a conflict:
// changing the answer never silently retargets the destination.
function applySiteTypePair(decisions, pair, { rationale = null, timestamp = nowIso() } = {}) {
  const existingType = getDecisionEntry(decisions, 'targetSiteType');
  if (existingType) {
    const existingBusiness = getDecisionEntry(decisions, 'targetSiteBusinessType');
    const same = existingType.value === pair.siteType
      && (existingBusiness ? existingBusiness.value : null) === pair.businessType;
    if (same) return { changed: false };
    throw new Error(`site type conflicts with the recorded decision (${existingType.value}${existingBusiness ? `/${existingBusiness.value}` : ''}); a type change needs an explicit recovery decision`);
  }
  updateDecisionObject(decisions, 'targetSiteType', pair.siteType, { source: 'user', rationale, timestamp });
  if (pair.siteType === 'harmony') {
    updateDecisionObject(decisions, 'targetSiteBusinessType', pair.businessType, {
      source: pair.businessTypeSource,
      rationale,
      timestamp,
      evidenceRef: pair.evidenceRef,
    });
  }
  return { changed: true };
}

// One atomic decisions.json write for the pair; never two writes the router could observe apart.
async function recordSiteTypeDecision(projectDir, input, options = {}) {
  const pair = resolveSiteTypePair(input);
  const artifacts = await loadArtifacts(projectDir);
  if (!artifacts.decisions) throw new Error('orchestration decisions are not initialized');
  const result = applySiteTypePair(artifacts.decisions, pair, options);
  if (result.changed) await writeJsonAtomic(path.join(projectDir, 'orchestration', 'decisions.json'), artifacts.decisions);
  return { ...pair, changed: result.changed };
}

// The durable request for a missing site type. With a context business type, Harmony
// collapses to one `harmony` choice that records the context value.
function siteTypeRequestInput({ contextBusinessType = null, evidenceRef = null, siteName = null } = {}) {
  const fromContext = contextBusinessType && KNOWN_BUSINESS_TYPES.includes(contextBusinessType) && evidenceRef;
  const ids = fromContext ? ['headless', 'studio', 'harmony'] : Object.keys(SITE_TYPE_CHOICES);
  const choices = ids.map((id) => ({ id, ...(fromContext && id === 'harmony' ? CONTEXT_HARMONY_LABEL : CHOICE_LABELS[id]) }));
  const context = [
    'A Studio or Harmony site is created in the Wix account the Wix CLI is logged into; that account is shown for confirmation before anything is created.',
    siteName ? `Its name will be "${siteName}".` : null,
    fromContext ? `The business type is already known from the run (${contextBusinessType}).` : null,
  ].filter(Boolean).join(' ');
  return {
    kind: 'question',
    stage: 'destination',
    title: 'Choose the new site type',
    prompt: `What kind of new Wix site should this migration create? This choice decides where the imported data will live and cannot be changed later as a setting. Headless is for a website developed in code; Studio and Harmony are websites designed in a Wix editor.${context ? ` ${context}` : ''}`,
    response: { mode: 'choice', required: true },
    choices,
    effect: {
      kind: 'decision',
      key: 'targetSiteType',
      choices: Object.fromEntries(ids.map((id) => [id, id])),
      ...(fromContext ? { contextBusinessType, evidenceRef } : {}),
    },
  };
}

// Maps an answered site-type choice to the pair it records (used by the effect handler).
function pairForChoice(effect, choiceId) {
  const mapped = SITE_TYPE_CHOICES[choiceId];
  if (!mapped) throw new Error(`unknown site-type choice: ${choiceId}`);
  if (mapped.siteType === 'harmony' && choiceId === 'harmony' && effect.contextBusinessType) {
    return resolveSiteTypePair({ siteType: 'harmony', businessType: effect.contextBusinessType, businessTypeSource: 'context', evidenceRef: effect.evidenceRef });
  }
  return resolveSiteTypePair({ siteType: mapped.siteType, businessType: mapped.businessType, businessTypeSource: 'user' });
}

function isValidSiteTypeEffect(effect, choices) {
  if (!effect || effect.kind !== 'decision' || effect.key !== 'targetSiteType') return false;
  if (!effect.choices || typeof effect.choices !== 'object' || Array.isArray(effect.choices)) return false;
  const entries = Object.entries(effect.choices);
  if (!entries.length) return false;
  if (!entries.every(([choice, value]) => choice === value && SITE_TYPE_CHOICES[choice] && choices.some((item) => item.id === choice))) return false;
  if (effect.contextBusinessType !== undefined) {
    if (!KNOWN_BUSINESS_TYPES.includes(effect.contextBusinessType) || typeof effect.evidenceRef !== 'string' || !effect.evidenceRef) return false;
    if (entries.some(([choice]) => choice.startsWith('harmony_'))) return false;
  }
  return true;
}

// Scope guard for management_and_website with an Editor choice.
const EDITOR_WEBSITE_DECISIONS = Object.freeze(['management_only', 'separate_editor_handoff']);

function editorWebsiteRequestInput({ siteType }) {
  return {
    kind: 'question',
    stage: 'destination',
    title: 'Editor website is not built automatically',
    prompt: `You asked for both the backend migration and the website, on a ${siteType === 'studio' ? 'Wix Studio' : 'Wix Harmony'} site. RePlatform has no supported automatic website migration for an Editor site: it creates the site and imports the business data, but the website itself is designed separately in the Wix editor. Choose whether to migrate the backend only, or to continue with the backend now and a separate Editor website handoff (the website stays outstanding and the migration is not reported complete until it is released).`,
    response: { mode: 'choice', required: true },
    choices: [
      { id: 'management_only', label: 'Backend only', description: 'Change the scope to management; no website work is owed by this run.' },
      { id: 'separate_editor_handoff', label: 'Backend now, Editor website separately', description: 'Keep the website obligation as an outstanding handoff for the site owner/designer.' },
    ],
    effect: { kind: 'decision', key: 'editorWebsiteDecision', choices: { management_only: 'management_only', separate_editor_handoff: 'separate_editor_handoff' } },
  };
}

function isValidEditorWebsiteEffect(effect, choices) {
  if (!effect || effect.kind !== 'decision' || effect.key !== 'editorWebsiteDecision') return false;
  const entries = Object.entries(effect.choices || {});
  return entries.length > 0 && entries.every(([choice, value]) => choice === value && EDITOR_WEBSITE_DECISIONS.includes(choice) && choices.some((item) => item.id === choice));
}

module.exports = {
  EDITOR_WEBSITE_DECISIONS,
  KNOWN_BUSINESS_TYPES,
  applySiteTypePair,
  editorWebsiteRequestInput,
  isValidEditorWebsiteEffect,
  isValidSiteTypeEffect,
  pairForChoice,
  recordSiteTypeDecision,
  resolveSiteTypePair,
  siteTypeRequestInput,
};
