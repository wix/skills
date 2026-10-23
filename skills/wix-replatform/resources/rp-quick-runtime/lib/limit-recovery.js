'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const STORES_PRODUCT_TAGS_MAX = 100;
const STORES_CATEGORIES_MAX = 1000;
const STORES_SKU_MAX = 40;
function truncate(value, limit, sourceId) { const chars = Array.from(String(value || '')); if (chars.length <= limit) return String(value || ''); const suffix = `-${crypto.createHash('sha256').update(String(sourceId)).digest('hex').slice(0, 7)}`; return `${chars.slice(0, Math.max(0, limit - suffix.length)).join('')}${suffix}`; }
function normalizeProduct({ sourceId, sku, tagIds = [] }) { const recoveries = []; const uniqueTags = [...new Set(tagIds)].slice(0, STORES_PRODUCT_TAGS_MAX); if (tagIds.length > uniqueTags.length) recoveries.push({ code: 'stores_product_tag_count', field: 'tags.publicTags.tagIds', action: 'capped', originalCount: tagIds.length, finalCount: uniqueTags.length }); const nextSku = truncate(sku, STORES_SKU_MAX, sourceId); if (nextSku !== sku) recoveries.push({ code: 'stores_variant_sku_length', field: 'variants.sku', action: 'trimmed_with_source_suffix', originalLength: Array.from(String(sku)).length, finalLength: Array.from(nextSku).length }); return { sku: nextSku, tagIds: uniqueTags, recoveries }; }
async function appendRecoveries(projectDir, adapter, sourceId, recoveries) { if (!recoveries.length) return; const file = path.join(projectDir, 'execution', 'quick-limit-recoveries.ndjson'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.appendFile(file, recoveries.map((r) => JSON.stringify({ adapter, sourceId: String(sourceId), outcome: 'written_with_loss', ...r })).join('\n') + '\n'); }
function recordRecoveredRecord(summary, recoveries) { if (!recoveries.length) return; summary.recovered = (summary.recovered || 0) + 1; summary.recoveryCounts ||= {}; for (const item of recoveries) summary.recoveryCounts[item.code] = (summary.recoveryCounts[item.code] || 0) + 1; }
const LIVE_FINAL_REPORT = 'execution/quick-mode-final-report.md';
const DRY_RUN_FINAL_REPORT = 'execution/dry-run-final-report.md';
// Temp file + rename so a reader (or a crash) never sees a half-written report.
async function writeFileAtomic(file, content) { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await fs.writeFile(temp, content); await fs.rename(temp, file); }
function renderFinalReport(summary) {
  const rows = Object.entries(summary.recoveryCounts || {}).map(([code, count]) => `- ${code}: ${count}`).join('\n') || '- None';
  let out = `# Quick-mode final report\n\nImported with deterministic recovery: ${summary.recovered || 0}\n\n## Target-limit recoveries\n\n${rows}\n`;
  const collections = summary.excludedCollections || [];
  if (collections.length) out += `\n## Collections not migrated\n\nThese source collections held no imported product, so no category was created. Recreate any the merchant still needs.\n\n${collections.map((c) => `- ${c.title || c.handle} (${c.handle}, source id ${c.sourceId})`).join('\n')}\n`;
  const unverified = (summary.writtenUnverified && summary.writtenUnverified.product) || [];
  if (unverified.length) out += `\n## Products to check\n\nThese products are on Wix with stock and categories, but a field differs from the source. Compare each with the source, then fix or accept it.\n\n${unverified.map((p) => `- ${p.name || p.sourceId} (source id ${p.sourceId}, Wix id ${p.targetId}): ${(p.failedFields || []).join(', ') || 'unspecified field'}`).join('\n')}\n`;
  if (summary.inventory) out += `\n## Inventory\n\nStatus: ${summary.inventory.status}. Verified complete: ${summary.inventory.complete}. See ${summary.dryRun ? 'execution/dry-run-inventory-report.json' : 'state/inventory-report.json'}.\n`;
  return out;
}
// A dry run owns its own report path so it can never overwrite, or stand in for, the live one.
async function writeFinalReport(projectDir, summary, { dryRun = false } = {}) {
  const relative = dryRun ? DRY_RUN_FINAL_REPORT : LIVE_FINAL_REPORT;
  await writeFileAtomic(path.join(projectDir, relative), renderFinalReport(summary));
  summary.finalReport = relative;
}
// Categories this run still has to create: not already crosswalked and not already on Wix by slug.
function countCategoriesToCreate({ rows, seen, existingSlugs, slugOf }) {
  return rows.filter((row) => { if (seen(row.id)) return false; try { return !existingSlugs.has(slugOf(row.handle)); } catch { return false; } }).length;
}
module.exports = { STORES_PRODUCT_TAGS_MAX, STORES_CATEGORIES_MAX, STORES_SKU_MAX, LIVE_FINAL_REPORT, DRY_RUN_FINAL_REPORT, truncate, normalizeProduct, appendRecoveries, recordRecoveredRecord, renderFinalReport, writeFinalReport, writeFileAtomic, countCategoriesToCreate };
