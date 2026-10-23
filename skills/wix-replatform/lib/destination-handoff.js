'use strict';

// Work that remains on an Editor destination after the backend import, folded
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

function destinationOperatorActions(receipt, { frontendCompletion = null } = {}) {
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
