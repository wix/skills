import path from "node:path";

const DEFAULT_TOLERANCES = Object.freeze({
  importantRegionPosition: 0.035,
  importantRegionSize: 0.06,
  supportingRegionPosition: 0.06,
  supportingRegionSize: 0.1,
  sectionHeightRatio: { minimum: 0.82, maximum: 1.22 },
  pageHeightRatio: { minimum: 0.82, maximum: 1.22 },
  importantTextInlineSizeRatio: { minimum: 0.9, maximum: 1.1 },
  logoSizeRatio: { minimum: 0.88, maximum: 1.12 },
});

export function analyzeGapEvidence({ source, result, iteration = 1, tolerances = {} }) {
  const limits = mergeTolerances(tolerances);
  const findings = [];
  const sourcePages = source.sourceMap?.pages || [];
  const resultPages = result.sourceMap?.pages || [];
  const sourceLayouts = source.layoutBlueprint?.pages || [];
  const resultLayouts = result.layoutBlueprint?.pages || [];

  for (const [pageIndex, sourcePage] of sourcePages.entries()) {
    const pathname = comparablePath(sourcePage, pageIndex);
    const resultPage = resultPages.find((page, index) => comparablePath(page, index) === pathname) || resultPages[pageIndex];
    const scope = { page: pathname };
    if (!resultPage) {
      addFinding(findings, "critical", "layout", scope, "Result page is missing.", { sourceUrl: sourcePage.url }, "Implement and expose the corresponding route.");
      continue;
    }
    const sourceLayout = sourceLayouts.find((page, index) => comparablePath(page, index) === pathname) || sourceLayouts[pageIndex] || { sections: [] };
    const resultLayout = resultLayouts.find((page, index) => comparablePath(page, index) === pathname) || resultLayouts[pageIndex] || { sections: [] };
    comparePageDimensions({ sourcePage, resultPage, scope, findings, limits });
    compareSections({ sourcePage, resultPage, sourceLayout, resultLayout, scope, findings, limits });
    compareTextInventory({ sourcePage, resultPage, scope, findings });
    compareMediaInventory({ sourcePage, resultPage, scope, findings, limits });
  }

  comparePageCoverage({ sourcePages, resultPages, findings });
  compareAssets({ source, result, findings, limits });
  compareInteractions({ source, result, findings });
  const screenshotPairs = buildScreenshotPairs(sourcePages, resultPages, source.screenshotMetadata, result.screenshotMetadata);
  const counts = countBySeverity(findings);
  const blockingCount = counts.critical + counts.high;
  const score = Math.max(0, Math.round(100 - counts.critical * 25 - counts.high * 10 - counts.medium * 3 - counts.low));
  return {
    schemaVersion: 1,
    iteration,
    generatedAt: new Date().toISOString(),
    policy: {
      goal: "identity-equivalent-with-measured-tolerances-not-universal-pixel-perfection",
      exact: ["visible-text", "section-order-and-major-composition", "identity-bearing-media", "important-dimensions-and-wrapping", "core-interaction-state"],
      tolerant: ["normalized-position-and-size", "section-and-page-height", "local-spacing-and-crop", "composited-color-and-antialiasing"],
      nonBlockingUnlessIdentityChanges: ["consent-infrastructure", "dynamic-third-party-content", "timestamps", "randomized-content", "video-frame-timing", "font-antialiasing"],
      tolerances: limits,
    },
    summary: {
      score,
      findingCount: findings.length,
      counts,
      blockingCount,
      screenshotPairCount: screenshotPairs.length,
      machineAcceptance: blockingCount === 0,
      finalAcceptance: false,
    },
    findings,
    screenshotPairs,
    visualReview: {
      status: screenshotPairs.length ? "pending" : "not-applicable",
      required: screenshotPairs.length > 0,
      instructions: "Open every pair at original size. Add identity-affecting visual findings, then set status to reviewed. Do not fail harmless antialiasing, video-frame, or small crop differences.",
      reviewedPairs: [],
      notes: [],
    },
    fixOrder: ["missing-page-or-section", "text-and-brand-media", "major-composition", "important-dimensions", "core-interactions", "supporting-spacing-and-style"],
    acceptance: {
      passWhen: ["visualReview.status is reviewed or not-applicable", "no open critical findings", "no open high findings"],
      passed: false,
    },
  };
}

function comparePageDimensions({ sourcePage, resultPage, scope, findings, limits }) {
  for (const viewport of ["desktop", "tablet", "mobile"]) {
    const sourceMeta = sourcePage.screenshotMetadata?.[viewport];
    const resultMeta = resultPage.screenshotMetadata?.[viewport];
    if (!sourceMeta || !resultMeta || !sourceMeta.height || !resultMeta.height) continue;
    // Full-page screenshots expand to the document's scroll width. Their PNG width is
    // therefore evidence of horizontal overflow, not the browser viewport requested by
    // the extractor; comparing it would turn a source-only overflow into a false
    // blocking mismatch. Section geometry below remains the authoritative comparison.
    const ratio = resultMeta.height / sourceMeta.height;
    if (!withinRatio(ratio, limits.pageHeightRatio)) {
      addFinding(findings, "high", "dimensions", { ...scope, viewport }, `Full-page height differs materially (${formatRatio(ratio)} of source).`, { source: sourceMeta, result: resultMeta, ratio }, "Review missing/extra sections and section block sizes before adjusting local spacing.", limits.pageHeightRatio);
    }
  }
}

function compareSections({ sourcePage, resultPage, sourceLayout, resultLayout, scope, findings, limits }) {
  const sourceSections = sourceLayout.sections || [];
  const resultSections = resultLayout.sections || [];
  if (sourceSections.length !== resultSections.length) {
    addFinding(findings, "high", "layout", scope, `Section count differs: source ${sourceSections.length}, result ${resultSections.length}.`, { source: sourceSections.length, result: resultSections.length }, "Restore missing sections or remove implementation-only sections.");
  }
  const matches = matchSections(sourceSections, resultSections);
  for (const match of matches) {
    const sourceSection = match.source;
    const resultSection = match.result;
    const sectionScope = { ...scope, section: sourceSection.sectionId };
    if (!resultSection) {
      addFinding(findings, "high", "layout", sectionScope, "Source section has no corresponding result section.", { sourceComposition: sourceSection.composition }, "Implement the section with its original position and composition.");
      continue;
    }
    if (match.sourceIndex !== match.resultIndex) {
      addFinding(findings, "high", "layout", sectionScope, `Section order differs: source position ${match.sourceIndex + 1}, result position ${match.resultIndex + 1}.`, { sourceIndex: match.sourceIndex, resultIndex: match.resultIndex }, "Restore the source section order unless the user explicitly approved the change.");
    }
    if (sourceSection.composition !== resultSection.composition) {
      addFinding(findings, "high", "layout", sectionScope, `Major composition changed from ${sourceSection.composition} to ${resultSection.composition}.`, { source: sourceSection.composition, result: resultSection.composition }, "Rebuild canvas/layers/regions using the source layout blueprint.");
    }
    if (sourceSection.background?.kind !== resultSection.background?.kind && sourceSection.background?.kind !== "none") {
      addFinding(findings, "high", "images", sectionScope, `Background kind changed from ${sourceSection.background?.kind} to ${resultSection.background?.kind}.`, { source: sourceSection.background, result: resultSection.background }, "Restore the source background media/layer model.");
    }
    if (sourceSection.identityLocks?.mediaRole !== resultSection.identityLocks?.mediaRole) {
      addFinding(findings, "high", "layout", sectionScope, `Media role changed from ${sourceSection.identityLocks?.mediaRole} to ${resultSection.identityLocks?.mediaRole}.`, { source: sourceSection.identityLocks?.mediaRole, result: resultSection.identityLocks?.mediaRole }, "Keep background media layered and content media as a peer region exactly as captured.");
    }
    compareSectionHeight(sourceSection, resultSection, sectionScope, findings, limits);
    compareRegions(sourceSection, resultSection, sectionScope, findings, limits);
  }
}

function compareSectionHeight(sourceSection, resultSection, scope, findings, limits) {
  const sourceHeight = Number(sourceSection.canvas?.sourceRect?.height);
  const resultHeight = Number(resultSection.canvas?.sourceRect?.height);
  if (!sourceHeight || !resultHeight) return;
  const ratio = resultHeight / sourceHeight;
  if (!withinRatio(ratio, limits.sectionHeightRatio)) {
    addFinding(findings, "medium", "dimensions", scope, `Section height is ${formatRatio(ratio)} of source.`, { source: sourceHeight, result: resultHeight, ratio }, "Correct the section canvas/min-height before tuning children.", limits.sectionHeightRatio);
  }
}

function compareRegions(sourceSection, resultSection, scope, findings, limits) {
  const used = new Set();
  for (const sourceRegion of sourceSection.regions || []) {
    const candidates = (resultSection.regions || []).map((region, index) => ({ region, index })).filter(({ region, index }) => !used.has(index) && region.role === sourceRegion.role);
    const best = candidates.sort((a, b) => regionMatchScore(sourceRegion, b.region) - regionMatchScore(sourceRegion, a.region))[0];
    if (!best) {
      if (["heading", "action", "media", "tabs"].includes(sourceRegion.role)) addFinding(findings, "high", "layout", { ...scope, region: sourceRegion.role }, `Important ${sourceRegion.role} region is missing.`, { sourceText: sourceRegion.text }, "Restore the semantic region in this section.");
      continue;
    }
    used.add(best.index);
    const resultRegion = best.region;
    const important = ["heading", "action", "media", "tabs"].includes(sourceRegion.role);
    const positionLimit = important ? limits.importantRegionPosition : limits.supportingRegionPosition;
    const sizeLimit = important ? limits.importantRegionSize : limits.supportingRegionSize;
    const delta = rectDelta(sourceRegion.normalizedRect, resultRegion.normalizedRect);
    if (delta.position > positionLimit || delta.size > sizeLimit) {
      addFinding(findings, important ? "high" : "medium", "dimensions", { ...scope, region: sourceRegion.role }, `${sourceRegion.role} geometry exceeds tolerance (position Δ ${round(delta.position)}, size Δ ${round(delta.size)}).`, { source: sourceRegion.normalizedRect, result: resultRegion.normalizedRect, delta }, "Apply the source normalized rectangle/container relationship at the matching viewport.", { position: positionLimit, size: sizeLimit });
    }
    const sourceGeometry = sourceRegion.textGeometry;
    const resultGeometry = resultRegion.textGeometry;
    if (sourceGeometry?.lineCount && resultGeometry?.lineCount && sourceGeometry.lineCount !== resultGeometry.lineCount) {
      addFinding(findings, sourceRegion.role === "heading" ? "high" : "medium", "text", { ...scope, region: sourceRegion.role }, `Line count differs: source ${sourceGeometry.lineCount}, result ${resultGeometry.lineCount}.`, { source: sourceGeometry, result: resultGeometry }, "Restore the measured inline size/wrap policy before changing font size.");
    }
    if (sourceGeometry?.inlineSize && resultGeometry?.inlineSize) {
      const ratio = resultGeometry.inlineSize / sourceGeometry.inlineSize;
      if (!withinRatio(ratio, limits.importantTextInlineSizeRatio) && important) {
        addFinding(findings, "high", "dimensions", { ...scope, region: sourceRegion.role }, `Important text inline size is ${formatRatio(ratio)} of source.`, { source: sourceGeometry.inlineSize, result: resultGeometry.inlineSize, ratio }, "Apply the captured width/max-width at this viewport.", limits.importantTextInlineSizeRatio);
      }
    }
  }
}

function compareTextInventory({ sourcePage, resultPage, scope, findings }) {
  const sourceText = textInventory(sourcePage);
  const resultText = textInventory(resultPage);
  for (const item of sourceText) {
    const exact = resultText.some((candidate) => candidate.text === item.text);
    if (exact) continue;
    const similarity = Math.max(0, ...resultText.map((candidate) => textSimilarity(item.text, candidate.text)));
    if (similarity < 0.92) {
      addFinding(findings, ["heading", "action", "tabs"].includes(item.role) ? "high" : "medium", "text", { ...scope, role: item.role }, `Visible source text is missing or changed: “${truncate(item.text, 140)}”`, { similarity }, "Use the extracted source copy verbatim unless the user approved editorial changes.");
    }
  }
}

function compareMediaInventory({ sourcePage, resultPage, scope, findings, limits }) {
  const sourceMedia = mediaInventory(sourcePage);
  const resultMedia = mediaInventory(resultPage);
  if (sourceMedia.length > resultMedia.length) {
    addFinding(findings, "high", "images", scope, `Result exposes fewer meaningful media surfaces (${resultMedia.length}) than source (${sourceMedia.length}).`, { source: sourceMedia, result: resultMedia }, "Restore missing source images/video and their background/content roles.");
  }
  for (const sourceItem of sourceMedia) {
    const best = resultMedia.map((item) => ({ item, score: mediaMatchScore(sourceItem, item) })).sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 2) {
      addFinding(findings, sourceItem.kind === "logo" ? "critical" : "high", "images", scope, `Source ${sourceItem.kind} is not confidently matched in the result: ${sourceItem.label || sourceItem.identity || "unnamed media"}.`, { source: sourceItem, nearest: best || null }, "Use the exact source asset; do not recreate brand media.");
      continue;
    }
    if (sourceItem.kind === "logo" && sourceItem.width && best.item.width) {
      const ratio = best.item.width / sourceItem.width;
      if (!withinRatio(ratio, limits.logoSizeRatio)) addFinding(findings, "high", "dimensions", scope, `Logo width is ${formatRatio(ratio)} of source.`, { source: sourceItem, result: best.item, ratio }, "Apply the captured logo variant and target size.", limits.logoSizeRatio);
    }
  }
}

function compareAssets({ source, result, findings }) {
  const sourceAssets = source.assets?.assets || [];
  const resultAssets = result.assets?.assets || [];
  const sourceImages = sourceAssets.filter((item) => /image|svg|video/i.test(item.type || "") || /\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)(\?|$)/i.test(item.sourceUrl || ""));
  const resultNames = new Set(resultAssets.map((item) => assetName(item.sourceUrl)).filter(Boolean));
  const missing = sourceImages.filter((item) => {
    const name = assetName(item.sourceUrl);
    return name && !resultNames.has(name);
  });
  if (missing.length && missing.length / Math.max(1, sourceImages.length) > 0.35) {
    addFinding(findings, "medium", "images", { page: "site-wide" }, `${missing.length} of ${sourceImages.length} source image/media filenames were not observed in result asset extraction.`, { examples: missing.slice(0, 12).map((item) => item.sourceUrl) }, "Review the screenshot pairs and media inventory; restore assets that belong to in-scope visible sections.");
  }
}

function compareInteractions({ source, result, findings }) {
  const sourceCore = (source.interactionMap?.interactions || []).filter((item) => item.importance === "core");
  const resultKinds = new Map();
  for (const item of result.interactionMap?.interactions || []) resultKinds.set(item.kind, (resultKinds.get(item.kind) || 0) + 1);
  for (const [kind, count] of frequencies(sourceCore.map((item) => item.kind))) {
    const actual = resultKinds.get(kind) || 0;
    if (actual < count) addFinding(findings, "high", "interactions", { page: "site-wide" }, `Core interaction coverage for ${kind} is lower in result (${actual}) than source (${count}).`, { source: count, result: actual }, "Restore the missing stateful scene/control behavior and rerun interaction extraction.");
  }
}

function comparePageCoverage({ sourcePages, resultPages, findings }) {
  if (resultPages.length > sourcePages.length) addFinding(findings, "low", "layout", { page: "site-wide" }, `Result extraction contains ${resultPages.length - sourcePages.length} additional page record(s).`, {}, "Confirm they are intentional routes; additional pages do not block fidelity by themselves.");
}

export function matchSections(sourceSections, resultSections) {
  const used = new Set();
  return sourceSections.map((source, sourceIndex) => {
    let best = null;
    for (const [resultIndex, result] of resultSections.entries()) {
      if (used.has(resultIndex)) continue;
      const score = sectionMatchScore(source, result, sourceIndex, resultIndex);
      if (!best || score > best.score) best = { result, resultIndex, score };
    }
    if (!best) return { source, sourceIndex, result: null, resultIndex: null, confidence: 0 };
    used.add(best.resultIndex);
    return { source, sourceIndex, result: best.result, resultIndex: best.resultIndex, confidence: round(Math.max(0, Math.min(1, best.score / 10))) };
  });
}

function sectionMatchScore(source, result, sourceIndex, resultIndex) {
  const sourceHeading = sectionHeading(source);
  const resultHeading = sectionHeading(result);
  let score = Math.max(0, 3 - Math.abs(sourceIndex - resultIndex));
  if (source.sectionId === result.sectionId) score += 2;
  if (sourceHeading && resultHeading) score += textSimilarity(sourceHeading, resultHeading) * 6;
  if (source.composition === result.composition) score += 2;
  if (source.sourceClassification?.kind === result.sourceClassification?.kind) score += 1;
  return score;
}

function buildScreenshotPairs(sourcePages, resultPages, sourceMetadata = {}, resultMetadata = {}) {
  const pairs = [];
  for (const [index, sourcePage] of sourcePages.entries()) {
    const pathname = comparablePath(sourcePage, index);
    const resultPage = resultPages.find((page, resultIndex) => comparablePath(page, resultIndex) === pathname) || resultPages[index];
    if (!resultPage) continue;
    for (const viewport of ["desktop", "tablet", "mobile"]) {
      const sourcePath = sourcePage.screenshots?.[viewport];
      const resultPath = resultPage.screenshots?.[viewport];
      if (!sourcePath || !resultPath) continue;
      pairs.push({
        id: `${slug(pathname)}-${viewport}`,
        page: pathname,
        viewport,
        source: { path: sourcePath, metadata: sourcePage.screenshotMetadata?.[viewport] || sourceMetadata[sourcePath] || null },
        result: { path: resultPath, metadata: resultPage.screenshotMetadata?.[viewport] || resultMetadata[resultPath] || null },
        reviewStatus: "pending",
      });
    }
  }
  return pairs;
}

function textInventory(page) {
  const records = [];
  for (const section of page.sections || []) {
    for (const region of section.layoutEvidence?.regions || []) {
      const text = normalizeText(region.text);
      if (text.length >= 2 && text.length <= 1200 && !looksLikeCode(text)) records.push({ role: region.role || "content", text });
    }
  }
  return dedupe(records, (item) => `${item.role}:${item.text}`);
}

function mediaInventory(page) {
  const records = [];
  for (const asset of page.visualAssets || []) {
    if (asset.kind === "icon") continue;
    records.push({ kind: asset.kind || "image", identity: asset.sourceUrl || asset.useHref || markupIdentity(asset), label: normalizeText(asset.accessibleName), context: asset.context, width: Number(asset.renderedSize?.width) || 0, height: Number(asset.renderedSize?.height) || 0 });
  }
  for (const section of page.sections || []) {
    for (const layer of section.layoutEvidence?.layers || []) {
      if (!["image", "video"].includes(layer.kind)) continue;
      records.push({ kind: layer.kind, identity: layer.src || layer.background?.image || "", label: section.heading || "", context: "section-layer", width: Number(layer.rect?.width) || 0, height: Number(layer.rect?.height) || 0 });
    }
  }
  return dedupe(records.filter((item) => item.identity || item.label), (item) => `${item.kind}:${item.identity}:${item.context}`);
}

function mediaMatchScore(source, result) {
  let score = 0;
  if (source.kind === result.kind) score += 2;
  if (source.identity && result.identity && source.identity === result.identity) score += 6;
  if (assetName(source.identity) && assetName(source.identity) === assetName(result.identity)) score += 5;
  if (source.label && result.label) score += textSimilarity(source.label, result.label) * 3;
  if (source.context && source.context === result.context) score += 1;
  return score;
}

function markupIdentity(asset) {
  return normalizeText(asset.symbolMarkup || asset.svgMarkup || "").replace(/\s+/g, "").slice(0, 300);
}

function sectionHeading(section) {
  return normalizeText((section.regions || []).find((region) => region.role === "heading")?.text || section.sourceClassification?.heading || "");
}

function regionMatchScore(source, result) {
  let score = source.role === result.role ? 3 : 0;
  if (source.text && result.text) score += textSimilarity(source.text, result.text) * 5;
  if (source.placement === result.placement) score += 1;
  return score;
}

function rectDelta(source = {}, result = {}) {
  const dx = Math.abs(Number(source.x) - Number(result.x));
  const dy = Math.abs(Number(source.y) - Number(result.y));
  const dw = Math.abs(Number(source.width) - Number(result.width));
  const dh = Math.abs(Number(source.height) - Number(result.height));
  return { position: Math.max(finite(dx), finite(dy)), size: Math.max(finite(dw), finite(dh)) };
}

function addFinding(findings, severity, category, scope, message, evidence = {}, repairHint = "", tolerance = null) {
  findings.push({ id: `gap-${String(findings.length + 1).padStart(3, "0")}`, severity, category, status: "open", scope, message, evidence, ...(tolerance ? { tolerance } : {}), repairHint });
}

function countBySeverity(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function mergeTolerances(input) {
  return { ...DEFAULT_TOLERANCES, ...input, sectionHeightRatio: { ...DEFAULT_TOLERANCES.sectionHeightRatio, ...(input.sectionHeightRatio || {}) }, pageHeightRatio: { ...DEFAULT_TOLERANCES.pageHeightRatio, ...(input.pageHeightRatio || {}) }, importantTextInlineSizeRatio: { ...DEFAULT_TOLERANCES.importantTextInlineSizeRatio, ...(input.importantTextInlineSizeRatio || {}) }, logoSizeRatio: { ...DEFAULT_TOLERANCES.logoSizeRatio, ...(input.logoSizeRatio || {}) } };
}

function comparablePath(page, index) {
  if (page.comparisonPath) return normalizePath(page.comparisonPath);
  try { return normalizePath(new URL(page.url).pathname); } catch { return `/${index}`; }
}

function normalizePath(value) {
  const normalized = `/${String(value || "").replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "/" : normalized;
}

function textSimilarity(a, b) {
  const left = new Set(normalizeText(a).toLowerCase().split(/\s+/).filter(Boolean));
  const right = new Set(normalizeText(b).toLowerCase().split(/\s+/).filter(Boolean));
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

function normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function looksLikeCode(value) { return /document\.|function\s*\(|=>|getElementById|classList\./.test(value); }
function assetName(value) { try { return path.basename(new URL(value, "https://local.invalid").pathname).toLowerCase().replace(/-[a-f0-9]{8}(?=\.)/, ""); } catch { return ""; } }
function withinRatio(value, range) { return Number.isFinite(value) && value >= range.minimum && value <= range.maximum; }
function formatRatio(value) { return `${round(value * 100)}%`; }
function round(value) { return Number((Number(value) || 0).toFixed(3)); }
function finite(value) { return Number.isFinite(value) ? value : 0; }
function truncate(value, max) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function frequencies(values) { const map = new Map(); for (const value of values) map.set(value, (map.get(value) || 0) + 1); return map; }
function dedupe(values, key) { const seen = new Set(); return values.filter((value) => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; }); }
function slug(value) { return String(value || "home").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "home"; }

export function renderGapAnalysisMarkdown(report) {
  const summary = report.summary;
  const findings = report.findings.map((finding) => `- **${finding.severity.toUpperCase()} · ${finding.category} · ${finding.id}** — ${finding.message}\n  - Scope: \`${JSON.stringify(finding.scope)}\`\n  - Fix: ${finding.repairHint}`).join("\n") || "_No deterministic gaps found._";
  const pairs = report.screenshotPairs.map((pair) => `- \`${pair.id}\` — ${pair.page}, ${pair.viewport}\n  - Source: \`${pair.source.path}\`\n  - Result: \`${pair.result.path}\``).join("\n") || "_No screenshot pairs._";
  return `# Post-build gap analysis — iteration ${String(report.iteration).padStart(3, "0")}\n\nScore: **${summary.score}/100**. Blocking findings: **${summary.blockingCount}**. Visual review: **${report.visualReview.status}**.\n\nThis is an identity comparison with measured tolerances, not a universal pixel-perfect test.\n\n## Findings\n\n${findings}\n\n## Screenshot review queue\n\nOpen every pair at original size and record only identity-affecting differences. Ignore harmless antialiasing, dynamic video frames, consent UI, and small crop differences within tolerance.\n\n${pairs}\n\n## Fix order\n\n${report.fixOrder.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n`;
}

export function renderGapFixPlan(report) {
  const blocking = report.findings.filter((finding) => ["critical", "high"].includes(finding.severity));
  const supporting = report.findings.filter((finding) => finding.severity === "medium");
  const rows = (items) => items.map((finding) => `- [ ] \`${finding.id}\` ${finding.message}\n  - ${finding.repairHint}`).join("\n") || "- [x] None";
  return `# Gap fix plan — iteration ${String(report.iteration).padStart(3, "0")}\n\nDo not begin fixes until the screenshot queue in \`gap-analysis.json\` is reviewed. Fix identity and structure before polish.\n\n## Blocking\n\n${rows(blocking)}\n\n## Supporting\n\n${rows(supporting)}\n\n## Completion\n\n- [ ] Build succeeds.\n- [ ] Result extraction rerun as a new iteration.\n- [ ] No open critical/high findings.\n- [ ] Screenshot review completed.\n`;
}
