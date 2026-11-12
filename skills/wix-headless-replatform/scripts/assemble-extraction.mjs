#!/usr/bin/env node
import path from "node:path";
import { copyFile, readdir, readFile, stat } from "node:fs/promises";
import { docsDir, ensureDir, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import {
  EXTRACTION_BUDGETS,
  EXTRACTION_SCHEMA_VERSION,
  applyDecisionPatch,
  assertValidArtifact,
  createExtractionManifest,
  createDecisionRequest,
  createGap,
  freezeSpec,
  semanticHash,
  sha256,
  writeFrozenExtraction,
} from "./lib/extraction-contract.mjs";
import { loadApprovedRegistry, selectRegistryItem } from "./lib/component-registry.mjs";
import { classifyObservedUnit, planRecursiveUnitJobs } from "./lib/extraction-detectors.mjs";
import {
  CONTENT_EXTRACTION_SEMANTICS_VERSION,
  inspectContentObject,
  removeContaminatedContent,
} from "./lib/content-boundary.mjs";

const LEGACY_OBSERVATION_FILES = [
  "assets.json",
  "control-state-contract.json",
  "interaction-map.json",
  "layout-blueprint.json",
  "scene-contract.json",
  "seo.json",
  "tokens.json",
  "ui-normalization.json",
  "visual-assets.json",
];

export async function assembleExtraction({
  outputDir,
  requestedUrl,
  resolvedUrl,
  canonicalUrl,
  page,
  assets = {},
  seo = {},
  tokens = {},
  interactionMap = {},
  sceneContract = {},
  layoutBlueprint = {},
  uiNormalization = {},
  controlStateContract = {},
  visualAssets = {},
  sourceFingerprint,
  sourceFingerprintIncludesContentSemantics = false,
  captureId: suppliedCaptureId,
  decisionPatches = [],
  pageResolutionArtifact = null,
}) {
  const docs = docsDir(outputDir);
  const observedSourceFingerprint = sourceFingerprint || sha256({
    resolvedUrl,
    title: page?.title || "",
    sections: (page?.sections || []).map((section) => ({ id: section.id, heading: section.heading, text: section.text })),
  });
  const fingerprint = sourceFingerprintIncludesContentSemantics
    ? observedSourceFingerprint
    : sha256({
        sourceFingerprint: observedSourceFingerprint,
        contentExtractionSemantics: CONTENT_EXTRACTION_SEMANTICS_VERSION,
      });
  const captureId = suppliedCaptureId || `home-${fingerprint.slice(0, 12)}`;
  const extractionDir = path.join(docs, "extraction", captureId);
  const gaps = [];
  const decisionRequests = [];
  const appliedDecisions = [];
  const patchesByRequest = new Map(decisionPatches.map((patch) => [patch.requestId, patch]));
  const rawEvidenceEstimate = Buffer.byteLength(JSON.stringify({ page, assets, seo, tokens, interactionMap, sceneContract, layoutBlueprint, uiNormalization, controlStateContract, visualAssets }));
  const recursiveJobs = planRecursiveUnitJobs(page?.sections || []);
  const pageCaptureGapRefs = [];
  if (rawEvidenceEstimate > EXTRACTION_BUDGETS.maxRawEvidenceBytes) {
    page = { ...page, rawDomSnapshots: {}, normalizedDomSnapshots: {} };
    const gap = createGap({
      id: "gap:page-capture:evidence-budget",
      ownerUnitId: "page-capture:home",
      missingFields: ["rawDomSnapshots", "normalizedDomSnapshots"],
      reason: `Raw evidence was estimated at ${rawEvidenceEstimate} bytes and exceeded the ${EXTRACTION_BUDGETS.maxRawEvidenceBytes}-byte retention budget. DOM snapshots were omitted by priority while structured observations were retained.`,
      evidenceRefs: [],
      dependencyClosure: (page?.sections || []).map((section, index) => section.id || `section-${String(index + 1).padStart(3, "0")}`),
      affectedAcceptance: ["packet-replay"],
      assumptions: ["Structured page/unit evidence remains sufficient to assemble a viable home-page shell."],
      omissions: ["DOM-only replay until a targeted recapture is authorized."],
    });
    gaps.push(gap);
    pageCaptureGapRefs.push(gap.id);
  }

  const pageResolution = pageResolutionArtifact || freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "page-resolution",
    id: "page-resolution:home",
    pageKey: "home",
    destinationRoute: "/",
    status: "accepted",
    source: {
      requestedUrl,
      resolvedUrl,
      canonicalUrl: canonicalUrl || resolvedUrl,
    },
    evidence: [{ kind: "navigation", ref: "observations/page.json" }],
    gapRefs: [],
  });

  const pageCapture = freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "page-capture",
    id: "page-capture:home",
    pageKey: "home",
    status: pageCaptureGapRefs.length ? "provisional" : "accepted",
    sourceFingerprint: fingerprint,
    viewportSet: Object.entries(page?.screenshots || {}).map(([name, screenshotRef]) => ({ name, screenshotRef: `observations/screenshots/${path.basename(String(screenshotRef))}` })),
    sectionOrder: recursiveJobs.jobs.filter((job) => job.unitKind === "section").map((job) => job.id),
    ignoredSurfaces: page?.ignoredSurfaces || [],
    normalizationActions: page?.normalizationActions || [],
    observationRefs: LEGACY_OBSERVATION_FILES.map((name) => `observations/${name}`),
    extensions: {
      "wix.replatform.content-boundary": { semanticsVersion: CONTENT_EXTRACTION_SEMANTICS_VERSION },
    },
    gapRefs: pageCaptureGapRefs,
  }, { dependencyHashes: [pageResolution.hash], gapIds: pageCaptureGapRefs });

  const foundationGapRefs = [];
  if (!hasFoundationEvidence(tokens)) {
    const gap = createGap({
      id: "gap:foundation:tokens",
      ownerUnitId: "foundation:home",
      missingFields: ["tokens"],
      reason: "No reliable page-wide token evidence was projected from the capture.",
      evidenceRefs: ["observations/tokens.json"],
      dependencyClosure: ["shared-chrome:home", ...(page?.sections || []).map((section, index) => section.id || `section-${String(index + 1).padStart(3, "0")}`)],
      assumptions: ["Use only directly observed computed values local to each unit."],
      omissions: ["Unobserved global token aliases."],
    });
    gaps.push(gap);
    foundationGapRefs.push(gap.id);
  }
  const foundation = freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "foundation",
    id: "foundation:home",
    pageKey: "home",
    status: foundationGapRefs.length ? "provisional" : "accepted",
    tokens: sanitizeEvidence(tokens),
    fonts: sanitizeEvidence(assets?.fonts || {}),
    primitives: collectFoundationPrimitives(page),
    globalCssIntent: collectGlobalCssIntent(tokens),
    evidenceRefs: ["observations/tokens.json", "observations/assets.json", "observations/page.json"],
    acceptance: { required: ["fonts-load", "direction-matches", "page-background-matches", "token-references-resolve"] },
    gapRefs: foundationGapRefs,
  }, { dependencyHashes: [pageCapture.hash], gapIds: foundationGapRefs });

  const metadata = freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "metadata",
    id: "metadata:home",
    pageKey: "home",
    status: "accepted",
    document: sanitizeEvidence(seo),
    evidenceRefs: ["observations/seo.json", "observations/page.json"],
    acceptance: { required: ["title", "description-when-observed", "canonical-when-observed", "lang-and-dir"] },
    gapRefs: [],
  }, { dependencyHashes: [pageCapture.hash] });

  const sharedChromeGapRefs = [];
  if (!page?.chrome && !page?.footer) {
    const gap = createGap({
      id: "gap:shared-chrome:unobserved",
      ownerUnitId: "shared-chrome:home",
      missingFields: ["header", "footer"],
      reason: "The capture did not identify a reliable header or footer boundary.",
      evidenceRefs: ["observations/page.json"],
      assumptions: ["Do not invent navigation or footer content."],
      omissions: ["Unobserved shared chrome."],
    });
    gaps.push(gap);
    sharedChromeGapRefs.push(gap.id);
  }
  const sharedChromeContamination = inspectContentObject({ header: page?.chrome || null, footer: page?.footer || null });
  if (sharedChromeContamination.contaminated) {
    const gap = contentContaminationGap("shared-chrome:home", "observations/page.json", sharedChromeContamination);
    gaps.push(gap);
    sharedChromeGapRefs.push(gap.id);
  }
  const safeSharedChrome = removeContaminatedContent({ header: page?.chrome || null, footer: page?.footer || null });
  const sharedChrome = freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "shared-chrome",
    id: "shared-chrome:home",
    pageKey: "home",
    status: sharedChromeGapRefs.length ? "provisional" : "accepted",
    header: sanitizeEvidence(safeSharedChrome.header),
    footer: sanitizeEvidence(safeSharedChrome.footer),
    controls: sanitizeEvidence(controlStateContract?.controls || []),
    visualAssets: selectChromeAssets(visualAssets),
    behavior: selectOwnedInteractions(interactionMap, "shared-chrome"),
    evidenceRefs: ["observations/page.json", "observations/control-state-contract.json", "observations/visual-assets.json"],
    acceptance: { required: ["visible-content", "navigation-hierarchy", "logo-identity", "responsive-chrome", "keyboard-navigation"] },
    gapRefs: sharedChromeGapRefs,
  }, { dependencyHashes: [foundation.hash, metadata.hash], gapIds: sharedChromeGapRefs });

  const specs = [foundation, metadata, sharedChrome];
  const specPaths = [
    { spec: foundation, relativePath: "foundation.spec.json" },
    { spec: metadata, relativePath: "metadata.spec.json" },
    { spec: sharedChrome, relativePath: "shared-chrome.spec.json" },
  ];

  const layouts = new Map((layoutBlueprint?.pages || []).flatMap((entry) => entry.sections || []).map((entry) => [entry.sectionId, entry]));
  const normalizations = new Map((uiNormalization?.sections || []).map((entry) => [entry.sectionId, entry]));
  const scenes = new Map((sceneContract?.scenes || []).map((entry) => [entry.sectionId, entry]));
  const recursiveSpecById = new Map();
  const jobsByDepth = [...recursiveJobs.jobs].sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));
  for (const job of jobsByDepth) {
    const decision = resolveClassification({
      value: job.value,
      unitId: job.id,
      evidenceRef: job.evidenceRef,
      patchesByRequest,
      decisionRequests,
      appliedDecisions,
    });
    const diagnosticGaps = job.unitKind === "section"
      ? gapsForSection(job.value, job.id, page, decision.classification)
      : [];
    const contentOptions = { allowVisibleCode: Array.isArray(job.value?.visibleCodeTexts) && job.value.visibleCodeTexts.length > 0 };
    const contamination = inspectContentObject(job.value, contentOptions);
    const contaminationGaps = contamination.contaminated
      ? [contentContaminationGap(job.id, job.evidenceRef, contamination)]
      : [];
    const unitGaps = [...decision.gaps, ...diagnosticGaps, ...contaminationGaps];
    gaps.push(...unitGaps);
    const gapRefs = unitGaps.map((gap) => gap.id);
    const isSection = job.unitKind === "section";
    const behavior = isSection
      ? scenes.get(job.id) || selectOwnedInteractions(interactionMap, job.id)
      : job.value.behavior || selectOwnedInteractions(interactionMap, job.id);
    const unit = freezeSpec({
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      kind: "unit",
      id: job.id,
      unitKind: job.unitKind,
      pageKey: "home",
      parentUnitId: job.parentUnitId,
      order: job.order,
      status: gapRefs.length ? "provisional" : "accepted",
      classification: {
        ...decision.classification,
        capabilityRequirements: capabilityRequirementsFor(job.value, decision.classification),
      },
      scope: {
        evidenceRef: job.evidenceRef,
        ...(isSection ? { screenshotRefs: Object.values(page?.screenshots || {}).map((item) => `observations/screenshots/${path.basename(String(item))}`) } : {}),
      },
      content: contentFor(job.value, contentOptions),
      assets: sanitizeEvidence(job.value.images || job.value.assets || []),
      layers: sanitizeEvidence(job.value.layers || (isSection ? layouts.get(job.id)?.background?.layers : []) || []),
      layout: sanitizeEvidence((isSection ? layouts.get(job.id) : null) || job.value.layout || {}),
      styleables: sanitizeEvidence(job.value.styleables || (job.value.layoutEvidence?.regions || []).map((region, index) => ({
        id: `${job.id}:styleable-${String(index + 1).padStart(3, "0")}`,
        role: region.role,
        categories: region.styleableCategories || [],
        computedByViewport: { desktop: region.computedStyle || {} },
        authoredCss: region.authoredCss || [],
      }))),
      behavior: sanitizeEvidence(behavior || {}),
      children: job.childIds,
      reconstruction: isSection ? {
        strategy: knownClassification(job.value) ? "registry-or-deterministic" : "bounded-custom",
        foundationRef: foundation.id,
        sharedChromeRef: sharedChrome.id,
        normalization: sanitizeEvidence(normalizations.get(job.id) || null),
      } : {
        strategy: "registry-or-custom",
        foundationRef: foundation.id,
      },
      acceptance: acceptanceFor(job.value),
      diagnostics: unitGaps.map((gap) => ({ gapRef: gap.id, reason: gap.reason })),
      provenance: {
        sourceRef: job.evidenceRef,
        sourceUrl: resolvedUrl,
        captureFingerprint: fingerprint,
        detectorVersions: decision.classification.detectorVersions,
        recursiveJobVersion: recursiveJobs.version,
      },
      extensions: {
        "wix.replatform.content-boundary": {
          semanticsVersion: CONTENT_EXTRACTION_SEMANTICS_VERSION,
          visibleCode: contentOptions.allowVisibleCode,
        },
      },
      gapRefs,
    }, {
      dependencyHashes: [foundation.hash, ...job.childIds.map((id) => recursiveSpecById.get(id)?.hash).filter(Boolean)],
      gapIds: gapRefs,
    });
    recursiveSpecById.set(job.id, unit);
    specs.push(unit);
    const sectionRoot = job.id.split(":component-")[0];
    specPaths.push({
      spec: unit,
      relativePath: isSection
        ? `sections/${job.id}/section.spec.json`
        : `sections/${sectionRoot}/components/${pathSafe(job.id)}.spec.json`,
    });
  }

  const observationRefs = await writeObservations(extractionDir, {
    page,
    assets,
    seo,
    tokens,
    interactionMap,
    sceneContract,
    layoutBlueprint,
    uiNormalization,
    controlStateContract,
    visualAssets,
    recursiveJobs: {
      version: recursiveJobs.version,
      jobs: recursiveJobs.jobs.map(({ value, ...job }) => job),
      ownership: recursiveJobs.ownership,
      conflicts: recursiveJobs.conflicts,
      hash: recursiveJobs.hash,
    },
  }, outputDir, fingerprint);
  if (decisionRequests.length > EXTRACTION_BUDGETS.maxAgentDecisions) {
    throw new Error(`Typed decision budget exceeded: ${decisionRequests.length} > ${EXTRACTION_BUDGETS.maxAgentDecisions}`);
  }
  const decisionRequestsArtifact = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    requests: decisionRequests,
  };
  const appliedDecisionsArtifact = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    decisions: appliedDecisions,
  };
  await writeJson(path.join(extractionDir, "decisions", "requests.json"), decisionRequestsArtifact);
  await writeJson(path.join(extractionDir, "decisions", "applied.json"), appliedDecisionsArtifact);
  observationRefs.push(
    { ref: "decisions/requests.json", hash: semanticHash(decisionRequestsArtifact) },
    { ref: "decisions/applied.json", hash: semanticHash(appliedDecisionsArtifact) },
  );
  const manifest = createExtractionManifest({ captureId, pageResolution, pageCapture, specs, gaps, observationRefs });
  await writeFrozenExtraction({ extractionDir, pageResolution, pageCapture, specs, gaps, manifest, specPaths });
  const buildPlan = createBuildPlan(manifest, specs);
  await ensureDir(path.join(docs, "build"));
  await writeJson(path.join(docs, "build", "build-plan.json"), buildPlan);
  const approvedRegistry = await loadApprovedRegistry();
  const componentSelection = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    manifestHash: manifest.manifestHash,
    selections: specs.filter((spec) => spec.kind === "unit").map((spec) => ({
      unitId: spec.id,
      contract: spec.classification,
      ...selectRegistryItem({
        kind: spec.classification.kind,
        requiresClientRuntime: requiresClientRuntime(spec),
        hardRequirements: ["license", "accessibility", "responsive", "ssr", "rtl", "reducedMotion"],
        capabilityRequirements: spec.classification.capabilityRequirements,
      }, approvedRegistry),
    })),
    rejectedRegistryItems: approvedRegistry.rejected,
  };
  await writeJson(path.join(docs, "build", "component-selection.json"), componentSelection);
  await ensureDir(path.join(docs, "qa"));
  await writeJson(path.join(docs, "qa", "registry-opportunities.json"), {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    manifestHash: manifest.manifestHash,
    opportunities: componentSelection.selections
      .filter((selection) => selection.strategy === "bounded-custom")
      .map((selection) => ({
        unitId: selection.unitId,
        contractKind: selection.contract.kind,
        variant: selection.contract.variant,
        reason: "No human-approved local registry item met every hard requirement; bounded custom building remains available.",
        requiredCapabilities: ["license", "accessibility", "responsive", "ssr", "rtl", "reducedMotion"],
        capabilityRequirements: selection.contract.capabilityRequirements || {},
        registryRejections: selection.rejected || [],
        sourceNeutral: true,
      })),
  });
  await writeJson(path.join(docs, "extraction", "latest.json"), { captureId, manifestRef: `${captureId}/extraction-manifest.json`, manifestHash: manifest.manifestHash });
  await enforceArtifactBudgets(extractionDir, manifest);
  return { captureId, extractionDir, pageResolution, pageCapture, specs, gaps, manifest, buildPlan };
}

export function createBuildPlan(manifest, specs) {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const ordered = [...specs].sort((a, b) => buildRank(a) - buildRank(b) || (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
  const plan = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "build-plan",
    pageKey: "home",
    route: "/",
    manifestHash: manifest.manifestHash,
    status: manifest.status,
    units: ordered.map((spec) => ({
      id: spec.id,
      kind: spec.kind,
      unitKind: spec.unitKind || spec.kind,
      status: spec.status,
      hash: spec.hash,
      gapRefs: spec.gapRefs || [],
      dependencies: dependencyIds(spec, byId),
    })),
  };
  assertValidArtifact(plan, "build-plan");
  return plan;
}

function buildRank(spec) {
  if (spec.kind === "foundation") return 0;
  if (spec.kind === "metadata") return 1;
  if (spec.kind === "shared-chrome") return 2;
  if (spec.unitKind === "component") return 3;
  return 4;
}

function dependencyIds(spec, byId) {
  const ids = [spec.reconstruction?.foundationRef, spec.reconstruction?.sharedChromeRef, ...(spec.children || [])].filter(Boolean);
  return ids.filter((id) => byId.has(id));
}

async function writeObservations(extractionDir, values, outputDir, sourceFingerprint) {
  const observationsDir = path.join(extractionDir, "observations");
  await ensureDir(observationsDir);
  const page = structuredClone(values.page || {});
  const screenshotDir = path.join(observationsDir, "screenshots");
  for (const [name, sourceRef] of Object.entries(page.screenshots || {})) {
    const sourcePath = path.isAbsolute(sourceRef) ? sourceRef : path.resolve(outputDir, sourceRef);
    const filename = path.basename(sourceRef);
    try {
      await ensureDir(screenshotDir);
      await copyFile(sourcePath, path.join(screenshotDir, filename));
      page.screenshots[name] = `screenshots/${filename}`;
    } catch {
      page.screenshots[name] = `screenshots/${filename}`;
    }
  }
  const mapping = {
    "page.json": page,
    "assets.json": values.assets,
    "seo.json": values.seo,
    "tokens.json": values.tokens,
    "interaction-map.json": values.interactionMap,
    "scene-contract.json": values.sceneContract,
    "layout-blueprint.json": values.layoutBlueprint,
    "ui-normalization.json": values.uiNormalization,
    "control-state-contract.json": values.controlStateContract,
    "visual-assets.json": values.visualAssets,
    "recursive-jobs.json": values.recursiveJobs,
  };
  const refs = [];
  const packetDir = path.join(observationsDir, "packets");
  await ensureDir(packetDir);
  const writePacket = async (packetName, packet) => {
    assertValidArtifact(packet, "observation-packet");
    await writeJson(path.join(packetDir, packetName), packet);
    refs.push({ ref: `observations/packets/${packetName}`, hash: semanticHash(packet) });
  };
  for (const [name, value] of Object.entries(mapping)) {
    const sanitized = sanitizeEvidence(value);
    await writeJson(path.join(observationsDir, name), sanitized);
    const packetName = name.replace(/\.json$/, ".packet.json");
    const packet = {
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      kind: "observation-packet",
      packetType: name.replace(/\.json$/, ""),
      sourceFingerprint,
      viewport: null,
      state: "settled",
      payload: sanitized,
    };
    await writePacket(packetName, packet);
  }
  for (const [name, screenshotRef] of Object.entries(page.screenshots || {})) {
    const packetName = `page.viewport-${pathSafe(name)}.packet.json`;
    await writePacket(packetName, {
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      kind: "observation-packet",
      packetType: "page-viewport",
      sourceFingerprint,
      viewport: { name, screenshotRef },
      state: "settled",
      payload: sanitizeEvidence({
        responsiveTextGeometry: page.responsiveTextGeometry?.[name] || null,
        viewportEvidence: page.viewportEvidence?.[name] || null,
      }),
    });
  }
  let statePacketIndex = 0;
  for (const scene of values.sceneContract?.scenes || []) {
    for (const interaction of scene.states || []) {
      const observedStates = Array.isArray(interaction.states) && interaction.states.length ? interaction.states : [null];
      for (const observedState of observedStates) {
        statePacketIndex += 1;
        const stateName = typeof observedState === "string"
          ? observedState
          : observedState?.id || observedState?.name || observedState?.phase || interaction.kind || "observed";
        await writePacket(`behavior-state-${String(statePacketIndex).padStart(4, "0")}.packet.json`, {
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          kind: "observation-packet",
          packetType: "behavior-state",
          sourceFingerprint,
          viewport: null,
          state: String(stateName),
          payload: sanitizeEvidence({
            sceneId: scene.id,
            sectionId: scene.sectionId,
            interactionId: interaction.id,
            interactionKind: interaction.kind,
            observation: observedState,
          }),
        });
      }
    }
  }
  return refs;
}

export function sanitizeEvidence(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item, key));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /authorization|cookie|set-cookie|password|token|secret|formvalue/i.test(key)) return "[redacted]";
    if (typeof value === "string" && /domsnapshots?/i.test(key)) return redactDomSecrets(value);
    if (typeof value === "string" && /url$/i.test(key)) return redactUrl(value);
    return value;
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/^(authorization|cookie|set-cookie|password|token|secret|formValue)$/i.test(childKey)) {
      result[childKey] = "[redacted]";
      continue;
    }
    result[childKey] = sanitizeEvidence(childValue, childKey);
  }
  return result;
}

function redactDomSecrets(html) {
  return String(html)
    .replace(/(<input\b[^>]*\bvalue\s*=\s*["'])[^"']*(["'][^>]*>)/gi, "$1[redacted]$2")
    .replace(/(["']?(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[redacted]$2")
    .replace(/(<meta\b[^>]*(?:csrf|token|secret)[^>]*\bcontent\s*=\s*["'])[^"']*(["'][^>]*>)/gi, "$1[redacted]$2");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|password|session|email|code/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function hasFoundationEvidence(tokens) {
  return Boolean(tokens && typeof tokens === "object" && Object.keys(tokens).some((key) => {
    const value = tokens[key];
    return Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : Boolean(value);
  }));
}

function collectFoundationPrimitives(page) {
  const kinds = new Set();
  for (const section of page?.sections || []) {
    const classification = classifyObservedUnit(section, { unitKind: "section", evidenceRef: "observations/page.json" });
    if (["button-group", "card", "accordion", "tabs", "gallery", "carousel", "navigation"].includes(classification.kind)) kinds.add(classification.kind);
  }
  return [...kinds].sort().map((kind) => ({ kind, evidence: "observations/page.json" }));
}

function collectGlobalCssIntent(tokens) {
  return {
    direction: tokens?.direction || tokens?.typography?.direction || "unknown",
    colorRoles: tokens?.colors || tokens?.colorRoles || {},
    typography: tokens?.typography || {},
    spacing: tokens?.spacing || {},
    breakpoints: tokens?.breakpoints || {},
  };
}

function selectChromeAssets(visualAssets) {
  return sanitizeEvidence({ logos: visualAssets?.logos || [], icons: visualAssets?.icons || [] });
}

function selectOwnedInteractions(interactionMap, owner) {
  const interactions = interactionMap?.interactions || [];
  if (owner === "shared-chrome") return interactions.filter((item) => /header|footer|nav|chrome/i.test(`${item.owner || ""} ${item.scope || ""} ${item.target?.selector || ""}`));
  return interactions.filter((item) => item.sectionId === owner || item.ownerUnitId === owner);
}

function resolveClassification({ value, unitId, evidenceRef, patchesByRequest, decisionRequests, appliedDecisions }) {
  const classification = classifyObservedUnit(value, { unitKind: unitId.includes(":component-") ? "component" : "section", evidenceRef });
  if (classification.confidence === "high") return { classification, gaps: [] };
  if (classification.confidence === "low") {
    return {
      classification,
      gaps: [createGap({
        id: `gap:${unitId}:classification`,
        ownerUnitId: unitId,
        missingFields: ["classification"],
        reason: "Classification confidence is below the calibrated decision band.",
        evidenceRefs: [evidenceRef],
        confidence: "low",
        affectedAcceptance: ["classification-specific-behavior", "visual-geometry"],
        assumptions: ["Use the bounded custom builder and preserve observed content/order/layout evidence."],
        omissions: ["Unverified classification-specific behavior."],
      })],
    };
  }
  const choices = [...new Set([classification.kind, value?.variant, "static-content", "bounded-custom"].filter(Boolean))];
  const request = createDecisionRequest({
    id: `decision:${unitId}:classification`,
    decisionType: "classification",
    allowedChoices: choices,
    evidenceRefs: [evidenceRef],
    detectorVersions: { sectionClassification: "0083.1" },
    responseSchema: { type: "string", enum: choices },
  });
  decisionRequests.push(request);
  const patch = patchesByRequest.get(request.id);
  if (patch) {
    try {
      const applied = applyDecisionPatch(request, patch);
      appliedDecisions.push(applied);
      return { classification: { ...classification, kind: applied.choice, confidence: applied.confidence }, gaps: [] };
    } catch (error) {
      return {
        classification,
        gaps: [createGap({
          id: `gap:${unitId}:classification`,
          ownerUnitId: unitId,
          missingFields: ["classification"],
          reason: `The typed classification patch was invalid: ${error.message}`,
          evidenceRefs: [evidenceRef, `decisions/requests.json#/${request.id}`],
          confidence: "medium",
          affectedAcceptance: ["classification-specific-behavior", "visual-geometry"],
          assumptions: ["Use the bounded custom builder until a valid typed decision is supplied."],
          omissions: ["Unverified classification-specific behavior."],
        })],
      };
    }
  }
  return {
    classification,
    gaps: [createGap({
      id: `gap:${unitId}:classification`,
      ownerUnitId: unitId,
      missingFields: ["classification"],
      reason: "Classification requires a bounded typed orchestrating-agent decision.",
      evidenceRefs: [evidenceRef, `decisions/requests.json#/${request.id}`],
      confidence: "medium",
      affectedAcceptance: ["classification-specific-behavior", "visual-geometry"],
      assumptions: ["Use the bounded custom builder if the decision is not supplied before assembly."],
      omissions: ["Unverified classification-specific behavior."],
    })],
  };
}

function gapsForSection(section, sectionId, page, classification) {
  const gaps = [];
  const warnings = [
    ...(section?.diagnostics?.warnings || []),
    ...(page?.sectionDiagnostics?.warnings || []).filter((warning) => String(warning).includes(sectionId)),
  ];
  if (warnings.length) {
    gaps.push(createGap({
      id: `gap:${sectionId}:diagnostics`,
      ownerUnitId: sectionId,
      missingFields: ["diagnostics"],
      reason: warnings.join(" "),
      evidenceRefs: [`observations/page.json#/${sectionId}`],
      confidence: classification.confidence,
      affectedAcceptance: ["classification-specific-behavior", "visual-geometry"],
      assumptions: ["Use the bounded custom builder and preserve observed content/order/layout evidence."],
      omissions: ["Unverified classification-specific behavior."],
    }));
  }
  if (!section?.layoutEvidence && !section?.layout) {
    gaps.push(createGap({
      id: `gap:${sectionId}:layout-evidence`,
      ownerUnitId: sectionId,
      missingFields: ["layout", "styleables"],
      reason: "Viewport layout and styleable-category evidence was not captured for this visible section.",
      evidenceRefs: [`observations/page.json#/${sectionId}`],
      confidence: classification.confidence,
      affectedAcceptance: ["responsive-layout", "visible-layers", "visual-geometry"],
      assumptions: ["Preserve observed content and order in a bounded fluid layout."],
      omissions: ["Unverified authored CSS context and viewport-specific property unions."],
    }));
  }
  return gaps;
}

function contentFor(value, options = {}) {
  return sanitizeEvidence(removeContaminatedContent({
    heading: value?.heading || "",
    text: value?.text || "",
    label: value?.label || "",
    links: value?.links || [],
    items: value?.items || [],
    accessibleName: value?.accessibleName || value?.ariaLabel || value?.a11y?.accessibleName || "",
    icon: value?.icon || null,
  }, options));
}

function contentContaminationGap(unitId, evidenceRef, contamination) {
  const fields = contamination.findings.map((finding) => finding.path).filter(Boolean);
  return createGap({
    id: `gap:${unitId}:content-contamination`,
    ownerUnitId: unitId,
    missingFields: fields.length ? fields : ["content.text"],
    reason: `Content-bearing DOM evidence matched non-rendered source-code signals (${contamination.reasons.join(", ")}). The affected strings were omitted instead of being emitted as page copy.`,
    evidenceRefs: [evidenceRef],
    affectedAcceptance: ["visible-content", "content-fidelity"],
    assumptions: ["Reliable structure, layout, assets, and uncontaminated copy can still be implemented for this unit."],
    omissions: ["Strings that appear to originate from executable script, stylesheet, template, or embedded source markup."],
  });
}

function capabilityRequirementsFor(value, classification) {
  if (value?.capabilityRequirements && typeof value.capabilityRequirements === "object") {
    return sanitizeEvidence(value.capabilityRequirements);
  }
  if (classification.kind !== "button") return {};
  const label = value?.label || value?.heading || value?.text || "";
  const href = (value?.links || []).find((link) => link?.href)?.href || value?.href || "";
  const icon = value?.icon || (value?.images || value?.assets || []).find((asset) => /icon/i.test(`${asset?.role || ""} ${asset?.type || ""}`));
  const accessibleName = value?.accessibleName || value?.ariaLabel || value?.a11y?.accessibleName || "";
  const availableSlots = [
    label ? "label" : null,
    href ? "href" : null,
    icon ? "icon" : null,
    accessibleName ? "accessibleName" : null,
  ].filter(Boolean);
  const composition = href
    ? "as-link"
    : icon && !label
      ? "icon-only"
      : icon && value?.iconPosition === "end"
        ? "trailing-icon"
        : icon
          ? "leading-icon"
          : "text";
  const axes = {};
  if (value?.componentVariant || value?.visualVariant) axes.variant = value.componentVariant || value.visualVariant;
  if (value?.componentSize || value?.controlSize) axes.size = value.componentSize || value.controlSize;
  return {
    axes,
    composition,
    availableSlots,
    requiredSlots: availableSlots,
    requiredStates: ["focus-visible", ...(value?.disabled ? ["disabled"] : [])],
  };
}

function requiresClientRuntime(spec) {
  const behavior = JSON.stringify(spec.behavior || {}).toLowerCase();
  return /accordion|disclosure|tablist|tabpanel|carousel|menuitem|dropdown|toggle|clientstate|client-state|hydration/.test(behavior);
}

function acceptanceFor(value) {
  return {
    required: ["content-order", "responsive-layout", "visible-layers", "keyboard-when-interactive"],
    sourceAssertions: sanitizeEvidence(value?.acceptance || value?.assertions || []),
  };
}

function knownClassification(section) {
  return /hero|navigation|menu|button|accordion|tabs|gallery|carousel|card|repeater|form|banner|footer|content|cta|promo|reviews/i.test(`${section?.kind || ""} ${section?.variant || ""}`);
}

function pathSafe(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-");
}

async function enforceArtifactBudgets(extractionDir, manifest) {
  const total = await directorySize(extractionDir);
  if (total > EXTRACTION_BUDGETS.maxRawEvidenceBytes) {
    const error = new Error(`Extraction evidence exceeds ${EXTRACTION_BUDGETS.maxRawEvidenceBytes} bytes (${total})`);
    error.code = "EXTRACTION_EVIDENCE_BUDGET";
    throw error;
  }
  const specsBytes = Buffer.byteLength(JSON.stringify(manifest));
  if (specsBytes > EXTRACTION_BUDGETS.maxFrozenSpecBytes) {
    const error = new Error(`Frozen manifest exceeds ${EXTRACTION_BUDGETS.maxFrozenSpecBytes} bytes (${specsBytes})`);
    error.code = "EXTRACTION_SPEC_BUDGET";
    throw error;
  }
}

async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(target) : (await stat(target)).size;
  }
  return total;
}

async function main() {
  const args = parseArgs();
  if (!args.out) throw new Error("--out is required");
  const outputDir = path.resolve(String(args.out));
  const docs = docsDir(outputDir);
  const pagePath = args.page || path.join(docs, "pages", "home-home.json");
  const readOptional = async (name, fallback) => {
    try { return await readJson(path.join(docs, name)); } catch { return fallback; }
  };
  const page = await readJson(pagePath);
  const decisionPatchArtifact = args["decision-patches"] ? await readJson(path.resolve(String(args["decision-patches"]))) : [];
  const result = await assembleExtraction({
    outputDir,
    requestedUrl: args.url || page.url,
    resolvedUrl: page.url,
    canonicalUrl: page.seo?.canonical || page.url,
    page,
    assets: await readOptional("assets.json", {}),
    seo: await readOptional("seo.json", page.seo || {}),
    tokens: await readOptional("tokens.json", {}),
    interactionMap: await readOptional("interaction-map.json", {}),
    sceneContract: await readOptional("scene-contract.json", {}),
    layoutBlueprint: await readOptional("layout-blueprint.json", {}),
    uiNormalization: await readOptional("ui-normalization.json", {}),
    controlStateContract: await readOptional("control-state-contract.json", {}),
    visualAssets: await readOptional("visual-assets.json", {}),
    decisionPatches: Array.isArray(decisionPatchArtifact) ? decisionPatchArtifact : decisionPatchArtifact.patches || [],
  });
  console.log(JSON.stringify({ captureId: result.captureId, manifestHash: result.manifest.manifestHash, status: result.manifest.status }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
