'use strict';

// Bundles: one sellable product made of other products. Wix Stores has no bundle type, so the
// bundle imports as a normal product and its links to its parts become an operator task: install a
// bundle app and link the parts. This module is the one producer of that task, for every source.
// It never installs, buys or configures an app, and it never holds or defers a product.
//
// Input: the canonical `product.bundle` of each source product that carries one (see
// wix-target-spec.js validateCanonicalBundle), whether the bundle product was written, and a
// crosswalk lookup for the parts. Output, in the two durable shapes cutover reads today:
// completion-report `operatorActions` (one row per written bundle, code bundle-app-setup) and
// migration-review/1 tasks in group Manual, plus the ledger execution/stores/bundle-setup.json
// that keeps every bundle's contents, written or not. Ids only; names come from the store.

const fs = require('node:fs');
const path = require('node:path');
const { validateCanonicalBundle } = require('./wix-target-spec.js');

const CODE = 'bundle-app-setup';
const ENTITY = 'stores/product-bundle';
const LEDGER = 'execution/stores/bundle-setup.json';
const LEDGER_VERSION = 1;

function candidateApps() {
  // eslint-disable-next-line global-require
  const entity = require('../domains/stores/entities/product-bundle.json');
  return entity.candidateApps || [];
}

function appsFor(kind) {
  return candidateApps().filter((app) => (app.supportsKinds || []).includes(kind)).map((app) => app.name);
}

function refKey(ref) {
  return `${ref.sourceProductId}${ref.sourceVariantId ? `#${ref.sourceVariantId}` : ''}`;
}

// A part's Wix ids, or `missing` when the part was not imported.
function resolvePart(ref, resolve) {
  const found = resolve({ sourceProductId: ref.sourceProductId, sourceVariantId: ref.sourceVariantId || null });
  if (!found || typeof found.productId !== 'string' || !found.productId) {
    return { sourceProductId: ref.sourceProductId, sourceVariantId: ref.sourceVariantId || null, wixProductId: null, wixVariantId: null, missing: true };
  }
  return {
    sourceProductId: ref.sourceProductId,
    sourceVariantId: ref.sourceVariantId || null,
    wixProductId: found.productId,
    wixVariantId: typeof found.variantId === 'string' && found.variantId ? found.variantId : null,
    missing: false,
  };
}

function normalizeEntry(entry, index) {
  const label = `bundles[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} must be an object`);
  if (typeof entry.sourceProductId !== 'string' || !entry.sourceProductId) throw new Error(`${label}.sourceProductId must be a non-empty string`);
  if (typeof entry.written !== 'boolean') throw new Error(`${label}.written must be a boolean`);
  if (entry.written && (typeof entry.wixProductId !== 'string' || !entry.wixProductId)) throw new Error(`${label}: a written bundle needs its wixProductId`);
  if (!entry.written && (typeof entry.reason !== 'string' || !entry.reason)) throw new Error(`${label}: an unwritten bundle needs a reason (for example price-missing)`);
  // A record whose source carried bundle fields either emitted the canonical bundle or says why
  // its contents could not be read. A silent null would drop the contents.
  if (entry.bundle === null || entry.bundle === undefined) {
    if (typeof entry.unreadableReason !== 'string' || !entry.unreadableReason) throw new Error(`${label}: a bundle record needs its canonical bundle or an unreadableReason`);
    return { ...entry, bundle: null };
  }
  const errors = validateCanonicalBundle(entry.bundle);
  if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`);
  return entry;
}

// The ledger rows: every bundle, written or not, with its parts resolved through the crosswalk.
function bundleSetupRows({ bundles = [], resolve = () => null } = {}) {
  const rows = bundles.map(normalizeEntry).map((entry) => {
    const base = {
      sourceProductId: entry.sourceProductId,
      wixProductId: entry.written ? entry.wixProductId : null,
      written: entry.written,
      ...(entry.written ? {} : { reason: entry.reason }),
    };
    if (!entry.bundle) return { ...base, kind: null, contentsUnreadable: true, unreadableReason: entry.unreadableReason, components: [], groups: [], missingParts: 0 };
    const { kind, priceRule, stockRule, detectedBy } = entry.bundle;
    const components = kind === 'fixed' ? entry.bundle.components.map((component) => ({
      ...resolvePart(component, resolve), quantity: component.quantity, optional: component.optional,
    })) : [];
    const groups = kind === 'configurable' ? entry.bundle.groups.map((group) => ({
      label: group.label, min: group.min, max: group.max, optional: group.optional,
      candidateRule: group.candidateRule || null,
      candidates: group.candidates.map((candidate) => resolvePart(candidate, resolve)),
    })) : [];
    const missingParts = components.filter((part) => part.missing).length
      + groups.reduce((sum, group) => sum + group.candidates.filter((part) => part.missing).length, 0);
    return { ...base, kind, priceRule, stockRule, detectedBy, components, groups, missingParts };
  });
  return rows.sort((a, b) => a.sourceProductId.localeCompare(b.sourceProductId));
}

function partsText(row) {
  const part = (p) => (p.missing ? `missing (source product ${refKey(p)})` : `\`${p.wixProductId}\`${p.wixVariantId ? ` variant \`${p.wixVariantId}\`` : ''}`);
  if (row.kind === 'fixed') return row.components.map((c) => `${part(c)} ×${c.quantity}${c.optional ? ' (optional)' : ''}`).join(', ');
  return row.groups.map((g) => `group "${g.label}" (pick ${g.min}–${g.max === null ? 'any' : g.max}${g.optional ? ', optional' : ''}): ${g.candidates.map(part).join(', ') || 'by rule'}${g.candidateRule ? ` (rule ${JSON.stringify(g.candidateRule)})` : ''}`).join('; ');
}

function consequenceFor(row) {
  if (row.kind === 'configurable') return 'Until it is set up, the kit sells at its price as a plain product: the buyer cannot pick its parts, and the parts\' stock does not drop.';
  return 'Until it is set up, the bundle sells at its price, but its parts\' stock does not drop.';
}

function priceNote(row) {
  if (row.priceRule !== 'derived') return '';
  return ' Its source price was worked out from its parts; it imported with the source price at extraction, frozen (0 if the source showed 0). Check the price in the app.';
}

// Whether to write a bundle product. Its parts never decide it (a bundle is never held because its
// parts cannot be linked). Its price does: a bundle whose source reports no price (empty, null or
// blank: an auto-priced bundle or a kit priced at checkout) is not written with an invented 0; it
// is reported as a missing-price gap and kept in the ledger as written:false / price-missing. A
// reported 0 is a price. The importer calls this before building a bundle product's create body.
const isBlankPrice = (price) => price === undefined || price === null || (typeof price === 'string' && price.trim() === '');
function bundleWriteDecision({ sourceProductId, price } = {}) {
  if (typeof sourceProductId !== 'string' || !sourceProductId) throw new Error('bundleWriteDecision: sourceProductId must be a non-empty string');
  if (!isBlankPrice(price)) return { write: true, reason: null, gap: null };
  return {
    write: false,
    reason: 'price-missing',
    gap: {
      code: 'BUNDLE_PRICE_MISSING', severity: 'warning', entityName: 'stores/product', gapType: 'missing-price',
      sourceId: sourceProductId,
      description: `Bundle product ${sourceProductId} has no source price, so it was not written: Wix needs a price, and an invented 0 would sell it for free.`,
      recommendedHandling: 'Set a price for this bundle in the source (or decide its price), then re-import it; its bundle-app task follows on the next run.',
    },
  };
}

// One operator action per WRITTEN bundle. An unwritten bundle (for example no source price) has no
// product to link; its own gap is its cutover item, and the ledger keeps its contents.
function bundleOperatorActions(input = {}) {
  return bundleSetupRows(input).filter((row) => row.written).map((row) => {
    const kind = row.kind || 'fixed';
    const apps = appsFor(kind);
    const contents = row.contentsUnreadable
      ? `The import could not read this bundle's contents (${row.unreadableReason}); take the parts and quantities from the source store.`
      : `Parts: ${partsText(row)}.`;
    const action = `Install a bundle app and link the components: choose one of ${apps.join(' or ')}, install it from the App Market, and link the listed parts and quantities to product \`${row.wixProductId}\`. ${contents}${priceNote(row)} Or dismiss and accept the consequence.`;
    const missing = row.missingParts > 0;
    return {
      code: CODE,
      actionId: `${CODE}:${row.wixProductId}`,
      severity: kind === 'configurable' ? 'high' : 'medium',
      entity: ENTITY,
      role: 'cutover-operator',
      action,
      deadlineReason: 'After the bundle and its parts are imported; before the DNS switch.',
      affectedCount: 1,
      affectedIds: [row.wixProductId],
      artifactRefs: [LEDGER],
      prerequisites: missing
        ? [`Requires Import Operator: Re-import the missing parts listed in ${LEDGER} for bundle ${row.wixProductId}, then rerun the bundle cutover producer.`]
        : ['The bundle and its parts are imported.'],
      resolutionEvidence: 'The operator resolves it after linking the parts in the app and checking the bundle, or dismisses it accepting the consequence.',
      consequence: consequenceFor(row),
    };
  }).map(({ consequence, ...row }) => row);
}

function bundleReviewTasks(input = {}, { scopeKey = 'stores-bundles' } = {}) {
  const rows = new Map(bundleSetupRows(input).filter((row) => row.written).map((row) => [row.wixProductId, row]));
  return bundleOperatorActions(input).map((action) => {
    const consequence = consequenceFor(rows.get(action.affectedIds[0]));
    return {
      findingKey: action.actionId, scopeKey, group: 'Manual', requirement: 'optional',
      title: action.actionId, summary: action.action, consequence, action: action.action,
      affected: action.affectedIds, affectedCount: action.affectedCount, prerequisites: action.prerequisites,
      verificationPolicy: 'manual', evidenceStatus: 'needs_attention', dismissalAcknowledgment: consequence,
    };
  });
}

// Rewritten from current state on every run, so a rerun never duplicates an item.
function writeBundleSetupLedger(projectDir, input = {}) {
  const rows = bundleSetupRows(input);
  const file = path.join(projectDir, LEDGER);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: LEDGER_VERSION, bundles: rows }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { path: LEDGER, bundles: rows.length, written: rows.filter((row) => row.written).length };
}

module.exports = {
  BUNDLE_ACTION_CODE: CODE,
  BUNDLE_LEDGER: LEDGER,
  bundleWriteDecision,
  candidateApps,
  bundleSetupRows,
  bundleOperatorActions,
  bundleReviewTasks,
  writeBundleSetupLedger,
};
