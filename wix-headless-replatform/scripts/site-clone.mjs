#!/usr/bin/env node
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import {
  businessNameFromProject,
  docsDir,
  ensureDir,
  parseArgs,
  writeJson,
  writeText,
} from "./lib/common.mjs";
import {
  createFrontendAutomationState,
  renderScopeSummary,
  resolveFrontendContext,
  updateScopeSummaryCheckpoint,
  writeFrontendAutomationState,
} from "./lib/frontend-automation-state.mjs";
import { discover } from "./discover-urls.mjs";
import { ensureBrowserExtractionReady } from "./lib/browser-tooling.mjs";
import { extractPage } from "./extract-page.mjs";
import { extractAssets } from "./extract-assets.mjs";
import { extractInteractions } from "./extract-interactions.mjs";
import { extractSeoForUrl } from "./extract-seo.mjs";
import { extractDesignSystem } from "./extract-design-system.mjs";
import { generateDesignMd } from "./generate-design-md.mjs";
import { generateSceneContract } from "./generate-scene-contract.mjs";
import { generateLayoutBlueprint } from "./generate-layout-blueprint.mjs";
import { generateUiNormalization } from "./generate-ui-normalization.mjs";
import { generateControlStateContract } from "./generate-control-state-contract.mjs";
import { generateVisualAssets } from "./generate-visual-assets.mjs";
import { createWixProject, ensureYarnProjectBoundary, verifyWixRuntimeProject } from "./create-wix-project.mjs";
import { validateProjectFontFaces } from "./lib/font-contract.mjs";
import { visualQa } from "./visual-qa.mjs";
import { buildExtractedHomepage } from "./build-extracted-homepage.mjs";
import { resolveHomePage } from "./resolve-home-page.mjs";
import { assembleExtraction } from "./assemble-extraction.mjs";
import { finalizeExtractionReport } from "./finalize-extraction-report.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const args = parseArgs();
  const context = await resolveFrontendContext({ args });
  const requestedSourceUrl = context.sourceUrl;
  let sourceUrl = requestedSourceUrl;
  const scope = context.scope;
  const outputDir = context.outputDir;
  const projectName = path.basename(outputDir);
  const docs = docsDir(outputDir);
  const runId = `site-clone-${Date.now().toString(36)}`;
  const automationState = createFrontendAutomationState(context);

  if (scope !== "home" || context.explicitUrls.length) {
    throw new Error("Spec 0083 currently implements the home-page workflow only. Remove --urls and use --scope home; additional-page resolution requires a future approved workflow.");
  }

  // Standalone runs must own one runnable project directory. Create it before
  // writing extraction artifacts: the Wix CLI will not scaffold into a folder
  // that already contains docs/site-clone or downloaded assets.
  const shouldProvision = context.mode === "standalone" && scope === "home" && !context.explicitUrls.length;
  let wixProject = null;
  if (shouldProvision) {
    wixProject = await ensureStandaloneWixProject({ sourceUrl, outputDir, projectName, args });
  } else if (context.mode === "migration_phase" && context.frontendPhase === "build") {
    await ensureYarnProjectBoundary(outputDir);
    const runtime = await verifyWixRuntimeProject(outputDir);
    if (!runtime.ok) {
      throw new Error(`Migration phase build requires the existing frontend project to be runnable: ${runtime.summary}`);
    }
    wixProject = { executed: true, reused: true, migrationManaged: true, ...runtime };
  }
  await ensureDir(docs);
  await assertNoLegacyResume(docs, args);
  await prepareCanonicalDocsDir(docs);
  console.log("[site-clone] resolving home page");
  const resolution = await resolveHomePage(requestedSourceUrl);
  if (!resolution.artifact) {
    await writeJson(path.join(docs, "page-resolution.spec.json"), {
      schemaVersion: "0083.1",
      kind: "page-resolution",
      gaps: resolution.gaps,
    });
    const error = new Error(resolution.gaps[0]?.reason || "Home-page resolution failed");
    error.code = "PAGE_RESOLUTION_BLOCKED";
    throw error;
  }
  sourceUrl = resolution.artifact.source.resolvedUrl;
  await writeJson(path.join(docs, "page-resolution.spec.json"), resolution.artifact);
  await writeJson(path.join(docs, "run-manifest.json"), {
    runId,
    sourceUrl,
    outputDir,
    mode: context.mode,
    automationMode: context.automationMode,
    frontendPhase: context.frontendPhase,
    handoffPath: context.handoffPath,
    startedAt: new Date().toISOString(),
  });
  await writeFrontendAutomationState(outputDir, automationState);

  const explicitUrls = context.explicitUrls;
  console.log(`[site-clone] discovery started (${scope}${explicitUrls.length ? `, explicit URLs: ${explicitUrls.length}` : ""})`);
  const discovery = await discover({ sourceUrl, scope, explicitUrls });
  await writeJson(path.join(docs, "discovery.json"), discovery);
  const scopeSummaryPath = path.join(docs, "scope-summary.md");
  await writeText(scopeSummaryPath, renderScopeSummary(context, discovery));
  console.log(`[site-clone] discovery complete: ${discovery.totalDiscovered} page(s), ${discovery.representativePages.length} representative page(s)`);

  if (discovery.requiresConfirmation && !args.yes && !context.autoApprove) {
    updateScopeSummaryCheckpoint(automationState, {
      status: "pending",
      discovery,
      artifactRefs: ["docs/site-clone/discovery.json", "docs/site-clone/scope-summary.md"],
      notes: "Non-homepage scope requires confirmation before extraction/building in manual mode.",
    });
    await writeFrontendAutomationState(outputDir, automationState);
    printConfirmationSummary(discovery, outputDir);
    console.log("");
    console.log("Review the scope above, then rerun with --yes to continue or pass --urls/--scope to adjust.");
    return;
  }
  updateScopeSummaryCheckpoint(automationState, {
    status: "approved",
    discovery,
    artifactRefs: ["docs/site-clone/discovery.json", "docs/site-clone/scope-summary.md"],
    decidedBy: context.autoApprove ? "agent" : discovery.requiresConfirmation ? "user" : "system",
    notes: context.autoApprove
      ? "Migration phase 1-click mode auto-approved the frontend scope summary."
      : discovery.requiresConfirmation
        ? "Scope summary confirmed by explicit --yes continuation."
        : "Scope confirmation was not required for this run.",
  });
  await writeFrontendAutomationState(outputDir, automationState);

  console.log("[site-clone] browser preflight started");
  const browserTooling = await ensureBrowserExtractionReady({ startDir: process.cwd() });
  console.log("[site-clone] browser preflight complete");
  const extractionWarnings = [];

  const pages = [];
  const pagesDir = path.join(docs, "pages");
  await ensureDir(pagesDir);
  for (const page of discovery.representativePages) {
    console.log(`[site-clone] extracting page ${page.path || page.url}`);
    const extracted = await extractPage(page.url, { outputDir, screenshots: args.screenshots !== "false", browserTooling });
    pages.push(extracted);
    await writeJson(path.join(pagesDir, `${safePageName(page)}.json`), extracted);
  }

  console.log("[site-clone] extracting SEO and assets");
  const seo = await extractSeoForUrl(sourceUrl);
  const assets = await extractAssets(sourceUrl, { outputDir, download: args.download !== "false" });
  await writeJson(path.join(docs, "seo.json"), seo);
  await writeJson(path.join(docs, "assets.json"), assets);
  await writeJson(path.join(docs, "fonts.json"), assets.fonts);

  console.log("[site-clone] extracting interactions");
  const interactionMap = await loadOrExtractInteractions({ sourceUrl, outputDir, browserTooling });
  await writeJson(path.join(docs, "interaction-map.json"), interactionMap);
  const enrichedPages = interactionMap.pages?.length ? interactionMap.pages : pages;
  pages.length = 0;
  pages.push(...enrichedPages);
  for (const page of pages) {
    await writeJson(path.join(pagesDir, `${safePageName(page)}.json`), page);
  }

  const sourceMap = {
    sourceUrl,
    normalizedAt: new Date().toISOString(),
    scope: discovery.scope,
    project: {
      name: projectName,
      outputDir,
      businessName: args["business-name"] || businessNameFromProject(projectName),
    },
    discovery,
    pages,
    assets: assets.assets,
    fonts: {
      families: assets.fonts?.families || [],
      faceCount: assets.fonts?.faces?.length || 0,
      contentScripts: assets.fonts?.contentScripts || [],
    },
    interactions: {
      interactionCount: interactionMap.summary?.interactionCount || 0,
      kinds: interactionMap.summary?.kinds || {},
      targetCount: interactionMap.summary?.targetCount || 0,
      meaningfulCaptureCount: interactionMap.summary?.meaningfulCaptureCount || 0,
    },
    seo,
    tokens: {},
    extractionWarnings,
  };
  await writeJson(path.join(docs, "source-map.json"), sourceMap);

  console.log("[site-clone] extracting design system");
  const designSystem = await extractDesignSystem({
    sourceUrl,
    outputDir,
    extractor: args["design-extractor"],
    browserTooling,
  });
  const tokens = designSystem.tokens;
  sourceMap.tokens = tokens;
  sourceMap.designExtraction = {
    selectedExtractor: designSystem.selectedExtractor,
    actualExtractor: designSystem.actualExtractor || designSystem.extractor,
    fallbackReason: designSystem.fallbackReason,
    attempts: designSystem.attempts || [],
  };
  await writeJson(path.join(docs, "tokens.json"), tokens);
  await writeJson(path.join(docs, "source-map.json"), sourceMap);

  console.log("[site-clone] projecting interaction, visual, and layout observations");
  const sceneContract = await generateSceneContract({ outputDir, pages, interactionMap });
  const controlStateContract = await generateControlStateContract({ outputDir, interactionMap });
  const visualAssets = await generateVisualAssets({ outputDir, pages, assets });
  const layoutBlueprint = await generateLayoutBlueprint({ outputDir, pages, interactionMap, sceneContract });
  const uiNormalization = await generateUiNormalization({ outputDir, pages, interactionMap, sceneContract, layoutBlueprint });
  const designMd = designSystem.designMd?.trim()
    ? designSystem.designMd
    : await generateDesignMd({ outputDir, sourceUrl });
  await writeText(path.join(docs, "design.md"), `${designMd.trim()}\n\n${renderVisualAssetsDesignSummary(visualAssets)}\n\n${renderControlStateDesignSummary(controlStateContract)}\n\n${renderLayoutBlueprintDesignSummary(layoutBlueprint)}\n\n${renderUiNormalizationDesignSummary(uiNormalization)}\n`);
  console.log("[site-clone] assembling and freezing extraction specs");
  const decisionPatches = args["decision-patches"]
    ? JSON.parse(await readFile(path.resolve(String(args["decision-patches"])), "utf8"))
    : [];
  const extraction = await assembleExtraction({
    outputDir,
    requestedUrl: requestedSourceUrl,
    resolvedUrl: sourceUrl,
    canonicalUrl: resolution.artifact.source.canonicalUrl,
    page: pages[0],
    assets,
    seo,
    tokens,
    interactionMap,
    sceneContract,
    layoutBlueprint,
    uiNormalization,
    controlStateContract,
    visualAssets,
    sourceFingerprint: resolution.artifact.source.fingerprint,
    decisionPatches: Array.isArray(decisionPatches) ? decisionPatches : decisionPatches.patches || [],
    pageResolutionArtifact: resolution.artifact,
  });
  await removeLegacyExtractionHandoffs(docs);
  if (context.frontendPhase === "build" && scope === "home") {
    console.log(`[site-clone] building home page from frozen manifest ${extraction.manifest.manifestHash}`);
    await installInteractionRuntime(outputDir);
    await buildExtractedHomepage({ outputDir });
  }

  if (!wixProject && context.mode === "standalone") {
    console.log("[site-clone] preparing Wix project metadata");
    wixProject = await createWixProject({
      sourceUrl,
      outputDir,
      projectName,
      businessName: args["business-name"] || businessNameFromProject(projectName),
      template: args.template,
      execute: Boolean(args["execute-create"]),
    });
  }
  if (wixProject?.executed) {
    const runtime = await verifyWixRuntimeProject(outputDir);
    if (!runtime.ok) throw new Error(`Wix project contract failed: ${runtime.summary}`);
  }

  let qa = null;
  let fontValidation = null;
  if (context.frontendPhase === "build") {
    console.log("[site-clone] running visual QA");
    qa = await visualQa({ outputDir });
    fontValidation = await validateProjectFontFaces({ projectRoot: outputDir, fontManifest: assets.fonts });
    await writeJson(path.join(docs, "qa", "visual-qa.json"), qa);
    await writeJson(path.join(docs, "qa", "font-validation.json"), fontValidation);
    const finalReport = await finalizeExtractionReport({ outputDir });
    console.log(`[site-clone] reconstruction status: ${finalReport.status}`);
  }
  await writeJson(path.join(docs, "run-manifest.json"), {
    runId,
    sourceUrl,
    outputDir,
    scope: discovery.scope,
    mode: context.mode,
    automationMode: context.automationMode,
    frontendPhase: context.frontendPhase,
    handoffPath: context.handoffPath,
    representativePages: discovery.representativePages.map((page) => page.url),
    actualDesignExtractor: designSystem.actualExtractor || designSystem.extractor,
    completedAt: new Date().toISOString(),
  });

  console.log(`Site clone artifacts written to ${docs}`);
  console.log(`Output project: ${outputDir}`);
  if (context.frontendPhase === "plan") {
    console.log("Migration phase plan mode completed: extraction and planning artifacts were refreshed, and build-only project verification/QA were intentionally skipped.");
  } else if (!wixProject?.executed) {
    console.log("Wix project creation command prepared:");
    console.log(wixProject.command);
    console.log("Run with --execute-create when ready to create the Wix Headless project.");
  }
  if (wixProject?.localOutputRename) {
    console.log(`Wix CLI folder name normalized to "${wixProject.wixFolderName}" and should be renamed to "${projectName}" after creation.`);
  }
  if (qa) {
    console.log(`Heuristic QA score: ${qa.score}/100`);
    console.log("After implementation: start the clone, run post-build-gap.mjs with --result-url, review every screenshot pair, then complete the bounded gap-fix loop.");
  }
}

async function ensureStandaloneWixProject({ sourceUrl, outputDir, projectName, args }) {
  const packagePath = path.join(outputDir, "package.json");
  try {
    await readFile(packagePath, "utf8");
    await ensureYarnProjectBoundary(outputDir);
    const existing = await verifyWixRuntimeProject(outputDir);
    if (!existing.ok) throw new Error(`Existing standalone output is not a runnable Wix project: ${existing.summary}`);
    console.log("[site-clone] reusing existing Wix project");
    return { executed: true, reused: true, ...existing };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log("[site-clone] provisioning Wix project before extraction");
  return createWixProject({
    sourceUrl,
    outputDir,
    projectName,
    businessName: args["business-name"] || businessNameFromProject(projectName),
    template: args.template,
    execute: true,
  });
}

async function loadOrExtractInteractions({ sourceUrl, outputDir, browserTooling }) {
  const artifact = path.join(docsDir(outputDir), "interaction-map.json");
  try {
    const existing = JSON.parse(await readFile(artifact, "utf8"));
    if (existing.sourceUrl === sourceUrl && Array.isArray(existing.interactions)) {
      console.log("[site-clone] reusing completed interaction map");
      return existing;
    }
  } catch {
    // No compatible checkpoint; perform a fresh extraction below.
  }
  return extractInteractionsIsolated({ sourceUrl, outputDir, browserTooling });
}

async function extractInteractionsIsolated({ sourceUrl, outputDir, browserTooling }) {
  const script = new URL("./extract-interactions.mjs", import.meta.url);
  try {
    await execFileAsync(process.execPath, [
      script.pathname,
      sourceUrl,
      "--out",
      outputDir,
      "--project-root",
      browserTooling.projectRoot,
    ], { timeout: 240000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`interaction extraction failed: ${error.stderr || error.message}`);
  }
  const artifact = path.join(docsDir(outputDir), "interaction-map.json");
  try { return JSON.parse(await readFile(artifact, "utf8")); }
  catch { throw new Error("interaction extraction exited without interaction-map.json"); }
}

async function prepareCanonicalDocsDir(docs) {
  const generatedPaths = [
    "pages",
    "components",
    "screenshots",
    "design-md-generator",
    ".design-md-generator-run",
    "design.md",
    "discovery.json",
    "routes.json",
    "repeater-cms.json",
    "repeater-cms.md",
    "source-map.json",
    "seo.json",
    "assets.json",
    "interaction-qa.json",
    "scene-contract.json",
    "control-state-contract.json",
    "control-state-contract.md",
    "visual-assets.json",
    "visual-assets.md",
    "layout-blueprint.json",
    "layout-blueprint.md",
    "ui-normalization.json",
    "ui-normalization.md",
    "fonts.json",
    "font-validation.json",
    "tokens.json",
    "visual-qa.json",
    "scope-summary.md",
    "frontend-automation-state.json",
    "run-manifest.json",
    "page-resolution.spec.json",
    "extraction",
    "build",
    "qa",
    "gap-analysis",
    "final-report.json",
    "final-report.md",
  ];
  for (const relativePath of generatedPaths) {
    await rm(path.join(docs, relativePath), { recursive: true, force: true });
  }
}

async function assertNoLegacyResume(docs, args) {
  try {
    await readFile(path.join(docs, "run-manifest.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  try {
    await readFile(path.join(docs, "extraction", "latest.json"), "utf8");
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (args["restart-0083"] === true || args["restart-0083"] === "true") return;
  throw new Error("This output contains a pre-0083 headless run and cannot be resumed. Rerun with --restart-0083 to discard its generated frontend evidence and restart from home-page resolution plus fresh capture.");
}

async function removeLegacyExtractionHandoffs(docs) {
  const obsolete = [
    "pages",
    "components",
    "source-map.json",
    "seo.json",
    "assets.json",
    "fonts.json",
    "tokens.json",
    "interaction-map.json",
    "scene-contract.json",
    "control-state-contract.json",
    "control-state-contract.md",
    "visual-assets.json",
    "visual-assets.md",
    "layout-blueprint.json",
    "layout-blueprint.md",
    "ui-normalization.json",
    "ui-normalization.md",
    "routes.json",
    "repeater-cms.json",
    "repeater-cms.md",
    "design.md",
    "page-resolution.spec.json",
  ];
  for (const relativePath of obsolete) await rm(path.join(docs, relativePath), { recursive: true, force: true });
}

export async function installInteractionRuntime(outputDir) {
  const source = new URL("./lib/interaction-runtime.mjs", import.meta.url);
  const sourceText = await readFile(source, "utf8");
  const target = path.join(outputDir, "src", "lib", "rp-interactions.mjs");
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!existing || existing.includes("@generated-source wix-headless-replatform")) {
    await ensureDir(path.dirname(target));
    await writeText(target, sourceText);
  }
  const publicDir = path.join(outputDir, "public", "site-clone");
  await ensureDir(publicDir);
  await writeText(path.join(publicDir, "rp-interactions.mjs"), sourceText);
  await writeText(
    path.join(publicDir, "rp-interactions-bootstrap.mjs"),
    await readFile(new URL("./lib/interaction-bootstrap.mjs", import.meta.url), "utf8"),
  );
  const normalizationCss = await readFile(new URL("./lib/ui-normalization.css", import.meta.url), "utf8");
  await writeText(path.join(publicDir, "rp-ui-normalize.css"), normalizationCss);
  const sourceStyleDir = path.join(outputDir, "src", "styles");
  await ensureDir(sourceStyleDir);
  const sourceStyleTarget = path.join(sourceStyleDir, "rp-ui-normalize.css");
  let existingStyle = "";
  try {
    existingStyle = await readFile(sourceStyleTarget, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!existingStyle || existingStyle.includes("@generated-source wix-headless-replatform")) {
    await writeText(sourceStyleTarget, normalizationCss);
  }
}

function printConfirmationSummary(discovery, outputDir) {
  console.log(`Output directory: ${outputDir}`);
  console.log(`Discovered ${discovery.totalDiscovered} same-origin URL(s) for scope "${discovery.scope}".`);
  if (discovery.inScopePages) console.log(`In-scope implementation URL(s): ${discovery.inScopePages.length}`);
  if (discovery.preservedPages) console.log(`Preserved fallback URL(s): ${discovery.preservedPages.length}`);
  for (const [area, count] of Object.entries(discovery.countsByArea)) {
    console.log(`- ${area}: ${count}`);
  }
  const dynamicAreas = ["product", "product-category", "blog-post", "blog-index", "cms-content", "bookings", "events", "pricing"]
    .filter((area) => discovery.countsByArea[area]);
  if (dynamicAreas.length) {
    console.log("");
    console.log(`Dynamic Wix SDK-backed templates: ${dynamicAreas.join(", ")}`);
  }
  if (discovery.excluded.length) {
    console.log("");
    console.log(`Excluded URL records: ${discovery.excluded.length}`);
  }
}

function parseUrlList(value, sourceUrl) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => new URL(item.trim(), sourceUrl).toString());
}

function safePageName(page) {
  return `${page.area}-${String(page.path || "home").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "home"}`;
}

function renderUiNormalizationDesignSummary(contract) {
  return `## Identity-Preserving UI Normalization\n\nIdentity locks outrank polish. Preserve content, section order/archetype, brand tokens, media, CTA hierarchy, and interaction model. Do not select a new design style.\n\nLoad once: \`<link rel="stylesheet" href="/site-clone/rp-ui-normalize.css">\`\n\nMotion: hover/focus is subtle and non-structural; click/activation may change major geometry only when required by the scene. Captured timing overrides defaults. Use easing and respect \`prefers-reduced-motion\`.\n\nSection recipes:\n${(contract.sections || []).map((section) => `- \`${section.sectionId}\` / \`${section.layout}\`: ${section.recipe.join(" ")}`).join("\n") || "- none"}`;
}

function renderLayoutBlueprintDesignSummary(contract) {
  return `## Section Layout Blueprints\n\nBuild each section independently in this order: canvas, background layers, container, semantic regions, relationships, responsive reflow, then UI normalization. Composition and background-media role are identity locks.\n\n${(contract.pages || []).flatMap((page) => page.sections || []).map((section) => `- \`${section.sectionId}\` / \`${section.composition}\` / \`${section.canvas.widthMode}-${section.canvas.heightMode}\`: ${section.implementation.steps.join(" ")}`).join("\n") || "- none"}`;
}

function renderControlStateDesignSummary(contract) {
  return `## Control State Fidelity\n\nImplement source-observed rest, hover, focus-visible, pressed, activated, current, and disabled deltas on their measured owner. Nested icon motion must not be promoted to the whole control.\n\n${(contract.controls || []).map((control) => `- \`${control.scope}/${control.role}\` ${(control.members || [control.label]).join(", ")}: ${Object.keys(control.states).map((state) => `\`${state}\``).join(", ") || "rest only"}`).join("\n") || "- no representative controls captured"}`;
}

function renderVisualAssetsDesignSummary(contract) {
  return `## Source Visual Assets\n\nLogos are identity locks: use exact source/materialized files, preserve every observed variant and target size, and never recreate a logo as text. Icons follow source asset → source library/sprite → style-matched established library fallback.\n\n${(contract.logos || []).map((logo) => `- \`${logo.id}\`: ${logo.localPath || logo.sourceUrl || logo.useHref || "captured markup"}`).join("\n") || "- BLOCKING: no logo candidate captured; inspect the source before implementing brand chrome."}`;
}

async function writeComponentSpecs({ docs, pages, routes, sceneContract, layoutBlueprint, uiNormalization, controlStateContract, visualAssets }) {
  const dir = path.join(docs, "components");
  await ensureDir(dir);
  for (const page of pages) {
    const relatedRoutes = routes.routes.filter((route) => route.representativeUrls?.includes(page.url));
    const pageScenes = (sceneContract?.scenes || []).filter((scene) => scene.id.startsWith(`${page.area || "page"}-`));
    const pageLayouts = (layoutBlueprint?.pages || []).find((candidate) => candidate.url === page.url)?.sections || [];
    const pageNormalization = (uiNormalization?.sections || []).filter((section) => section.pageUrl === page.url);
    const pageControls = (controlStateContract?.controls || []).filter((control) => control.scope !== "content" || page.url === pages[0]?.url);
    const pageLogos = (visualAssets?.logos || []).filter((asset) => asset.usages.some((usage) => usage.pageUrl === page.url));
    const pageIcons = (visualAssets?.icons || []).filter((asset) => asset.usages.some((usage) => usage.pageUrl === page.url));
    const title = page.title || page.seo?.title || page.url;
    const body = `# ${title}

Source URL: ${page.url}

Area: ${page.area}

Route strategy:

${relatedRoutes.map((route) => `- ${route.kind}: \`${route.targetRoute}\`${route.dataSource ? ` via ${route.dataSource}` : ""}`).join("\n") || "- static or not yet classified"}

## Blocking Interaction Checklist

Do this before visual polish. The page is incomplete until every item passes.

1. Add this exact tag once near the end of the document: \`<script type="module" src="/site-clone/rp-interactions-bootstrap.mjs"></script>\`.
2. Add this exact stylesheet once in the document head: \`<link rel="stylesheet" href="/site-clone/rp-ui-normalize.css">\`.
3. Do not use a raw \`type="module"\` script to import a relative file from \`src/\`; that browser URL will not resolve. The public bootstrap auto-binds marker-complete scenes.
4. Implement the following ${pageScenes.length} core scene(s) and their exact markers:
${pageScenes.map((scene) => `   - \`${scene.id}\` / \`${scene.implementation.primitive}\`: ${(scene.implementation.recipe?.steps || []).join(" ")}`).join("\n") || "   - none"}
5. Use the exact logos/icons in the visual asset inventory. A text recreation of a logo is a blocking failure.
6. Implement the dedicated control states below before generic UI normalization.
7. Implement each section's layout blueprint below before applying UI normalization. Composition, text geometry, and background-media role are identity locks.
8. Implement each identity-preserving UI normalization recipe below. Identity locks outrank polish.
9. Start the clone and run \`node skills/wix-headless-replatform/scripts/verify-interactions.mjs --out <project-dir> --clone-url <local-url> --project-root <host-project-root>\`.
10. Fix every failed scene or normalization check. A missing \`interaction-qa.json\` or \`pass: false\` is a blocking failure, even if the static page looks close.

Ignored source infrastructure:
${(page.ignoredSurfaces || []).map((surface) => `- \`${surface.kind}\` / provider \`${surface.provider || "unknown"}\`: ${surface.creationPolicy === "ignore" ? "identify only; do not recreate as page UI" : surface.creationPolicy}`).join("\n") || "- none"}

## Source Visual Assets

Logos must use these exact source/materialized files and recorded usage sizes. Do not recreate them as text. Icons use source-first resolution; a matching established library is fallback-only.

Logos:
${pageLogos.map((asset) => `- \`${asset.id}\`: ${asset.localPath || asset.sourceUrl || asset.useHref || "captured source markup"}; ${asset.usages.filter((usage) => usage.pageUrl === page.url).map((usage) => `${usage.context}/${usage.variant} ${usage.renderedSize?.width || 0}×${usage.renderedSize?.height || 0}`).join(", ")}`).join("\n") || "- BLOCKING: none captured; inspect source chrome before implementation"}

Icons:
${pageIcons.map((asset) => `- \`${asset.id}\`: ${asset.localPath || asset.sourceUrl || asset.useHref || "captured source markup"}; ${asset.usages.filter((usage) => usage.pageUrl === page.url).map((usage) => usage.context).join(", ")}`).join("\n") || "- no standalone icon evidence captured"}

## Dedicated Control States

Implement state deltas on the recorded owner. \`focus-visible\` remains required for accessibility; nested icon motion must remain nested.

${pageControls.map((control) => `- \`${control.scope}/${control.role}\` ${(control.members || [control.label]).join(", ")}: ${Object.keys(control.states).map((state) => `\`${state}\``).join(", ") || "rest only"}; icon motion: ${control.iconMotion.join(", ") || "none"}`).join("\n") || "- no representative controls captured"}

## Section Layout Blueprints

Use the controlled terms and normalized rectangles as the source of truth. Build canvas and ordered background layers first. A background media layer is not a peer column.

${pageLayouts.map((section) => `### ${section.sectionId}: ${section.composition}\n\n- Canvas: \`${section.canvas.widthMode}/${section.canvas.heightMode}\`${section.canvas.pinned ? "; pinned" : ""}\n- Background: \`${section.background.kind}\` — ${section.background.layers.map((layer) => `\`${layer.role}:${layer.kind}\``).join(" -> ") || "none"}\n- Container: \`${section.container.widthMode}\`\n- Relationships: ${section.relationships.map((item) => `\`${item}\``).join(", ") || "none measured"}\n- Forbidden conversions: ${section.identityLocks.forbiddenConversions.map((item) => `\`${item}\``).join(", ") || "none"}\n\nRegions:\n${section.regions.map((region) => `- \`${region.role}\` / \`${region.placement}\` / \`${JSON.stringify(region.normalizedRect)}\`${region.textGeometry ? ` / text geometry \`${JSON.stringify({ ...region.textGeometry, responsive: region.responsiveTextGeometry || [] })}\`` : ""}${region.text ? `: ${region.text}` : ""}`).join("\n") || "- no measured regions; follow scene evidence and source screenshot"}\n\nBuild order:\n${section.implementation.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`).join("\n\n") || "_No section layout blueprint captured._"}

## Identity-Preserving UI Normalization

Allowed: spacing/alignment cleanup, consistent repeated-item geometry, responsive reflow within the same archetype, subtle hover/focus feedback, eased state transitions, accessibility, and reduced motion.

Forbidden: new visual style/palette/type, section reordering, archetype conversion, new CTA hierarchy, replaced media/interaction intent, or hiding source content to simplify layout.

${pageNormalization.map((section) => `### ${section.sectionId}: ${section.kind}/${section.variant}\n\nMarkers: \`${section.markerContract.section}\`; \`${section.markerContract.layout}\`\n\nRecipe:\n${section.recipe.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\nRules:\n${section.rules.map((rule) => `- ${rule.id}: ${rule.requirement}`).join("\n")}\n\nAssertions:\n${section.assertions.map((assertion) => `- \`${assertion.kind}\`: ${JSON.stringify(assertion)}`).join("\n")}`).join("\n\n") || "_No section normalization contract captured._"}

## Sections

${(page.sections || []).map((section, index) => `### ${index + 1}. ${section.heading || section.tag || "Section"}\n\n${section.text || "_No text captured._"}`).join("\n\n") || "_No sections captured._"}

## Repeaters

${(page.repeaters || []).map((repeater, index) => `### ${index + 1}. ${repeater.label || repeater.kind || "Repeater"}\n\n- kind: \`${repeater.kind}\`\n- source: \`${repeater.source}\`\n- items: ${repeater.itemCount || repeater.items?.length || 0}\n- schema: headings=${Boolean(repeater.schema?.hasHeading)}, paragraphs=${Boolean(repeater.schema?.hasParagraphs)}, images=${Boolean(repeater.schema?.hasImages)}, maxImagesPerItem=${repeater.schema?.maxImagesPerItem ?? 0}\n\n${(repeater.items || []).slice(0, 12).map((item, itemIndex) => `#### ${itemIndex + 1}. ${item.heading || "Item"}\n\n${(item.paragraphs || []).join("\n\n") || "_No text captured._"}\n\nImages:\n${(item.images || []).map((image) => `- ${image.src}`).join("\n") || "_No images captured._"}`).join("\n\n")}`).join("\n\n") || "_No repeaters captured._"}

## Repeater Diagnostics

${page.repeaterDiagnostics ? `- source: \`${page.repeaterDiagnostics.source || "unknown"}\`\n- accessibility snapshot available: ${Boolean(page.repeaterDiagnostics.accessibilitySnapshotAvailable)}\n- signal count: ${page.repeaterDiagnostics.signalCount ?? 0}\n- accepted repeaters: ${page.repeaterDiagnostics.acceptedRepeaterCount ?? 0}\n${(page.repeaterDiagnostics.warnings || []).length ? `- warnings:\n${page.repeaterDiagnostics.warnings.map((warning) => `  - ${warning}`).join("\n")}` : "- warnings: none"}` : "_No repeater diagnostics captured._"}

## Interactions

${page.interactionDiscovery ? `${(page.interactionDiscovery.requiredBehaviors || []).length ? `Required behaviors:\n${page.interactionDiscovery.requiredBehaviors.map((behavior) => `- \`${behavior}\``).join("\n")}` : "Required behaviors: none"}\n\n${(page.interactionDiscovery.sectionInteractions || []).filter((section) => section.interactions?.length).map((section) => `### ${section.sectionId}\n\n${section.interactions.map((interaction) => `- ${interaction.kind} / ${interaction.importance} / ${interaction.trigger?.type || interaction.trigger}${interaction.textChanged ? " / text-changes" : ""}`).join("\n")}`).join("\n\n") || "_No section interactions captured._"}` : "_No interaction discovery captured._"}

## Scene Implementation Contract

${pageScenes.map((scene) => `### ${scene.sectionId}: ${scene.implementation.primitive || scene.implementation.model}\n\nRuntime adapter: \`${scene.implementation.runtimeAdapter || "custom"}\`; preferred startup: \`${scene.implementation.runtimeModule || "/site-clone/rp-interactions-bootstrap.mjs"}\`\n\nScene marker: \`data-rp-scene="${scene.id}"\`\n\nMarkers:\n${Object.entries(scene.implementation.markerContract || {}).map(([role, marker]) => `- ${role}: \`${marker}\``).join("\n") || "- none"}\n\nRecipe:\n${(scene.implementation.recipe?.steps || []).map((step, index) => `${index + 1}. ${step}`).join("\n") || "- custom"}\n\nAssertions:\n${(scene.implementation.assertions || []).map((assertion) => `- \`${assertion.kind}\`: ${JSON.stringify(assertion)}`).join("\n") || "- none"}\n\nRequirements:\n${scene.implementation.requirements.map((requirement) => `- ${requirement}`).join("\n")}\n\nAcceptance:\n${scene.implementation.acceptance.map((criterion) => `- ${criterion}`).join("\n")}\n\nEvidence:\n${scene.states.map((state) => `- ${state.kind}: ${state.screenshot || "state data in scene-contract.json"}`).join("\n")}\n${scene.manualContentInventory ? "\n- Manual content inventory required: this interactive collection was not captured as a structured repeater; preserve all source items before coding.\n" : ""}`).join("\n\n") || "_No stateful scene contract captured._"}

## Media

${(page.interactionDiscovery?.media || []).map((media) => `- ${media.role} ${media.provider || media.tag}: ${media.src || "deferred source"} (autoplay: ${Boolean(media.playback?.autoplay)}, loop: ${Boolean(media.playback?.loop)}, muted: ${Boolean(media.playback?.muted)})`).join("\n") || "_No embedded media captured._"}

## Footer

${page.footer?.legalText || "_No structured footer content captured._"}

## Links

${(page.links || []).slice(0, 80).map((link) => `- [${link.text || link.url}](${link.url})`).join("\n") || "_No links captured._"}
`;
    await writeText(path.join(dir, `${safePageName(page)}.spec.md`), body);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
