'use strict';

// Child rows read from their own extract (WooCommerce variations) are joined to their parent
// record under `as` before build. The import loop and the read-back inventory both call this, so
// the inventory measures the same record the import step builds.
const fs = require('node:fs');
const path = require('node:path');

const at = (record, dotted) => String(dotted).split('.').reduce((value, key) => value?.[key], record);
const readRows = (projectDir, extractPath) => fs.readFileSync(path.join(projectDir, extractPath), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

// childExtracts: [{ extractPath, parentField, as }]. A missing child file joins nothing.
function joinChildExtracts(projectDir, records, keyField, childExtracts = []) {
  for (const child of childExtracts) {
    if (!child?.extractPath || !child.parentField || !child.as) throw new Error('runRecordTask: childExtracts need extractPath, parentField and as');
    if (!fs.existsSync(path.join(projectDir, child.extractPath))) continue;
    const byParent = new Map();
    for (const row of readRows(projectDir, child.extractPath)) { const parent = String(at(row, child.parentField)); byParent.set(parent, [...(byParent.get(parent) || []), row]); }
    for (const record of records) if (byParent.has(String(at(record, keyField)))) record[child.as] = byParent.get(String(at(record, keyField)));
  }
  return records;
}

module.exports = { joinChildExtracts };
