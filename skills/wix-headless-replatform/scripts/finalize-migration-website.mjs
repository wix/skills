#!/usr/bin/env node
import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { parseArgs, readJson } from "./lib/common.mjs";

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function createMigrationWebsiteCompletion({ handoffPath = null, projectDir = null, outputDir, releaseUrl, releaseNotApplicable = false, doneWithGaps = false, iteration = null }) {
  if (!handoffPath && !projectDir) throw new Error("--handoff or --project-dir is required");
  if (!outputDir) throw new Error("A migration frontend output directory is required");
  const handoff = handoffPath ? await readJson(handoffPath) : null;
  if (handoffPath && !handoff?.handoffFingerprint) throw new Error("website/handoff.json is missing handoffFingerprint; refresh the handoff first");
  const gapPath = iteration
    ? path.join(outputDir, "docs", "site-clone", "gap-analysis", "iterations", String(iteration).padStart(3, "0"), "gap-analysis.json")
    : path.join(outputDir, "docs", "site-clone", "gap-analysis", "latest.json");
  const gap = await readJson(gapPath);
  const finalReportPath = path.join(outputDir, "docs", "site-clone", "final-report.json");
  const finalReport = await readOptionalJson(finalReportPath);
  if (finalReport?.status === "blocked") throw new Error("The frozen extraction final report contains a global blocker");
  const effectiveDoneWithGaps = doneWithGaps || finalReport?.status === "done_with_gaps";
  if (gap?.visualReview?.status !== "reviewed") {
    throw new Error("Post-build gap review has not passed; run/finalize the gap loop before finalizing the website");
  }
  const findings = Array.isArray(gap.findings) ? gap.findings : [];
  const unresolved = findings.filter((finding) => finding.status !== "resolved" && finding.status !== "accepted");
  const unresolvedCritical = unresolved.filter((finding) => finding.severity === "critical").length;
  const unresolvedHigh = unresolved.filter((finding) => finding.severity === "high").length;
  if (!effectiveDoneWithGaps && (!gap?.acceptance?.passed || unresolvedCritical || unresolvedHigh)) throw new Error("Post-build gap review still has unresolved critical/high findings");
  if (doneWithGaps && !iteration && !finalReport) throw new Error("--done-with-gaps requires --iteration or a frozen final report so the terminal evidence is explicit");
  const automationState = await readJson(path.join(outputDir, "docs", "site-clone", "frontend-automation-state.json"));
  const facelift = automationState?.checkpoints?.facelift;
  if (!effectiveDoneWithGaps && facelift?.requested && facelift.status !== "accepted") {
    throw new Error("Optional facelift was requested but has not been accepted; complete the separate facelift review first");
  }
  if (!releaseUrl && !releaseNotApplicable) throw new Error("--release-url is required unless --release-not-applicable is explicitly set");

  const receipt = {
    schemaVersion: 1,
    status: effectiveDoneWithGaps ? "done_with_gaps" : unresolved.length ? "complete_with_warnings" : "complete",
    handoffFingerprint: handoff?.handoffFingerprint || null,
    extractionManifestHash: finalReport?.manifestHash || null,
    frontendProjectDir: path.relative(projectDir || path.dirname(path.dirname(handoffPath)), outputDir) || ".",
    phase: effectiveDoneWithGaps ? finalReport?.status === "done_with_gaps" ? "provisional_handoff" : "gap_cycle_cap" : "release",
    gapAnalysis: {
      latestIteration: gap.iteration,
      cycleCap: doneWithGaps ? 5 : null,
      screenshotReview: "complete",
      unresolvedCritical,
      unresolvedHigh,
      residualFindings: unresolved.map((finding) => ({ id: finding.id, severity: finding.severity, message: finding.message })),
    },
    facelift: effectiveDoneWithGaps ? { status: "not_run", reason: finalReport?.status === "done_with_gaps" ? "provisional_units_remain" : "maximum_gap_cycles_reached" } : facelift?.requested ? { status: "accepted" } : { status: "not_requested" },
    release: releaseNotApplicable ? { status: "not_applicable", url: null } : { status: "released", url: releaseUrl },
    artifactRefs: [path.relative(projectDir || path.dirname(path.dirname(handoffPath)), gapPath), ...(finalReport ? [path.relative(projectDir || path.dirname(path.dirname(handoffPath)), finalReportPath)] : []), ...(gap.paths?.visualProgress ? [gap.paths.visualProgress] : []), ...(gap.visualReview?.artifactPath ? [gap.visualReview.artifactPath] : [])],
    updatedAt: new Date().toISOString(),
  };
  const receiptPath = handoffPath
    ? path.join(path.dirname(handoffPath), "completion.json")
    : path.join(projectDir, "website", "completion.json");
  await writeJsonAtomic(receiptPath, receipt);
  return { receiptPath, receipt };
}

async function readOptionalJson(filePath) {
  try { return await readJson(filePath); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs();
  const handoffPath = args.handoff ? path.resolve(String(args.handoff)) : null;
  const projectDir = args["project-dir"] ? path.resolve(String(args["project-dir"])) : null;
  const handoff = handoffPath ? await readJson(handoffPath) : null;
  const outputDir = args.out
    ? path.resolve(String(args.out))
    : handoff?.destination?.frontendProjectDir
      ? path.resolve(String(handoff.destination.frontendProjectDir))
      : null;
  const result = await createMigrationWebsiteCompletion({
    handoffPath,
    projectDir,
    outputDir,
    releaseUrl: args["release-url"] ? String(args["release-url"]) : null,
    releaseNotApplicable: args["release-not-applicable"] === true || args["release-not-applicable"] === "true",
    doneWithGaps: args["done-with-gaps"] === true || args["done-with-gaps"] === "true",
    iteration: args.iteration ? Number(args.iteration) : null,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
