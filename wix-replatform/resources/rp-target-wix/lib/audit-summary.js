'use strict';

const fs = require('fs');

function createBucket() {
  return {
    total: 0,
    ok: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    throttled: 0,
  };
}

function statusOf(event) {
  return event.status || event.resultStatus || event.result || 'unknown';
}

function entityOf(event) {
  return event.entity || event.entityKey || event.sourceEntity || 'unknown';
}

function summarizeAuditEvents(events, { runId } = {}) {
  if (!runId) {
    throw new Error('summarizeAuditEvents requires runId; append-only audit logs may contain multiple attempts.');
  }
  const summary = {};
  for (const event of events) {
    if (!event || event.runId !== runId) continue;
    const entity = entityOf(event);
    const status = statusOf(event);
    if (!summary[entity]) summary[entity] = createBucket();
    summary[entity].total += 1;
    if (Object.prototype.hasOwnProperty.call(summary[entity], status)) {
      summary[entity][status] += 1;
    }
  }
  return summary;
}

function readAuditNdjson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid audit JSON at line ${index + 1}: ${error.message}`);
    }
  });
}

function summarizeAuditFile(filePath, options) {
  return summarizeAuditEvents(readAuditNdjson(filePath), options);
}

module.exports = {
  summarizeAuditEvents,
  summarizeAuditFile,
  readAuditNdjson,
};
