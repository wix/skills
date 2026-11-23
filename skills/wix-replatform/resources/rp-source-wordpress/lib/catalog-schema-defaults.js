'use strict';

// Facts the WooCommerce reader catalog already knows, written into the synthesized source-schema.json
// so discovery QA does not have to send discovery back for them:
//   - a catalog child (product-variation under product) becomes its own entity with a many-to-one
//     relation to its parent, even when discovery did not sample the child route;
//   - a catalog `hierarchy` (product-category.parent) sets `hierarchical: true` and declares the
//     parent field as a self-relation, on the entity and on its public Store API duplicate.
// Only adds what is missing; never changes a field, count or relation discovery wrote.

const fs = require('node:fs');
const path = require('node:path');
const { loadCatalog } = require('./reader-catalog.js');

const FIELDS_DIR = path.join(__dirname, '..', 'catalog-fields');

function rowsOf(schema) {
  if (Array.isArray(schema.entities)) return schema.entities.map((row) => [row.entity || row.id || row.name, row]);
  return Object.entries(schema.entities || {});
}

function childFields(id) {
  const file = path.join(FIELDS_DIR, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).fields : {};
}

function addRelation(row, relation) {
  row.relations = Array.isArray(row.relations) ? row.relations : [];
  if (row.relations.some((r) => r.field === relation.field && r.targetEntity === relation.targetEntity)) return false;
  row.relations.push(relation);
  return true;
}

function applyCatalogSchemaDefaults(schema, catalog = loadCatalog()) {
  const changes = [];
  const rows = rowsOf(schema);
  const byId = new Map(rows);
  for (const entry of catalog.entities || []) {
    const parent = byId.get(entry.id);
    if (!parent) continue;
    for (const child of entry.children || []) {
      if (byId.has(child.id) || !child.parentField) continue;
      const row = {
        route: child.route,
        recordCount: null,
        inUse: null,
        primaryKey: 'id',
        fields: childFields(child.id),
        relations: [{ field: child.parentField, targetEntity: entry.id, cardinality: 'many-to-one', evidence: `reader-catalog: ${entry.id}.children.${child.id}` }],
        sourceMeta: {
          restNamespace: entry.namespace,
          origin: 'reader-catalog-child',
          parentRoute: entry.route,
          ...(child.when ? { parentFilter: `${child.when.field}=${child.when.equals}` } : {}),
          ...(child.target ? { candidateTargetRefs: [child.target] } : {}),
          note: 'Added from the reader catalog; the fixed reader reads and counts it at extract.',
        },
      };
      if (Array.isArray(schema.entities)) schema.entities.push({ entity: child.id, ...row });
      else schema.entities[child.id] = row;
      byId.set(child.id, row);
      changes.push({ entity: child.id, change: 'child-entity' });
    }
    if (!entry.hierarchy) continue;
    const self = [[entry.id, parent], ...rows.filter(([, row]) => row?.sourceMeta?.publicDuplicateOf === entry.id)];
    for (const [id, row] of self) {
      let changed = false;
      if (row.hierarchical !== true) { row.hierarchical = true; changed = true; }
      row.sourceMeta = row.sourceMeta || {};
      if (row.sourceMeta.hierarchical !== true) { row.sourceMeta.hierarchical = true; changed = true; }
      changed = addRelation(row, { field: entry.hierarchy.parentField, targetEntity: id, cardinality: 'many-to-one', evidence: `reader-catalog: ${entry.id}.hierarchy (self-reference)` }) || changed;
      if (changed) changes.push({ entity: id, change: 'hierarchy' });
    }
  }
  return changes;
}

module.exports = { applyCatalogSchemaDefaults };
