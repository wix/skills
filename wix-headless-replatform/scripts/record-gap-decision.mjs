#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { finalizeExtractionReport } from "./finalize-extraction-report.mjs";

export const GAP_DECISIONS = new Set(["accept-as-is", "retry-or-fix", "provide-material", "replace", "omit", "leave-unresolved"]);

export async function recordGapDecision({ outputDir, gapId, decision, note = "", materialRefs = [] }) {
  if (!gapId) throw new Error("gapId is required");
  if (!GAP_DECISIONS.has(decision)) throw new Error(`Unsupported gap decision: ${decision}`);
  const docs = docsDir(outputDir);
  const latest = await readJson(path.join(docs, "extraction", "latest.json"));
  const gaps = await readJson(path.join(docs, "extraction", latest.captureId, "extraction-gaps.json"));
  if (!(gaps.gaps || []).some((gap) => gap.id === gapId)) throw new Error(`Unknown extraction gap: ${gapId}`);
  const decisionPath = path.join(docs, "gap-decisions.json");
  let artifact;
  try { artifact = await readJson(decisionPath); } catch { artifact = { schemaVersion: "0083.1", manifestHash: latest.manifestHash, decisions: [] }; }
  if (artifact.manifestHash !== latest.manifestHash) throw new Error("Gap decisions belong to a stale frozen manifest; review the current final report first");
  const record = { gapId, decision, note, materialRefs };
  artifact.decisions = [...artifact.decisions.filter((item) => item.gapId !== gapId), record].sort((a, b) => a.gapId.localeCompare(b.gapId));
  await writeJson(decisionPath, artifact);
  const report = await finalizeExtractionReport({ outputDir });
  return { decisionPath, record, finalStatus: report.status };
}

async function main() {
  const args = parseArgs();
  if (!args.out || !args.gap || !args.decision) throw new Error("--out, --gap, and --decision are required");
  const materialRefs = String(args.material || "").split(",").map((item) => item.trim()).filter(Boolean);
  console.log(JSON.stringify(await recordGapDecision({
    outputDir: path.resolve(String(args.out)),
    gapId: String(args.gap),
    decision: String(args.decision),
    note: String(args.note || ""),
    materialRefs,
  }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
