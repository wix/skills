'use strict';

// Operator-facing URL-preservation projection, derived only from durable rows: the plan,
// redirect-execution.ndjson and url-verification.ndjson. Nothing is recounted by hand, an
// acknowledgment never upgrades a status, and only a public-stage check can verify a link.

const fs = require('node:fs/promises');
const path = require('node:path');
const { executionDigestFor } = require('./url-verification.js');

const REPORT_JSON = 'execution/url-preservation-report.json';
const REPORT_MD = 'execution/url-preservation-report.md';
const DISPOSITIONS = ['verified_direct', 'verified_redirect', 'not_verified', 'unresolved', 'manual_review', 'failed'];
const TOKEN_LINK = /(reset|lost-?password|key=|token|order-received|view-order|download|checkout|my-account|wp-login|nonce)/i;

const NEXT_ACTION = {
  destination_not_found: 'Find the page this old address should reach, or record an explicit decision that it has none.',
  final_route_missing: 'The website build has no final page for this entity; build or map it, then re-run plan.',
  ambiguous_final_route: 'Several final pages claim this entity; choose one in the route manifest.',
  ownership_conflict: 'Another page already owns this address; decide which page should keep it. Nothing was redirected.',
  origin_intent_conflict: 'Declared origins need different behaviour at this path; resolve the host-specific rule by hand.',
  existing_rule_conflict: 'An existing redirect on the site points this path elsewhere; review it by hand. It was not replaced.',
  destination_is_existing_source: 'Creating this rule could delete an existing redirect; resolve the chain by hand.',
  group_overlap: 'A group redirect overlaps this path; confirm the scopes by hand.',
  language_overlap: 'A language-scoped redirect overlaps this path; confirm the scopes by hand.',
  creates_chain_with_existing_rule: 'An existing redirect already points to this path; resolve the chain by hand.',
  unsupported_match_type: 'Pattern redirect: convert it to exact rules or configure it manually.',
  non_permanent_status: 'The source rule is not a permanent redirect; decide whether to recreate it manually.',
  status_308_not_writable: 'The source rule is a 308 redirect; only exact 301 rules are written automatically. Recreate it manually if 301 behaviour is acceptable.',
  import_manual_review: 'The import recorded this address for manual review; resolve that decision before any redirect is written.',
  import_redirect_source_rule_shape: 'This import row is a source-authored rule without a stable entity key. Confirm its destination and enabled state in the source-rule inventory before creating a redirect.',
  import_redirect_invalid_row: 'This import redirect row lacks required fields. Correct or classify the row, then re-run plan; no redirect was written for it.',
  base_path_manual_review: 'Resolve the listed non-routing restriction; exact destination evidence alone does not clear it.',
  base_path_hold_reason_missing: 'Explain the original base-path hold in base-paths.json reasonCodes; an unexplained flag is not proof of an active restriction or of resolution. Routing-only uncertainty can be settled by an exact entity/final-route match.',
  base_path_entity_type_unknown: 'Resolve the source entity type from its stable ledger identity before evaluating this base-path restriction; do not infer type from a path prefix.',
  base_path_not_public: 'The import recorded this base path as not public; confirm whether the old address should be preserved.',
  base_path_unparseable: 'A recorded base path cannot be parsed; correct base-paths.json, then re-run plan.',
  query_semantics_conflict: 'The old address and its final page carry different query strings; decide which query the redirect must keep.',
  final_query_mismatch: 'The old address reached the right page but with a different query string; fix the redirect so the query is kept.',
  conditional_rule: 'The source rule has conditions the migration cannot reproduce; configure it manually.',
  query_conditional_rule: 'The source rule matches on a query string; configure it manually.',
  language_scoped_rule: 'Language-scoped source rule; configure it manually.',
  external_destination: 'The source rule sends visitors to another site; recreate it manually if still wanted.',
  external_setup_pending: 'Copy the original external destination through the supported Redirect Manager UI and record the stored rule before public verification.',
  external_location_mismatch: 'The public source redirect points somewhere other than its captured external destination; correct the stored rule.',
  external_source_status_mismatch: 'The public source returned a status other than the captured 301 redirect.',
  external_redirect_unsupported_on_wix: 'No Wix resolution is known for this exact rule; retain the launch gap.',
  external_redirect_capability_unverified: 'Confirm whether this exact rule is supported before setup; keep its original destination.',
  removed_source_rule_requires_reconciliation: 'The source rule disappeared from a complete capture; reconcile and retire any old local or destination redirect before launch.',
  inactive_import_redirect_plan_requires_reconciliation: 'An old imported plan remains for a disabled or missing source rule; reconcile it before any redirect write.',
  source_root: 'The site root cannot be redirected; confirm the home page serves the intended content.',
  source_rule_cycle: 'The source redirect rules form a loop; fix the source map.',
  redirect_not_installed: 'Apply the redirect plan (url-redirects.js apply), then verify.',
  public_check_pending: 'After the DNS switch, run url-redirects.js verify --stage verified_public.',
  website_not_built: 'Build the destination website and supply its final route manifest.',
  origin_not_cut_over: 'Switch the website DNS for this origin, then re-run the public check.',
};

function nextActionFor(reason) {
  if (!reason) return 'None.';
  if (NEXT_ACTION[reason]) return NEXT_ACTION[reason];
  if (reason.startsWith('import_unresolved_')) return 'The import left this address unresolved; resolve the recorded issue, then re-run plan.';
  if (/malformed|credentials|scheme|not_site_relative|undeclared/.test(reason)) return 'The recorded address cannot be used safely; correct it in the source inventory.';
  return 'Review the evidence and resolve by hand before launch.';
}

function redactUrl(url) {
  return TOKEN_LINK.test(url || '') ? '[redacted token/action link — see state/url-preservation/]' : url;
}

function redactRecordedDestination(value) {
  if (!value) return null;
  try {
    const absolute = /^https?:\/\//i.test(value);
    const protocolRelative = value.startsWith('//');
    const url = new URL(value, 'https://redaction.invalid');
    if (!['http:', 'https:'].includes(url.protocol)) return '[unsupported destination — see local state]';
    if (url.username || url.password) return '[redacted credential-bearing destination — see local state]';
    if (url.search) url.search = '?[redacted]';
    return redactUrl(absolute ? url.href : protocolRelative
      ? `//${url.host}${url.pathname}${url.search}${url.hash}`
      : `${url.pathname}${url.search}${url.hash}`);
  } catch { return '[invalid destination — see local state]'; }
}

function redactExternalTarget(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return '[redacted credential-bearing destination — see local state]';
    if (url.search) url.search = '?[redacted]';
    return redactUrl(url.href);
  } catch { return '[invalid external destination — see local state]'; }
}

function latestBy(rows, key) {
  const map = {};
  for (const row of rows || []) map[row[key]] = row;
  return map;
}

function obligationStatus(ob, plan, executionByKey, verificationRows) {
  if (ob.disposition === 'unresolved') return { disposition: 'unresolved', reason: ob.reasonCodes[0] || 'unresolved' };
  if (ob.disposition === 'manual_review') return { disposition: 'manual_review', reason: ob.reasonCodes[0] || 'manual_review' };
  if (!plan.websiteBuilt) return { disposition: 'not_verified', reason: 'website_not_built' };
  if (ob.disposition === 'pending_website_build') return { disposition: 'not_verified', reason: 'website_not_built' };
  if (ob.disposition === 'redirect') {
    const exec = ob.remoteRuleKey ? executionByKey[ob.remoteRuleKey] : null;
    if (exec && exec.disposition === 'failed') return { disposition: 'failed', reason: exec.reasonCodes[0] || 'redirect_write_failed' };
    if (exec && exec.disposition === 'manual_review') return { disposition: 'manual_review', reason: exec.reasonCodes[0] || 'manual_review' };
    if (!exec || !['installed', 'already_present'].includes(exec.disposition)) {
      return { disposition: 'not_verified', reason: exec && exec.disposition === 'outcome_unknown' ? 'redirect_outcome_unknown' : 'redirect_not_installed' };
    }
  }
  if (ob.disposition === 'external_redirect' && !ob.externalSetup) {
    return { disposition: 'not_verified', reason: 'external_setup_pending' };
  }
  const execDigest = executionDigestFor(ob, executionByKey);
  const current = verificationRows.filter((row) => row.obligationKey === ob.obligationKey
    && row.stage === 'verified_public' && row.planDigest === plan.planDigest
    && row.deploymentId === plan.deploymentId && row.executionDigest === execDigest);
  const perOrigin = latestBy(current, 'origin');
  const failed = Object.values(perOrigin).find((row) => row.result === 'failed');
  if (failed) return { disposition: 'failed', reason: failed.reason };
  const verified = ob.origins.every((origin) => perOrigin[origin] && perOrigin[origin].result.startsWith('verified_'));
  if (!verified) {
    const pending = ob.origins.map((origin) => perOrigin[origin]).find((row) => row && row.result === 'not_verified');
    return { disposition: 'not_verified', reason: pending ? pending.reason : 'public_check_pending' };
  }
  const redirected = ob.origins.some((origin) => perOrigin[origin].result === 'verified_redirect');
  return { disposition: redirected ? 'verified_redirect' : 'verified_direct', reason: null };
}

function buildUrlPreservationReport({ plan, executionRows = [], verificationRows = [], launchPlan = null, applyStatus = null, generatedAt = new Date().toISOString() }) {
  const executionByKey = latestBy(executionRows, 'ruleKey');
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  const urls = [];
  const functionalGaps = [];
  for (const ob of plan.obligations) {
    const status = obligationStatus(ob, plan, executionByKey, verificationRows);
    counts[status.disposition] += 1;
    const tokenLink = TOKEN_LINK.test(ob.originalUrl || '');
    if (tokenLink) functionalGaps.push({ obligationKey: redactUrl(ob.originalUrl), reason: 'token_or_action_link_needs_functional_check' });
    const provenance = ob.provenance.map((p) => {
      if (p.kind === 'source_rule') return `rule ${p.provider}:${p.stableId}`;
      if (p.kind === 'imported_redirect_removed') return `removed rule ${p.sourceStableKey}`;
      if (p.kind === 'inactive_import_redirect') return `inactive plan ${p.sourceStableKey}`;
      if (p.kind === 'import_redirect_rejected') return `redirects.ndjson line ${p.line}`;
      return `entity ${p.sourceEntityType || ''}:${p.sourceStableKey}`;
    });
    const holdReasons = [...new Set(ob.provenance.filter((p) => p.kind === 'base_path_hold' && p.resolution === 'unresolved').flatMap((p) => p.reasonCodes || []))];
    urls.push({
      originalUrl: redactUrl(ob.originalUrl),
      origins: ob.origins,
      intendedDestination: ob.externalTarget ? redactExternalTarget(ob.externalTarget) : ob.expected ? ob.expected.relativeUrl : null,
      targetEntity: ob.expected ? `${ob.expected.targetEntityType}:${ob.expected.targetEntityId}` : null,
      source: provenance,
      recordedRedirects: ob.provenance.filter((p) => p.kind === 'import_redirect_rejected').map((p) => ({ line: p.line, recordedDestination: redactRecordedDestination(p.recordedDestination), recordedStatus: p.recordedStatus || null })),
      basePathHolds: ob.provenance.filter((p) => p.kind === 'base_path_hold').map((p) => ({ ...p, sourceBasePath: redactUrl(p.sourceBasePath), ...(p.evidence ? { evidence: { ...p.evidence, relativeUrl: redactUrl(p.evidence.relativeUrl) } } : {}) })),
      disposition: status.disposition,
      reason: status.reason,
      evidence: ob.remoteRuleKey ? { remoteRuleKey: ob.remoteRuleKey, execution: 'state/url-preservation/redirect-execution.ndjson', verification: 'state/url-preservation/url-verification.ndjson' } : { verification: 'state/url-preservation/url-verification.ndjson' },
      nextAction: `${nextActionFor(status.reason)}${holdReasons.length ? ` Recorded hold reasons: ${holdReasons.join(', ')}.` : ''}`,
      launchImpact: status.disposition.startsWith('verified_') ? 'none' : 'old emails, bookmarks and external links using this address may fail',
    });
  }
  const coverageGaps = (plan.coverage || []).filter((row) => row.status === 'unreadable' || row.status === 'unsupported');
  const coverageComplete = plan.coverageComplete === true;
  const affected = urls.filter((u) => !u.disposition.startsWith('verified_'));
  const onlyPublicPending = affected.every((u) => u.disposition === 'not_verified' && (u.reason === 'public_check_pending' || u.reason === 'origin_not_cut_over'));
  let status;
  if (!plan.websiteBuilt) status = 'pending_website_build';
  else if (affected.length === 0 && coverageComplete) status = 'verified';
  else if (onlyPublicPending && coverageComplete && !(applyStatus && applyStatus.operatorActions && applyStatus.operatorActions.length)) status = 'pending_cutover_verification';
  else status = 'action_required';

  const operatorActions = [];
  const reportRef = `See ${REPORT_MD} for each address.`;
  if (affected.length && plan.websiteBuilt) {
    const missing = counts.unresolved;
    const conflicts = counts.manual_review;
    const failed = counts.failed;
    const unverified = counts.not_verified;
    operatorActions.push({
      code: status === 'pending_cutover_verification' ? 'url_public_verification_pending' : 'url_links_not_confirmed',
      severity: status === 'pending_cutover_verification' ? 'medium' : 'high',
      action: `${affected.length} old link${affected.length === 1 ? ' is' : 's are'} not confirmed working: ${missing} missing destination${missing === 1 ? '' : 's'}, ${conflicts} needing manual review, ${failed} failed and ${unverified} unverified. Old emails and bookmarks using them may fail. ${reportRef}`,
      deadlineReason: 'old links must work when the production domain moves to the new site',
      entity: 'url-preservation',
      affectedCount: affected.length,
    });
  }
  if (!plan.websiteBuilt && plan.obligations.length) {
    operatorActions.push({
      code: 'url_preservation_pending_website_build',
      severity: 'medium',
      action: `${plan.obligations.length} known old addresses wait for the destination website's final routes before redirects can be planned and tested. ${reportRef}`,
      deadlineReason: 'redirects must exist before the website DNS switch',
      entity: 'url-preservation',
      affectedCount: plan.obligations.length,
    });
  }
  for (const gap of coverageGaps) {
    operatorActions.push({
      code: 'redirect_source_discovery_gap',
      severity: 'high',
      action: `Redirect rules held by ${gap.provider} could not be read (${gap.status}${gap.reason ? `: ${gap.reason}` : ''}). Export them from the source site so they can be preserved. ${reportRef}`,
      deadlineReason: 'historical addresses kept alive only by those rules would break at launch',
      entity: 'url-preservation',
      affectedCount: 1,
    });
  }
  if (!coverageComplete && !coverageGaps.length) {
    operatorActions.push({
      code: 'redirect_source_discovery_gap',
      severity: 'high',
      action: `No redirect-provider coverage was recorded, so the source redirect map is not known to be complete. ${reportRef}`,
      deadlineReason: 'historical addresses kept alive only by source rules would break at launch',
      entity: 'url-preservation',
      affectedCount: 1,
    });
  }
  if (launchPlan) {
    for (const field of ['domainAssociation', 'https']) {
      if (launchPlan[field] !== 'ready') {
        operatorActions.push({
          code: field === 'https' ? 'url_launch_https_not_ready' : 'url_launch_domain_not_associated',
          severity: 'high',
          action: `${field === 'https' ? 'HTTPS for the production hostname' : 'The production domain association'} on the destination site is ${launchPlan[field]}; prepare it before requesting the website DNS switch.`,
          deadlineReason: 'the DNS switch sends visitors to the new site immediately',
          entity: 'url-preservation',
          affectedCount: 1,
        });
      }
    }
  }
  for (const act of (applyStatus && applyStatus.operatorActions) || []) {
    if (!operatorActions.some((existing) => existing.code === act.code)) operatorActions.push(act);
  }

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    planDigest: plan.planDigest,
    deploymentId: plan.deploymentId,
    productionHostname: plan.productionHostname,
    counts,
    obligationCount: plan.obligations.length,
    remoteRuleCount: (plan.remoteRules || []).length,
    coverage: {
      complete: coverageComplete,
      providers: plan.coverage || [],
      scope: 'Known public page addresses and discovered source redirect rules only; not every link in every email ever sent.',
    },
    functionalGaps,
    operatorActions,
    urls,
    notifications: 'none sent',
  };
}

function renderUrlPreservationMarkdown(report) {
  const lines = ['# Old link preservation', '', `- Status: ${report.status}`, `- Production hostname: ${report.productionHostname || 'not declared'}`, '', '## Required actions', ''];
  if (!report.operatorActions.length) lines.push('- None.');
  for (const act of report.operatorActions) lines.push(`- [${act.severity}] ${act.code}: ${act.action}`);
  lines.push('', '## Totals', '', `Known old addresses: ${report.obligationCount} (redirect rules: ${report.remoteRuleCount}).`, '');
  for (const disposition of DISPOSITIONS) lines.push(`- ${disposition}: ${report.counts[disposition]}`);
  lines.push('', `Coverage: ${report.coverage.complete ? 'source redirect discovery complete' : 'source redirect discovery INCOMPLETE'}. ${report.coverage.scope}`);
  const affected = report.urls.filter((u) => !u.disposition.startsWith('verified_'));
  lines.push('', '## Addresses not confirmed working', '');
  if (!affected.length) lines.push('- None.');
  else {
    lines.push('| Old address | Intended destination | Recorded destination / status | Source | Status | Reason | Next action |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const u of affected) lines.push(`| ${u.originalUrl} | ${u.intendedDestination || 'unknown'} | ${(u.recordedRedirects || []).map((row) => `${row.recordedDestination || 'unknown'} (${JSON.stringify(row.recordedStatus)})`.replace(/\|/g, '\\|')).join('; ') || '—'} | ${u.source.join('; ')} | ${u.disposition} | ${u.reason || ''} | ${u.nextAction} |`);
  }
  if (report.functionalGaps.length) {
    lines.push('', '## Links that need a functional check', '', 'A page response cannot prove that password-reset, checkout, order or download links still work.', '');
    for (const gap of report.functionalGaps) lines.push(`- ${gap.obligationKey}`);
  }
  lines.push('', 'Acknowledging a lost link does not make it work. No customer notifications were sent.');
  return `${lines.join('\n')}\n`;
}

async function writeUrlPreservationReport(projectDir, report) {
  for (const [rel, text] of [[REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`], [REPORT_MD, renderUrlPreservationMarkdown(report)]]) {
    const filePath = path.join(projectDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, filePath);
  }
  return { json: REPORT_JSON, markdown: REPORT_MD };
}

// Compact projection for completion-report.json.urlPreservation.
function completionProjection(report) {
  return {
    status: report.status,
    counts: report.counts,
    obligationCount: report.obligationCount,
    coverageComplete: report.coverage.complete,
    reportPath: REPORT_JSON,
    detailPath: REPORT_MD,
    operatorActions: report.operatorActions,
  };
}

module.exports = {
  REPORT_JSON,
  REPORT_MD,
  DISPOSITIONS,
  buildUrlPreservationReport,
  renderUrlPreservationMarkdown,
  writeUrlPreservationReport,
  completionProjection,
  redactUrl,
  obligationStatus,
};
