'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const local = require('./local-state');
const verification = require('./write-verification');
const file = projectDir => path.join(projectDir, 'state', 'write-verification.json');
const journalDir = projectDir => path.join(projectDir, 'state', 'write-verification-journal');
async function load(projectDir, siteId) {
  let state;
  try { state = JSON.parse(await fs.readFile(file(projectDir), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; state = { schemaVersion: 1, siteId, sequence: 0, rows: {} }; }
  if (state.schemaVersion !== 1 || state.siteId !== siteId || !state.rows || Array.isArray(state.rows)) throw new Error('Invalid or wrong-site write verification state');
  state.sequence ||= 0;
  let names;
  try { names = await fs.readdir(journalDir(projectDir)); } catch (e) { if (e.code !== 'ENOENT') throw e; names = []; }
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    const delta = JSON.parse(await fs.readFile(path.join(journalDir(projectDir), name), 'utf8'));
    if (delta.siteId !== siteId || !Number.isSafeInteger(delta.sequence) || !delta.rows) throw new Error('Invalid verification checkpoint');
    if (delta.sequence > state.sequence) { Object.assign(state.rows, delta.rows); state.sequence = delta.sequence; }
  }
  return state;
}
async function atomicJson(dest, value) {
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try { await fs.writeFile(tmp, JSON.stringify(value) + '\n', { mode: 0o600 }); await fs.rename(tmp, dest); }
  finally { await fs.rm(tmp, { force: true }); }
}
// Each checkpoint writes only changed rows. A crash before rename leaves no visible
// partial transaction; a crash after it is replayed before any retry can write.
async function checkpoint(projectDir, state, rows) {
  if (!rows.length) return;
  const sequence = (state.sequence || 0) + 1;
  await atomicJson(path.join(journalDir(projectDir), `${String(sequence).padStart(16, '0')}.json`),
    { siteId: state.siteId, sequence, rows: Object.fromEntries(rows.map(r => [r.sourceKey, state.rows[r.sourceKey]])) });
  state.sequence = sequence;
}
async function persist(projectDir, state) {
  await atomicJson(file(projectDir), state);
  // Snapshot includes the sequence. Old journals are harmless if cleanup is interrupted.
  let names;
  try { names = await fs.readdir(journalDir(projectDir)); } catch (e) { if (e.code !== 'ENOENT') throw e; return; }
  for (const name of names) if (/^\d+\.json$/.test(name) && Number(name.slice(0, -5)) <= state.sequence) await fs.rm(path.join(journalDir(projectDir), name), { force: true });
}
function reference(receipt) {
  return { storage: 'write-verification', schemaVersion: 1, siteId: receipt.siteId, sourceKey: receipt.sourceKey,
    targetId: receipt.targetId, kind: receipt.kind, receiptDigest: verification.digest(receipt) };
}
async function validateReference(projectDir, row) {
  const ref = row.verification;
  if (ref?.storage !== 'write-verification') return verification.validReceipt(ref, { sourceKey: row.sourceStableKey, targetId: row.targetId });
  const state = await load(projectDir, ref.siteId);
  const candidate = state.rows[row.sourceStableKey];
  if (candidate?.identityConflict) return false;
  const receipt = [candidate?.receipt, candidate?.lastVerifiedReceipt].find(r => r && ref.receiptDigest === verification.digest(r));
  return Boolean(receipt) && ref.receiptDigest === verification.digest(receipt) && verification.validReceipt(receipt,
    { siteId: ref.siteId, sourceKey: row.sourceStableKey, targetId: row.targetId, kind: ref.kind });
}
function publication(row, receipt, { baseline = null, confirmedCreate = false, sourceVersion, sourceVersionField, sourceHash, sourceHashDefinition } = {}) {
  if (!verification.validReceipt(receipt, { sourceKey: row.sourceStableKey, targetId: row.targetId })) throw new Error('Cannot publish an unverified mapping');
  // A read-only reconciliation must preserve the last confirmed write's version pair.
  // In particular, never pair a refreshed source version with a newer read-only revision.
  let published = { ...(baseline || {}), ...row, verification: reference(receipt) };
  if (confirmedCreate && !baseline) {
    const next = local.nextCrosswalkBaseline({ existingRow: published, outcome: 'created',
      sourceVersion, sourceVersionField, sourceHash, sourceHashDefinition, targetRevision: receipt.actual?.revision });
    if (next.advanced) published = next.row;
  }
  return published;
}
async function publishMany(projectDir, entries, revoke = []) {
  const rows = entries.map(({ row, receipt, options }) => publication(row, receipt, options));
  await local.updateCrosswalkRows(projectDir, rows, { remove: revoke });
}
async function publish(projectDir, row, receipt, options) {
  await publishMany(projectDir, [{ row, receipt, options }]);
}
function report(rows, siteId) {
  const targetIds = new Set();
  const checked = rows.map(row => {
    const valid = verification.validReceipt(row.receipt, { siteId, sourceKey: row.sourceKey, targetId: row.targetId });
    const duplicate = valid && targetIds.has(row.targetId);
    if (valid) targetIds.add(row.targetId);
    return { ...row, verified: valid && !duplicate };
  });
  // All participants in a collision fail, not only the last one.
  for (const row of checked) if (checked.filter(r => r.targetId && r.targetId === row.targetId).length > 1) row.verified = false;
  return { siteId, intended: rows.length, rows: checked, verified: checked.filter(r => r.verified).length,
    status: !rows.length ? 'no-data' : checked.every(r => r.verified) ? 'complete' : 'partial' };
}
module.exports = { load, checkpoint, persist, publish, publishMany, report, validateReference };
