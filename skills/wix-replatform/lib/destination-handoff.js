'use strict';

// Work that remains on a new destination after the backend import, folded
// into `execution/completion-report.json.operatorActions` (projected to the post-execution
// handoff). Pre-import recovery lives in orchestration/user-actions/ and is not repeated here.
// The notification item is produced by setup and reused, never duplicated.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readReceipt } = require('./destination.js');
const { readEnvFile } = require('./config-env.js');
const { getEffectiveDeliveryMode, isWebsiteDeliveryMode } = require('./orchestration-decisions.js');

const EDITOR_LABEL = { studio: 'Wix Studio', harmony: 'Wix Harmony' };

async function readJsonIfExists(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

// A released website (frontend completion receipt with a released state) resolves both items.
function websiteReleased(frontendCompletion) {
  return Boolean(frontendCompletion
    && ['complete', 'complete_with_warnings'].includes(frontendCompletion.status)
    && frontendCompletion.release && frontendCompletion.release.status === 'released');
}

const HEADLESS_READBACK_PROMPT = 'Requires Import Operator. In the original migration workspace, restore Wix CLI access to site {site}, then run `node skills/wix-replatform/scripts/wix-destination.js ensure --project-dir <migration project directory>` to repeat the published-URLs readback. Do not create a new site, and do not publish it without the cutover decision.';

// A Headless site is created unpublished; publishing it is a cutover step. The item
// stays until a readback records `published` or a website release is recorded.
function headlessOperatorActions(receipt, { frontendCompletion }) {
  if (!receipt.metaSiteId || !['created', 'verified'].includes(receipt.status)) return [];
  const publication = receipt.publication || {};
  if (publication.state === 'published' || websiteReleased(frontendCompletion)) return [];
  const site = receipt.metaSiteId;
  const base = {
    code: 'headless_site_publication_outstanding',
    severity: 'high',
    deadlineReason: 'before switching traffic',
    entity: 'website',
    affectedCount: 1,
    actionId: `headless_site_publication_outstanding:${site}`,
    affectedIds: [site],
    artifactRefs: ['orchestration/destination.json'],
    resolutionEvidence: 'A `published` readback in orchestration/destination.json, or a released website/completion.json.',
  };
  if (publication.state === 'unpublished') {
    return [{
      ...base,
      role: 'cutover-operator',
      action: `Cutover Operator: Headless site ${site} is not published (verified unpublished at ${publication.checkedAt}) — customers have no public website yet. After the website and public-site checks pass, publish it from Business Manager (or \`npm run release\` in frontend/, which requires the Import Operator), then rerun the destination step to record a published readback. RePlatform never publishes it.`,
    }];
  }
  // A receipt written before the Headless readback existed has no readback at all.
  const reason = !publication.state ? ' (never read back)' : publication.reason ? ` (${publication.reason})` : '';
  return [{
    ...base,
    role: 'import-operator',
    importOperatorPrompt: HEADLESS_READBACK_PROMPT.replace('{site}', site),
    action: `Import Operator: the publication state of Headless site ${site} could not be read${reason} — an unresolved check, not "unpublished". Restore access and repeat the readback; then the Cutover Operator publishes the site at cutover if it is still unpublished.`,
  }];
}

// The destination step installs the Developer Tools app (Secrets Manager) once when it verifies a new
// Harmony or Studio site. A failed install does not fail the destination, so it is reported here. It is
// independent of the website release: the owner needs the app whenever a stored secret is entered.
function developerToolsOperatorActions(receipt) {
  const record = receipt.developerTools;
  if (record == null) return [];
  const wellFormed = typeof record === 'object' && !Array.isArray(record) && ['installed', 'failed'].includes(record.status);
  if (wellFormed && record.status === 'installed') return [];
  // A malformed record is reported like a failed install; it never stops the destination step or the run.
  const reason = wellFormed ? (record.reason || 'install failed') : 'the install record in the receipt is unreadable';
  const checked = wellFormed && record.checkedAt ? `, checked ${record.checkedAt}` : '';
  const site = receipt.metaSiteId;
  const editor = EDITOR_LABEL[receipt.requestedSiteType];
  return [{
    code: 'developer_tools_not_installed',
    severity: 'medium',
    action: `Site owner: the Developer Tools app is not confirmed installed on the ${editor} site ${site} (${reason}${checked}), so the dashboard may have no Secrets Manager and site code may have no \`secrets\` object. Add "Developer Tools" from the dashboard's app list, then open the Secrets Manager page to confirm. This does not stop the migration, and the destination step does not retry it.`,
    deadlineReason: 'before a credential must be stored on the site',
    entity: 'website',
    affectedCount: 1,
    actionId: `developer_tools_not_installed:${site}`,
    role: 'site-owner',
    affectedIds: [site],
    artifactRefs: ['orchestration/destination.json'],
    resolutionEvidence: 'The Secrets Manager page opens on the site. Nothing in the pipeline clears this item.',
  }];
}

function destinationOperatorActions(receipt, { frontendCompletion = null, deliveryMode = 'management_and_website' } = {}) {
  const websiteDelivery = isWebsiteDeliveryMode(deliveryMode);
  if (receipt && receipt.requestedSiteType === 'headless') return websiteDelivery ? headlessOperatorActions(receipt, { frontendCompletion }) : [];
  if (!receipt || !EDITOR_LABEL[receipt.requestedSiteType] || !receipt.metaSiteId || receipt.status !== 'verified') return [];
  const developerTools = developerToolsOperatorActions(receipt);
  // Developer Tools supports backend credentials and remains actionable for management-only
  // runs; only the editor website build/publication actions are website-scoped.
  if (!websiteDelivery) return developerTools;
  if (websiteReleased(frontendCompletion)) return developerTools;
  const editor = EDITOR_LABEL[receipt.requestedSiteType];
  const editorLink = receipt.editorUrl ? ` Editor: ${receipt.editorUrl}.` : '';
  const generated = receipt.creationMethod === 'harmony_generation'
    ? ' The site was created by Harmony generation: its generated pages, AI-generated text and images are placeholders until reviewed or replaced, even when the site looks finished; their existence never resolves this item.'
    : '';
  const publication = receipt.publication && receipt.publication.state === 'unpublished'
    ? `verified unpublished at ${receipt.publication.checkedAt}`
    : 'publication state not verified as unpublished — an unresolved check, not "unpublished"';
  return [
    ...developerTools,
    {
      code: 'editor_website_unfinished',
      severity: 'high',
      action: `Site owner/designer: the ${editor} website for site ${receipt.metaSiteId} is not built — customers cannot use the migrated website yet.${editorLink} Open the verified editor, complete the pages and required app surfaces for the imported data, then review/publish through the authorized cutover workflow. Resolve with bound website review/release evidence; backend import counts alone do not resolve this.${generated}`,
      deadlineReason: 'before switching traffic',
      entity: 'website',
      affectedCount: 1,
    },
    {
      code: 'editor_publication_outstanding',
      severity: 'high',
      action: `Cutover Operator/authorized publisher: site ${receipt.metaSiteId} has no public website until it is released (${publication}). Complete the website and public-site checks, then authorize and publish through the supported workflow. RePlatform never publishes it. Resolve with publication and public-site evidence.`,
      deadlineReason: 'before switching traffic',
      entity: 'website',
      affectedCount: 1,
    },
  ];
}

// Setup installs apps on a Harmony site and cannot read the site's pages, so it records
// setup/harmony-app-pages.json (`appPages: "not-read"`, the apps and their step ids) instead of claiming
// the pages exist. That is an item for the site owner whether setup created the site or the operator
// supplied it, so it does not depend on the destination receipt. The record is its own file because the
// setup receipt is rewritten on every setup run. Nothing here proves the pages exist, and a released
// website does not either, so only the site owner's confirmation can close it.
function appPagesOperatorActions(record, receipt, currentSiteId = null) {
  if (!record || record.appPages !== 'not-read') return [];
  const apps = Array.isArray(record.apps) ? record.apps : [];
  const deferred = Array.isArray(record.deferred) ? record.deferred : [];
  if (!apps.length && !deferred.length) return [];
  // A record that names another site than the project's current one (the destination receipt's, else
  // the project's WIX_SITE_ID) is a leftover, not this site's.
  const current = (receipt && receipt.metaSiteId) || currentSiteId;
  if (current && record.siteId && record.siteId !== current) return [];
  const site = receipt && receipt.metaSiteId ? ` ${receipt.metaSiteId}` : record.siteId ? ` ${record.siteId}` : '';
  const editorLink = receipt && receipt.editorUrl ? ` Editor: ${receipt.editorUrl}.` : '';
  const names = (rows) => rows.map((app) => app.stepId || app.appDefId).join(', ');
  const actions = [];
  if (apps.length) actions.push({
    code: 'harmony_app_pages_unconfirmed',
    severity: 'high',
    action: `Site owner/designer: setup installed these apps on the Wix Harmony site${site}: ${names(apps)}. It cannot read the site's pages, so the pages each app adds are unconfirmed — visitors may find them missing (a site whose app was installed another way, or before this run, may lack them).${editorLink} Open the editor and confirm each app's pages exist, and before any publication open them in the preview. Nothing in the pipeline clears this item: record the confirmation in the cutover checklist.`,
    deadlineReason: 'before switching traffic',
    entity: 'website',
    affectedCount: apps.length,
    actionId: 'harmony-app-pages:unconfirmed',
    role: 'site-owner',
    prerequisites: ['Setup passed for the listed install steps.'],
    affectedIds: receipt && receipt.metaSiteId ? [receipt.metaSiteId] : [],
    artifactRefs: ['setup/harmony-app-pages.json'],
    resolutionEvidence: "The site owner's confirmation that each app's pages exist, recorded in the cutover checklist. A released website does not prove it, and nothing in the pipeline clears this item.",
  });
  // An app the installer refused because another app already owns its page paths is not on the site at all.
  if (deferred.length) {
    actions.push({
      code: 'harmony_app_install_deferred',
      severity: 'high',
      action: `Site owner/designer: setup could not install these apps on the Wix Harmony site${site}: ${names(deferred)}. Wix's editor installer refuses an app whose page paths another installed app already uses, so the app is missing and so are its pages and features.${editorLink} Add each app from the editor's app panel once Wix fixes the conflict, or decide to go without it, and record the decision in the cutover checklist. Nothing in the pipeline clears this item.`,
      deadlineReason: 'before switching traffic',
      entity: 'website',
      affectedCount: deferred.length,
      actionId: 'harmony-app-install:deferred',
      role: 'site-owner',
      prerequisites: ['Setup finished with the listed install steps deferred.'],
      affectedIds: receipt && receipt.metaSiteId ? [receipt.metaSiteId] : [],
      artifactRefs: ['setup/harmony-app-pages.json'],
      resolutionEvidence: "The site owner's record that each listed app was added, or consciously left out, in the cutover checklist. A released website does not prove it, and nothing in the pipeline clears this item.",
    });
  }
  return actions;
}

// The site the project is set up against, from config/wix.env.
async function projectSiteId(projectDir) {
  try { return (await readEnvFile(path.join(projectDir, 'config', 'wix.env'))).WIX_SITE_ID || null; } catch { return null; }
}

async function projectDestinationOperatorActions(projectDir) {
  const receipt = await readReceipt(projectDir);
  const usable = receipt && !receipt.invalid ? receipt : null;
  const decisions = await readJsonIfExists(path.join(projectDir, 'orchestration', 'decisions.json'));
  // Historical destination receipts predate the durable delivery decision. Preserve their
  // existing website cutover actions; an explicit management/management_only decision is
  // what suppresses website work.
  const deliveryMode = getEffectiveDeliveryMode(decisions || {}) || 'management_and_website';
  const frontendCompletion = await readJsonIfExists(path.join(projectDir, 'website', 'completion.json'));
  const appPagesRecord = await readJsonIfExists(path.join(projectDir, 'setup', 'harmony-app-pages.json'));
  return [
    ...(usable ? destinationOperatorActions(usable, { frontendCompletion, deliveryMode }) : []),
    ...(isWebsiteDeliveryMode(deliveryMode) ? appPagesOperatorActions(appPagesRecord, usable, await projectSiteId(projectDir)) : []),
  ];
}

module.exports = { destinationOperatorActions, projectDestinationOperatorActions, appPagesOperatorActions, websiteReleased };
