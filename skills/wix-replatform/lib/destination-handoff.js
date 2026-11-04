'use strict';

// Work that remains on a new destination after the backend import, folded
// into `execution/completion-report.json.operatorActions` (projected to the post-execution
// handoff). Pre-import recovery lives in orchestration/user-actions/ and is not repeated here.
// The notification item is produced by setup and reused, never duplicated.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readReceipt } = require('./destination.js');

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

function destinationOperatorActions(receipt, { frontendCompletion = null } = {}) {
  if (receipt && receipt.requestedSiteType === 'headless') return headlessOperatorActions(receipt, { frontendCompletion });
  if (!receipt || !EDITOR_LABEL[receipt.requestedSiteType] || !receipt.metaSiteId || receipt.status !== 'verified') return [];
  if (websiteReleased(frontendCompletion)) return [];
  const editor = EDITOR_LABEL[receipt.requestedSiteType];
  const editorLink = receipt.editorUrl ? ` Editor: ${receipt.editorUrl}.` : '';
  const generated = receipt.creationMethod === 'harmony_generation'
    ? ' The site was created by Harmony generation: its generated pages, AI-generated text and images are placeholders until reviewed or replaced, even when the site looks finished; their existence never resolves this item.'
    : '';
  const publication = receipt.publication && receipt.publication.state === 'unpublished'
    ? `verified unpublished at ${receipt.publication.checkedAt}`
    : 'publication state not verified as unpublished — an unresolved check, not "unpublished"';
  return [
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

async function projectDestinationOperatorActions(projectDir) {
  const receipt = await readReceipt(projectDir);
  if (!receipt || receipt.invalid) return [];
  const frontendCompletion = await readJsonIfExists(path.join(projectDir, 'website', 'completion.json'));
  return destinationOperatorActions(receipt, { frontendCompletion });
}

module.exports = { destinationOperatorActions, projectDestinationOperatorActions, websiteReleased };
