#!/usr/bin/env node
import path from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import {
  docsDir,
  ensureDir,
  isAssetLikeUrl,
  normalizeUrl,
  parseArgs,
  readJson,
  resolveOutputDir,
  slugForUrl,
  writeJson,
  writeText,
} from "./lib/common.mjs";
import { ensureBrowserExtractionReady } from "./lib/browser-tooling.mjs";
import { extractPage } from "./extract-page.mjs";
import { extractAssets } from "./extract-assets.mjs";
import { extractInteractions } from "./extract-interactions.mjs";
import { extractSeoForUrl } from "./extract-seo.mjs";
import { extractDesignSystem } from "./extract-design-system.mjs";
import { generateSceneContract } from "./generate-scene-contract.mjs";
import { generateControlStateContract } from "./generate-control-state-contract.mjs";
import { generateVisualAssets } from "./generate-visual-assets.mjs";
import { generateLayoutBlueprint } from "./generate-layout-blueprint.mjs";
import { generateUiNormalization } from "./generate-ui-normalization.mjs";
import { analyzeGapEvidence, renderGapAnalysisMarkdown, renderGapFixPlan } from "./lib/gap-analysis.mjs";

export const MAX_GAP_CYCLES = 5;

async function main() {
  const args = parseArgs();
  const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
  const resultUrlValue = args["result-url"] || args["clone-url"];
  if (!resultUrlValue) throw new Error("Missing --result-url for the running clone, for example http://localhost:4321/");
  const paths = String(args.paths || "").split(",").map((value) => value.trim()).filter(Boolean);
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  const report = await runPostBuildGap({
    sourceUrl,
    resultUrl: normalizeUrl(resultUrlValue).toString(),
    outputDir,
    screenshots: args.screenshots !== "false",
    designExtractor: args["design-extractor"],
    paths,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else console.log(`[gap-analysis] iteration ${String(report.iteration).padStart(3, "0")}: score ${report.summary.score}/100, ${report.summary.blockingCount} blocking gap(s), visual review ${report.visualReview.status}`);
}

export async function runPostBuildGap({ sourceUrl, resultUrl, outputDir, screenshots = true, designExtractor, browserTooling, paths = [] } = {}) {
  if (!sourceUrl || !resultUrl || !outputDir) throw new Error("sourceUrl, resultUrl, and outputDir are required");
  const canonicalDocs = docsDir(outputDir);
  const frozenSource = await loadFrozenSourceEvidence(canonicalDocs);
  const canonicalSourceMap = sanitizeSourceMap(frozenSource.evidence.sourceMap);
  const sourceMap = structuredClone(canonicalSourceMap);
  const selectedPaths = [...new Set(paths.map((value) => new URL(value, sourceUrl).pathname.replace(/\/$/, "") || "/"))];
  if (selectedPaths.length) {
    sourceMap.pages = (sourceMap.pages || []).filter((page) => selectedPaths.includes(new URL(page.url).pathname.replace(/\/$/, "") || "/"));
    if (!sourceMap.pages.length) throw new Error(`No source-map pages matched --paths ${selectedPaths.join(", ")}`);
  }
  const gapRoot = path.join(canonicalDocs, "gap-analysis");
  const previousReport = await readPreviousReport(gapRoot);
  const iteration = await nextIteration(gapRoot);
  const iterationDir = path.join(gapRoot, "iterations", String(iteration).padStart(3, "0"));
  const resultOutputDir = path.join(iterationDir, "result-extraction");
  const sourceEvidence = frozenSource.evidence;
  sourceEvidence.sourceMap = sourceMap;
  const sourceEvidenceReference = {
    root: frozenSource.extractionDir,
    fingerprint: frozenSource.manifest.manifestHash,
    mode: "frozen-manifest-reference",
  };
  await ensureDir(iterationDir);
  await writeJson(path.join(iterationDir, "iteration-manifest.json"), {
    iteration,
    sourceUrl,
    resultUrl,
    paths: selectedPaths,
    sourceEvidence: sourceEvidenceReference,
    status: "extracting",
    startedAt: new Date().toISOString(),
  });

  const tooling = browserTooling || await ensureBrowserExtractionReady({ startDir: process.cwd() });
  const resultEvidence = await extractResultEvidence({
    sourceMap,
    sourceUrl,
    resultUrl,
    resultOutputDir,
    screenshots,
    designExtractor: designExtractor || sourceMap.designExtraction?.selectedExtractor || "auto",
    browserTooling: tooling,
  });
  await attachScreenshotMetadata(sourceEvidence);
  await attachScreenshotMetadata(resultEvidence);
  const report = analyzeGapEvidence({ source: sourceEvidence, result: resultEvidence, iteration });
  report.sourceEvidence = sourceEvidenceReference;
  report.visualProgress = buildVisualProgressRequirement({ previousReport, report });
  report.paths = {
    iterationDir,
    sourceEvidence: canonicalDocs,
    resultExtraction: docsDir(resultOutputDir),
    reportJson: path.join(iterationDir, "gap-analysis.json"),
    reportMarkdown: path.join(iterationDir, "gap-analysis.md"),
    fixPlan: path.join(iterationDir, "gap-fix-plan.md"),
    visualProgress: path.join(iterationDir, "visual-progress.json"),
  };
  if (report.visualProgress.required) await writeJson(report.paths.visualProgress, visualProgressTemplate({ report, previousReport }));
  await writeJson(report.paths.reportJson, report);
  await writeText(report.paths.reportMarkdown, renderGapAnalysisMarkdown(report));
  await writeText(report.paths.fixPlan, renderGapFixPlan(report));
  await writeJson(path.join(gapRoot, "latest.json"), report);
  await writeText(path.join(gapRoot, "latest.md"), renderGapAnalysisMarkdown(report));
  await writeJson(path.join(iterationDir, "iteration-manifest.json"), {
    iteration,
    sourceUrl,
    resultUrl,
    status: "comparison-complete-visual-review-pending",
    startedAt: report.generatedAt,
    completedAt: new Date().toISOString(),
    score: report.summary.score,
    blockingCount: report.summary.blockingCount,
    sourceEvidence: sourceEvidenceReference,
    visualProgress: report.visualProgress,
  });
  return report;
}

async function extractResultEvidence({ sourceMap, sourceUrl, resultUrl, resultOutputDir, screenshots, designExtractor, browserTooling }) {
  await rm(resultOutputDir, { recursive: true, force: true });
  const resultDocs = docsDir(resultOutputDir);
  const pagesDir = path.join(resultDocs, "pages");
  const screenshotsDir = path.join(resultDocs, "screenshots");
  await ensureDir(pagesDir);
  const pages = [];
  for (const [index, sourcePage] of (sourceMap.pages || []).entries()) {
    const comparisonPath = pagePath(sourcePage.url, sourceUrl, index);
    const targetUrl = resultPageUrl(resultUrl, comparisonPath);
    console.log(`[gap-analysis] extracting result page ${targetUrl}`);
    const page = await extractPage(targetUrl, {
      outputDir: resultOutputDir,
      screenshots,
      browserTooling,
      screenshotDir: screenshotsDir,
      screenshotPrefix: "result",
    });
    page.comparisonPath = comparisonPath;
    page.sourceComparisonUrl = sourcePage.url;
    pages.push(page);
    await writeJson(path.join(pagesDir, `${String(index + 1).padStart(3, "0")}-${slugForUrl(targetUrl)}.json`), page);
  }

  const [seo, assets] = await Promise.all([
    extractSeoForUrl(resultUrl),
    extractAssets(resultUrl, { outputDir: resultOutputDir, download: false }),
  ]);
  await writeJson(path.join(resultDocs, "seo.json"), seo);
  await writeJson(path.join(resultDocs, "assets.json"), assets);
  await writeJson(path.join(resultDocs, "fonts.json"), assets.fonts);

  const interactionMap = await extractInteractions(resultUrl, { outputDir: resultOutputDir, pages, browserTooling });
  const enrichedPages = interactionMap.pages?.length ? interactionMap.pages : pages;
  for (const page of enrichedPages) page.comparisonPath ||= pagePath(page.sourceComparisonUrl || page.url, sourceUrl);
  await writeJson(path.join(resultDocs, "interaction-map.json"), interactionMap);
  const resultMap = {
    sourceUrl: resultUrl,
    comparisonSourceUrl: sourceUrl,
    normalizedAt: new Date().toISOString(),
    scope: sourceMap.scope,
    pages: enrichedPages,
    assets: assets.assets,
    fonts: { families: assets.fonts?.families || [], faceCount: assets.fonts?.faces?.length || 0 },
    interactions: interactionMap.summary || {},
    seo,
    tokens: {},
    extractionRole: "post-build-result",
  };
  await writeJson(path.join(resultDocs, "source-map.json"), resultMap);

  console.log("[gap-analysis] extracting result design system and derived contracts");
  const designSystem = await extractDesignSystem({ sourceUrl: resultUrl, outputDir: resultOutputDir, extractor: designExtractor, browserTooling });
  resultMap.tokens = designSystem.tokens;
  resultMap.designExtraction = {
    selectedExtractor: designSystem.selectedExtractor,
    actualExtractor: designSystem.actualExtractor || designSystem.extractor,
    fallbackReason: designSystem.fallbackReason,
  };
  await writeJson(path.join(resultDocs, "tokens.json"), designSystem.tokens);
  await writeJson(path.join(resultDocs, "source-map.json"), resultMap);
  const sceneContract = await generateSceneContract({ outputDir: resultOutputDir, pages: enrichedPages, interactionMap });
  await generateControlStateContract({ outputDir: resultOutputDir, interactionMap });
  await generateVisualAssets({ outputDir: resultOutputDir, pages: enrichedPages, assets });
  const layoutBlueprint = await generateLayoutBlueprint({ outputDir: resultOutputDir, pages: enrichedPages, interactionMap, sceneContract });
  await generateUiNormalization({ outputDir: resultOutputDir, pages: enrichedPages, interactionMap, sceneContract, layoutBlueprint });
  return loadEvidence(resultDocs);
}

async function readPreviousReport(gapRoot) {
  try { return await readJson(path.join(gapRoot, "latest.json")); } catch { return null; }
}

function buildVisualProgressRequirement({ previousReport, report }) {
  const previousBlocking = (previousReport?.findings || []).filter((finding) => ["critical", "high"].includes(finding.severity) && finding.status !== "resolved" && finding.status !== "accepted");
  return {
    required: previousBlocking.length > 0,
    status: previousBlocking.length ? "pending" : "not-applicable",
    previousIteration: previousBlocking.length ? previousReport.iteration : null,
    previousReportPath: previousBlocking.length ? previousReport.paths?.reportJson || null : null,
    previousBlockingFindingIds: previousBlocking.map((finding) => finding.id),
    instructions: "For every prior blocking finding, record a named target section and exact source, before-result, and after-result screenshots. A claimed resolution requires verdict improved.",
  };
}

function visualProgressTemplate({ report, previousReport }) {
  const prior = report.visualProgress.previousBlockingFindingIds;
  const pairs = new Map((report.screenshotPairs || []).map((pair) => [pair.id, pair]));
  const priorPairs = new Map((previousReport?.screenshotPairs || []).map((pair) => [pair.id, pair]));
  return {
    entries: prior.map((findingId) => ({
      priorFindingId: findingId,
      target: "Name the affected section or interaction state.",
      pairId: "Choose the matching screenshot pair ID.",
      sourceScreenshotPath: "Copy the source path for that pair.",
      beforeResultScreenshotPath: "Copy the result path from the prior iteration for that pair.",
      afterResultScreenshotPath: "Copy the result path from this iteration for that pair.",
      beforeObservation: "Describe the visible pre-fix mismatch.",
      afterObservation: "Describe what is visibly closer, unchanged, or worse.",
      verdict: "improved",
      evidence: "State the visible relationship being judged; do not cite only a score or code change.",
    })),
    _templateNote: `Use the source and before/after paths from the matching pair. Current pair IDs: ${[...pairs.keys()].join(", ") || "none"}. Prior pair IDs: ${[...priorPairs.keys()].join(", ") || "available in the prior report"}.`,
  };
}

function sanitizeSourceMap(sourceMap) {
  const sanitized = structuredClone(sourceMap || {});
  const pages = Array.isArray(sanitized.pages) ? sanitized.pages : [];
  sanitized.pages = pages.filter((page) => page?.url && !isAssetLikeUrl(page.url));
  return sanitized;
}

async function loadEvidence(dir) {
  const read = async (name, fallback) => {
    try { return await readJson(path.join(dir, name)); } catch { return fallback; }
  };
  return {
    root: dir,
    sourceMap: await read("source-map.json", { pages: [] }),
    assets: await read("assets.json", { assets: [] }),
    seo: await read("seo.json", {}),
    interactionMap: await read("interaction-map.json", { interactions: [] }),
    sceneContract: await read("scene-contract.json", { scenes: [] }),
    controlStateContract: await read("control-state-contract.json", { controls: [] }),
    visualAssets: await read("visual-assets.json", { logos: [], icons: [] }),
    layoutBlueprint: await read("layout-blueprint.json", { pages: [] }),
    uiNormalization: await read("ui-normalization.json", { sections: [] }),
    tokens: await read("tokens.json", {}),
  };
}

async function loadFrozenSourceEvidence(canonicalDocs) {
  const latest = await readJson(path.join(canonicalDocs, "extraction", "latest.json"));
  const extractionDir = path.join(canonicalDocs, "extraction", latest.captureId);
  const manifest = await readJson(path.join(extractionDir, "extraction-manifest.json"));
  if (manifest.manifestHash !== latest.manifestHash) throw new Error("Frozen source manifest does not match extraction/latest.json");
  const observations = path.join(extractionDir, "observations");
  const page = await readJson(path.join(observations, "page.json"));
  page.screenshots = Object.fromEntries(Object.entries(page.screenshots || {}).map(([viewport, filePath]) => [
    viewport,
    path.isAbsolute(filePath) ? filePath : path.join(observations, filePath),
  ]));
  const read = async (name, fallback) => {
    try { return await readJson(path.join(observations, name)); } catch { return fallback; }
  };
  const seo = await read("seo.json", {});
  const tokens = await read("tokens.json", {});
  return {
    extractionDir,
    manifest,
    evidence: {
      root: extractionDir,
      sourceMap: {
        sourceUrl: page.url,
        scope: "home",
        pages: [page],
        seo,
        tokens,
        designExtraction: tokens.extraction || {},
      },
      assets: await read("assets.json", { assets: [] }),
      seo,
      interactionMap: await read("interaction-map.json", { interactions: [] }),
      sceneContract: await read("scene-contract.json", { scenes: [] }),
      controlStateContract: await read("control-state-contract.json", { controls: [] }),
      visualAssets: await read("visual-assets.json", { logos: [], icons: [] }),
      layoutBlueprint: await read("layout-blueprint.json", { pages: [] }),
      uiNormalization: await read("ui-normalization.json", { sections: [] }),
      tokens,
    },
  };
}

async function attachScreenshotMetadata(evidence) {
  for (const page of evidence.sourceMap.pages || []) {
    page.screenshotMetadata = {};
    for (const [viewport, filePath] of Object.entries(page.screenshots || {})) {
      const metadata = await pngMetadata(filePath);
      if (metadata) page.screenshotMetadata[viewport] = metadata;
    }
  }
}

async function pngMetadata(filePath) {
  try {
    const buffer = await readFile(filePath);
    if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
  } catch {
    return null;
  }
}

async function nextIteration(gapRoot) {
  try {
    const names = await readdir(path.join(gapRoot, "iterations"));
    const numbers = names.map((name) => Number(name)).filter(Number.isInteger);
    const next = Math.max(0, ...numbers) + 1;
    if (next > MAX_GAP_CYCLES) throw new Error(`Maximum of ${MAX_GAP_CYCLES} visual gap cycles reached; finalize the reviewed final iteration as done_with_gaps when blockers remain.`);
    return next;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return 1;
  }
}

function pagePath(pageUrl, sourceUrl, fallbackIndex = 0) {
  try {
    const page = new URL(pageUrl, sourceUrl);
    return page.pathname || "/";
  } catch {
    return fallbackIndex ? `/page-${fallbackIndex + 1}` : "/";
  }
}

function resultPageUrl(resultUrl, pathname) {
  const target = new URL(resultUrl);
  target.pathname = pathname || "/";
  target.search = "";
  target.hash = "";
  return target.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
