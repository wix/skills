#!/usr/bin/env node
import path from "node:path";
import { readdir } from "node:fs/promises";
import { assembleExtraction } from "./assemble-extraction.mjs";
import { docsDir, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { EXTRACTION_SCHEMA_VERSION, semanticHash, verifyFrozenManifest } from "./lib/extraction-contract.mjs";
import { CONTENT_EXTRACTION_SEMANTICS_VERSION } from "./lib/content-boundary.mjs";

const REQUIRED_PACKET_TYPES = new Set([
  "page", "assets", "seo", "tokens", "interaction-map", "scene-contract",
  "layout-blueprint", "ui-normalization", "control-state-contract", "visual-assets",
]);

export async function replayExtraction({ outputDir, captureId, decisionPatches = [] }) {
  const docs = docsDir(outputDir);
  const latest = captureId ? null : await readJson(path.join(docs, "extraction", "latest.json"));
  const sourceCaptureId = captureId || latest.captureId;
  const sourceDir = path.join(docs, "extraction", sourceCaptureId);
  const integrity = await verifyFrozenManifest(sourceDir);
  if (!integrity.ok) throw new Error(`Cannot replay corrupt extraction: ${integrity.failures.join("; ")}`);
  const pageResolution = await readJson(path.join(sourceDir, "page-resolution.spec.json"));
  const pageCapture = await readJson(path.join(sourceDir, "page-capture.spec.json"));
  const capturedContentSemantics = pageCapture.extensions?.["wix.replatform.content-boundary"]?.semanticsVersion;
  if (capturedContentSemantics !== CONTENT_EXTRACTION_SEMANTICS_VERSION) {
    throw new Error(`Capture ${sourceCaptureId} uses obsolete content-extraction semantics (${capturedContentSemantics || "unversioned"}); recapture the source page before replay.`);
  }
  const packetDir = path.join(sourceDir, "observations", "packets");
  const packetFiles = (await readdir(packetDir)).filter((name) => name.endsWith(".packet.json")).sort();
  const packets = new Map();
  for (const file of packetFiles) {
    const packet = await readJson(path.join(packetDir, file));
    if (packet.schemaVersion !== EXTRACTION_SCHEMA_VERSION || packet.kind !== "observation-packet") {
      throw new Error(`Invalid observation packet: ${file}`);
    }
    if (packet.sourceFingerprint !== pageCapture.sourceFingerprint) {
      throw new Error(`Packet source fingerprint changed: ${file}`);
    }
    packets.set(packet.packetType, packet.payload);
  }
  const missing = [...REQUIRED_PACKET_TYPES].filter((type) => !packets.has(type));
  if (missing.length) throw new Error(`Replay requires missing packet type(s): ${missing.join(", ")}`);
  const page = structuredClone(packets.get("page"));
  for (const [name, screenshotRef] of Object.entries(page.screenshots || {})) {
    page.screenshots[name] = path.join(sourceDir, "observations", screenshotRef);
  }
  const packetHashes = integrity.manifest.observationRefs
    .filter((entry) => entry.ref.startsWith("observations/packets/"))
    .map((entry) => ({ ref: entry.ref, hash: entry.hash }));
  const replayKey = semanticHash({
    sourceCaptureId,
    sourceFingerprint: pageCapture.sourceFingerprint,
    packetHashes,
    decisionPatches,
  }).slice(0, 12);
  const replayCaptureId = `${sourceCaptureId}-replay-${replayKey}`;
  const result = await assembleExtraction({
    outputDir,
    requestedUrl: pageResolution.source.requestedUrl,
    resolvedUrl: pageResolution.source.resolvedUrl,
    canonicalUrl: pageResolution.source.canonicalUrl,
    page,
    assets: packets.get("assets"),
    seo: packets.get("seo"),
    tokens: packets.get("tokens"),
    interactionMap: packets.get("interaction-map"),
    sceneContract: packets.get("scene-contract"),
    layoutBlueprint: packets.get("layout-blueprint"),
    uiNormalization: packets.get("ui-normalization"),
    controlStateContract: packets.get("control-state-contract"),
    visualAssets: packets.get("visual-assets"),
    sourceFingerprint: pageCapture.sourceFingerprint,
    sourceFingerprintIncludesContentSemantics: true,
    captureId: replayCaptureId,
    decisionPatches,
    pageResolutionArtifact: pageResolution,
  });
  const sourceHashes = new Map(integrity.manifest.specs.map((entry) => [entry.id, entry.hash]));
  const changedSpecs = result.manifest.specs
    .filter((entry) => sourceHashes.get(entry.id) !== entry.hash)
    .map((entry) => ({ id: entry.id, before: sourceHashes.get(entry.id) || null, after: entry.hash }));
  const report = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    sourceCaptureId,
    replayCaptureId,
    sourceFingerprint: pageCapture.sourceFingerprint,
    reopenedSource: false,
    packetCount: packetFiles.length,
    changedSpecs,
    manifestHash: result.manifest.manifestHash,
  };
  await writeJson(path.join(result.extractionDir, "replay-report.json"), report);
  return { ...result, replayReport: report };
}

async function main() {
  const args = parseArgs();
  if (!args.out) throw new Error("--out is required");
  const patches = args["decision-patches"] ? await readJson(path.resolve(String(args["decision-patches"]))) : [];
  const result = await replayExtraction({
    outputDir: path.resolve(String(args.out)),
    captureId: args.capture ? String(args.capture) : undefined,
    decisionPatches: Array.isArray(patches) ? patches : patches.patches || [],
  });
  console.log(JSON.stringify(result.replayReport, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
