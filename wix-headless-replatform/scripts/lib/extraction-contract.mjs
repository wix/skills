import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ensureDir, writeJson } from "./common.mjs";
import { validateGeneratedArtifact } from "./extraction-validators.generated.mjs";

export const EXTRACTION_SCHEMA_VERSION = "0083.1";
export const MAX_GAP_RECOVERY_ATTEMPTS = 2;
export const EXTRACTION_BUDGETS = Object.freeze({
  maxRawEvidenceBytes: 250 * 1024 * 1024,
  maxFrozenSpecBytes: 10 * 1024 * 1024,
  maxAgentDecisions: 30,
  maxAgentInputTokens: 50_000,
  maxExtractionMs: 10 * 60 * 1000,
});

const ARTIFACT_KINDS = new Set([
  "page-resolution",
  "observation-packet",
  "page-capture",
  "foundation",
  "metadata",
  "shared-chrome",
  "unit",
  "extraction-gap",
  "extraction-manifest",
  "build-plan",
  "final-report",
  "decision-request",
  "decision-patch",
]);

const NON_SEMANTIC_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "generatedAt",
  "capturedAt",
  "timestamp",
  "logs",
  "log",
]);

const ALLOWED_FIELDS = Object.freeze({
  "page-resolution": new Set(["schemaVersion", "kind", "id", "pageKey", "destinationRoute", "status", "source", "evidence", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  "page-capture": new Set(["schemaVersion", "kind", "id", "pageKey", "status", "sourceFingerprint", "viewportSet", "sectionOrder", "ignoredSurfaces", "normalizationActions", "observationRefs", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  foundation: new Set(["schemaVersion", "kind", "id", "pageKey", "status", "tokens", "fonts", "primitives", "globalCssIntent", "evidenceRefs", "acceptance", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  metadata: new Set(["schemaVersion", "kind", "id", "pageKey", "status", "document", "evidenceRefs", "acceptance", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  "shared-chrome": new Set(["schemaVersion", "kind", "id", "pageKey", "status", "header", "footer", "controls", "visualAssets", "behavior", "evidenceRefs", "acceptance", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  unit: new Set(["schemaVersion", "kind", "id", "unitKind", "pageKey", "parentUnitId", "order", "status", "classification", "scope", "content", "assets", "layers", "layout", "styleables", "behavior", "children", "reconstruction", "acceptance", "diagnostics", "provenance", "gapRefs", "dependencyHashes", "hash", "extensions"]),
  "extraction-gap": new Set(["schemaVersion", "kind", "id", "ownerUnitId", "scope", "status", "missingFields", "reason", "evidenceRefs", "confidence", "dependencyClosure", "affectedAcceptance", "attempts", "remainingAttempts", "assumptions", "omissions", "unblockAction", "userDecision", "extensions"]),
  "extraction-manifest": new Set(["schemaVersion", "kind", "captureId", "pageKey", "pageResolution", "pageCapture", "observationRefs", "specs", "gaps", "budgets", "status", "manifestHash", "extensions"]),
  "build-plan": new Set(["schemaVersion", "kind", "pageKey", "route", "manifestHash", "status", "units", "extensions"]),
  "final-report": new Set(["schemaVersion", "kind", "captureId", "manifestHash", "status", "summary", "gaps", "qa", "extensions"]),
  "decision-request": new Set(["schemaVersion", "kind", "id", "decisionType", "allowedChoices", "evidenceRefs", "detectorVersions", "responseSchema", "cacheKey", "extensions"]),
  "decision-patch": new Set(["schemaVersion", "kind", "requestId", "choice", "confidence", "reasonCodes", "extensions"]),
});

export function canonicalizeJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}

export function sha256(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalizeJson(value);
  return createHash("sha256").update(input).digest("hex");
}

export function semanticContent(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => semanticContent(item));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && (key === "absolutePath" || key.endsWith("AbsolutePath")) && path.isAbsolute(value)) {
      return path.basename(value);
    }
    return value;
  }
  const result = {};
  for (const childKey of Object.keys(value).sort()) {
    if (NON_SEMANTIC_KEYS.has(childKey)) continue;
    if (childKey === "hash" || childKey === "manifestHash" || childKey === "cacheKey") continue;
    result[childKey] = semanticContent(value[childKey], childKey);
  }
  return result;
}

export function semanticHash(artifact, dependencyHashes = []) {
  return sha256({
    artifact: semanticContent(artifact),
    dependencyHashes: [...dependencyHashes].sort(),
  });
}

export function createDecisionRequest({ id, decisionType, allowedChoices, evidenceRefs = [], detectorVersions = {}, responseSchema = {} }) {
  if (!id || !decisionType || !allowedChoices?.length) throw new Error("A decision request requires id, decisionType, and allowedChoices");
  const request = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "decision-request",
    id,
    decisionType,
    allowedChoices,
    evidenceRefs,
    detectorVersions,
    responseSchema,
    cacheKey: "",
  };
  request.cacheKey = semanticHash(request);
  assertValidArtifact(request, "decision-request");
  return request;
}

export function applyDecisionPatch(request, patch) {
  assertValidArtifact(request, "decision-request");
  assertValidArtifact(patch, "decision-patch");
  if (patch.requestId !== request.id) throw new Error(`Decision patch ${patch.requestId} does not match ${request.id}`);
  if (!request.allowedChoices.some((choice) => canonicalizeJson(choice) === canonicalizeJson(patch.choice))) {
    throw new Error("Decision patch choice is outside the allowed typed choices");
  }
  return { requestId: request.id, cacheKey: request.cacheKey, choice: patch.choice, confidence: patch.confidence, reasonCodes: patch.reasonCodes };
}

export function createGap({
  id,
  ownerUnitId,
  scope = "local",
  missingFields = [],
  reason,
  evidenceRefs = [],
  confidence = "low",
  dependencyClosure = [],
  affectedAcceptance = [],
  assumptions = [],
  omissions = [],
  unblockAction = null,
}) {
  if (!id || !ownerUnitId || !reason) throw new Error("A gap requires id, ownerUnitId, and reason");
  if (!new Set(["local", "global"]).has(scope)) throw new Error(`Invalid gap scope: ${scope}`);
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "extraction-gap",
    id,
    ownerUnitId,
    scope,
    status: scope === "global" ? "global-blocker" : "recoverable",
    missingFields,
    reason,
    evidenceRefs,
    confidence,
    dependencyClosure: [...new Set([ownerUnitId, ...dependencyClosure])],
    affectedAcceptance,
    attempts: [],
    remainingAttempts: scope === "global" ? 0 : MAX_GAP_RECOVERY_ATTEMPTS,
    assumptions,
    omissions,
    unblockAction,
    userDecision: null,
  };
}

export function recordGapAttempt(gap, { tactic, evidenceRefs = [], outcome = "failed", producedNewEvidence = false, note = "" }) {
  if (gap.scope === "global") return gap;
  if (["provisional", "resolved", "needs-user-decision"].includes(gap.status) || gap.remainingAttempts === 0) return gap;
  if (!tactic) throw new Error("A gap recovery attempt requires a tactic");
  const previousSameTactic = gap.attempts.some((attempt) => attempt.tactic === tactic && !attempt.producedNewEvidence);
  if (previousSameTactic && !producedNewEvidence) return gap;
  const countsAgainstBudget = outcome !== "resolved";
  const attempts = [...gap.attempts, { tactic, evidenceRefs, outcome, producedNewEvidence, countsAgainstBudget, note }];
  const consumed = attempts.filter((attempt) => attempt.countsAgainstBudget && attempt.outcome !== "resolved").length;
  const resolved = outcome === "resolved";
  const remainingAttempts = Math.max(0, MAX_GAP_RECOVERY_ATTEMPTS - consumed);
  return {
    ...gap,
    attempts,
    remainingAttempts,
    status: resolved ? "resolved" : remainingAttempts === 0 ? "provisional" : "recoverable",
  };
}

export function validateArtifact(artifact, expectedKind = artifact?.kind) {
  const errors = [];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) errors.push("artifact must be an object");
  if (!ARTIFACT_KINDS.has(expectedKind)) errors.push(`unsupported artifact kind: ${expectedKind}`);
  if (artifact?.kind !== expectedKind) errors.push(`kind must be ${expectedKind}`);
  if (artifact?.schemaVersion !== EXTRACTION_SCHEMA_VERSION) errors.push(`schemaVersion must be ${EXTRACTION_SCHEMA_VERSION}`);
  if (ARTIFACT_KINDS.has(expectedKind)) {
    const schemaInput = ["page-resolution", "page-capture", "foundation", "metadata", "shared-chrome", "unit"].includes(expectedKind) && !artifact?.hash
      ? { ...artifact, hash: "0".repeat(64) }
      : artifact;
    const generated = validateGeneratedArtifact(schemaInput, expectedKind);
    errors.push(...generated.errors.map((error) => `schema ${error}`));
  }
  const allowed = ALLOWED_FIELDS[expectedKind];
  if (allowed && artifact && typeof artifact === "object") {
    for (const key of Object.keys(artifact)) if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
  }
  if (expectedKind === "page-resolution") {
    if (artifact.pageKey !== "home") errors.push("pageKey must be home");
    if (!artifact.source?.requestedUrl || !artifact.source?.resolvedUrl) errors.push("requestedUrl and resolvedUrl are required");
    if (artifact.destinationRoute !== "/") errors.push("destinationRoute must be /");
  }
  if (["foundation", "metadata", "shared-chrome", "unit"].includes(expectedKind)) {
    if (!artifact.id) errors.push("id is required");
    if (!["accepted", "provisional"].includes(artifact.status)) errors.push("status must be accepted or provisional");
    if (!Array.isArray(artifact.gapRefs)) errors.push("gapRefs must be an array");
    if (artifact.status === "provisional" && artifact.gapRefs?.length === 0) errors.push("provisional artifacts require gapRefs");
  }
  if (expectedKind === "extraction-gap") {
    if (!artifact.id || !artifact.ownerUnitId || !artifact.reason) errors.push("gap id, ownerUnitId, and reason are required");
    if (!["local", "global"].includes(artifact.scope)) errors.push("gap scope must be local or global");
    if (!Array.isArray(artifact.attempts)) errors.push("gap attempts must be an array");
  }
  if (expectedKind === "extraction-manifest") {
    if (!artifact.captureId || !Array.isArray(artifact.specs) || !Array.isArray(artifact.gaps)) errors.push("manifest captureId, specs, and gaps are required");
    if (artifact.gaps?.some((gap) => gap.scope === "global" && gap.status !== "resolved")) errors.push("manifest cannot freeze with an unresolved global blocker");
  }
  if (expectedKind === "decision-request") {
    if (!artifact.id || !artifact.decisionType || !artifact.allowedChoices?.length || !artifact.cacheKey) errors.push("decision request is incomplete");
  }
  if (expectedKind === "decision-patch") {
    if (!artifact.requestId || !artifact.reasonCodes?.length || !["high", "medium", "low"].includes(artifact.confidence)) errors.push("decision patch is incomplete");
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidArtifact(artifact, expectedKind = artifact?.kind) {
  const result = validateArtifact(artifact, expectedKind);
  if (!result.ok) throw new Error(`${expectedKind} validation failed: ${result.errors.join("; ")}`);
  return artifact;
}

export function freezeSpec(spec, { dependencyHashes = [], gapIds = spec.gapRefs || [] } = {}) {
  assertValidArtifact(spec, spec.kind);
  const frozen = {
    ...spec,
    gapRefs: [...new Set(gapIds)].sort(),
    dependencyHashes: [...dependencyHashes].sort(),
  };
  frozen.hash = semanticHash(frozen, frozen.dependencyHashes);
  return Object.freeze(frozen);
}

export function createExtractionManifest({ captureId, pageResolution, pageCapture, specs, gaps = [], observationRefs = [], budgets = {} }) {
  const unresolvedGlobal = gaps.filter((gap) => gap.scope === "global" && gap.status !== "resolved");
  if (unresolvedGlobal.length) {
    const error = new Error(`Cannot freeze extraction manifest: ${unresolvedGlobal.map((gap) => gap.id).join(", ")}`);
    error.code = "EXTRACTION_GLOBAL_BLOCKER";
    error.gaps = unresolvedGlobal;
    throw error;
  }
  const specEntries = [...specs]
    .map((spec) => ({ id: spec.id, kind: spec.kind, status: spec.status, hash: spec.hash, gapRefs: spec.gapRefs || [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "extraction-manifest",
    captureId,
    pageKey: "home",
    pageResolution: { id: pageResolution.id, hash: pageResolution.hash },
    pageCapture: { id: pageCapture.id, hash: pageCapture.hash },
    observationRefs: [...observationRefs].sort((a, b) => a.ref.localeCompare(b.ref)),
    specs: specEntries,
    gaps: gaps.map((gap) => ({ id: gap.id, ownerUnitId: gap.ownerUnitId, scope: gap.scope, status: gap.status })).sort((a, b) => a.id.localeCompare(b.id)),
    budgets: { ...EXTRACTION_BUDGETS, ...budgets },
    status: pageCapture.status === "provisional" || specEntries.some((spec) => spec.status === "provisional") ? "done_with_gaps" : "accepted",
  };
  manifest.manifestHash = semanticHash(manifest, specEntries.map((entry) => entry.hash));
  assertValidArtifact(manifest, "extraction-manifest");
  return Object.freeze(manifest);
}

export async function verifyFrozenManifest(extractionDir) {
  const manifest = JSON.parse(await readFile(path.join(extractionDir, "extraction-manifest.json"), "utf8"));
  assertValidArtifact(manifest, "extraction-manifest");
  const failures = [];
  const pageResolution = JSON.parse(await readFile(path.join(extractionDir, "page-resolution.spec.json"), "utf8"));
  const pageCapture = JSON.parse(await readFile(path.join(extractionDir, "page-capture.spec.json"), "utf8"));
  const gapArtifact = JSON.parse(await readFile(path.join(extractionDir, "extraction-gaps.json"), "utf8"));
  const gaps = gapArtifact.gaps || [];
  const gapIds = new Set();
  for (const gap of gaps) {
    try { assertValidArtifact(gap, "extraction-gap"); }
    catch (error) { failures.push(`${gap.id || "unknown gap"}: ${error.message}`); }
    if (gapIds.has(gap.id)) failures.push(`duplicate gap id: ${gap.id}`);
    gapIds.add(gap.id);
  }
  const manifestGapProjection = gaps
    .map((gap) => ({ id: gap.id, ownerUnitId: gap.ownerUnitId, scope: gap.scope, status: gap.status }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (canonicalizeJson(manifestGapProjection) !== canonicalizeJson(manifest.gaps)) failures.push("manifest gap projection does not match extraction-gaps.json");
  const resolutionHash = semanticHash(pageResolution, pageResolution.dependencyHashes || []);
  const captureHash = semanticHash(pageCapture, pageCapture.dependencyHashes || []);
  if (resolutionHash !== manifest.pageResolution.hash) failures.push(`page resolution: expected ${manifest.pageResolution.hash}, got ${resolutionHash}`);
  if (captureHash !== manifest.pageCapture.hash) failures.push(`page capture: expected ${manifest.pageCapture.hash}, got ${captureHash}`);
  for (const entry of manifest.observationRefs) {
    const absolute = path.resolve(extractionDir, entry.ref);
    const extractionRoot = `${path.resolve(extractionDir)}${path.sep}`;
    if (!absolute.startsWith(extractionRoot)) {
      failures.push(`observation ${entry.ref}: path escapes extraction directory`);
      continue;
    }
    try {
      const observation = JSON.parse(await readFile(absolute, "utf8"));
      const actual = semanticHash(observation);
      if (actual !== entry.hash) failures.push(`observation ${entry.ref}: expected ${entry.hash}, got ${actual}`);
    } catch (error) {
      failures.push(`observation ${entry.ref}: ${error.code === "ENOENT" ? "file missing" : error.message}`);
    }
  }
  const knownHashes = new Set([resolutionHash, captureHash, ...manifest.specs.map((entry) => entry.hash)]);
  for (const gapRef of [...(pageResolution.gapRefs || []), ...(pageCapture.gapRefs || [])]) {
    if (!gapIds.has(gapRef)) failures.push(`page artifact: unknown gap ref ${gapRef}`);
  }
  for (const entry of manifest.specs) {
    const file = await findSpecFile(extractionDir, entry.id);
    if (!file) {
      failures.push(`${entry.id}: file missing`);
      continue;
    }
    const spec = JSON.parse(await readFile(file, "utf8"));
    const actual = semanticHash(spec, spec.dependencyHashes || []);
    if (actual !== entry.hash) failures.push(`${entry.id}: expected ${entry.hash}, got ${actual}`);
    if (canonicalizeJson([...(spec.gapRefs || [])].sort()) !== canonicalizeJson([...(entry.gapRefs || [])].sort())) failures.push(`${entry.id}: manifest gap refs do not match spec`);
    for (const gapRef of spec.gapRefs || []) if (!gapIds.has(gapRef)) failures.push(`${entry.id}: unknown gap ref ${gapRef}`);
    if (spec.status === "provisional" && !(spec.gapRefs || []).length) failures.push(`${entry.id}: provisional spec is not gap-backed`);
    for (const dependencyHash of spec.dependencyHashes || []) {
      if (!knownHashes.has(dependencyHash)) failures.push(`${entry.id}: unknown dependency hash ${dependencyHash}`);
    }
  }
  const manifestHash = semanticHash(manifest, manifest.specs.map((entry) => entry.hash));
  if (manifestHash !== manifest.manifestHash) failures.push(`manifest: expected ${manifest.manifestHash}, got ${manifestHash}`);
  return { ok: failures.length === 0, failures, manifest };
}

async function findSpecFile(extractionDir, id) {
  const indexPath = path.join(extractionDir, "spec-index.json");
  try {
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    return index[id] ? path.join(extractionDir, index[id]) : null;
  } catch {
    return null;
  }
}

export async function writeFrozenExtraction({ extractionDir, pageResolution, pageCapture, specs, gaps, manifest, specPaths }) {
  await ensureDir(extractionDir);
  await writeJson(path.join(extractionDir, "page-resolution.spec.json"), pageResolution);
  await writeJson(path.join(extractionDir, "page-capture.spec.json"), pageCapture);
  for (const gap of gaps) assertValidArtifact(gap, "extraction-gap");
  await writeJson(path.join(extractionDir, "extraction-gaps.json"), {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    gaps,
  });
  const index = {};
  for (const { spec, relativePath } of specPaths) {
    await writeJson(path.join(extractionDir, relativePath), spec);
    index[spec.id] = relativePath;
  }
  await writeJson(path.join(extractionDir, "spec-index.json"), index);
  await writeJson(path.join(extractionDir, "extraction-manifest.json"), manifest);
}
