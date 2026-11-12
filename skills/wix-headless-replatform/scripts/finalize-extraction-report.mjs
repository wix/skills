#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, writeJson, writeText } from "./lib/common.mjs";
import { EXTRACTION_SCHEMA_VERSION, assertValidArtifact } from "./lib/extraction-contract.mjs";

export async function finalizeExtractionReport({ outputDir }) {
  const docs = docsDir(outputDir);
  const latest = await readJson(path.join(docs, "extraction", "latest.json"));
  const extractionDir = path.join(docs, "extraction", latest.captureId);
  const manifest = await readJson(path.join(extractionDir, "extraction-manifest.json"));
  const gapArtifact = await readJson(path.join(extractionDir, "extraction-gaps.json"));
  const decisionArtifact = await optionalJson(path.join(docs, "gap-decisions.json"), { manifestHash: latest.manifestHash, decisions: [] });
  if (decisionArtifact.manifestHash !== latest.manifestHash) throw new Error("Gap decisions refer to a stale frozen manifest");
  const decisions = new Map((decisionArtifact.decisions || []).map((decision) => [decision.gapId, decision]));
  const ledger = await optionalJson(path.join(docs, "build", "section-implementation.json"), { units: [] });
  const qa = await optionalJson(path.join(docs, "qa", "visual-qa.json"), null);
  const gapReview = await optionalJson(path.join(docs, "gap-analysis", "latest.json"), null);
  const gaps = (gapArtifact.gaps || []).filter((gap) => gap.status !== "resolved").map((gap) => {
    const implementation = ledger.units?.find((unit) => unit.id === gap.ownerUnitId);
    return {
      id: gap.id,
      unitId: gap.ownerUnitId,
      scope: gap.scope,
      status: gap.status,
      reason: gap.reason,
      missingFields: gap.missingFields,
      confidence: gap.confidence,
      evidenceRefs: gap.evidenceRefs,
      recoveryAttempts: gap.attempts,
      remainingAttempts: gap.remainingAttempts,
      assumptions: gap.assumptions,
      omissions: gap.omissions,
      affectedAcceptance: gap.affectedAcceptance,
      dependencyClosure: gap.dependencyClosure,
      implementation: implementation ? { status: implementation.status, cloneRoot: implementation.cloneRoot } : null,
      userDecision: decisions.get(gap.id) || gap.userDecision,
      choices: ["accept-as-is", "retry-or-fix", "provide-material", "replace", "omit", "leave-unresolved"],
      unblockAction: gap.unblockAction,
    };
  });
  const unresolvedGlobal = gaps.filter((gap) => gap.scope === "global");
  const provisional = gaps.filter((gap) => gap.scope === "local" && !["accept-as-is", "replace", "omit"].includes(gap.userDecision?.decision));
  const browserVerified = Boolean(gapReview?.acceptance?.passed && ["reviewed", "not-applicable"].includes(gapReview?.visualReview?.status));
  const implementationExists = Boolean(ledger.units?.length);
  const status = unresolvedGlobal.length ? "blocked" : provisional.length ? "done_with_gaps" : browserVerified ? "done" : qa || implementationExists ? "verification_pending" : "implementation_pending";
  const report = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "final-report",
    captureId: latest.captureId,
    manifestHash: manifest.manifestHash,
    status,
    summary: {
      totalGaps: gaps.length,
      provisionalGaps: provisional.length,
      globalBlockers: unresolvedGlobal.length,
      acceptedUnits: manifest.specs.filter((spec) => spec.status === "accepted").length,
      provisionalUnits: manifest.specs.filter((spec) => spec.status === "provisional").length,
    },
    gaps,
    qa: qa || gapReview ? {
      preflightScore: qa?.score ?? null,
      warnings: qa?.warnings || [],
      provisionalUnits: qa?.provisionalUnits || [],
      browserReview: gapReview ? { iteration: gapReview.iteration, passed: Boolean(gapReview.acceptance?.passed), status: gapReview.visualReview?.status, blockingCount: gapReview.summary?.blockingCount } : null,
    } : null,
  };
  assertValidArtifact(report, "final-report");
  await writeJson(path.join(docs, "final-report.json"), report);
  await writeText(path.join(docs, "final-report.md"), renderFinalReport(report));
  return report;
}

export function renderFinalReport(report) {
  const lines = [
    "# Home-page reconstruction report",
    "",
    `- Status: \`${report.status}\``,
    `- Frozen manifest: \`${report.manifestHash}\``,
    `- Accepted units: ${report.summary.acceptedUnits}`,
    `- Provisional units: ${report.summary.provisionalUnits}`,
    `- Unresolved local gaps: ${report.summary.provisionalGaps}`,
    `- Global blockers: ${report.summary.globalBlockers}`,
    "",
  ];
  if (!report.gaps.length) {
    lines.push("No extraction gaps remain. Browser-backed verification is still required before final clone acceptance.", "");
  } else {
    lines.push("## Gaps requiring review", "");
    for (const gap of report.gaps) {
      lines.push(
        `### ${gap.unitId}`,
        "",
        `This unit could not be imported reliably because ${lowerFirst(gap.reason)}`,
        "",
        `- Gap: \`${gap.id}\` (${gap.scope}, ${gap.status}, confidence: ${gap.confidence})`,
        `- Missing: ${gap.missingFields.join(", ") || "unspecified evidence"}`,
        `- Attempts: ${gap.recoveryAttempts.length}; remaining budget: ${gap.remainingAttempts}`,
        `- Provisional implementation: ${gap.implementation?.status || "not implemented"}${gap.implementation?.cloneRoot ? ` at \`${gap.implementation.cloneRoot}\`` : ""}`,
        `- Assumptions: ${gap.assumptions.join("; ") || "none"}`,
        `- Omissions: ${gap.omissions.join("; ") || "none"}`,
        `- Affected checks: ${gap.affectedAcceptance.join(", ") || "none recorded"}`,
        `- User decision: ${gap.userDecision ? `\`${gap.userDecision.decision}\`${gap.userDecision.note ? ` — ${gap.userDecision.note}` : ""}` : "pending"}`,
        `- Available decisions: ${gap.choices.map((choice) => `\`${choice}\``).join(", ")}`,
        "",
      );
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function lowerFirst(value) {
  const text = String(value || "evidence was incomplete");
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

async function optionalJson(filePath, fallback) {
  try { return await readJson(filePath); } catch { return fallback; }
}

async function main() {
  const args = parseArgs();
  if (!args.out) throw new Error("--out is required");
  console.log(JSON.stringify(await finalizeExtractionReport({ outputDir: path.resolve(String(args.out)) }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
