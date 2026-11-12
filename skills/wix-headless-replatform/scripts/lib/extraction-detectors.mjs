import { canonicalizeJson, sha256 } from "./extraction-contract.mjs";
import { validateGeneratedArtifact } from "./extraction-validators.generated.mjs";

export const DETECTOR_ENSEMBLE_VERSION = "0083.1";
export const HIGH_CONFIDENCE_MIN_PRECISION = 0.95;

const KNOWN_KINDS = new Set([
  "accordion", "banner", "button", "button-group", "card", "card-collection",
  "category-strip", "cta-strip", "footer", "form", "gallery", "header", "hero",
  "marquee", "menu", "navigation", "promo-band", "repeater", "reviews", "rich-text",
  "stat-group", "static-content", "tabs", "text-media",
]);

export function detectUnitCandidates(value = {}, { unitKind = "section", evidenceRef = "" } = {}) {
  const candidates = [];
  const add = (detectorId, candidate) => {
    if (!candidate?.kind) return;
    const artifact = {
      schemaVersion: DETECTOR_ENSEMBLE_VERSION,
      detectorId,
      detectorVersion: DETECTOR_ENSEMBLE_VERSION,
      unitKind,
      evidenceRefs: evidenceRef ? [evidenceRef] : [],
      variant: candidate.variant || "default",
      score: clamp(candidate.score),
      signals: [...new Set(candidate.signals || [])].sort(),
      kind: normalizeKind(candidate.kind),
    };
    const validation = validateGeneratedArtifact(artifact, "candidate");
    if (!validation.ok) throw new Error(`Candidate validation failed: ${validation.errors.join("; ")}`);
    candidates.push(artifact);
  };

  const declaredKind = value.kind || value.classification?.kind;
  const declaredVariant = value.variant || value.classification?.variant;
  if (declaredKind) {
    const declaredConfidence = normalizeConfidenceValue(value.classification?.confidence ?? value.confidence);
    add("declared-observation", {
      kind: declaredKind,
      variant: declaredVariant,
      score: declaredConfidence ?? (KNOWN_KINDS.has(normalizeKind(declaredKind)) ? 0.82 : 0.58),
      signals: ["observed-kind", declaredVariant ? "observed-variant" : ""].filter(Boolean),
    });
  }

  const semantic = semanticCandidate(value);
  if (semantic) add("semantic-aria", semantic);
  const structural = structuralCandidate(value);
  if (structural) add("structure-cardinality", structural);
  const behavior = behaviorCandidate(value);
  if (behavior) add("behavior-state", behavior);
  const visual = visualCandidate(value);
  if (visual) add("layout-visual", visual);

  if (!candidates.length) add("fallback-static", {
    kind: "static-content",
    variant: "default",
    score: 0.35,
    signals: ["no-qualified-detector"],
  });
  return candidates.sort((a, b) => b.score - a.score || a.detectorId.localeCompare(b.detectorId));
}

export function resolveCandidateEnsemble(candidates, calibration = {}) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("Candidate ensemble requires at least one candidate");
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.kind;
    const group = groups.get(key) || { kind: candidate.kind, variant: candidate.variant, candidates: [], detectors: new Set(), scoreTotal: 0 };
    group.candidates.push(candidate);
    group.detectors.add(candidate.detectorId);
    group.scoreTotal += candidate.score;
    if (candidate.score > Math.max(...group.candidates.slice(0, -1).map((entry) => entry.score), -1)) group.variant = candidate.variant;
    groups.set(key, group);
  }
  const ranked = [...groups.values()].map((group) => {
    const max = Math.max(...group.candidates.map((candidate) => candidate.score));
    const agreementBonus = Math.min(0.12, Math.max(0, group.detectors.size - 1) * 0.04);
    const mean = group.scoreTotal / group.candidates.length;
    return { ...group, aggregateScore: clamp(max * 0.68 + mean * 0.32 + agreementBonus) };
  }).sort((a, b) => b.aggregateScore - a.aggregateScore || a.kind.localeCompare(b.kind));
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const margin = winner.aggregateScore - (runnerUp?.aggregateScore || 0);
  const detectorCalibration = calibration[winner.kind] || {};
  const highThreshold = detectorCalibration.highThreshold ?? 0.85;
  const mediumThreshold = detectorCalibration.mediumThreshold ?? 0.60;
  const highPrecision = detectorCalibration.highPrecision ?? (winner.detectors.size >= 2 ? HIGH_CONFIDENCE_MIN_PRECISION : 0);
  const explicitHigh = winner.candidates.some((candidate) => candidate.detectorId === "declared-observation" && candidate.score >= 0.85);
  const confidence = winner.aggregateScore >= highThreshold
    && margin >= 0.08
    && (highPrecision >= HIGH_CONFIDENCE_MIN_PRECISION || explicitHigh)
      ? "high"
      : winner.aggregateScore >= mediumThreshold && margin >= 0.03 ? "medium" : "low";
  return {
    kind: winner.kind,
    variant: winner.variant,
    confidence,
    score: Number(winner.aggregateScore.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    signals: [...new Set(winner.candidates.flatMap((candidate) => candidate.signals))].sort(),
    candidates: candidates.map((candidate) => ({
      schemaVersion: candidate.schemaVersion,
      detectorId: candidate.detectorId,
      detectorVersion: candidate.detectorVersion,
      kind: candidate.kind,
      variant: candidate.variant,
      score: candidate.score,
      signals: candidate.signals,
      evidenceRefs: candidate.evidenceRefs,
    })),
    detectorVersions: Object.fromEntries(candidates.map((candidate) => [candidate.detectorId, candidate.detectorVersion])),
  };
}

export function classifyObservedUnit(value, options = {}) {
  return resolveCandidateEnsemble(detectUnitCandidates(value, options), options.calibration || {});
}

export function planRecursiveUnitJobs(sections = []) {
  const jobs = [];
  const evidenceOwners = new Map();
  const ownershipConflicts = [];
  const walk = (value, { id, parentUnitId, unitKind, order, evidenceRef, depth }) => {
    if (depth > 12) throw new Error(`Recursive extraction depth exceeded for ${id}`);
    const children = childValues(value);
    const childIds = children.map((entry, index) => `${id}:component-${String(index + 1).padStart(3, "0")}`);
    const job = { id, parentUnitId, unitKind, order, evidenceRef, depth, value, childIds };
    jobs.push(job);
    if (evidenceRef) {
      const existing = evidenceOwners.get(evidenceRef);
      if (existing && existing !== id) ownershipConflicts.push({ evidenceRef, owners: [existing, id].sort() });
      else evidenceOwners.set(evidenceRef, id);
    }
    children.forEach((entry, index) => walk(entry.value, {
      id: childIds[index],
      parentUnitId: id,
      unitKind: "component",
      order: index + 1,
      evidenceRef: `${evidenceRef}/${entry.key}/${entry.index}`,
      depth: depth + 1,
    }));
  };
  sections.forEach((section, index) => walk(section, {
    id: section.id || `section-${String(index + 1).padStart(3, "0")}`,
    parentUnitId: null,
    unitKind: "section",
    order: index + 1,
    evidenceRef: `observations/page.json#/sections/${index}`,
    depth: 0,
  }));
  return {
    version: DETECTOR_ENSEMBLE_VERSION,
    jobs,
    ownership: [...evidenceOwners.entries()].map(([evidenceRef, ownerUnitId]) => ({ evidenceRef, ownerUnitId })).sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef)),
    conflicts: dedupeConflicts(ownershipConflicts),
    hash: sha256({ jobs: jobs.map(({ value, ...job }) => job), ownership: [...evidenceOwners.entries()] }),
  };
}

function childValues(value) {
  for (const key of ["modules", "components", "children"]) {
    if (Array.isArray(value?.[key]) && value[key].some((item) => item && typeof item === "object")) {
      return value[key].map((item, index) => ({ key, index, value: item })).filter((entry) => entry.value && typeof entry.value === "object");
    }
  }
  return [];
}

function semanticCandidate(value) {
  const role = String(value?.a11y?.role || value?.role || "").toLowerCase();
  const tag = String(value?.tag || value?.domRef?.tag || "").toLowerCase();
  if (tag === "header" || role === "banner") return candidate("header", "generic", 0.94, ["semantic-header"]);
  if (tag === "footer" || role === "contentinfo") return candidate("footer", "site-footer", 0.96, ["semantic-footer"]);
  if (tag === "nav" || role === "navigation") return candidate("navigation", "site-navigation", 0.95, ["semantic-navigation"]);
  if (role === "tablist") return candidate("tabs", "tablist", 0.96, ["aria-tablist"]);
  if (/button/.test(role) || tag === "button") return candidate("button", "native", 0.96, ["native-button"]);
  return null;
}

function structuralCandidate(value) {
  const counts = value?.counts || {};
  const itemCount = value?.itemCount ?? value?.items?.length ?? value?.modules?.length ?? 0;
  const imageCount = counts.images ?? value?.images?.length ?? 0;
  const headingCount = counts.headings ?? (value?.heading ? 1 : 0);
  const text = `${value?.heading || ""} ${value?.text || ""}`;
  if (itemCount >= 3 && imageCount >= 3) return candidate("card-collection", value?.capabilities?.isCarouselLike ? "card-carousel" : "card-grid", 0.84, ["repeated-items", "repeated-media"]);
  if (itemCount >= 2) return candidate("repeater", "collection", 0.72, ["repeated-items"]);
  if (imageCount >= 1 && headingCount >= 1 && text.trim().length >= 20) return candidate("text-media", "media-left", 0.74, ["media", "heading", "copy"]);
  return null;
}

function behaviorCandidate(value) {
  const behavior = value?.behavior || value?.interaction || {};
  const text = canonicalizeJson(behavior).toLowerCase();
  if (/aria-?expanded|disclosure|accordion/.test(text)) return candidate("accordion", "disclosure", 0.92, ["expanded-state", "toggle-trigger"]);
  if (/aria-selected|tablist|tabpanel/.test(text)) return candidate("tabs", "tablist", 0.93, ["selected-state", "tabpanel"]);
  if (/carousel|slide|scroll-snap/.test(text)) return candidate("gallery", "carousel", 0.82, ["slide-state"]);
  if (/menuitem|aria-haspopup|dropdown/.test(text)) return candidate("menu", "dropdown", 0.88, ["menu-state"]);
  return null;
}

function visualCandidate(value) {
  const classText = `${value?.className || ""} ${value?.idAttr || ""} ${value?.variant || ""}`.toLowerCase();
  const layout = value?.layoutEvidence || value?.layout || {};
  const layers = value?.layers || layout?.background?.layers || [];
  if (/hero|masthead|billboard/.test(classText) || value?.a11y?.headingLevels?.includes?.(1) && layers.length) {
    return candidate("hero", /carousel|slider/.test(classText) ? "carousel-hero" : "generic-hero", 0.80, ["first-view-dominance", layers.length ? "layered-background" : ""]);
  }
  if (/marquee|ticker/.test(classText)) return candidate("marquee", "horizontal", 0.83, ["visual-marquee"]);
  if (/gallery/.test(classText)) return candidate("gallery", "grid", 0.78, ["visual-gallery"]);
  return null;
}

function candidate(kind, variant, score, signals) {
  return { kind, variant, score, signals: signals.filter(Boolean) };
}

function normalizeKind(value) {
  return String(value || "static-content").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "static-content";
}

function normalizeConfidenceValue(value) {
  if (typeof value === "number") return clamp(value);
  if (value === "high") return 0.96;
  if (value === "medium") return 0.72;
  if (value === "low") return 0.40;
  return null;
}

function clamp(value) {
  return Number(Math.max(0, Math.min(1, Number(value) || 0)).toFixed(4));
}

function dedupeConflicts(conflicts) {
  const seen = new Set();
  return conflicts.filter((conflict) => {
    const key = canonicalizeJson(conflict);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
