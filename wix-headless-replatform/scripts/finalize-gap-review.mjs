#!/usr/bin/env node
import path from "node:path";
import { docsDir, normalizeUrl, parseArgs, readJson, resolveOutputDir, writeJson, writeText } from "./lib/common.mjs";
import { renderGapAnalysisMarkdown, renderGapFixPlan } from "./lib/gap-analysis.mjs";
import { finalizeExtractionReport } from "./finalize-extraction-report.mjs";

async function main() {
  const args = parseArgs();
  const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  if (args.reviewed === true || args.reviewed === "true") throw new Error("--reviewed is no longer supported; write the required visual-review.json evidence beside the canonical iteration report");
  const report = await finalizeGapReview({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else console.log(`[gap-analysis] visual review ${report.visualReview.status}; final acceptance ${report.acceptance.passed ? "passed" : "not yet passed"}`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function validateVisualReview({ review, report, reviewPath }) {
  if (!review || typeof review !== "object" || Array.isArray(review)) throw new Error(`Visual review must be a JSON object: ${reviewPath}`);
  if (!Array.isArray(review.pairs)) throw new Error(`Visual review must include a pairs array: ${reviewPath}`);
  const expectedPairs = new Map((report.screenshotPairs || []).map((pair) => [pair.id, pair]));
  const findingIds = new Set((report.findings || []).map((finding) => finding.id));
  const seen = new Set();
  const normalized = review.pairs.map((entry, index) => {
    const prefix = `visual review pair ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${prefix} must be an object`);
    const pairId = requireNonEmptyString(entry.pairId, `${prefix}.pairId`);
    const pair = expectedPairs.get(pairId);
    if (!pair) throw new Error(`${prefix} references unknown screenshot pair: ${pairId}`);
    if (seen.has(pairId)) throw new Error(`Visual review has duplicate screenshot pair: ${pairId}`);
    seen.add(pairId);
    const viewport = requireNonEmptyString(entry.viewport, `${prefix}.viewport`);
    if (viewport !== pair.viewport) throw new Error(`${prefix}.viewport must match ${pairId} (${pair.viewport})`);
    const observation = requireNonEmptyString(entry.observation, `${prefix}.observation`);
    const verdict = requireNonEmptyString(entry.verdict, `${prefix}.verdict`);
    const entryFindingIds = Array.isArray(entry.findingIds) ? entry.findingIds.map((id) => requireNonEmptyString(id, `${prefix}.findingIds`)) : [];
    if (new Set(entryFindingIds).size !== entryFindingIds.length) throw new Error(`${prefix}.findingIds contains duplicates`);
    for (const id of entryFindingIds) if (!findingIds.has(id)) throw new Error(`${prefix} links unknown finding: ${id}`);
    const rationale = typeof entry.rationale === "string" ? entry.rationale.trim() : "";
    if (verdict === "no-identity-gap") {
      if (entryFindingIds.length) throw new Error(`${prefix} cannot link findings for no-identity-gap`);
      if (!rationale) throw new Error(`${prefix}.rationale is required for no-identity-gap`);
    } else if (verdict === "findings-recorded") {
      if (!entryFindingIds.length) throw new Error(`${prefix}.findingIds is required for findings-recorded`);
    } else {
      throw new Error(`${prefix}.verdict must be findings-recorded or no-identity-gap`);
    }
    return { pairId, viewport, observation, verdict, findingIds: entryFindingIds, rationale: rationale || null };
  });
  const missing = [...expectedPairs.keys()].filter((pairId) => !seen.has(pairId));
  if (missing.length) throw new Error(`Visual review is incomplete: ${missing.join(", ")}`);
  return normalized;
}

async function validateVisualProgress({ progress, report, progressPath }) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) throw new Error(`Visual progress proof must be a JSON object: ${progressPath}`);
  if (!Array.isArray(progress.entries)) throw new Error(`Visual progress proof must include an entries array: ${progressPath}`);
  const expectedFindingIds = new Set(report.visualProgress?.previousBlockingFindingIds || []);
  const currentPairs = new Map((report.screenshotPairs || []).map((pair) => [pair.id, pair]));
  const previousReportPath = report.visualProgress?.previousReportPath;
  if (!previousReportPath) throw new Error("Visual progress proof is missing the prior canonical report path");
  const previousReport = await readJson(previousReportPath);
  const previousPairs = new Map((previousReport.screenshotPairs || []).map((pair) => [pair.id, pair]));
  const seen = new Set();
  const records = progress.entries.map((entry, index) => {
    const prefix = `visual progress entry ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${prefix} must be an object`);
    const priorFindingId = requireNonEmptyString(entry.priorFindingId, `${prefix}.priorFindingId`);
    if (!expectedFindingIds.has(priorFindingId)) throw new Error(`${prefix} references unknown prior blocking finding: ${priorFindingId}`);
    if (seen.has(priorFindingId)) throw new Error(`Visual progress proof has duplicate prior finding: ${priorFindingId}`);
    seen.add(priorFindingId);
    const target = requireNonEmptyString(entry.target, `${prefix}.target`);
    const pairId = requireNonEmptyString(entry.pairId, `${prefix}.pairId`);
    const currentPair = currentPairs.get(pairId);
    const previousPair = previousPairs.get(pairId);
    if (!currentPair || !previousPair) throw new Error(`${prefix}.pairId must exist in both the prior and current screenshot queues`);
    const sourceScreenshotPath = requireNonEmptyString(entry.sourceScreenshotPath, `${prefix}.sourceScreenshotPath`);
    const beforeResultScreenshotPath = requireNonEmptyString(entry.beforeResultScreenshotPath, `${prefix}.beforeResultScreenshotPath`);
    const afterResultScreenshotPath = requireNonEmptyString(entry.afterResultScreenshotPath, `${prefix}.afterResultScreenshotPath`);
    if (sourceScreenshotPath !== currentPair.source.path) throw new Error(`${prefix}.sourceScreenshotPath must match the canonical source screenshot for ${pairId}`);
    if (beforeResultScreenshotPath !== previousPair.result.path) throw new Error(`${prefix}.beforeResultScreenshotPath must match the prior iteration result screenshot for ${pairId}`);
    if (afterResultScreenshotPath !== currentPair.result.path) throw new Error(`${prefix}.afterResultScreenshotPath must match the current iteration result screenshot for ${pairId}`);
    const beforeObservation = requireNonEmptyString(entry.beforeObservation, `${prefix}.beforeObservation`);
    const afterObservation = requireNonEmptyString(entry.afterObservation, `${prefix}.afterObservation`);
    const evidence = requireNonEmptyString(entry.evidence, `${prefix}.evidence`);
    const verdict = requireNonEmptyString(entry.verdict, `${prefix}.verdict`);
    if (!["improved", "no-visible-improvement", "regressed"].includes(verdict)) throw new Error(`${prefix}.verdict must be improved, no-visible-improvement, or regressed`);
    return { priorFindingId, target, pairId, sourceScreenshotPath, beforeResultScreenshotPath, afterResultScreenshotPath, beforeObservation, afterObservation, verdict, evidence };
  });
  const missing = [...expectedFindingIds].filter((findingId) => !seen.has(findingId));
  if (missing.length) throw new Error(`Visual progress proof is incomplete: ${missing.join(", ")}`);
  return records;
}

export async function finalizeGapReview({ outputDir } = {}) {
  const gapRoot = path.join(docsDir(outputDir), "gap-analysis");
  const latest = await readJson(path.join(gapRoot, "latest.json"));
  const reportPath = latest.paths?.reportJson;
  if (!reportPath) throw new Error("Latest gap report does not include its canonical report path");
  const report = await readJson(reportPath);
  const reviewPath = path.join(path.dirname(reportPath), "visual-review.json");
  const reviewRequired = Boolean(report.visualReview?.required || report.screenshotPairs?.length);
  let reviewPairs = [];
  let progressRecords = [];
  if (reviewRequired) {
    let review;
    try {
      review = await readJson(reviewPath);
    } catch (error) {
      throw new Error(`Missing required visual review evidence at ${reviewPath}. Open every source/result pair and write visual-review.json before finalizing. (${error.message})`);
    }
    reviewPairs = validateVisualReview({ review, report, reviewPath });
    for (const pair of report.screenshotPairs || []) pair.reviewStatus = "reviewed";
    report.visualReview.status = "reviewed";
    report.visualReview.reviewedPairs = reviewPairs.map((entry) => entry.pairId);
    report.visualReview.records = reviewPairs;
    report.visualReview.artifactPath = reviewPath;
    report.visualReview.reviewedAt = new Date().toISOString();
  } else {
    report.visualReview.status = "not-applicable";
    report.visualReview.reviewedPairs = [];
    report.visualReview.records = [];
  }
  if (report.visualProgress?.required) {
    const progressPath = report.paths?.visualProgress || path.join(path.dirname(reportPath), "visual-progress.json");
    let progress;
    try {
      progress = await readJson(progressPath);
    } catch (error) {
      throw new Error(`Missing required visual progress proof at ${progressPath}. Compare the prior and current result screenshots before finalizing. (${error.message})`);
    }
    progressRecords = await validateVisualProgress({ progress, report, progressPath });
    report.visualProgress.status = "reviewed";
    report.visualProgress.records = progressRecords;
    report.visualProgress.artifactPath = progressPath;
    report.visualProgress.reviewedAt = new Date().toISOString();
  }
  const open = (report.findings || []).filter((finding) => finding.status !== "resolved" && finding.status !== "accepted");
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of open) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  report.summary.counts = counts;
  report.summary.blockingCount = counts.critical + counts.high;
  report.summary.findingCount = open.length;
  report.summary.score = Math.max(0, Math.round(100 - counts.critical * 25 - counts.high * 10 - counts.medium * 3 - counts.low));
  report.summary.finalAcceptance = report.summary.blockingCount === 0 && (!report.visualReview.required || report.visualReview.status === "reviewed");
  if (report.summary.finalAcceptance && report.visualProgress?.required && progressRecords.some((record) => record.verdict !== "improved")) {
    throw new Error("Cannot accept the iteration: a prior blocking finding was not proven improved by its before/after screenshot evidence");
  }
  report.acceptance.passed = report.summary.finalAcceptance;
  report.acceptance.finalizedAt = new Date().toISOString();
  await writeJson(reportPath, report);
  await writeText(report.paths.reportMarkdown, renderGapAnalysisMarkdown(report));
  await writeText(report.paths.fixPlan, renderGapFixPlan(report));
  await writeJson(path.join(gapRoot, "latest.json"), report);
  await writeText(path.join(gapRoot, "latest.md"), renderGapAnalysisMarkdown(report));
  const manifestPath = path.join(path.dirname(reportPath), "iteration-manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.status = "visual-review-complete";
  manifest.visualReview = { artifactPath: reviewRequired ? reviewPath : null, reviewedPairs: reviewPairs.map((entry) => entry.pairId), reviewedAt: report.visualReview.reviewedAt || null };
  manifest.visualProgress = { artifactPath: report.visualProgress?.artifactPath || null, reviewedAt: report.visualProgress?.reviewedAt || null, verdicts: progressRecords.map((entry) => ({ priorFindingId: entry.priorFindingId, verdict: entry.verdict })) };
  await writeJson(manifestPath, manifest);
  try {
    await readJson(path.join(docsDir(outputDir), "extraction", "latest.json"));
    await finalizeExtractionReport({ outputDir });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
