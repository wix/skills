'use strict';

// File-only dependency for every import task. The locale entity already read Wix; downstream
// tasks verify its current receipt and apply the selective keep rule without another site call.

const path = require('node:path');

const core = require('./site-regional.js');
const sr = require('./source-regional.js');
const { hashArtifact } = require('./artifact-freshness.js');

const GATE_CODES = Object.freeze({
  SITE_LOCALE_NOT_READY: { action: 'The site locale entity has not passed for this site, plan, source and owner decision. Run setup.' },
  SITE_LOCALE_KEPT: { action: 'The owner kept a differing site locale. Neutral records may continue; change the relevant site value or answer, rerun setup, then catch up this held task.' },
});

function verificationRow(projectDir) {
  const verification = core.readJsonSync(path.join(projectDir, 'setup', 'setup-verification.json'));
  if (!verification) return { verification: null, row: null };
  return { verification, row: (verification.requirements || []).find((item) => item && item.id === core.STEP_ID) || null };
}

function receiptIsCurrent(projectDir, siteId, verification, row) {
  if (!verification || !row || row.status !== 'passed' || !row.regional) return false;
  if (verification.siteId !== siteId) return false;
  if (verification.planDigest !== hashArtifact(projectDir, path.join('setup', 'setup-plan.json'))) return false;
  if (row.regional.sourceDigest !== core.fileSha256(projectDir, sr.SOURCE_REGIONAL_FILE)) return false;
  if (row.regional.decisionDigest !== core.approvalDigest(projectDir, siteId)) return false;
  return core.SETTINGS.every((field) => row.regional.fields?.[field]?.verified === true);
}

function regionalDependency({ projectDir, siteId, entityRefs }) {
  const refuse = (code, extra = {}) => ({ ok: false, gated: true, code, ...GATE_CODES[code], ...extra });
  try {
    if (!sr.readSourceRegionalSync(projectDir)) return refuse('SITE_LOCALE_NOT_READY', { reason: 'source-locale-missing' });
  } catch {
    return refuse('SITE_LOCALE_NOT_READY', { reason: 'source-locale-invalid' });
  }
  if (!core.planHasRegionalStep(projectDir)) return refuse('SITE_LOCALE_NOT_READY', { reason: 'site-locale-step-missing' });
  const { verification, row } = verificationRow(projectDir);
  if (!receiptIsCurrent(projectDir, siteId, verification, row)) return refuse('SITE_LOCALE_NOT_READY', { reason: 'site-locale-receipt-not-current' });

  const parts = core.partitionRefs(entityRefs);
  const fields = row.regional.fields || {};
  const keptFields = [];
  const affectedRefs = new Set();
  if (fields.currency?.action === 'kept') {
    keptFields.push('currency');
    for (const ref of parts.moneyBearingRefs) affectedRefs.add(ref);
  }
  if (fields.timeZone?.action === 'kept') {
    keptFields.push('timeZone');
    for (const ref of parts.wallClockRefs) affectedRefs.add(ref);
  }
  // Unknown families are never silently neutral. While either semantic setting is kept, hold
  // them until their domain is classified and the coverage test is updated.
  if (keptFields.length) for (const ref of parts.unclassifiedRefs) affectedRefs.add(ref);
  if (affectedRefs.size) return refuse('SITE_LOCALE_KEPT', { keptFields, affectedRefs: [...affectedRefs].sort() });
  return { ok: true, gated: true, keptFields, affectedRefs: [] };
}

module.exports = { GATE_CODES, regionalDependency, receiptIsCurrent, verificationRow };
