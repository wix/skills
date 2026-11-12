'use strict';

// Product videos: the plan, the per-product outcomes, and the cutover items they
// produce, in one place.
//
//   plan     execution/product-videos.json, written by rp-source-wordpress
//            scripts/product-videos.js plan from the product extract. `attach[]` are video files
//            the importer attaches (rp-target-wix attachStoresProductVideos); `manual[]` are links
//            Wix product media cannot hold (YouTube, Vimeo, other).
//   outcome  state/product-videos/outcomes.ndjson, one line per attach call
//            (recordProductVideoOutcome). Append-only; the latest line per product decides.
//   report   reportRows(projectDir), joined by completion-report.js:
//            product-video-manual       Cutover Operator adds each linked video by hand.
//            product-video-not-attached a planned video file is not on its product (failed, not
//                                       verified, or the step never ran). Requires Import Operator.

const fs = require('node:fs');
const path = require('node:path');

const PLAN_PATH = 'execution/product-videos.json';
const OUTCOMES_PATH = 'state/product-videos/outcomes.ndjson';
const MANUAL_CODE = 'product-video-manual';
const NOT_ATTACHED_CODE = 'product-video-not-attached';
// Outcomes of attachStoresProductVideos that leave nothing to do.
const DONE = new Set(['attached', 'already-attached', 'nothing-to-attach']);
const KNOWN = new Set([...DONE, 'partial', 'unverified', 'deferred', 'failed']);

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function writeProductVideoPlan(projectDir, { attach = [], manual = [] }, { generatedAt = new Date().toISOString(), source = null } = {}) {
  const doc = { schemaVersion: 1, generatedAt, source, attach, manual };
  writeAtomic(path.join(projectDir, PLAN_PATH), `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function readProductVideoPlan(projectDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(projectDir, PLAN_PATH), 'utf8'));
    if (doc.schemaVersion !== 1 || !Array.isArray(doc.attach) || !Array.isArray(doc.manual)) {
      throw new Error(`${PLAN_PATH}: expected schemaVersion 1 with attach[] and manual[]`);
    }
    return doc;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function recordProductVideoOutcome(projectDir, { productSourceId, productId, result, recordedAt = new Date().toISOString() }) {
  if (productSourceId === undefined || productSourceId === null || productSourceId === '') throw new Error('recordProductVideoOutcome: productSourceId is required');
  if (!result || !KNOWN.has(result.status)) throw new Error(`recordProductVideoOutcome: unknown status ${result && result.status}`);
  const line = {
    productSourceId: String(productSourceId),
    productId: productId ? String(productId) : null,
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    videos: (result.videos || []).map(({ url, fileId, status, error }) => ({ url: url || null, fileId: fileId || null, status, ...(error ? { error } : {}) })),
    recordedAt,
  };
  const file = path.join(projectDir, OUTCOMES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  return line;
}

function latestOutcomes(projectDir) {
  let text;
  try { text = fs.readFileSync(path.join(projectDir, OUTCOMES_PATH), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const latest = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    latest.set(String(row.productSourceId), row);
  }
  return latest;
}

// The plan row's videos, each with the Wix Media file id its latest recorded outcome holds
// (status ready or landed). Pass the result to attachStoresProductVideos so a re-run after a
// partial or unverified attach skips what is on the product and never imports a file twice.
function videosWithRecordedFiles(projectDir, row) {
  const outcome = latestOutcomes(projectDir).get(String(row.productSourceId));
  const files = new Map((outcome?.videos || [])
    .filter((video) => video.url && video.fileId && (video.status === 'ready' || video.status === 'landed'))
    .map((video) => [video.url, video.fileId]));
  return (row.videos || []).map((video) => (files.has(video.url) ? { ...video, fileId: files.get(video.url) } : { ...video }));
}

function reportRows(projectDir) {
  const plan = readProductVideoPlan(projectDir);
  const operatorActions = [];
  if (!plan) return { operatorActions };
  if (plan.manual.length) {
    const products = [...new Set(plan.manual.map((row) => row.productSourceId))];
    operatorActions.push({
      actionId: 'product-video:manual', code: MANUAL_CODE, severity: 'medium', role: 'cutover-operator', entity: 'stores/product',
      action: `Cutover Operator: ${plan.manual.length} product video link(s) on ${products.length} product(s) (YouTube, Vimeo or other) cannot be product media in Wix. In Business Manager > Store Products, open each product (source ids in affectedIds; product name and link in ${PLAN_PATH} manual[]) and add the video by hand.`,
      deadlineReason: 'before switching traffic; these product pages show no video until it is added', affectedCount: products.length, affectedIds: products,
      artifactRefs: [PLAN_PATH], prerequisites: ['The products are imported.'],
      resolutionEvidence: 'Each listed product shows its video on the Wix product page.',
    });
  }
  const latest = latestOutcomes(projectDir);
  const open = plan.attach.filter((row) => !DONE.has(latest.get(String(row.productSourceId))?.status));
  if (open.length) {
    const ids = open.map((row) => String(row.productSourceId));
    const neverRan = open.filter((row) => !latest.has(String(row.productSourceId))).length;
    operatorActions.push({
      actionId: 'product-video:not-attached', code: NOT_ATTACHED_CODE, severity: 'high', role: 'import-operator', entity: 'stores/product',
      action: `Requires Import Operator: ${open.length} product(s) have a video file that is not on the Wix product yet${neverRan ? ` (${neverRan} never attempted)` : ''} (source ids in affectedIds).`,
      importOperatorPrompt: `Resolve ${NOT_ATTACHED_CODE}: for each product in ${PLAN_PATH} attach[] whose latest line in ${OUTCOMES_PATH} is not attached, run the product video step again (rp-target-wix attachStoresProductVideos under the product's grant) and record the outcome.`,
      deadlineReason: 'before switching traffic; these product pages are missing their video', affectedCount: open.length, affectedIds: ids,
      artifactRefs: [PLAN_PATH, OUTCOMES_PATH], resolutionEvidence: `The latest outcome for each product is attached or already-attached.`,
    });
  }
  return { operatorActions };
}

module.exports = {
  PLAN_PATH, OUTCOMES_PATH, MANUAL_CODE, NOT_ATTACHED_CODE,
  writeProductVideoPlan, readProductVideoPlan, recordProductVideoOutcome, latestOutcomes, videosWithRecordedFiles, reportRows,
};
