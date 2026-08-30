'use strict';

const fsp = require('node:fs/promises');

const HANDLER_VERSION = '1.2.0';

const VALID_TYPES = new Set(['text', 'textarea', 'select', 'radio', 'checkbox', 'multiselect', 'date', 'heading']);
const CHOICE_TYPES = new Set(['select', 'radio', 'multiselect']);
const REQUIRED_COLUMNS = ['meta_key', 'label', 'type', 'section', 'required', 'options', 'enabled', 'sort_order'];
const YES_NO_VALUES = new Set(['yes', 'no']);

// RFC4180 field splitter: a field starting with `"` is quoted, a doubled `""` inside a quoted
// field is one literal quote, and a comma only splits outside quotes. Returns null (never a
// partially-split row) when a quote is left unterminated, so a malformed row is caught rather
// than silently mis-split.
function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { inQuotes = false; }
      } else {
        current += char;
      }
    } else if (char === '"' && current.length === 0) {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (inQuotes) return null;
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

// Pure over its input string — no I/O — so it can be exercised directly by a self-test or a
// direct unit test without touching disk.
function parseCsvText(csvText) {
  if (typeof csvText !== 'string' || csvText.trim().length === 0) {
    return { reconciled: false, reason: 'empty-input' };
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 1) return { reconciled: false, reason: 'empty-input' };

  const headerCells = splitCsvLine(lines[0]);
  if (!headerCells) return { reconciled: false, reason: 'malformed-row', rowNumber: 1 };
  const header = headerCells.map((cell) => cell.toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) return { reconciled: false, reason: 'missing-column', column };
  }

  const seenKeys = new Set();
  const fields = [];
  let headingCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    if (!cells) return { reconciled: false, reason: 'malformed-row', rowNumber: i + 1 };
    const row = {};
    header.forEach((column, index) => { row[column] = cells[index] !== undefined ? cells[index] : ''; });

    if (row.type === 'heading') {
      headingCount += 1;
      continue;
    }
    if (!VALID_TYPES.has(row.type)) return { reconciled: false, reason: 'unrecognized-type', row };
    if (!row.meta_key) return { reconciled: false, reason: 'missing-meta-key', row };
    if (seenKeys.has(row.meta_key)) return { reconciled: false, reason: 'duplicate-meta-key', row };
    if (CHOICE_TYPES.has(row.type) && !row.options) return { reconciled: false, reason: 'missing-options-for-choice-type', row };
    const requiredValue = row.required.toLowerCase();
    if (!YES_NO_VALUES.has(requiredValue)) return { reconciled: false, reason: 'invalid-required-value', row };
    const enabledValue = row.enabled.toLowerCase();
    if (!YES_NO_VALUES.has(enabledValue)) return { reconciled: false, reason: 'invalid-enabled-value', row };
    const sortOrder = Number(row.sort_order);
    if (!Number.isFinite(sortOrder)) return { reconciled: false, reason: 'invalid-sort-order', row };

    seenKeys.add(row.meta_key);
    fields.push({
      metaKey: row.meta_key,
      label: row.label,
      fieldType: row.type,
      section: row.section,
      required: requiredValue === 'yes',
      options: row.options ? row.options.split('|').map((option) => option.trim()).filter(Boolean) : [],
      enabled: enabledValue === 'yes',
      sortOrder,
    });
  }

  // A CSV is read whole in one pass, never paginated, so by the time every row above has
  // validated cleanly there is nothing left to reconcile against — sourceCount and
  // expectedTotal are trivially the same value. Kept as two fields (not folded into one)
  // because resolveBlockedDataRequest's resultReconciles() requires both, matching the
  // paginated-fetch shape every other fulfillment kind reports.
  const dataRowCount = lines.length - 1;
  return { reconciled: true, fields, headingCount, sourceCount: dataRowCount, expectedTotal: dataRowCount };
}

// The handler entry point blocked-data-requests.js's attemptFulfillment() actually calls:
// handler.parse({ inputPath, ...handlerContext }). It has already confirmed inputPath exists
// before calling this. `readFile` is injectable so a self-test can exercise this exact entry
// point without touching disk.
async function parse({ inputPath, readFile = (p) => fsp.readFile(p, 'utf8') } = {}) {
  const csvText = await readFile(inputPath);
  return parseCsvText(csvText);
}

module.exports = { HANDLER_VERSION, parse, parseCsvText, VALID_TYPES, CHOICE_TYPES };
