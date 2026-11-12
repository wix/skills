'use strict';

// Deterministic old-URL preservation planning.
//
// Input: the import's URL ledger (current source page addresses), source-authored redirect
// definitions, the website builder's final route manifest, the declared production origins,
// and (optionally) the destination site's current redirect inventory.
// Output: one obligation per known old address, and at most one remote rule per
// site + path + API scope. Nothing here writes, publishes or guesses: a missing or ambiguous
// destination is an obligation with a reason and an operator action, never a best guess.

const crypto = require('node:crypto');

const PLAN_SCHEMA_VERSION = 1;
const MAX_SOURCE_CHAIN_HOPS = 10;
const PLACEHOLDER_BASE = 'http://placeholder.invalid';

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      if (value[key] !== undefined) out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

// --- URL parsing ------------------------------------------------------------------------

// Structural parse of an old address. Reserved escapes such as %2F are kept as-is (never
// decoded), hex case is normalized, non-ASCII is percent-encoded, and the query/fragment are
// kept separately so they are never discarded.
function parseAddress(raw, { origins = [] } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'malformed_url' };
  const value = raw.trim();
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) return { ok: false, reason: 'malformed_encoding' };
  let url;
  let absolute = false;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      absolute = true;
      url = new URL(value);
    } else if (value.startsWith('//')) {
      return { ok: false, reason: 'scheme_relative_url' };
    } else if (value.startsWith('/')) {
      url = new URL(value, PLACEHOLDER_BASE);
    } else {
      return { ok: false, reason: 'not_site_relative' };
    }
  } catch {
    return { ok: false, reason: 'malformed_url' };
  }
  if (absolute && url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'unsupported_scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  let origin = null;
  if (absolute) {
    const scheme = url.protocol.slice(0, -1);
    const port = url.port ? Number(url.port) : (scheme === 'https' ? 443 : 80);
    origin = `${scheme}://${url.hostname}:${port}`;
    const declared = origins.some((o) => `${o.scheme}://${o.hostname}:${o.effectivePort}` === origin);
    if (!declared) return { ok: true, external: true, origin, href: url.href };
  }
  const pathName = url.pathname.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
  return {
    ok: true,
    external: false,
    origin,
    path: pathName,
    conflictPath: conflictPath(pathName),
    query: url.search || '',
    fragment: url.hash || '',
  };
}

// Provider trailing-slash equivalence, applied only to redirect conflict keys.
function conflictPath(pathName) {
  if (pathName.length > 1 && pathName.endsWith('/')) return pathName.replace(/\/+$/, '') || '/';
  return pathName;
}

function isPathPrefix(prefix, candidate) {
  if (prefix === '/') return true;
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

// --- remote identity -------------------------------------------------------------------

// The API stores one site-level rule per path; origins are not part of its identity.
function apiScopeOf(rule) {
  return {
    groupRedirect: Boolean(rule && rule.options && rule.options.groupRedirect),
    language: (rule && rule.language) || '*',
  };
}

function remoteRuleKey(siteId, fromConflictPath, scope = { groupRedirect: false, language: '*' }) {
  return `${siteId}|${fromConflictPath}|${scope.groupRedirect ? 'group' : 'exact'}|${scope.language}`;
}

function normalizeInventoryRule(rule) {
  const from = parseAddress(rule.from || '');
  const to = parseAddress(rule.to || '');
  return {
    id: rule.id || null,
    from: rule.from,
    to: rule.to,
    fromConflict: from.ok && !from.external ? from.conflictPath : null,
    toConflict: to.ok && !to.external ? to.conflictPath : null,
    toExternal: Boolean(to.ok && to.external),
    toQuery: to.ok && !to.external ? to.query : '',
    scope: apiScopeOf(rule),
  };
}

function inventoryDigest(inventory) {
  return digest((inventory || []).map((rule) => ({
    id: rule.id || null, from: rule.from, to: rule.to, scope: apiScopeOf(rule),
  })).sort((a, b) => `${a.from}|${a.to}|${a.id}`.localeCompare(`${b.from}|${b.to}|${b.id}`)));
}

// --- planning --------------------------------------------------------------------------

const ENTITY_URL_SKIP = new Set(['not_public', 'source_url_missing']);
// Import-era unresolved rows that a final route manifest is expected to settle. Any other open
// or manual_review row keeps its decision: the obligation stays manual_review, never a write.
const IMPORT_RESOLVABLE_STATUS = new Set(['target_url_missing', 'pending_target_route', 'redirect_required', 'preserved']);
// Only these documented routing uncertainties can be settled by an exact final route.
// Privacy, explicit decisions, missing reasons and all other causes remain restrictions.
const BASE_PATH_ROUTING_REASONS = new Set(['target_route_unknown', 'target_url_missing', 'pending_target_route', 'final_route_missing']);

function addReason(target, code) {
  if (!target.reasonCodes.includes(code)) target.reasonCodes.push(code);
}

function obligationKeyOf(parsed) {
  return `${parsed.path}${parsed.query}${parsed.fragment}`;
}

function buildEntityIndex(ledgerRows) {
  const byConflictPath = new Map();
  for (const row of ledgerRows) {
    if (ENTITY_URL_SKIP.has(row.urlStatus) || !row.sourceRelativeUrl) continue;
    const parsed = parseAddress(row.sourceRelativeUrl);
    if (!parsed.ok || parsed.external) continue;
    const list = byConflictPath.get(parsed.conflictPath) || [];
    if (!list.some((entry) => entry.sourceStableKey === row.sourceStableKey)) list.push(row);
    byConflictPath.set(parsed.conflictPath, list);
  }
  return byConflictPath;
}

function buildRouteIndexes(finalRoutes) {
  const bySourceKey = new Map();
  const byConflictPath = new Map();
  for (const route of (finalRoutes && finalRoutes.routes) || []) {
    const parsed = parseAddress(route.relativeUrl);
    if (!parsed.ok || parsed.external) continue;
    const entry = { ...route, conflictPath: parsed.conflictPath, path: parsed.path, query: parsed.query };
    bySourceKey.set(route.sourceKey, [...(bySourceKey.get(route.sourceKey) || []), entry]);
    byConflictPath.set(parsed.conflictPath, [...(byConflictPath.get(parsed.conflictPath) || []), entry]);
  }
  return { bySourceKey, byConflictPath };
}

function distinctRoutes(routes) {
  const seen = new Map();
  for (const route of routes) seen.set(`${route.targetEntityType}|${route.targetEntityId}|${route.conflictPath}`, route);
  return [...seen.values()];
}

// Follow enabled exact source rules to the current source entity whose page they reach.
function resolveSourceChain(startRule, ctx) {
  const visited = [];
  let rule = startRule;
  for (let hop = 0; hop <= MAX_SOURCE_CHAIN_HOPS; hop += 1) {
    visited.push(rule.ruleKey);
    const dest = parseAddress(rule.destination || '', { origins: ctx.origins });
    if (!dest.ok) return { status: 'manual_review', reason: `destination_${dest.reason}`, edges: visited };
    if (dest.external) return { status: 'manual_review', reason: 'external_destination', edges: visited };
    if (dest.query) return { status: 'manual_review', reason: 'destination_query_semantics', edges: visited };
    const entities = ctx.entityIndex.get(dest.conflictPath) || [];
    if (entities.length > 1) return { status: 'manual_review', reason: 'ambiguous_destination_entity', edges: visited };
    if (entities.length === 1) return { status: 'resolved', entity: entities[0], edges: visited };
    const next = ctx.exactRulesBySource.get(dest.conflictPath) || [];
    if (next.length > 1) return { status: 'manual_review', reason: 'conflicting_source_rules', edges: visited };
    if (next.length === 0) return { status: 'unresolved', reason: 'destination_not_found', edges: visited };
    if (visited.includes(next[0].ruleKey)) return { status: 'manual_review', reason: 'source_rule_cycle', edges: visited };
    rule = next[0];
  }
  return { status: 'manual_review', reason: 'source_chain_too_long', edges: visited };
}

function classifySourceRule(rule) {
  if (!rule.enabled) return 'disabled_rule_excluded';
  if (rule.matchType !== 'exact') return 'unsupported_match_type';
  // Only exact 301 rules can be written (the API takes an unqualified from/to rule). A 308
  // keeps the request method; rewriting it as a 301 would silently change its semantics.
  if (rule.statusCode === 308) return 'status_308_not_writable';
  if (rule.statusCode !== 301) return 'non_permanent_status';
  if (rule.language) return 'language_scoped_rule';
  if (Array.isArray(rule.conditions) && rule.conditions.length) {
    const onlyHost = rule.conditions.every((c) => c && c.type === 'host');
    if (!onlyHost) return 'conditional_rule';
  }
  return null;
}

function hostConditionOrigins(rule, origins) {
  const hosts = (rule.conditions || []).filter((c) => c && c.type === 'host').map((c) => String(c.value || '').toLowerCase());
  if (!hosts.length) return null;
  return origins.filter((o) => hosts.includes(o.hostname));
}

function planRedirects(input) {
  const {
    siteId,
    ledgerRows = [],
    sourceRules = [],
    importedRedirectOutcomes = [],
    coverage = null,
    finalRoutes = null,
    sourceDomains = null,
    targetInventory = null,
    importRedirects = [],
    invalidImportRedirects = [],
    importUnresolved = [],
    basePaths = [],
  } = input;
  const origins = (sourceDomains && sourceDomains.origins) || [];
  const originKeys = origins.map((o) => `${o.scheme}://${o.hostname}:${o.effectivePort}`);
  const deploymentId = finalRoutes ? finalRoutes.deploymentId : null;
  const ruleFindings = [];
  const importedByRule = new Map(importedRedirectOutcomes.map((row) => [row.sourceStableKey, row]));
  const capturedRuleKeys = new Set(sourceRules.filter((rule) => rule.enabled && rule.storage?.kind !== 'export')
    .map((rule) => `${rule.provider}:redirect:${rule.sourceRuleId || rule.stableId}`));
  const inventoryBySource = new Map();
  for (const rule of targetInventory || []) {
    const normalized = normalizeInventoryRule(rule);
    if (!normalized.fromConflict) continue;
    if (!inventoryBySource.has(normalized.fromConflict)) inventoryBySource.set(normalized.fromConflict, []);
    inventoryBySource.get(normalized.fromConflict).push({ rule, normalized });
  }

  // Source-rule inventory: deduplicate identical definitions across providers, keep evidence.
  const activeRules = [];
  const semantic = new Map();
  for (const rule of sourceRules) {
    const exclusion = classifySourceRule(rule);
    if (exclusion === 'disabled_rule_excluded') {
      ruleFindings.push({ ruleKey: rule.ruleKey, provider: rule.provider, disposition: 'excluded', reasonCodes: [exclusion] });
      continue;
    }
    const src = parseAddress(rule.source, { origins });
    const key = src.ok && !src.external ? `${src.conflictPath}${src.query}` : `raw:${rule.source}`;
    const signature = JSON.stringify([key, rule.destination, rule.statusCode, rule.matchType, rule.conditions || null, rule.language || null]);
    if (semantic.has(signature)) {
      semantic.get(signature).duplicateEvidence.push({ ruleKey: rule.ruleKey, provider: rule.provider, storage: rule.storage });
      continue;
    }
    const entry = { ...rule, parsedSource: src, exclusion, duplicateEvidence: [] };
    semantic.set(signature, entry);
    activeRules.push(entry);
  }
  const exactRulesBySource = new Map();
  for (const rule of activeRules) {
    if (rule.exclusion || !rule.parsedSource.ok || rule.parsedSource.external || rule.parsedSource.query) continue;
    const list = exactRulesBySource.get(rule.parsedSource.conflictPath) || [];
    list.push(rule);
    exactRulesBySource.set(rule.parsedSource.conflictPath, list);
  }

  const entityIndex = buildEntityIndex(ledgerRows);
  const entityTypesByKey = new Map();
  for (const row of ledgerRows) {
    if (!row.sourceStableKey || !row.sourceEntityType) continue;
    if (!entityTypesByKey.has(row.sourceStableKey)) entityTypesByKey.set(row.sourceStableKey, new Set());
    entityTypesByKey.get(row.sourceStableKey).add(row.sourceEntityType);
  }
  const routes = buildRouteIndexes(finalRoutes);
  const ctx = { origins, entityIndex, exactRulesBySource };
  const obligations = new Map();

  function obligationFor(parsed, rawUrl) {
    const key = parsed.ok && !parsed.external ? obligationKeyOf(parsed) : `refused:${rawUrl}`;
    if (!obligations.has(key)) {
      obligations.set(key, {
        obligationKey: key,
        originalUrl: rawUrl,
        path: parsed.ok ? parsed.path || null : null,
        conflictPath: parsed.ok ? parsed.conflictPath || null : null,
        query: parsed.ok ? parsed.query || '' : '',
        fragment: parsed.ok ? parsed.fragment || '' : '',
        provenance: [],
        origins: new Set(),
        targets: [],
        disposition: null,
        reasonCodes: [],
        expected: null,
        remoteRuleKey: null,
      });
    }
    return obligations.get(key);
  }

  function attachTarget(ob, entity, via, originSubset) {
    const types = new Set(entityTypesByKey.get(entity.sourceStableKey) || []);
    if (entity.sourceEntityType) types.add(entity.sourceEntityType);
    const resolvedEntity = { ...entity, sourceEntityType: types.size === 1 ? [...types][0] : null };
    ob.targets.push({ entity: resolvedEntity, via, origins: originSubset || originKeys });
    for (const key of originSubset || originKeys) ob.origins.add(key);
  }

  for (const row of ledgerRows) {
    if (ENTITY_URL_SKIP.has(row.urlStatus) || !row.sourceRelativeUrl) continue;
    const parsed = parseAddress(row.sourceRelativeUrl, { origins });
    const ob = obligationFor(parsed, row.sourceRelativeUrl);
    ob.provenance.push({ kind: 'entity_url', sourceStableKey: row.sourceStableKey, sourceEntityType: row.sourceEntityType, urlStatus: row.urlStatus });
    if (!parsed.ok) { addReason(ob, parsed.reason); continue; }
    // A recorded manual decision is never turned into an automatic write.
    if (row.urlStatus === 'manual_review') addReason(ob, 'import_manual_review');
    attachTarget(ob, row, 'entity_url');
  }

  // Replay import-era redirect requirements: each one stays an obligation for its entity even
  // when the ledger no longer lists that address. The final route decides the destination;
  // the import-era target is kept as evidence.
  for (const row of importRedirects) {
    // Source-authored exact rules also have their full semantics in sourceRules. Their
    // import-era relative plan is compatibility evidence, not a second entity owner.
    if (capturedRuleKeys.has(row.sourceStableKey)) continue;
    if (/:redirect:/.test(row.sourceStableKey || '')) {
      const parsed = parseAddress(row.sourceRelativeUrl, { origins });
      const ob = obligationFor(parsed, row.sourceRelativeUrl);
      ob.provenance.push({ kind: 'inactive_import_redirect', sourceStableKey: row.sourceStableKey,
        recordedDestination: row.targetRelativeUrl });
      addReason(ob, 'inactive_import_redirect_plan_requires_reconciliation');
      continue;
    }
    const parsed = parseAddress(row.sourceRelativeUrl, { origins });
    const ob = obligationFor(parsed, row.sourceRelativeUrl);
    ob.provenance.push({ kind: 'import_redirect', sourceStableKey: row.sourceStableKey, importTarget: row.targetRelativeUrl, status: row.status });
    if (!parsed.ok) { addReason(ob, parsed.reason); continue; }
    attachTarget(ob, { sourceStableKey: row.sourceStableKey, sourceEntityType: row.sourceEntityType || null }, 'import_redirect');
  }

  for (const row of invalidImportRedirects) {
    const source = row.sourceRelativeUrl || `redirects.ndjson line ${row.line}: address missing`;
    const parsed = parseAddress(source, { origins });
    const ob = obligationFor(parsed, source);
    ob.provenance.push({ kind: 'import_redirect_rejected', line: row.line, recordedDestination: row.recordedDestination || null, recordedStatus: row.recordedStatus || null });
    addReason(ob, row.reason || 'import_redirect_invalid_row');
    if (!parsed.ok) addReason(ob, parsed.reason);
  }

  // Replay import-era unresolved rows. Resolved rows are evidence only. Open rows that only
  // waited for a final route stay obligations; anything else keeps a manual decision.
  for (const row of importUnresolved) {
    const parsed = parseAddress(row.sourceRelativeUrl, { origins });
    const evidence = { kind: 'import_unresolved', sourceStableKey: row.sourceStableKey, urlStatus: row.urlStatus, status: row.status, reason: row.reason || null };
    if (row.status === 'resolved') {
      const key = parsed.ok && !parsed.external ? obligationKeyOf(parsed) : `refused:${row.sourceRelativeUrl}`;
      if (obligations.has(key)) obligations.get(key).provenance.push(evidence);
      continue;
    }
    const ob = obligationFor(parsed, row.sourceRelativeUrl);
    ob.provenance.push(evidence);
    if (!parsed.ok) { addReason(ob, parsed.reason); continue; }
    if (row.status === 'manual_review' || row.urlStatus === 'manual_review') addReason(ob, 'import_manual_review');
    else if (!IMPORT_RESOLVABLE_STATUS.has(row.urlStatus)) addReason(ob, `import_unresolved_${row.urlStatus}`);
    attachTarget(ob, { sourceStableKey: row.sourceStableKey, sourceEntityType: row.sourceEntityType }, 'import_unresolved');
  }

  for (const row of importedRedirectOutcomes) {
    if (row.disposition !== 'removed_input') continue;
    const parsed = parseAddress(row.originalSource || '', { origins });
    const remoteRuleExists = parsed.ok && !parsed.external &&
      (inventoryBySource.get(parsed.conflictPath) || []).length > 0;
    if (!row.requiresReconciliation && !remoteRuleExists) continue;
    const ob = obligationFor(parsed, row.originalSource || `removed:${row.sourceStableKey}`);
    ob.provenance.push({ kind: 'imported_redirect_removed', sourceStableKey: row.sourceStableKey,
      evidenceDigest: row.evidenceDigest });
    addReason(ob, 'removed_source_rule_requires_reconciliation');
  }

  for (const rule of activeRules) {
    const parsed = rule.parsedSource;
    const ob = obligationFor(parsed, rule.source);
    ob.provenance.push({ kind: 'source_rule', ruleKey: rule.ruleKey, provider: rule.provider,
      storage: rule.storage, stableId: rule.stableId, sourceRuleId: rule.sourceRuleId || rule.stableId,
      duplicates: rule.duplicateEvidence });
    ruleFindings.push({ ruleKey: rule.ruleKey, provider: rule.provider, disposition: 'obligation', obligationKey: ob.obligationKey, duplicates: rule.duplicateEvidence.map((d) => d.ruleKey), reasonCodes: rule.exclusion ? [rule.exclusion] : [] });
    if (!parsed.ok) { addReason(ob, parsed.reason); continue; }
    if (parsed.external) { addReason(ob, 'source_on_undeclared_origin'); continue; }
    if (rule.exclusion) { addReason(ob, rule.exclusion); continue; }
    if (parsed.query) { addReason(ob, 'query_conditional_rule'); continue; }
    const imported = importedByRule.get(`${rule.provider}:redirect:${rule.sourceRuleId || rule.stableId}`);
    const target = parseAddress(imported?.resolvedTarget || rule.destination || '', { origins });
    if (target.ok && target.external) {
      if (ob.externalTarget && ob.externalTarget !== rule.destination) {
        addReason(ob, 'conflicting_source_rules');
        continue;
      }
      if (!imported || imported.originalTarget !== rule.destination || imported.destinationKind !== 'external') {
        addReason(ob, 'external_destination');
        addReason(ob, 'external_target_audit_missing_or_stale');
        continue;
      }
      if (ob.targets.length || ob.provenance.some((item) => item.kind !== 'source_rule')) {
        addReason(ob, 'source_address_ownership_conflict');
        continue;
      }
      ob.externalTarget = imported.resolvedTarget || imported.originalTarget;
      ob.externalOriginalTarget = imported.originalTarget;
      ob.externalDisposition = imported.disposition;
      ob.externalEvidenceDigest = imported.evidenceDigest;
      continue;
    }
    const subset = hostConditionOrigins(rule, origins);
    if (subset && subset.length === 0) { addReason(ob, 'host_condition_undeclared'); continue; }
    const chain = resolveSourceChain(rule, ctx);
    ob.provenance[ob.provenance.length - 1].chain = chain.edges;
    if (chain.status !== 'resolved') { addReason(ob, chain.reason); ob.chainStatus = chain.status; continue; }
    attachTarget(ob, chain.entity, 'source_rule', subset ? subset.map((o) => `${o.scheme}://${o.hostname}:${o.effectivePort}`) : null);
  }

  // Import-era base-path decisions: a base path held for manual review, or recorded as not
  // public, is evaluated by reason for each matching occurrence. Unknown type cannot bypass it.
  const heldBasePaths = basePaths
    .filter((entry) => entry.status === 'manual_review' || entry.public === false)
    .map((entry) => ({ entry, parsed: parseAddress(entry.sourceBasePath) }));

  // Resolve each obligation's intended final page and whether a redirect is needed.
  for (const ob of obligations.values()) {
    if (ob.externalTarget) {
      if (ob.reasonCodes.length || !origins.length || ob.path === '/') {
        ob.disposition = 'manual_review';
        if (!origins.length) addReason(ob, 'origins_not_declared');
        if (ob.path === '/') addReason(ob, 'source_root');
      } else if (!['external_pending_execution', 'external_redirect_automation_unavailable'].includes(ob.externalDisposition)) {
        ob.disposition = 'manual_review';
        addReason(ob, ob.externalDisposition || 'external_target_not_ready');
      } else {
        ob.disposition = 'external_redirect';
        // The same-site API writer never accepts an external destination. A matching
        // inventory row is setup evidence only; public source verification is separate.
        const atSource = inventoryBySource.get(ob.conflictPath) || [];
        const matching = atSource.filter(({ rule, normalized }) =>
          !normalized.scope.groupRedirect && normalized.scope.language === '*' &&
          rule.to === ob.externalTarget);
        ob.externalSetup = matching.length === 1 ?
          { remoteId: matching[0].rule.id || null, target: matching[0].rule.to } : null;
        if (matching.length > 1) { ob.disposition = 'manual_review'; addReason(ob, 'external_setup_conflict'); }
        if (atSource.some((entry) => !matching.includes(entry))) {
          ob.disposition = 'manual_review'; addReason(ob, 'existing_rule_conflict'); ob.externalSetup = null;
        }
      }
      continue;
    }
    ob.origins = [...ob.origins].sort();
    const routingHolds = [];
    for (const { entry, parsed } of heldBasePaths) {
      const unknownType = !ob.targets.length || ob.targets.some((target) => !target.entity.sourceEntityType);
      if (!unknownType && !ob.targets.some((target) => target.entity.sourceEntityType === entry.sourceEntityType)) continue;
      if (!ob.conflictPath) continue;
      if (!parsed.ok || parsed.external) { addReason(ob, 'base_path_unparseable'); continue; }
      if (!isPathPrefix(parsed.conflictPath, ob.conflictPath)) continue;
      const reasons = Array.isArray(entry.reasonCodes) && entry.reasonCodes.every((code) => typeof code === 'string' && code.trim()) ? entry.reasonCodes : [];
      const hold = { kind: 'base_path_hold', sourceBasePath: entry.sourceBasePath,
        sourceEntityType: entry.sourceEntityType, reasonCodes: reasons, resolution: 'unresolved' };
      ob.provenance.push(hold);
      if (entry.public === false) { addReason(ob, 'base_path_not_public'); continue; }
      if (unknownType) { addReason(ob, 'base_path_entity_type_unknown'); continue; }
      if (!reasons.length) { addReason(ob, 'base_path_hold_reason_missing'); continue; }
      if (!reasons.every((reason) => BASE_PATH_ROUTING_REASONS.has(reason))) {
        addReason(ob, 'base_path_manual_review'); continue;
      }
      // Resolve only this occurrence, and only after the normal exact-route/ownership checks.
      routingHolds.push(hold);
    }
    if (!origins.length) addReason(ob, 'origins_not_declared');
    if (ob.path === '/' || ob.conflictPath === '/') addReason(ob, 'source_root');
    if (ob.reasonCodes.length) {
      const unresolvedOnly = ob.reasonCodes.every((code) => code === 'destination_not_found' || code === 'origins_not_declared');
      ob.disposition = unresolvedOnly ? 'unresolved' : 'manual_review';
      continue;
    }
    if (!finalRoutes) { ob.disposition = 'pending_website_build'; addReason(ob, 'final_routes_missing'); continue; }
    const entityKeys = [...new Set(ob.targets.map((t) => t.entity.sourceStableKey))];
    if (entityKeys.length !== 1) { ob.disposition = 'manual_review'; addReason(ob, 'conflicting_intended_entities'); continue; }
    const candidates = distinctRoutes(routes.bySourceKey.get(entityKeys[0]) || []);
    if (candidates.length === 0) { ob.disposition = 'unresolved'; addReason(ob, 'final_route_missing'); continue; }
    if (candidates.length > 1) { ob.disposition = 'manual_review'; addReason(ob, 'ambiguous_final_route'); continue; }
    const route = candidates[0];
    // The old address's query is part of what it means. A final route that carries its own,
    // different query leaves the expected result undefined, so a person decides.
    if (ob.query && route.query && ob.query !== route.query) { ob.disposition = 'manual_review'; addReason(ob, 'query_semantics_conflict'); continue; }
    ob.expected = {
      sourceKey: route.sourceKey,
      targetEntityType: route.targetEntityType,
      targetEntityId: route.targetEntityId,
      relativeUrl: route.relativeUrl,
      conflictPath: route.conflictPath,
      query: route.query || ob.query || '',
      pageMarker: route.pageMarker,
    };
    const owners = distinctRoutes(routes.byConflictPath.get(ob.conflictPath) || []);
    if (owners.some((owner) => owner.targetEntityId !== route.targetEntityId || owner.targetEntityType !== route.targetEntityType)) {
      ob.disposition = 'manual_review';
      addReason(ob, 'ownership_conflict');
      continue;
    }
    for (const hold of routingHolds) {
      hold.resolution = 'resolved_by_exact_final_route';
      hold.evidence = { sourceStableKey: route.sourceKey, targetEntityType: route.targetEntityType,
        targetEntityId: route.targetEntityId, relativeUrl: route.relativeUrl, deploymentId };
    }
    if (owners.length || route.conflictPath === ob.conflictPath) {
      ob.disposition = 'direct';
      continue;
    }
    ob.disposition = 'redirect';
  }

  // Fold per-origin intent into remote rules: one site-level rule per path and API scope.
  const remote = new Map();
  for (const ob of obligations.values()) {
    if (!ob.conflictPath || ob.conflictPath === '/' || !origins.length) continue;
    if (!['redirect', 'direct'].includes(ob.disposition)) continue;
    const key = remoteRuleKey(siteId, ob.conflictPath);
    if (!remote.has(key)) remote.set(key, { ruleKey: key, fromConflict: ob.conflictPath, from: ob.path, intents: [], obligationKeys: [] });
    const entry = remote.get(key);
    entry.obligationKeys.push(ob.obligationKey);
    for (const originKeyValue of originKeys) {
      const serves = ob.targets.some((t) => t.origins.includes(originKeyValue));
      entry.intents.push({
        origin: originKeyValue,
        obligationKey: ob.obligationKey,
        need: !serves ? 'none' : ob.disposition === 'direct' ? 'no_redirect' : ob.expected.relativeUrl,
      });
    }
  }

  const remoteRules = [];
  for (const entry of remote.values()) {
    const perOrigin = new Map();
    for (const intent of entry.intents) {
      if (!perOrigin.has(intent.origin)) perOrigin.set(intent.origin, new Set());
      perOrigin.get(intent.origin).add(intent.need);
    }
    // An origin with no obligation at this path has no requirement; an origin whose only
    // requirement is "none" while another needs a redirect blocks the whole key.
    const needs = new Set();
    const conflicts = [];
    for (const [origin, set] of perOrigin) {
      const concrete = [...set].filter((need) => need !== 'none');
      // A 'none' beside a concrete need means a second obligation at this path serves the
      // origin; only an origin with no concrete need contributes 'none'.
      if (concrete.length === 0) needs.add('none');
      else if (concrete.length > 1) conflicts.push({ origin, reason: 'conflicting_targets' });
      else needs.add(concrete[0]);
    }
    const rule = {
      ruleKey: entry.ruleKey,
      from: entry.from,
      fromConflict: entry.fromConflict,
      to: null,
      origins: [...perOrigin.keys()].sort(),
      obligationKeys: [...new Set(entry.obligationKeys)].sort(),
      disposition: null,
      reasonCodes: [],
      perOriginConflicts: conflicts,
    };
    if (conflicts.length) {
      rule.disposition = 'manual_review';
      rule.reasonCodes.push('origin_intent_conflict');
    } else if (needs.size > 1) {
      rule.disposition = 'manual_review';
      rule.reasonCodes.push('origin_intent_conflict');
      for (const [origin, set] of perOrigin) rule.perOriginConflicts.push({ origin, reason: `needs:${[...set].join(',')}` });
    } else {
      const only = [...needs][0];
      if (only === 'no_redirect' || only === 'none') {
        rule.disposition = 'no_write';
        rule.reasonCodes.push('route_serves_original_address');
      } else {
        rule.to = only;
        rule.disposition = 'write_candidate';
      }
    }
    remoteRules.push(rule);
  }

  // Whole-candidate-set checks: a destination that is itself a planned source would be a chain.
  const candidateSources = new Set(remoteRules.filter((r) => r.disposition === 'write_candidate').map((r) => r.fromConflict));
  for (const rule of remoteRules) {
    if (rule.disposition !== 'write_candidate') continue;
    const to = parseAddress(rule.to);
    rule.toConflict = to.ok ? to.conflictPath : null;
    if (!to.ok || to.external) { rule.disposition = 'manual_review'; rule.reasonCodes.push('invalid_destination'); continue; }
    if (to.conflictPath === rule.fromConflict) { rule.disposition = 'manual_review'; rule.reasonCodes.push('self_loop'); continue; }
    if (candidateSources.has(to.conflictPath)) { rule.disposition = 'manual_review'; rule.reasonCodes.push('candidate_chain'); }
  }

  const preflight = targetInventory ? preflightAgainstInventory(remoteRules, targetInventory, siteId) : null;
  const effectiveRules = preflight ? preflight.rules : remoteRules;

  // Blocked remote rules block every obligation they serve.
  const byRemote = new Map(effectiveRules.map((rule) => [rule.ruleKey, rule]));
  for (const ob of obligations.values()) {
    if (!ob.conflictPath) continue;
    const key = remoteRuleKey(siteId, ob.conflictPath);
    const rule = byRemote.get(key);
    if (!rule) continue;
    ob.remoteRuleKey = key;
    if (rule.disposition === 'manual_review' && ['redirect', 'direct'].includes(ob.disposition)) {
      if (ob.disposition === 'redirect' || rule.reasonCodes.includes('origin_intent_conflict')) {
        ob.disposition = 'manual_review';
        for (const code of rule.reasonCodes) addReason(ob, code);
      }
    }
  }

  const obligationList = [...obligations.values()].sort((a, b) => a.obligationKey.localeCompare(b.obligationKey));
  // The plan identity covers its inputs, not the live inventory: inventory drift is caught by
  // the apply-time preflight, while a changed ledger, rule set, route manifest, deployment or
  // origin list is a different plan.
  const planDigest = digest({
    siteId,
    deploymentId,
    origins: originKeys,
    ledger: ledgerRows.map((row) => [row.sourceStableKey, row.sourceRelativeUrl, row.sourceEntityType || null, row.urlStatus]),
    sourceRules: sourceRules.map((rule) => [rule.ruleKey, rule.enabled, rule.matchType, rule.source, rule.destination, rule.statusCode, rule.conditions || null, rule.language || null]),
    importedRedirectOutcomes: importedRedirectOutcomes.map((row) => [row.sourceStableKey, row.originalTarget, row.disposition, row.evidenceDigest]),
    routes: ((finalRoutes && finalRoutes.routes) || []).map((r) => [r.sourceKey, r.targetEntityType, r.targetEntityId, r.relativeUrl, r.pageMarker]),
    importRedirects: importRedirects.map((row) => [row.sourceStableKey, row.sourceRelativeUrl, row.sourceEntityType || null, row.targetRelativeUrl, row.status]),
    invalidImportRedirects: invalidImportRedirects.map((row) => [row.line, row.sourceRelativeUrl, row.reason, row.recordedDestination || null, row.recordedStatus || null]),
    importUnresolved: importUnresolved.map((row) => [row.sourceStableKey, row.sourceRelativeUrl, row.sourceEntityType || null, row.urlStatus, row.status]),
    basePaths: basePaths.map((entry) => [entry.sourceEntityType, entry.sourceBasePath, entry.sourceUrlPattern, entry.public, entry.status, entry.reasonCodes || null]),
  });
  const coverageRows = (coverage && coverage.providers) || [];
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    planDigest,
    siteId,
    deploymentId,
    productionHostname: sourceDomains ? sourceDomains.productionHostname : null,
    origins: originKeys,
    websiteBuilt: Boolean(finalRoutes),
    coverage: coverageRows,
    coverageComplete: coverageRows.length > 0 && coverageRows.every((row) => row.status === 'extracted' || row.status === 'confirmed_empty'),
    obligations: obligationList.map((ob) => ({
      obligationKey: ob.obligationKey,
      originalUrl: ob.originalUrl,
      path: ob.path,
      query: ob.query,
      fragment: ob.fragment,
      origins: ob.origins.length ? ob.origins : originKeys,
      disposition: ob.disposition,
      reasonCodes: ob.reasonCodes,
      expected: ob.expected,
      externalTarget: ob.externalTarget || null,
      externalOriginalTarget: ob.externalOriginalTarget || null,
      externalDisposition: ob.externalDisposition || null,
      externalEvidenceDigest: ob.externalEvidenceDigest || null,
      externalSetup: ob.externalSetup || null,
      remoteRuleKey: ob.remoteRuleKey,
      provenance: ob.provenance,
    })),
    // Pre-inventory candidates: apply always re-runs the preflight against a fresh inventory.
    remoteRules,
    preflight,
    sourceRuleFindings: ruleFindings,
  };
}

// Compare candidate rules against the site's existing redirects. Exact semantic match is
// `already_present`; anything that could replace, delete or overlap an existing rule is
// `manual_review` with zero writes.
function preflightAgainstInventory(remoteRules, inventory, siteId) {
  const existing = (inventory || []).map(normalizeInventoryRule);
  const rules = remoteRules.map((rule) => ({ ...rule, reasonCodes: [...rule.reasonCodes] }));
  for (const rule of rules) {
    if (rule.disposition !== 'write_candidate') continue;
    const toConflict = rule.toConflict || parseAddress(rule.to).conflictPath;
    const block = (code) => { rule.disposition = 'manual_review'; if (!rule.reasonCodes.includes(code)) rule.reasonCodes.push(code); };
    for (const ex of existing) {
      if (!ex.fromConflict) continue;
      const exKey = remoteRuleKey(siteId, ex.fromConflict, ex.scope);
      if (exKey === rule.ruleKey) {
        if (!ex.toExternal && ex.toConflict === toConflict && !ex.toQuery) {
          rule.disposition = 'already_present';
          rule.remoteId = ex.id;
        } else block('existing_rule_conflict');
        continue;
      }
      if (ex.fromConflict === rule.fromConflict && ex.scope.language !== '*') block('language_overlap');
      if (ex.fromConflict === rule.fromConflict && ex.scope.groupRedirect) block('group_overlap');
      if (ex.scope.groupRedirect && ex.fromConflict !== rule.fromConflict && (isPathPrefix(ex.fromConflict, rule.fromConflict) || isPathPrefix(rule.fromConflict, ex.fromConflict))) block('group_overlap');
      if (ex.fromConflict === toConflict) block('destination_is_existing_source');
      if (ex.scope.groupRedirect && isPathPrefix(ex.fromConflict, toConflict)) block('destination_under_group_rule');
      if (ex.toConflict && ex.toConflict === rule.fromConflict) block('creates_chain_with_existing_rule');
    }
  }
  return { rules, inventoryDigest: inventoryDigest(inventory) };
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  MAX_SOURCE_CHAIN_HOPS,
  parseAddress,
  conflictPath,
  remoteRuleKey,
  apiScopeOf,
  inventoryDigest,
  normalizeInventoryRule,
  planRedirects,
  preflightAgainstInventory,
  digest,
};
