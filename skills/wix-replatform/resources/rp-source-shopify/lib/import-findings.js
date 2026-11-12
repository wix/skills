'use strict';

// A coverage row first found during the import (a full read short of Shopify's count, a withheld
// field, a failed census) is recorded the same way for every Shopify finding: upserted by
// coverageId into the adapter's raw coverage file, re-promoted, and the extract stops with the
// finding's code. What happens next is the pipeline's general path back through mapping, the same
// as for any source; nothing here writes a gap, a decision or an approval.

const { upsertAdapterCoverageRows } = require('../../../lib/source-coverage.js');

class ShopifyExtractStop extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ShopifyExtractStop';
    this.code = code;
    this.details = details;
  }
}

// Always rejects with a ShopifyExtractStop carrying `code`, after the row is durable.
async function stopWithFinding(projectDir, { row, code, message = null }) {
  if (typeof code !== 'string' || !code) throw new Error('stopWithFinding needs the finding code');
  if (!row || typeof row !== 'object') throw new Error('stopWithFinding needs a coverage row');
  const result = await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows: [row] });
  throw new ShopifyExtractStop(code, message || `Shopify extract stopped (${code}): ${row.coverageId} was recorded as a source-coverage row.`, {
    coverageId: row.coverageId,
    ...result,
  });
}

module.exports = {
  ShopifyExtractStop,
  stopWithFinding,
};
