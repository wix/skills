'use strict';

// Imported redirect preparation. External destinations remain in source capture and the
// audit, never in targetRelativeUrl. Cutover owns application and public verification.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  urlPreservationDir, loadRedirects, appendRedirectRow, validateRedirectRow,
} = require('./url-preservation-state');

const AUDIT_FILE = 'url-rewrite-occurrences.ndjson';
const REPORT_FILE = 'url-rewrite-report.json';
const DEFAULT_PORT = { http: 80, https: 443 };

function domainIdentity(value) {
  const protocol = value.protocol.slice(0, -1);
  return `${protocol}\t${value.hostname}\t${value.port || DEFAULT_PORT[protocol]}`;
}

function validateDomains(document) {
  // The cutover helper already owns source-domains.json. Accept its explicit origin
  // declarations as website membership without interpreting observed source hosts as
  // aliases or deriving aliases from suffixes.
  if (document?.schemaVersion === 1 && Array.isArray(document.origins)) {
    const { validateSourceDomains } = require('./url-preservation-state');
    const validated = validateSourceDomains(document);
    document = { schemaVersion: 1, domains: validated.origins.map((origin) => ({
      hostname: origin.hostname, schemes: [origin.scheme],
      ...(origin.effectivePort !== DEFAULT_PORT[origin.scheme] ? { port: origin.effectivePort } : {}),
      cutover: true, declaredBy: 'source-domains', evidence: origin.role,
    })).concat(validated.domains || []) };
  }
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.domains)) {
    throw new Error('source-domains.json requires schemaVersion 1 and domains array');
  }
  const identities = new Map();
  document.domains.forEach((entry, index) => {
    if (!entry || typeof entry.hostname !== 'string' || !entry.hostname ||
      !Array.isArray(entry.schemes) || !entry.schemes.length ||
      typeof entry.cutover !== 'boolean' || !entry.declaredBy || !entry.evidence) {
      throw new Error(`source-domains.json entry ${index} is incomplete`);
    }
    if (new URL(`https://${entry.hostname}/`).hostname !== entry.hostname ||
      entry.hostname.includes(':') || entry.hostname.includes('/') || entry.hostname.endsWith('.')) {
      throw new Error(`source-domains.json entry ${index} has noncanonical hostname`);
    }
    if (entry.port !== undefined && (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535)) {
      throw new Error(`source-domains.json entry ${index} has invalid port`);
    }
    const schemes = new Set();
    for (const scheme of entry.schemes) {
      if (!DEFAULT_PORT[scheme] || schemes.has(scheme) || entry.port === DEFAULT_PORT[scheme]) {
        throw new Error(`source-domains.json entry ${index} has invalid scheme or default port`);
      }
      schemes.add(scheme);
      const key = `${scheme}\t${entry.hostname}\t${entry.port || DEFAULT_PORT[scheme]}`;
      if (identities.has(key)) {
        throw new Error(`source-domains.json entries ${identities.get(key).index} and ${index} duplicate identity`);
      }
      identities.set(key, { ...entry, index });
    }
  });
  return identities;
}

function parseHttpUrl(raw, context) {
  if (typeof raw !== 'string' || !raw || /%(?![0-9a-fA-F]{2})/.test(raw)) {
    throw new Error('malformed_url');
  }
  if (!/^(?:https?:\/\/|\/\/|\/)/i.test(raw) && !context) {
    throw new Error('missing_source_context');
  }
  let url;
  try {
    url = new URL(raw, context);
  } catch {
    throw new Error('malformed_url');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('unsupported_or_credentialed_url');
  }
  return url;
}

function classifyTarget(rule, domains) {
  const source = parseHttpUrl(rule.from, rule.sourceContext);
  const target = parseHttpUrl(rule.to, source.href);
  const declared = domains.get(domainIdentity(target));
  const siteIdentity = rule.websiteIdentity;
  const aliases = Array.isArray(rule.websiteAliases) ? rule.websiteAliases : [];
  const website = new Set([siteIdentity, ...aliases].filter(Boolean));
  for (const identity of website) {
    if (domains.get(identity)?.cutover !== true) {
      throw new Error('website_identity_not_declared_cutover');
    }
  }
  const targetIdentity = domainIdentity(target);
  const sourceOrigins = new Set((rule.capturedSourceOrigins || []).map((value) => domainIdentity(parseHttpUrl(value))));
  let kind;
  if (rule.to.startsWith('/') && !rule.to.startsWith('//')) {
    kind = 'internal';
  } else if (website.has(targetIdentity) && declared?.cutover === true) {
    kind = 'internal';
  } else if (website.has(targetIdentity) || sourceOrigins.has(targetIdentity) && !declared) {
    kind = 'target_ownership_unresolved';
  } else {
    kind = 'external';
  }
  return { source, target, kind };
}

function redact(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const protocolRelative = raw.startsWith('//');
    const relative = raw.startsWith('/') && !protocolRelative;
    const value = new URL(protocolRelative ? `https:${raw}` : raw,
      relative ? 'https://redaction.invalid/' : undefined);
    if (!['http:', 'https:'].includes(value.protocol)) return '[unsupported URL — see local audit]';
    value.username = '';
    value.password = '';
    if (value.search) value.search = '?[redacted]';
    if (relative) return `${value.pathname}${value.search}${value.hash}`;
    if (protocolRelative) return `//${value.host}${value.pathname}${value.search}${value.hash}`;
    return value.href;
  } catch {
    return '[invalid URL — see local audit]';
  }
}

function actionFor(row) {
  if ((row.disposition === 'excluded_inactive_rule' && !row.requiresReconciliation) ||
    (row.disposition === 'removed_input' && !row.requiresReconciliation)) return null;
  const setup = row.disposition === 'external_redirect_automation_unavailable';
  const unsupported = row.disposition === 'external_redirect_unsupported_on_wix';
  const pending = row.disposition === 'external_pending_execution' || row.disposition === 'same_site_plan' ||
    row.disposition === 'preserved_cutover_target';
  return {
    code: pending ? 'cutover_links_pending_verification' : 'source_origin_links_need_action',
    severity: unsupported ? 'critical' : 'high',
    action: unsupported ? 'No Wix resolution is known for this exact redirect rule; retain the gap.' :
      setup ? 'Cutover Operator: set up this rule in Redirect Manager using the original destination; then verify the source status and Location.' :
        pending ? 'Requires Import Operator: reconcile with the redirect helper and verify the source redirect status and Location before cutover.' :
          'Requires Import Operator: resolve this rule from immutable capture and capability evidence before execution.',
    deadlineReason: 'Old addresses may fail or send visitors to the wrong destination after DNS cutover.',
    prerequisites: setup ? 'Original source path, status, scope and exact target from the Import Operator.' :
      'Immutable source capture, declared website origins and current redirect inventory.',
    timing: 'Before DNS preparation; verify again against the public source address after the authorized DNS move.',
    evidence: 'state/url-preservation/url-rewrite-occurrences.ndjson and state/url-preservation/url-verification.ndjson',
    entity: row.sourceStableKey,
    affectedCount: 1,
  };
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function planRule(rule, domains, existingBySource) {
  if (!rule || rule.kind !== 'imported_redirect' || !rule.sourceSystem ||
    !rule.captureRevision) {
    throw new Error('redirect record lacks ownership or immutable capture');
  }
  const key = rule.sourceRuleId ? `${rule.sourceSystem}:redirect:${rule.sourceRuleId}` :
    `${rule.sourceSystem}:redirect:unidentified:${digest({ sourceImmutableId: rule.sourceImmutableId || null,
      from: rule.from, to: rule.to, captureRevision: rule.captureRevision })}`;
  const base = {
    schemaVersion: 1, sourceStableKey: key, field: 'to', captureRevision: rule.captureRevision,
    originalSource: typeof rule.from === 'string' ? rule.from : '',
    originalTarget: typeof rule.to === 'string' ? rule.to : '', httpStatus: rule.httpStatus,
    matchType: rule.matchType, scope: rule.scope, enabled: rule.enabled !== false,
  };
  const outcome = (disposition, reason, extras = {}) => ({ ...base, disposition, reason, ...extras });
  if (!rule.sourceRuleId) return outcome('manual_review', 'stable_source_rule_identity_missing');
  if (rule.enabled === false) return outcome('excluded_inactive_rule', 'source_rule_disabled');
  if (typeof rule.from !== 'string' || !rule.from || typeof rule.to !== 'string' || !rule.to) {
    return outcome('manual_review', 'source_or_target_missing_or_nonscalar');
  }
  if (rule.httpStatus !== 301 || rule.matchType !== 'exact' || rule.scope !== 'path') {
    return outcome('manual_review', 'unsupported_rule_semantics');
  }
  let parsed;
  try { parsed = classifyTarget(rule, domains); } catch (error) {
    return outcome('unresolved', error.message);
  }
  const { source, target, kind } = parsed;
  if (kind === 'target_ownership_unresolved') return outcome('unresolved', kind);
  if (source.origin !== new URL(rule.sourceContext || source.href).origin || source.search || source.hash) {
    return outcome('manual_review', 'unsupported_source_address');
  }
  const previous = existingBySource.get(source.pathname);
  if (previous && (previous.conflictingPlans || previous.sourceStableKey !== key ||
    kind === 'external' || !rule.to.startsWith('/') || rule.to.startsWith('//') ||
    previous.targetRelativeUrl !== target.pathname + target.search + target.hash)) {
    return outcome('manual_review', 'stale_or_conflicting_plan',
      { stalePlan: previous, destinationKind: kind, resolvedTarget: target.href });
  }
  if (kind === 'external') {
    const capability = rule.capability || {};
    if (capability.productSupported === false && capability.evidence) {
      return outcome('external_redirect_unsupported_on_wix', 'proven_platform_limitation',
        { destinationKind: kind, resolvedTarget: target.href, capability });
    }
    if (capability.productSupported === true && capability.automationSupported === false && capability.evidence) {
      return outcome('external_redirect_automation_unavailable', 'manual_redirect_manager_setup',
        { destinationKind: kind, resolvedTarget: target.href, capability });
    }
    if (capability.productSupported === true && capability.automationSupported === true && capability.evidence) {
      return outcome('external_pending_execution', 'awaiting_compatible_redirect_consumer',
        { destinationKind: kind, resolvedTarget: target.href, capability });
    }
    return outcome('external_redirect_capability_unverified', 'capability_evidence_missing',
      { destinationKind: kind, resolvedTarget: target.href, capability });
  }
  if (!rule.to.startsWith('/') || rule.to.startsWith('//')) {
    return outcome('preserved_cutover_target', 'absolute_internal_target_requires_execution_equivalence');
  }
  if (source.pathname === target.pathname + target.search + target.hash) {
    return outcome('manual_review', 'self_loop');
  }
  const plan = {
    schemaVersion: 1, sourceStableKey: key, sourceRelativeUrl: source.pathname,
    targetRelativeUrl: target.pathname + target.search + target.hash, httpStatus: 301, status: 'planned',
  };
  validateRedirectRow(plan);
  return outcome('same_site_plan', 'equivalent_relative_target', { plan });
}

function adaptSourceRedirects(sourceRules, { captureRevision, sourceDomains, capability = {} }) {
  if (!captureRevision || !sourceDomains?.origins?.length) throw new Error('source capture revision and declared origins are required');
  const origins = sourceDomains.origins;
  const primary = origins.find((origin) => origin.role === 'production');
  if (!primary) throw new Error('production source origin is required');
  const originUrl = (origin) => `${origin.scheme}://${origin.hostname}${origin.effectivePort === DEFAULT_PORT[origin.scheme] ? '' : `:${origin.effectivePort}`}/`;
  const identity = (origin) => `${origin.scheme}\t${origin.hostname}\t${origin.effectivePort}`;
  const declared = new Set(origins.map(identity));
  return sourceRules.map((rule) => {
    let sourceContext = originUrl(primary);
    try {
      const source = new URL(rule.source);
      if (declared.has(domainIdentity(source))) sourceContext = source.origin + '/';
    } catch { /* relative source uses the declared production context */ }
    return ({
    kind: 'imported_redirect', sourceSystem: rule.provider,
    sourceRuleId: rule.storage?.kind === 'export' ? null : (rule.sourceRuleId || rule.stableId),
    captureRevision,
    from: rule.source, to: rule.destination,
    enabled: rule.enabled,
    httpStatus: rule.statusCode, matchType: rule.matchType,
    scope: rule.enabled && !(rule.conditions || []).length && !rule.language ? 'path' : 'unsupported',
    sourceContext, websiteIdentity: identity(primary),
    websiteAliases: origins.filter((origin) => origin.role !== 'production').map(identity),
    capturedSourceOrigins: rule.capturedSourceOrigins || [],
    capability: capability[rule.ruleKey] || rule.capability ||
      (/^https?:\/\/[^?#]+$/i.test(rule.destination || '')
        ? { productSupported: true, automationSupported: false,
          evidence: 'Redirect Manager documents external 301 UI setup; the current API writer accepts only same-site relative targets' }
        : {}),
    });
  });
}

async function readAudit(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (raw && !raw.endsWith('\n')) throw new Error('audit torn tail; locked recovery required');
  return raw.split('\n').filter(Boolean).map((line, index) => {
    try {
      const row = JSON.parse(line);
      validateAuditRow(row);
      return row;
    } catch { throw new Error(`audit malformed complete row ${index + 1}`); }
  });
}

function validateAuditRow(row) {
  if (!row || typeof row !== 'object' || row.schemaVersion !== 1) throw new Error('invalid audit schema');
  if (row.type === 'rule') {
    if (!row.sourceStableKey || !row.disposition || typeof row.originalTarget !== 'string' ||
      !row.evidenceDigest) throw new Error('invalid audit rule');
  } else if (row.type === 'capture_complete') {
    if (!row.runId || !row.captureRevision || !Number.isInteger(row.count)) throw new Error('invalid capture marker');
  } else if (row.type === 'plan_retired') {
    if (!row.sourceStableKey || !row.sourceRelativeUrl || !row.targetRelativeUrl || !row.evidence) {
      throw new Error('invalid plan retirement');
    }
  } else throw new Error('unknown audit row type');
}

async function currentAuditRows(projectDir) {
  const history = await readAudit(path.join(urlPreservationDir(projectDir), AUDIT_FILE));
  const end = history.findLastIndex((row) => row.type === 'capture_complete');
  if (end < 0) return [];
  const current = new Map();
  const redirects = await loadRedirects(projectDir);
  for (const row of completedCaptureRows(history, end)) {
    current.set(row.sourceStableKey, row.disposition === 'removed_input' ? {
      ...row, requiresReconciliation: Object.values(redirects.byKey).some((plan) =>
        plan.sourceStableKey === row.sourceStableKey && plan.status === 'planned'),
    } : row);
  }
  return [...current.values()];
}

function completedCaptureRows(history, markerIndex) {
  if (markerIndex < 0) return [];
  const marker = history[markerIndex];
  const start = history.slice(0, markerIndex).findLastIndex((row) => row.type === 'capture_complete');
  const matching = history.slice(start + 1, markerIndex).filter((row) =>
    row.type === 'rule' && row.runId === marker.runId && row.captureRevision === marker.captureRevision);
  const rows = marker.count ? matching.slice(-marker.count) : [];
  if (rows.length !== marker.count) throw new Error('completed capture marker count does not match its rule rows');
  return rows;
}

async function acquireAuditLock(file) {
  const lockFile = `${file}.lock`;
  // This audit lock deliberately requires operator inspection before removal: a dead
  // writer may have left a torn tail that needs recovery after the stale lock is cleared.
  let handle;
  try { handle = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`audit lock exists at ${lockFile}; confirm no writer is running, remove the stale lock, then recover a torn audit tail before retrying planning`);
    throw error;
  }
  return async () => { await handle.close(); await fs.unlink(lockFile); };
}

async function updateVerificationOutcomes(projectDir, plan, verificationRows) {
  const file = path.join(projectDir, 'execution', REPORT_FILE);
  let report;
  try { report = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  report.siteId = plan.siteId || report.siteId || null;
  const byRule = new Map();
  const auditByKey = new Map((await currentAuditRows(projectDir))
    .map((row) => [row.sourceStableKey, row]));
  for (const ob of plan.obligations || []) for (const source of ob.provenance || []) {
    if (source.kind === 'source_rule') byRule.set(`${source.provider}:redirect:${source.sourceRuleId || source.stableId}`, ob);
  }
  const { executionDigestFor } = require('./url-verification');
  const verificationByObligation = new Map();
  for (const entry of verificationRows || []) {
    if (entry.stage !== 'verified_public' || entry.planDigest !== plan.planDigest ||
      entry.deploymentId !== plan.deploymentId) continue;
    if (!verificationByObligation.has(entry.obligationKey)) verificationByObligation.set(entry.obligationKey, []);
    verificationByObligation.get(entry.obligationKey).push(entry);
  }
  for (const row of report.rules || []) {
    row.siteId = plan.siteId || row.siteId || null;
    const ob = byRule.get(row.sourceStableKey);
    if (!ob || !ob.externalTarget) continue;
    const capture = auditByKey.get(row.sourceStableKey);
    if (!capture || capture.originalTarget !== ob.externalOriginalTarget ||
      capture.disposition !== ob.externalDisposition) {
      row.setupEvidence = null;
      row.verificationOutcome = 'pending';
      row.verificationEvidence = null;
      continue;
    }
    row.setupEvidence = ob.externalSetup ? { remoteId: ob.externalSetup.remoteId,
      evidence: 'matching current Redirect Manager inventory at planning time' } : null;
    if (row.setupEvidence) {
      row.owner = 'Import Operator';
      row.nextAction = 'Requires Import Operator: run bounded source-status/Location verification after the authorized DNS move.';
    }
    const digestValue = executionDigestFor(ob, {});
    const current = (verificationByObligation.get(ob.obligationKey) || []).filter((entry) =>
      entry.executionDigest === digestValue);
    const byOrigin = new Map(current.map((entry) => [entry.origin, entry]));
    const checked = (ob.origins || []).map((origin) => byOrigin.get(origin));
    row.verificationOutcome = checked.length && checked.every((entry) => entry?.result === 'verified_redirect')
      ? 'verified_public' : checked.some((entry) => entry?.result === 'failed') ? 'failed' : 'pending';
    row.verificationEvidence = row.verificationOutcome === 'pending' ? null :
      'state/url-preservation/url-verification.ndjson';
    if (row.verificationOutcome === 'verified_public') row.nextAction = 'No action; source redirect verified publicly.';
  }
  const reportByKey = new Map(report.rules.map((row) => [row.sourceStableKey, row]));
  report.operatorActions = (report.operatorActions || []).filter((action) =>
    reportByKey.get(action.entity)?.verificationOutcome !== 'verified_public');
  for (const action of report.operatorActions) {
    const row = reportByKey.get(action.entity);
    if (row?.setupEvidence) action.action = row.nextAction;
  }
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
  await fs.rename(temp, file);
  const markdown = ['# Imported redirect target planning', '',
    `Run: ${report.runId}; capture revision: ${report.captureRevision}; complete: ${report.captureComplete}.`, '',
    '| Rule | Original source | Original target | Outcome | Verification |',
    '| --- | --- | --- | --- | --- |',
    ...(report.rules || []).map((row) => {
      const safe = (value) => String(value || '').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
      return `| ${safe(row.sourceStableKey)} | ${safe(row.source)} | ${safe(row.target)} | ${safe(row.disposition)} | ${safe(row.verificationOutcome || 'pending')} |`;
    }), ''].join('\n');
  const mdFile = path.join(projectDir, 'execution', 'url-rewrite-report.md');
  await fs.writeFile(`${mdFile}.tmp`, markdown);
  await fs.rename(`${mdFile}.tmp`, mdFile);
  return report;
}

async function recoverTornAudit(projectDir) {
  const file = path.join(urlPreservationDir(projectDir), AUDIT_FILE);
  const release = await acquireAuditLock(file);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const end = raw.lastIndexOf('\n');
    const complete = end < 0 ? '' : raw.slice(0, end + 1);
    complete.split('\n').filter(Boolean).forEach((line) => validateAuditRow(JSON.parse(line)));
    const handle = await fs.open(file, 'r+');
    try { await handle.truncate(Buffer.byteLength(complete)); await handle.sync(); } finally { await handle.close(); }
  } finally { await release(); }
}

async function retireImportedPlan({ projectDir, sourceStableKey, sourceRelativeUrl,
  targetRelativeUrl, evidence, targetInventory }) {
  if (!sourceStableKey || !sourceRelativeUrl || !targetRelativeUrl || !evidence || !Array.isArray(targetInventory)) {
    throw new Error('retirement needs exact plan identity, evidence and a current destination inventory');
  }
  const auditFile = path.join(urlPreservationDir(projectDir), AUDIT_FILE);
  const release = await acquireAuditLock(auditFile);
  try {
    const current = await currentAuditRows(projectDir);
    const capture = current.find((row) => row.sourceStableKey === sourceStableKey);
    if (!capture || !(['removed_input', 'excluded_inactive_rule'].includes(capture.disposition) ||
      capture.destinationKind === 'external' || capture.reason === 'stale_or_conflicting_plan')) {
      throw new Error('current complete capture does not prove an external, removed, disabled or changed source rule');
    }
    const redirects = await loadRedirects(projectDir);
    const key = `${sourceRelativeUrl}\t${targetRelativeUrl}\t301`;
    const row = redirects.byKey[key];
    if (!row || row.status === 'retired' || row.sourceStableKey !== sourceStableKey) {
      throw new Error('exact active imported plan was not found');
    }
    const { parseAddress, conflictPath } = require('./url-redirect-plan');
    const source = parseAddress(sourceRelativeUrl);
    if (!source.ok || source.external || targetInventory.some((remote) => {
      const parsed = parseAddress(remote.from);
      return parsed.ok && !parsed.external && parsed.conflictPath === conflictPath(source.path);
    })) throw new Error('destination inventory still has an overlapping source rule');
    const retiredAt = new Date().toISOString();
    const handle = await fs.open(auditFile, 'a');
    try {
      await handle.write(`${JSON.stringify({ type: 'plan_retired', schemaVersion: 1,
        sourceStableKey, sourceRelativeUrl, targetRelativeUrl, evidence, retiredAt })}\n`);
      await handle.sync();
    } finally { await handle.close(); }
    await appendRedirectRow(projectDir, { ...row, status: 'retired', retirementEvidence: evidence, retiredAt });
    return { sourceStableKey, sourceRelativeUrl, targetRelativeUrl, retiredAt };
  } finally { await release(); }
}

async function planImportedRedirectTargets(input) {
  const { projectDir, runId, captureRevision, rules, fullCapture = false } = input;
  if (!projectDir || !runId || !captureRevision || !Array.isArray(rules)) {
    throw new Error('projectDir, runId, captureRevision and rules are required');
  }
  const dir = urlPreservationDir(projectDir);
  await fs.mkdir(dir, { recursive: true });
  const domains = validateDomains(JSON.parse(await fs.readFile(path.join(dir, 'source-domains.json'), 'utf8')));
  const { loadStateJson } = require('./url-preservation-state');
  const launchPlan = await loadStateJson(projectDir, 'launchPlan');
  const finalRoutes = await loadStateJson(projectDir, 'finalRoutes');
  const siteId = launchPlan?.siteId || finalRoutes?.siteId || null;
  const auditFile = path.join(dir, AUDIT_FILE);
  const release = await acquireAuditLock(auditFile);
  try {
    const history = await readAudit(auditFile);
    const redirects = await loadRedirects(projectDir);
    const existingBySource = new Map();
    for (const row of Object.values(redirects.byKey)) {
      if (row.status !== 'planned') continue;
      const prior = existingBySource.get(row.sourceRelativeUrl);
      existingBySource.set(row.sourceRelativeUrl, prior ? { ...prior, conflictingPlans: true } : row);
    }
    const ids = new Set();
    const outcomes = rules.map((rule) => {
      if (rule.captureRevision !== captureRevision) {
        throw new Error('redirect record capture revision does not match invocation');
      }
      const result = planRule(rule, domains, existingBySource);
      if (result.disposition === 'excluded_inactive_rule') {
        result.requiresReconciliation = Object.values(redirects.byKey).some((plan) =>
          plan.sourceStableKey === result.sourceStableKey && plan.status === 'planned');
      }
      if (ids.has(result.sourceStableKey)) throw new Error(`duplicate source rule ${result.sourceStableKey}`);
      ids.add(result.sourceStableKey);
      return result;
    });
    const completedIndex = history.findLastIndex((row) => row.type === 'capture_complete');
    const completed = history[completedIndex];
    if (fullCapture && completed) {
      const previous = new Map();
      for (const row of completedCaptureRows(history, completedIndex)) previous.set(row.sourceStableKey, row);
      const retiredSinceCapture = new Set(history.slice(completedIndex + 1)
        .filter((row) => row.type === 'plan_retired').map((row) => row.sourceStableKey));
      for (const [key, row] of previous) {
        const activePlan = Object.values(redirects.byKey).some((plan) =>
          plan.sourceStableKey === key && plan.status === 'planned');
        if (!ids.has(key) && (row.disposition !== 'removed_input' ||
          activePlan || !retiredSinceCapture.has(key))) {
          const { type, runId: priorRunId, evidenceDigest, updatedAt, ...base } = row;
          outcomes.push({ ...base, captureRevision, disposition: 'removed_input',
            reason: 'missing_from_complete_capture', requiresReconciliation: activePlan });
        }
      }
    }
    if (fullCapture && completed?.captureRevision === captureRevision) {
      const byKey = new Map(completedCaptureRows(history, completedIndex)
        .map((row) => [row.sourceStableKey, row]));
      if (byKey.size === outcomes.length && outcomes.every((row) =>
        byKey.get(row.sourceStableKey)?.evidenceDigest === digest(row))) {
        try {
          const existingReport = JSON.parse(await fs.readFile(path.join(projectDir, 'execution', REPORT_FILE), 'utf8'));
          if (existingReport.siteId === siteId) return existingReport;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    const now = new Date().toISOString();
    const rows = outcomes.map((row) => ({ ...row, type: 'rule', runId, evidenceDigest: digest(row), updatedAt: now }));
    const handle = await fs.open(auditFile, 'a');
    try {
      for (const row of rows) await handle.write(`${JSON.stringify(row)}\n`);
      await handle.sync();
      for (const row of rows) {
        if (fullCapture && row.disposition === 'same_site_plan' && redirects.byKey[
          `${row.plan.sourceRelativeUrl}\t${row.plan.targetRelativeUrl}\t301`]?.status !== 'planned') {
          await appendRedirectRow(projectDir, row.plan);
        }
      }
      if (fullCapture) {
        await handle.write(`${JSON.stringify({ type: 'capture_complete', schemaVersion: 1, runId, captureRevision,
          count: rows.length, updatedAt: now })}\n`);
        await handle.sync();
      }
    } finally { await handle.close(); }
    const reportRows = fullCapture ? rows : (() => {
      const latest = new Map();
      if (completed) {
        for (const row of completedCaptureRows(history, completedIndex)) latest.set(row.sourceStableKey, row);
      }
      for (const row of rows) latest.set(row.sourceStableKey, { ...row, provisional: true });
      return [...latest.values()];
    })();
    const report = {
      schemaVersion: 1, runId, siteId, captureRevision, captureComplete: fullCapture,
      sourceArtifact: 'state/url-preservation/url-rewrite-occurrences.ndjson',
      rules: reportRows.map((row) => {
        const action = actionFor(row);
        return {
          project: path.basename(projectDir), runId, siteId,
          sourceStableKey: row.sourceStableKey, source: redact(row.originalSource),
          target: redact(row.originalTarget), disposition: row.disposition, reason: row.reason,
          provisional: Boolean(row.provisional),
          capabilityState: row.disposition.startsWith('external_') ? row.disposition : null,
          customerImpact: action?.deadlineReason || null,
          owner: ['external_redirect_automation_unavailable', 'external_redirect_unsupported_on_wix']
            .includes(row.disposition) ? 'Cutover Operator' : action ? 'Import Operator' : null,
          nextAction: action?.action || 'No action; no active plan requires reconciliation.',
          prerequisites: action?.prerequisites || null, timing: action?.timing || null,
          requiresImportOperator: Boolean(action),
          importOperatorPrompt: action ? `Requires Import Operator: resume ${path.basename(projectDir)} run ${runId}, site ${siteId || 'from the current launch plan'}. Read execution/url-rewrite-report.json and the local url-rewrite-occurrences.ndjson row for ${row.sourceStableKey}; reconstruct the exact source, target, status and scope from immutable capture. Resolve ${row.reason} without substituting a local destination. If supported UI setup is needed, hand the exact values and capability evidence to the Cutover Operator before DNS preparation. Refresh the URL report and retain source-status/Location verification evidence after the authorized DNS move.` : null,
          closingEvidence: action?.evidence || null, evidenceDigest: row.evidenceDigest,
        };
      }),
      operatorActions: [
        ...reportRows.map(actionFor).filter(Boolean),
        ...(!fullCapture ? [{ code: 'source_origin_links_need_action', severity: 'high',
          action: 'Requires Import Operator: complete the authoritative redirect capture before using this run for cutover.',
          deadlineReason: 'This capture was partial; missing rules cannot be interpreted as removals.',
          entity: 'imported redirects', affectedCount: 0 }] : []),
      ],
    };
    const reportFile = path.join(projectDir, 'execution', REPORT_FILE);
    await fs.mkdir(path.dirname(reportFile), { recursive: true });
    const temp = `${reportFile}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await fs.rename(temp, reportFile);
    const markdown = [
      '# Imported redirect target planning', '',
      `Run: ${runId}; capture revision: ${captureRevision}; complete: ${fullCapture}.`, '',
      '| Rule | Original source | Original target | Outcome | Next action |',
      '| --- | --- | --- | --- | --- |',
      ...report.rules.map((row) => {
        const safe = (value) => String(value || '').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
        const action = report.operatorActions.find((item) => item.entity === row.sourceStableKey);
        return `| ${safe(row.sourceStableKey)} | ${safe(row.source)} | ${safe(row.target)} | ${safe(row.disposition)} | ${safe(action?.action)} |`;
      }), '',
    ].join('\n');
    await fs.writeFile(`${reportFile}.md.tmp`, markdown);
    await fs.rename(`${reportFile}.md.tmp`, path.join(projectDir, 'execution', 'url-rewrite-report.md'));
    const redirectPlan = await loadStateJson(projectDir, 'redirectPlan');
    if (redirectPlan) {
      const { loadUrlVerification } = require('./url-preservation-state');
      return await updateVerificationOutcomes(projectDir, redirectPlan,
        (await loadUrlVerification(projectDir)).rows);
    }
    return report;
  } finally { await release(); }
}

module.exports = { validateDomains, classifyTarget, planRule, adaptSourceRedirects,
  planImportedRedirectTargets, recoverTornAudit, retireImportedPlan,
  readAudit, currentAuditRows, updateVerificationOutcomes };
