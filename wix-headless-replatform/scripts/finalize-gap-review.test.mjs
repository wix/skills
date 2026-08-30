import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeGapReview } from "./finalize-gap-review.mjs";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "gap-review-"));
  const iterationDir = path.join(outputDir, "docs", "site-clone", "gap-analysis", "iterations", "001");
  const reportPath = path.join(iterationDir, "gap-analysis.json");
  const report = {
    iteration: 1,
    summary: { score: 90, findingCount: 1, counts: { critical: 0, high: 0, medium: 1, low: 0 }, blockingCount: 0, finalAcceptance: false },
    findings: [{ id: "gap-001", severity: "medium", status: "open", category: "layout", message: "Example", scope: {}, repairHint: "Fix" }],
    screenshotPairs: [{ id: "home-desktop", page: "/", viewport: "desktop", source: { path: "source.png" }, result: { path: "result.png" } }],
    visualReview: { status: "pending", required: true, reviewedPairs: [], notes: [] },
    fixOrder: [],
    acceptance: { passed: false },
    paths: { reportJson: reportPath, reportMarkdown: path.join(iterationDir, "gap-analysis.md"), fixPlan: path.join(iterationDir, "gap-fix-plan.md") },
  };
  await writeJson(reportPath, report);
  await writeJson(path.join(outputDir, "docs", "site-clone", "gap-analysis", "latest.json"), report);
  await writeJson(path.join(iterationDir, "iteration-manifest.json"), { iteration: 1, status: "comparison-complete-visual-review-pending" });
  return { outputDir, iterationDir };
}

test("finalizeGapReview rejects a missing visual review artifact", async () => {
  const { outputDir } = await fixture();
  try {
    await assert.rejects(() => finalizeGapReview({ outputDir }), /Missing required visual review evidence/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("finalizeGapReview records evidence and synchronizes the iteration manifest", async () => {
  const { outputDir, iterationDir } = await fixture();
  try {
    await writeJson(path.join(iterationDir, "visual-review.json"), {
      pairs: [{ pairId: "home-desktop", viewport: "desktop", observation: "The hero composition differs from the source.", verdict: "findings-recorded", findingIds: ["gap-001"] }],
    });
    const report = await finalizeGapReview({ outputDir });
    assert.equal(report.visualReview.status, "reviewed");
    assert.equal(report.visualReview.records[0].findingIds[0], "gap-001");
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(iterationDir, "iteration-manifest.json"), "utf8"));
    assert.equal(manifest.status, "visual-review-complete");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("finalizeGapReview requires traceable before/after proof after a prior blocking finding", async () => {
  const { outputDir, iterationDir } = await fixture();
  try {
    const reportPath = path.join(iterationDir, "gap-analysis.json");
    const report = JSON.parse(await (await import("node:fs/promises")).readFile(reportPath, "utf8"));
    const previousDir = path.join(outputDir, "docs", "site-clone", "gap-analysis", "iterations", "000");
    const previousReportPath = path.join(previousDir, "gap-analysis.json");
    await writeJson(previousReportPath, {
      iteration: 0,
      findings: [{ id: "gap-previous", severity: "high", status: "open" }],
      screenshotPairs: [{ id: "home-desktop", page: "/", viewport: "desktop", source: { path: "source.png" }, result: { path: "before.png" } }],
      paths: { reportJson: previousReportPath },
    });
    report.visualProgress = { required: true, status: "pending", previousIteration: 0, previousReportPath, previousBlockingFindingIds: ["gap-previous"] };
    report.paths.visualProgress = path.join(iterationDir, "visual-progress.json");
    await writeJson(reportPath, report);
    await writeJson(path.join(outputDir, "docs", "site-clone", "gap-analysis", "latest.json"), report);
    await writeJson(path.join(iterationDir, "visual-review.json"), {
      pairs: [{ pairId: "home-desktop", viewport: "desktop", observation: "The hero now matches.", verdict: "no-identity-gap", rationale: "No identity gap remains." }],
    });
    await assert.rejects(() => finalizeGapReview({ outputDir }), /Missing required visual progress proof/);
    await writeJson(report.paths.visualProgress, {
      entries: [{
        priorFindingId: "gap-previous",
        target: "Hero section",
        pairId: "home-desktop",
        sourceScreenshotPath: "source.png",
        beforeResultScreenshotPath: "before.png",
        afterResultScreenshotPath: "result.png",
        beforeObservation: "The hero heading was misplaced.",
        afterObservation: "The hero heading now aligns with the source.",
        verdict: "improved",
        evidence: "The same desktop screenshot pair shows the corrected heading alignment.",
      }],
    });
    const finalized = await finalizeGapReview({ outputDir });
    assert.equal(finalized.visualProgress.records[0].verdict, "improved");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
