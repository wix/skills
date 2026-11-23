'use strict';

// The single source of truth for the WordPress plugin coverage artifact shared by
// rp-source-wordpress and rp-discovery. Keep the public JSON definition declarative;
// this module supplies the small runtime helpers and validation used by both views.

const definition = require('../plugin-coverage-contract.json');

const STATUS_META = Object.fromEntries(definition.statuses.map((status) => [status.id, {
  label: status.label,
  order: status.order,
  blurb: status.blurb,
}]));
const COVERAGE_STATUSES = new Set(definition.statuses.map((status) => status.id));
const STATUS_PRECEDENCE = [...definition.precedence];
const PER_PLUGIN_FIELDS = [...definition.perPluginFields];

function artifactContract() {
  return {
    version: definition.version,
    statuses: definition.statuses.map((status) => status.id),
    perPluginFields: [...PER_PLUGIN_FIELDS],
  };
}

function validatePerPluginRows(rows = []) {
  const errors = [];
  if (!Array.isArray(rows)) return ['perPlugin must be an array'];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`perPlugin[${index}] must be an object`);
      return;
    }
    for (const field of PER_PLUGIN_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`perPlugin[${index}] is missing ${field}`);
    }
    if (row.status !== undefined && !COVERAGE_STATUSES.has(row.status)) {
      errors.push(`perPlugin[${index}] has unknown status ${row.status}`);
    }
  });
  return errors;
}

module.exports = {
  definition,
  STATUS_META,
  COVERAGE_STATUSES,
  STATUS_PRECEDENCE,
  PER_PLUGIN_FIELDS,
  artifactContract,
  validatePerPluginRows,
};
