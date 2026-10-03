'use strict';

const { opaqueId, contactId } = require('../../../lib/entity-verification');
// These selectors belong to inspected endpoint contracts, not to bulk APIs in general.
const selectors = { index: r => r?.itemMetadata?.originalIndex, success: r => r?.itemMetadata?.success };
const adapters = Object.freeze({
  contacts: { ...selectors, envelope: r => r, validId: contactId },
  products: { ...selectors, envelope: r => r?.productResults, validId: opaqueId },
  inventory: { ...selectors, envelope: r => r, validId: null },
});

function correlateBulk(response, inputs, adapter) {
  if (!adapter || !Object.values(adapters).includes(adapter)) throw new Error('An inspected endpoint adapter is required');
  const envelope = adapter.envelope(response);
  const defects = [];
  const raw = Array.isArray(envelope?.results) ? envelope.results : [];
  if (!Array.isArray(envelope?.results)) defects.push('invalid-envelope');
  const meta = envelope?.bulkActionMetadata;
  if (meta != null && (typeof meta !== 'object' || Array.isArray(meta))) defects.push('invalid-metadata');
  const indexes = new Map(), ids = new Map();
  for (const r of raw) {
    const index = adapter.index(r);
    indexes.set(index, (indexes.get(index) || 0) + 1);
    if (adapter.success(r) === true && r?.itemMetadata?.id) ids.set(r.itemMetadata.id, (ids.get(r.itemMetadata.id) || 0) + 1);
  }
  const reportedSuccesses = raw.filter(r => adapter.success(r) === true).length;
  const reportedFailures = raw.filter(r => adapter.success(r) === false).length;
  for (const key of ['totalSuccesses', 'totalFailures', 'undetailedFailures']) {
    if (meta?.[key] !== undefined && (!Number.isInteger(meta[key]) || meta[key] < 0 || meta[key] > inputs.length)) defects.push(`invalid-${key}`);
  }
  const undetailedFailures = Number.isInteger(meta?.undetailedFailures) && meta.undetailedFailures >= 0 ? meta.undetailedFailures : 0;
  if (meta?.totalSuccesses !== undefined && meta.totalSuccesses !== reportedSuccesses) defects.push('inconsistent-successes');
  if (meta?.totalFailures !== undefined && meta.totalFailures !== reportedFailures + undetailedFailures) defects.push('inconsistent-failures');
  if (raw.length + undetailedFailures > inputs.length) defects.push('excess-results');
  const globalInvalid = defects.length > 0;
  const results = raw.map(r => {
    const index = adapter.index(r), metadata = r?.itemMetadata || {};
    const errors = [];
    if (!Number.isInteger(index) || index < 0 || index >= inputs.length) errors.push('invalid-index');
    else if (indexes.get(index) !== 1) errors.push('duplicate-index');
    if (typeof adapter.success(r) !== 'boolean') errors.push('invalid-success');
    if (adapter.validId && adapter.success(r) === true) {
      if (!adapter.validId(metadata.id) || r?.item?._dryRunPlaceholder) errors.push('invalid-id');
      if (r?.item?.id !== undefined && r.item.id !== metadata.id) errors.push('conflicting-id');
      if (ids.get(metadata.id) > 1) errors.push('duplicate-target-id');
    }
    const correlated = !globalInvalid && errors.length === 0;
    defects.push(...errors.map(code => `${code}:${String(index)}`));
    return { index, input: Number.isInteger(index) ? inputs[index] : undefined, raw: r,
      correlated, success: correlated && adapter.success(r) === true,
      errorCode: errors[0] || (globalInvalid ? 'invalid-bulk-metadata' : metadata.error?.code) || null,
      errorDescription: metadata.error?.description || null };
  });
  const accounted = new Set(results.filter(r => r.correlated).map(r => r.index));
  const unresolvedIndexes = inputs.map((_, i) => i).filter(i => !accounted.has(i));
  return { results, defects, unresolvedIndexes, unaccounted: unresolvedIndexes.length, undetailedFailures,
    totalSuccesses: reportedSuccesses, totalFailures: reportedFailures + undetailedFailures };
}

function normalizeBulk(response, inputs, kind) {
  const out = correlateBulk(response, inputs, adapters[kind]);
  const contact = kind === 'contacts';
  out.results = out.results.map(({ raw, input, ...r }) => ({ ...r,
    [contact ? 'inputContact' : 'inputProduct']: input,
    [contact ? 'contactId' : 'productId']: raw?.itemMetadata?.id || null,
    [contact ? 'contact' : 'product']: raw?.item || null,
    ...(contact ? { action: raw?.action || null } : { revision: raw?.item?.revision || null }),
  }));
  out.succeeded = out.results.filter(r => r.success);
  out.failed = out.results.filter(r => !r.success);
  return out;
}
module.exports = { adapters, correlateBulk, normalizeBulk, opaqueId, contactId };
