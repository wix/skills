'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const TOPOLOGY_MODES = Object.freeze(['single', 'multi', 'unknown', 'not-applicable']);
const TRANSLATION_STATES = Object.freeze(['value', 'absent', 'public-unavailable']);
const PAIRING_METHODS = Object.freeze(['client-key-echo', 'api-stable-id']);
const DECISION_KINDS = Object.freeze({
  'confirm-setup': ['LANG_TARGET_SETUP_CONFIRMATION_REQUIRED'],
  'decline-setup': ['LANG_TARGET_SETUP_CONFIRMATION_REQUIRED'],
  'accept-gap': ['LANG_PUBLIC_SOURCE_GAP', 'LANG_PUBLIC_IDENTITY_UNRESOLVED', 'LANG_TARGET_FIELD_UNSUPPORTED', 'LANG_PRIVATE_SOURCE_DEFERRED', 'LANG_FRONTEND_DEFERRED'],
  'ack-overwrite-notice': ['LANG_TARGET_TRANSLATION_OVERWRITTEN'],
  'accept-retained-removal': ['LANG_SOURCE_TRANSLATION_REMOVED'],
  'authorize-journal-removal': ['LANG_RECOVERY_JOURNAL_REMOVE'],
  'request-restore': ['LANG_TARGET_TRANSLATION_OVERWRITTEN'],
});

const canonical = (value) => JSON.stringify(value, (key, current) => (
  current && typeof current === 'object' && !Array.isArray(current)
    ? Object.fromEntries(Object.keys(current).sort().map((name) => [name, current[name]]))
    : current
));
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const stableId = (...parts) => digest(parts).slice(0, 24);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const result = values.map((value, index) => requireString(value, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
  return result;
}

function normalizeTopology(input) {
  requireObject(input, 'topology');
  const mode = requireString(input.mode, 'topology.mode');
  if (!TOPOLOGY_MODES.includes(mode)) throw new Error(`topology.mode must be one of ${TOPOLOGY_MODES.join(', ')}`);
  const additionalLocales = (input.additionalLocales || []).map((row, index) => {
    requireObject(row, `topology.additionalLocales[${index}]`);
    const locale = requireString(row.locale, `topology.additionalLocales[${index}].locale`);
    const state = row.state || 'reachable';
    if (!['reachable', 'unreachable'].includes(state)) throw new Error(`topology.additionalLocales[${index}].state is invalid`);
    return { locale, state, evidenceRefs: uniqueStrings(row.evidenceRefs || [], `topology.additionalLocales[${index}].evidenceRefs`) };
  });
  if (new Set(additionalLocales.map((row) => row.locale)).size !== additionalLocales.length) throw new Error('topology.additionalLocales must not contain duplicate locales');
  if (mode === 'single' && additionalLocales.length) throw new Error('single topology cannot have additional locales');
  if (mode === 'multi' && !additionalLocales.length) throw new Error('multi topology requires at least one additional locale');
  return {
    schemaVersion: 1,
    mode,
    defaultLocaleRef: input.defaultLocaleRef || null,
    additionalLocales,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
  };
}

function normalizeTranslationState(value, label) {
  requireObject(value, label);
  const state = requireString(value.state, `${label}.state`);
  if (!TRANSLATION_STATES.includes(state)) throw new Error(`${label}.state must be one of ${TRANSLATION_STATES.join(', ')}`);
  if (state === 'value' && !Object.prototype.hasOwnProperty.call(value, 'value')) throw new Error(`${label}.value is required`);
  if (state !== 'value' && Object.prototype.hasOwnProperty.call(value, 'value')) throw new Error(`${label}.value is forbidden for ${state}`);
  return state === 'value' ? { state, value: value.value } : { state };
}

function normalizeContentRows(rows, topology) {
  if (!Array.isArray(rows)) throw new Error('multilingual content must be an array');
  const locales = new Set(topology.additionalLocales.map((row) => row.locale));
  if (topology.mode !== 'multi' && rows.length) throw new Error('only proven multi topology may produce multilingual rows');
  return rows.map((row, index) => {
    requireObject(row, `content[${index}]`);
    const sourceObject = requireObject(row.sourceObject, `content[${index}].sourceObject`);
    const member = requireObject(row.member, `content[${index}].member`);
    const defaultValue = normalizeTranslationState(row.default, `content[${index}].default`);
    if (defaultValue.state !== 'value') throw new Error(`content[${index}].default must carry the default value`);
    const normalized = {
      rowId: row.rowId || stableId(sourceObject.type, sourceObject.id, member.path, member.stableId || ''),
      sourceObject: {
        type: requireString(sourceObject.type, `content[${index}].sourceObject.type`),
        id: requireString(sourceObject.id, `content[${index}].sourceObject.id`),
      },
      member: {
        path: requireString(member.path, `content[${index}].member.path`),
        ...(member.stableId ? { stableId: requireString(member.stableId, `content[${index}].member.stableId`) } : {}),
      },
      default: defaultValue,
      translations: {},
      evidenceRefs: uniqueStrings(row.evidenceRefs || [], `content[${index}].evidenceRefs`),
    };
    for (const locale of locales) {
      if (!row.translations || !Object.prototype.hasOwnProperty.call(row.translations, locale)) {
        throw new Error(`content[${index}] must record value, absent, or public-unavailable for ${locale}`);
      }
      normalized.translations[locale] = normalizeTranslationState(row.translations[locale], `content[${index}].translations.${locale}`);
    }
    for (const locale of Object.keys(row.translations || {})) if (!locales.has(locale)) throw new Error(`content[${index}] names undeclared locale ${locale}`);
    return normalized;
  });
}

function buildMemberPairings(bindings, additionalLocaleCount) {
  if (additionalLocaleCount === 0) return [];
  if (!Array.isArray(bindings)) throw new Error('member bindings must be an array');
  return bindings.map((row, index) => {
    requireObject(row, `bindings[${index}]`);
    const method = requireString(row.method, `bindings[${index}].method`);
    if (!PAIRING_METHODS.includes(method)) throw new Error(`bindings[${index}].method cannot use text or position`);
    const normalized = {
      sourceObjectId: requireString(row.sourceObjectId, `bindings[${index}].sourceObjectId`),
      sourceMemberId: requireString(row.sourceMemberId, `bindings[${index}].sourceMemberId`),
      targetObjectId: requireString(row.targetObjectId, `bindings[${index}].targetObjectId`),
      targetMemberId: requireString(row.targetMemberId, `bindings[${index}].targetMemberId`),
      method,
      requestDigest: requireString(row.requestDigest, `bindings[${index}].requestDigest`),
      readbackDigest: requireString(row.readbackDigest, `bindings[${index}].readbackDigest`),
    };
    return { ...normalized, pairingId: stableId(normalized) };
  });
}

function buildObjectPairings(bindings, additionalLocaleCount) {
  if (additionalLocaleCount === 0) return [];
  if (!Array.isArray(bindings)) throw new Error('object bindings must be an array');
  return bindings.map((row, index) => {
    requireObject(row, `objectBindings[${index}]`);
    const method = requireString(row.method, `objectBindings[${index}].method`);
    if (!PAIRING_METHODS.includes(method)) throw new Error(`objectBindings[${index}].method cannot use text or position`);
    const normalized = {
      sourceObjectId: requireString(row.sourceObjectId, `objectBindings[${index}].sourceObjectId`),
      targetObjectId: requireString(row.targetObjectId, `objectBindings[${index}].targetObjectId`),
      method,
      requestDigest: requireString(row.requestDigest, `objectBindings[${index}].requestDigest`),
      readbackDigest: requireString(row.readbackDigest, `objectBindings[${index}].readbackDigest`),
    };
    return { ...normalized, pairingId: stableId(normalized) };
  });
}

async function collectPages(fetchPage, label = 'page') {
  if (typeof fetchPage !== 'function') throw new Error('fetchPage must be a function');
  const items = [];
  const seen = new Set();
  let cursor = null;
  do {
    if (seen.has(cursor)) throw new Error(`${label} pagination repeated cursor ${cursor}`);
    seen.add(cursor);
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage(cursor);
    requireObject(page, label);
    if (!Array.isArray(page.items)) throw new Error(`${label}.items must be an array`);
    items.push(...page.items);
    cursor = page.nextCursor || null;
  } while (cursor);
  return items;
}

function capabilityKey(row) {
  return [row.sourceType, row.sourcePath, row.locale || '*'].join('|');
}

function buildCapabilityManifest({ localeSettings = {}, locales = [], schemas = [], contents = [], recoveryRows = [] } = {}) {
  const fields = [];
  for (const schema of schemas) {
    requireObject(schema, 'schema');
    for (const field of schema.fields || []) {
      const row = {
        schemaId: requireString(schema.id, 'schema.id'),
        schemaRevision: schema.revision || null,
        application: schema.application || null,
        frontend: schema.frontend === true,
        entityType: requireString(schema.entityType, 'schema.entityType'),
        sourceType: field.sourceType || schema.sourceType || schema.entityType,
        sourcePath: requireString(field.sourcePath || field.path, 'schema field sourcePath'),
        keyTemplate: field.keyTemplate || null,
        concreteKey: field.concreteKey || null,
        type: field.type || 'string',
        writable: field.writable !== false,
        flags: Array.isArray(field.flags) ? field.flags : [],
        constraints: field.constraints || {},
        parentRequirements: Array.isArray(field.parentRequirements) ? field.parentRequirements : [],
      };
      fields.push(row);
    }
  }
  const liveContents = normalizeTranslationContents(contents, schemas);
  return {
    schemaVersion: 1,
    localeSettings,
    locales,
    schemas: schemas.map((row) => ({ id: row.id, revision: row.revision || null, entityType: row.entityType, frontend: row.frontend === true })),
    fields,
    contents: liveContents,
    recoveryRows,
    digest: digest({ localeSettings, locales, schemas, contents: liveContents, recoveryRows }),
  };
}

function typedFieldValue(field) {
  if (Object.prototype.hasOwnProperty.call(field, 'textValue')) return field.textValue;
  if (Object.prototype.hasOwnProperty.call(field, 'richContent')) return field.richContent;
  if (Object.prototype.hasOwnProperty.call(field, 'image')) return field.image;
  if (Object.prototype.hasOwnProperty.call(field, 'video')) return field.video;
  if (Object.prototype.hasOwnProperty.call(field, 'value')) return field.value;
  return undefined;
}

function memberIdFromConcreteKey(concreteKey, keyTemplate) {
  if (typeof concreteKey !== 'string' || typeof keyTemplate !== 'string') return null;
  const marker = keyTemplate.indexOf('()');
  if (marker < 0 || keyTemplate.indexOf('()', marker + 2) >= 0) return null;
  const prefix = `${keyTemplate.slice(0, marker)}(`;
  const suffix = `)${keyTemplate.slice(marker + 2)}`;
  if (!concreteKey.startsWith(prefix) || !concreteKey.endsWith(suffix)) return null;
  const memberId = concreteKey.slice(prefix.length, concreteKey.length - suffix.length);
  return memberId || null;
}

function concreteKeyFor(capability, memberPath, targetMemberId) {
  if (targetMemberId && capability.keyTemplate?.includes('()')) {
    return capability.keyTemplate.replace('()', `(${targetMemberId})`);
  }
  const candidate = capability.concreteKey || capability.keyTemplate || memberPath;
  return targetMemberId && candidate.includes('()')
    ? candidate.replace('()', `(${targetMemberId})`)
    : candidate;
}

function normalizeTranslationContents(contents, schemas = []) {
  if (!Array.isArray(contents)) throw new Error('translation contents must be an array');
  const schemaById = new Map(schemas.map((row) => [row.id, row]));
  const rows = [];
  for (const content of contents) {
    requireObject(content, 'translation content');
    if (content.fields && !Array.isArray(content.fields)) {
      const schemaId = requireString(content.schemaId, 'translation content.schemaId');
      const entityId = requireString(content.entityId, 'translation content.entityId');
      const locale = requireString(content.locale, 'translation content.locale');
      const entityType = schemaById.get(schemaId)?.entityType || content.entityType || schemaId;
      for (const [mapKey, rawField] of Object.entries(content.fields)) {
        const field = requireObject(rawField, `translation content.fields.${mapKey}`);
        const value = typedFieldValue(field);
        const keyTemplate = field.schemaFieldKey || mapKey;
        rows.push({
          schemaId,
          entityType,
          locale,
          targetObjectId: content.parentEntityId || entityId,
          targetMemberId: content.parentEntityId ? entityId : memberIdFromConcreteKey(mapKey, keyTemplate),
          key: mapKey,
          keyTemplate,
          value,
          published: field.published === true,
          contentId: content.id || null,
          publishStatus: content.publishStatus || null,
        });
      }
      continue;
    }
    rows.push(content);
  }
  return rows;
}

function fieldStateDigest(value, published) {
  return digest({ state: value === undefined ? 'missing' : 'value', value: value === undefined ? null : value, published: published === true });
}

function findPairing(pairings, contentRow) {
  if (!contentRow.member.stableId) return null;
  return pairings.find((row) => row.sourceObjectId === contentRow.sourceObject.id && row.sourceMemberId === contentRow.member.stableId) || null;
}

function findObjectPairing(pairings, contentRow) {
  return pairings.find((row) => row.sourceObjectId === contentRow.sourceObject.id) || null;
}

function findLiveField(liveContents, identity) {
  return liveContents.find((row) => row.locale === identity.locale && row.entityType === identity.entityType
    && (!row.schemaId || row.schemaId === identity.schemaId)
    && row.targetObjectId === identity.targetObjectId
    && (row.targetMemberId || null) === (identity.targetMemberId || null)
    && row.key === identity.concreteKey) || null;
}

function reasonForGap(state) {
  if (state === 'public-unavailable') return 'LANG_PRIVATE_SOURCE_DEFERRED';
  return 'LANG_PUBLIC_SOURCE_GAP';
}

function latestVerifiedJournalRow(rows, predicate) {
  let latest = null;
  for (const row of rows) {
    if (row.outcome !== 'verified' || !predicate(row)) continue;
    if (!latest || String(row.verifiedAt || '') >= String(latest.verifiedAt || '')) latest = row;
  }
  return latest;
}

function buildPlan({ topology, contentRows, objectPairings = [], pairings = [], capabilities, liveContents = [], journalRows = [], priorPlanRows = [] }) {
  const normalizedTopology = normalizeTopology(topology);
  const sourceRows = normalizeContentRows(contentRows, normalizedTopology);
  if (normalizedTopology.mode !== 'multi') return { schemaVersion: 1, rows: [], inputDigest: digest({ topology: normalizedTopology, contentRows: sourceRows, capabilities }) };
  const capabilityRows = capabilities.fields || [];
  const rows = [];
  const currentKeys = new Set();
  for (const source of sourceRows) {
    for (const localeRow of normalizedTopology.additionalLocales) {
      const locale = localeRow.locale;
      const translated = source.translations[locale];
      const rowId = stableId(source.rowId, locale);
      currentKeys.add(rowId);
      const base = { rowId, sourceRowId: source.rowId, locale, sourceObject: source.sourceObject, member: source.member, evidenceRefs: source.evidenceRefs };
      if (localeRow.state !== 'reachable') {
        rows.push({ ...base, state: 'source-gap', decision: 'skip-unsupported', reasonCode: 'LANG_PUBLIC_TOPOLOGY_UNRESOLVED', recovery: 'none' });
        continue;
      }
      if (translated.state === 'absent') {
        const previous = latestVerifiedJournalRow(journalRows, (entry) => entry.rowId === rowId && entry.identity)
          || priorPlanRows.find((entry) => entry.rowId === rowId && entry.identity);
        const live = previous ? findLiveField(liveContents, previous.identity) : null;
        const liveDigest = live ? fieldStateDigest(live.value, live.published) : null;
        const authored = previous && journalRows.some((entry) => entry.outcome === 'verified'
          && entry.identityDigest === digest(previous.identity) && entry.replacementDigest === liveDigest);
        if (authored) {
          rows.push({ ...previous, sourceState: 'absent', target: live, state: 'migration-authored-source-absent', decision: 'skip-absent-leave-target', reasonCode: 'LANG_SOURCE_TRANSLATION_REMOVED', recovery: previous.recovery || 'none' });
        } else {
          rows.push({ ...base, sourceState: 'absent', state: 'source-gap', decision: 'skip-equal', reasonCode: null, recovery: 'none' });
        }
        continue;
      }
      if (translated.state !== 'value') {
        rows.push({ ...base, state: 'source-gap', decision: 'skip-unsupported', reasonCode: reasonForGap(translated.state), recovery: 'none' });
        continue;
      }
      const capability = capabilityRows.find((entry) => !entry.frontend && entry.writable !== false
        && entry.sourceType === source.sourceObject.type && entry.sourcePath === source.member.path);
      if (!capability) {
        const frontend = capabilityRows.some((entry) => entry.frontend && entry.sourceType === source.sourceObject.type && entry.sourcePath === source.member.path);
        rows.push({ ...base, sourceValue: translated.value, state: 'unsupported-field', decision: 'skip-unsupported', reasonCode: frontend ? 'LANG_FRONTEND_DEFERRED' : 'LANG_TARGET_FIELD_UNSUPPORTED', recovery: 'none' });
        continue;
      }
      const objectPairing = findObjectPairing(objectPairings, source);
      if (!objectPairing) {
        rows.push({ ...base, sourceValue: translated.value, state: 'blocked', decision: 'blocked', reasonCode: 'LANG_PUBLIC_IDENTITY_UNRESOLVED', recovery: 'none' });
        continue;
      }
      let targetObjectId = objectPairing.targetObjectId;
      let targetMemberId = null;
      if (source.member.stableId) {
        const pairing = findPairing(pairings, source);
        if (!pairing) {
          rows.push({ ...base, sourceValue: translated.value, state: 'blocked', decision: 'blocked', reasonCode: 'LANG_PUBLIC_IDENTITY_UNRESOLVED', recovery: 'none' });
          continue;
        }
        targetObjectId = pairing.targetObjectId;
        targetMemberId = pairing.targetMemberId;
      }
      const requiresMemberIdentity = [capability.keyTemplate, capability.concreteKey]
        .some((key) => typeof key === 'string' && key.includes('()'));
      if (requiresMemberIdentity && !targetMemberId) {
        rows.push({ ...base, sourceValue: translated.value, state: 'blocked', decision: 'blocked', reasonCode: 'LANG_PUBLIC_IDENTITY_UNRESOLVED', recovery: 'none' });
        continue;
      }
      const identity = { locale, entityType: capability.entityType, targetObjectId, targetMemberId, concreteKey: concreteKeyFor(capability, source.member.path, targetMemberId), schemaId: capability.schemaId };
      const live = findLiveField(liveContents, identity);
      const liveValue = live && Object.prototype.hasOwnProperty.call(live, 'value') ? live.value : undefined;
      const published = live?.published === true;
      const replacementDigest = fieldStateDigest(translated.value, true);
      const priorDigest = fieldStateDigest(liveValue, published);
      const identityDigest = digest(identity);
      const verifiedJournal = journalRows.find((entry) => entry.outcome === 'verified' && entry.identityDigest === identityDigest
        && entry.replacementDigest === priorDigest);
      const preparedJournal = journalRows.find((entry) => entry.outcome === 'prepared' && entry.identityDigest === identityDigest
        && entry.sourceDigest === digest(translated.value) && entry.replacementDigest === replacementDigest);
      let state;
      let decision;
      let reasonCode = null;
      if (liveValue === undefined) { state = live ? 'missing-field' : 'missing-record'; decision = live ? 'patch-unpublished' : 'create-unpublished'; }
      else if (canonical(liveValue) === canonical(translated.value) && published) { state = 'equal-published'; decision = preparedJournal ? 'finalize-prepared' : 'skip-equal'; }
      else if (canonical(liveValue) === canonical(translated.value)) { state = 'equal-unpublished'; decision = 'publish-only'; }
      else if (verifiedJournal) { state = 'different-migration-authored'; decision = 'update-migration-authored'; }
      else { state = liveValue === '' || liveValue === null ? 'empty' : 'different'; decision = 'overwrite-after-backup'; reasonCode = state === 'different' ? 'LANG_TARGET_TRANSLATION_OVERWRITTEN' : null; }
      const recovery = preparedJournal?.id || preparedJournal?.recoveryRowId
        || (decision === 'skip-equal' || decision === 'publish-only' ? 'none' : stableId(identity, priorDigest, replacementDigest));
      rows.push({ ...base, identity, ...(live?.contentId ? { contentId: live.contentId } : {}), sourceValue: translated.value, target: live || null, state, decision, reasonCode, priorDigest, replacementDigest, recovery, ...(preparedJournal ? { preparedRecovery: recovery } : {}) });
    }
  }
  for (const previous of priorPlanRows) {
    if (currentKeys.has(previous.rowId) || previous.sourceState !== 'absent') continue;
    const live = findLiveField(liveContents, previous.identity || {});
    const liveDigest = live ? fieldStateDigest(live.value, live.published) : null;
    const authored = journalRows.some((entry) => entry.outcome === 'verified' && entry.identityDigest === digest(previous.identity) && entry.replacementDigest === liveDigest);
    if (!authored) continue;
    rows.push({ ...previous, target: live, state: 'migration-authored-source-absent', decision: 'skip-absent-leave-target', reasonCode: 'LANG_SOURCE_TRANSLATION_REMOVED', recovery: previous.recovery || 'none' });
  }
  return { schemaVersion: 1, rows, inputDigest: digest({ topology: normalizedTopology, contentRows: sourceRows, objectPairings, pairings, capabilities, liveContents }) };
}

function actionId(reasonCode, rowId) { return `lang:${reasonCode}:${rowId}`; }

function scopeDigest(row) {
  return digest({ rowId: row.rowId, reasonCode: row.reasonCode, state: row.state, decision: row.decision, identity: row.identity || null, recovery: row.recovery || null });
}

function normalizeDecision(input, openActions, existing = []) {
  requireObject(input, 'decision');
  const kind = requireString(input.kind, 'decision.kind');
  if (!DECISION_KINDS[kind]) throw new Error(`unsupported multilingual decision kind ${kind}`);
  const action = openActions.find((row) => row.actionId === input.actionId);
  if (!action) throw new Error(`decision action is not open: ${input.actionId}`);
  if (!DECISION_KINDS[kind].includes(action.reasonCode)) throw new Error(`${kind} cannot resolve ${action.reasonCode}`);
  if (input.scopeDigest !== action.scopeDigest) throw new Error('decision scope digest is stale');
  const decidedBy = input.decidedBy;
  if (!['site-owner', 'cutover-operator'].includes(decidedBy)) throw new Error('decidedBy must be site-owner or cutover-operator');
  const recordedBy = input.recordedBy;
  if (recordedBy !== 'import-operator') throw new Error('migration-local decisions must be recorded by the Import Operator');
  if (kind === 'request-restore') requireString(input.recoveryRowId, 'decision.recoveryRowId');
  const normalized = {
    decisionId: stableId(input.actionId, kind, input.scopeDigest, input.evidenceRef, existing.length),
    actionId: input.actionId,
    reasonCode: action.reasonCode,
    kind,
    scopeDigest: input.scopeDigest,
    affectedIds: uniqueStrings(input.affectedIds || action.affectedIds || [], 'decision.affectedIds'),
    decidedBy,
    recordedBy,
    evidenceRef: requireString(input.evidenceRef, 'decision.evidenceRef'),
    recordedAt: input.recordedAt || new Date().toISOString(),
    ...(input.recoveryRowId ? { recoveryRowId: input.recoveryRowId } : {}),
  };
  if (!Number.isFinite(Date.parse(normalized.recordedAt))) throw new Error('decision.recordedAt must be an ISO timestamp');
  return normalized;
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(temp, file);
}

async function appendNdjson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, `${JSON.stringify(value)}\n`);
}

async function artifactDigests(projectDir, files) {
  const result = {};
  for (const relative of uniqueStrings(files, 'files')) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('default artifact paths must be project-relative');
    // eslint-disable-next-line no-await-in-loop
    result[relative] = digest(await fsp.readFile(path.join(projectDir, relative)));
  }
  return result;
}

function assertDefaultArtifactsUnchanged(before, after) {
  if (canonical(before) !== canonical(after)) {
    const changed = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
      .filter((file) => before?.[file] !== after?.[file]);
    throw Object.assign(new Error(`multilingual sidecar changed default artifacts: ${changed.join(', ')}`), { code: 'LANG_DEFAULT_OUTPUT_CHANGED', changed });
  }
  return true;
}

function readNdjson(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = {
  DECISION_KINDS,
  TOPOLOGY_MODES,
  actionId,
  appendNdjson,
  artifactDigests,
  assertDefaultArtifactsUnchanged,
  buildCapabilityManifest,
  buildMemberPairings,
  buildObjectPairings,
  buildPlan,
  canonical,
  capabilityKey,
  collectPages,
  digest,
  fieldStateDigest,
  normalizeContentRows,
  normalizeDecision,
  normalizeTranslationContents,
  normalizeTopology,
  readNdjson,
  scopeDigest,
  stableId,
  writeJsonAtomic,
};
