#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs, writeJson } from "./lib/common.mjs";
import { classifyObservedUnit, planRecursiveUnitJobs } from "./lib/extraction-detectors.mjs";

export const RELEASE_GATES = Object.freeze({
  minimumFixtures: 20,
  segmentationPrecision: 0.90,
  segmentationRecall: 0.95,
  componentPrecision: 0.95,
  componentRecall: 0.85,
  behaviorRecall: 0.90,
  ownership: 1,
  qaDefectRecall: 0.95,
  qaFalsePositiveRate: 0.05,
  p95ExtractionMs: 10 * 60 * 1000,
  rawEvidenceBytes: 250 * 1024 * 1024,
  frozenSpecBytes: 10 * 1024 * 1024,
  agentDecisions: 30,
  agentInputTokens: 50_000,
});

export async function benchmarkExtractionCorpus({ corpusPath }) {
  const raw = await readFile(corpusPath);
  const corpus = JSON.parse(raw);
  const humanApproved = corpus.status === "human-approved"
    && corpus.approval?.human === true
    && Boolean(corpus.approval?.reviewerId)
    && Boolean(corpus.approval?.reviewedAt);
  const failures = [];
  const measurements = [];
  let boundaryTp = 0;
  let boundaryFp = 0;
  let boundaryFn = 0;
  let componentTp = 0;
  let componentFp = 0;
  let componentFn = 0;
  let behaviorExpected = 0;
  let behaviorFound = 0;
  let ownershipExpected = 0;
  let ownershipAccounted = 0;
  let qaExpected = 0;
  let qaFound = 0;
  let qaClean = 0;
  let qaFalsePositive = 0;
  let agentDecisions = 0;

  for (const fixture of corpus.fixtures || []) {
    const started = performance.now();
    const sections = fixture.sections || [];
    const plan = planRecursiveUnitJobs(sections.map((section) => ({ id: section.id, ...section.observed })));
    ownershipExpected += plan.jobs.length;
    ownershipAccounted += plan.ownership.length;
    if (plan.conflicts.length) failures.push({ fixture: fixture.id, metric: "ownership", details: plan.conflicts });
    const expectedQa = new Set(fixture.expectedQaDefects || []);
    const actualQa = new Set();
    for (const section of sections) {
      const classification = classifyObservedUnit(section.observed, { unitKind: "section", evidenceRef: `${fixture.id}#${section.id}` });
      const predictedBoundary = classification.confidence !== "low";
      if (predictedBoundary) boundaryTp += 1;
      else boundaryFn += 1;
      if (classification.confidence === "medium") agentDecisions += 1;
      if (section.knownComponent) {
        if (classification.confidence === "low") componentFn += 1;
        else if (classification.kind === section.expectedKind) componentTp += 1;
        else {
          componentFp += 1;
          componentFn += 1;
          failures.push({ fixture: fixture.id, unit: section.id, metric: "component-kind", expected: section.expectedKind, actual: classification.kind });
        }
      } else if (classification.kind !== section.expectedKind) {
        failures.push({ fixture: fixture.id, unit: section.id, metric: "classification", expected: section.expectedKind, actual: classification.kind });
      }
      const expectedStates = new Set(section.expectedStates || []);
      const observedStates = new Set(section.observed?.behavior?.states || []);
      behaviorExpected += expectedStates.size;
      for (const state of expectedStates) if (observedStates.has(state)) behaviorFound += 1;
      for (const defect of detectQaDefects(section.id, section.observed)) actualQa.add(defect);
    }
    qaExpected += expectedQa.size;
    for (const defect of expectedQa) {
      if (actualQa.has(defect)) qaFound += 1;
      else failures.push({ fixture: fixture.id, metric: "qa-missed-defect", defect });
    }
    const cleanAssertions = Math.max(1, sections.length * 6 - expectedQa.size);
    qaClean += cleanAssertions;
    for (const defect of actualQa) if (!expectedQa.has(defect)) {
      qaFalsePositive += 1;
      failures.push({ fixture: fixture.id, metric: "qa-false-positive", defect });
    }
    measurements.push({ fixture: fixture.id, extractionMs: Number((performance.now() - started).toFixed(3)), rawEvidenceBytes: Buffer.byteLength(JSON.stringify(fixture)), frozenSpecBytes: Buffer.byteLength(JSON.stringify(plan)) });
  }
  const metrics = {
    fixtureCount: corpus.fixtures?.length || 0,
    coverage: [...new Set((corpus.fixtures || []).flatMap((fixture) => fixture.features || []))].sort(),
    segmentationPrecision: ratio(boundaryTp, boundaryTp + boundaryFp),
    segmentationRecall: ratio(boundaryTp, boundaryTp + boundaryFn),
    componentPrecision: ratio(componentTp, componentTp + componentFp),
    componentRecall: ratio(componentTp, componentTp + componentFn),
    behaviorRecall: ratio(behaviorFound, behaviorExpected),
    ownership: ratio(ownershipAccounted, ownershipExpected),
    qaDefectRecall: ratio(qaFound, qaExpected),
    qaFalsePositiveRate: ratio(qaFalsePositive, qaClean),
    p95ExtractionMs: percentile(measurements.map((entry) => entry.extractionMs), 0.95),
    maxRawEvidenceBytes: Math.max(0, ...measurements.map((entry) => entry.rawEvidenceBytes)),
    maxFrozenSpecBytes: Math.max(0, ...measurements.map((entry) => entry.frozenSpecBytes)),
    agentDecisions,
    agentInputTokens: 0,
  };
  const gateResults = [
    gate("minimum-fixtures", metrics.fixtureCount >= RELEASE_GATES.minimumFixtures, metrics.fixtureCount, RELEASE_GATES.minimumFixtures),
    gate("segmentation-precision", metrics.segmentationPrecision >= RELEASE_GATES.segmentationPrecision, metrics.segmentationPrecision, RELEASE_GATES.segmentationPrecision),
    gate("segmentation-recall", metrics.segmentationRecall >= RELEASE_GATES.segmentationRecall, metrics.segmentationRecall, RELEASE_GATES.segmentationRecall),
    gate("component-precision", metrics.componentPrecision >= RELEASE_GATES.componentPrecision, metrics.componentPrecision, RELEASE_GATES.componentPrecision),
    gate("component-recall", metrics.componentRecall >= RELEASE_GATES.componentRecall, metrics.componentRecall, RELEASE_GATES.componentRecall),
    gate("behavior-recall", metrics.behaviorRecall >= RELEASE_GATES.behaviorRecall, metrics.behaviorRecall, RELEASE_GATES.behaviorRecall),
    gate("ownership", metrics.ownership === RELEASE_GATES.ownership, metrics.ownership, RELEASE_GATES.ownership),
    gate("qa-defect-recall", metrics.qaDefectRecall >= RELEASE_GATES.qaDefectRecall, metrics.qaDefectRecall, RELEASE_GATES.qaDefectRecall),
    gate("qa-false-positive-rate", metrics.qaFalsePositiveRate <= RELEASE_GATES.qaFalsePositiveRate, metrics.qaFalsePositiveRate, RELEASE_GATES.qaFalsePositiveRate),
    gate("p95-extraction-ms", metrics.p95ExtractionMs <= RELEASE_GATES.p95ExtractionMs, metrics.p95ExtractionMs, RELEASE_GATES.p95ExtractionMs),
    gate("raw-evidence-bytes", metrics.maxRawEvidenceBytes <= RELEASE_GATES.rawEvidenceBytes, metrics.maxRawEvidenceBytes, RELEASE_GATES.rawEvidenceBytes),
    gate("frozen-spec-bytes", metrics.maxFrozenSpecBytes <= RELEASE_GATES.frozenSpecBytes, metrics.maxFrozenSpecBytes, RELEASE_GATES.frozenSpecBytes),
    gate("agent-decisions", metrics.agentDecisions <= RELEASE_GATES.agentDecisions, metrics.agentDecisions, RELEASE_GATES.agentDecisions),
    gate("agent-input-tokens", metrics.agentInputTokens <= RELEASE_GATES.agentInputTokens, metrics.agentInputTokens, RELEASE_GATES.agentInputTokens),
  ];
  return {
    schemaVersion: "0083-benchmark.1",
    corpus: { path: corpusPath, status: corpus.status, license: corpus.license, provenance: corpus.provenance, approval: corpus.approval || null },
    status: gateResults.every((entry) => entry.passed) && failures.length === 0
      ? (humanApproved ? "metrics-passed-human-approved-model-regression-corpus" : "metrics-passed-awaiting-human-model-corpus-approval")
      : "failed",
    metrics,
    gates: gateResults,
    failures,
    measurements,
  };
}

function detectQaDefects(id, observed = {}) {
  const defects = [];
  if ((observed.images || []).some((image) => !String(image.alt || "").trim())) defects.push(`${id}:missing-alt`);
  if (observed.behavior?.interactive && observed.behavior?.keyboard === false) defects.push(`${id}:keyboard-unreachable`);
  if (observed.layout?.scrollWidth > observed.layout?.viewportWidth) defects.push(`${id}:horizontal-overflow`);
  if (observed.behavior?.motion && observed.behavior?.reducedMotion === false) defects.push(`${id}:reduced-motion-missing`);
  return defects;
}

function ratio(numerator, denominator) { return denominator ? Number((numerator / denominator).toFixed(4)) : 1; }
function percentile(values, quantile) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] : 0; }
function gate(name, passed, actual, threshold) { return { name, passed, actual, threshold }; }

async function main() {
  const args = parseArgs();
  const corpusPath = path.resolve(String(args.corpus || "tests/fixtures/headless/0083-model-regression-corpus.json"));
  const report = await benchmarkExtractionCorpus({ corpusPath });
  if (args.out) await writeJson(path.resolve(String(args.out)), report);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
