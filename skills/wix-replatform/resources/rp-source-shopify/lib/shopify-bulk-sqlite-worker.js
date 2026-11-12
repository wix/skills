#!/usr/bin/env node
'use strict';

// Compatibility worker for Node 22.12, where node:sqlite exists but still needs
// --experimental-sqlite. shopify-bulk.js starts this file itself; operators never add a flag.

require('node:sqlite');

function errorRecord(error) {
  const record = {
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null,
  };
  for (const field of ['code', 'errno', 'syscall', 'path']) {
    if (error && error[field] !== undefined) record[field] = error[field];
  }
  return record;
}

function reply(message) {
  if (!process.send) return;
  process.send(message, () => {
    if (process.connected) process.disconnect();
  });
}

process.once('message', async (message) => {
  try {
    const bulk = require('./shopify-bulk.js');
    const { operation, payload } = message || {};
    let result;
    if (operation === 'foldBulkJsonl') {
      result = await bulk.foldBulkJsonl(payload.file, payload.shape, { outputFile: payload.outputFile });
    } else if (operation === 'joinOrderFiles') {
      result = await bulk.joinOrderFiles(payload);
    } else {
      throw new Error(`unknown SQLite worker operation ${operation}`);
    }
    reply({ ok: true, result });
  } catch (error) {
    reply({ ok: false, error: errorRecord(error) });
  }
});
