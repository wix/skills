#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, resolveOutputDir, writeJson, writeText } from "./lib/common.mjs";
import { classifyBackground, classifyCanvas, buildRegions, classifyComposition, relationshipsFor } from "./lib/layout-blueprint/classifiers.mjs";
import { LAYOUT_VOCABULARY_VERSION, VOCABULARY } from "./lib/layout-blueprint/vocabulary.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url, args.out);
  const blueprint = await generateLayoutBlueprint({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(blueprint, null, 2)}\n`);
}

export async function generateLayoutBlueprint({ outputDir, pages: suppliedPages, interactionMap: suppliedInteractionMap, sceneContract: suppliedSceneContract } = {}) {
  const docs = docsDir(outputDir);
  const [sourceMap, interactionMap, sceneContract] = await Promise.all([
    suppliedPages ? null : readJson(path.join(docs, "source-map.json")),
    suppliedInteractionMap || readJson(path.join(docs, "interaction-map.json")),
    suppliedSceneContract || readJson(path.join(docs, "scene-contract.json")),
  ]);
  const pages = suppliedPages || sourceMap?.pages || interactionMap?.pages || [];
  const pageBlueprints = pages.map((page) => ({
    url: page.url,
    area: page.area || "page",
    sections: (page.sections || []).map((section) => buildSectionBlueprint({ page, section, sceneContract })),
  }));
  const blueprint = {
    schemaVersion: 1,
    vocabularyVersion: LAYOUT_VOCABULARY_VERSION,
    generatedAt: new Date().toISOString(),
    sourceUrl: interactionMap?.sourceUrl || pages[0]?.url || "",
    vocabulary: VOCABULARY,
    implementationOrder: ["canvas", "background-layers", "container", "regions", "relationships", "responsive-reflow", "ui-normalization"],
    pages: pageBlueprints,
  };
  await writeJson(path.join(docs, "layout-blueprint.json"), blueprint);
  await writeText(path.join(docs, "layout-blueprint.md"), renderLayoutBlueprintMarkdown(blueprint));
  return blueprint;
}

export function buildSectionBlueprint({ page, section, sceneContract = {} }) {
  const pagePrefix = `${page.area || "page"}-`;
  const scene = (sceneContract.scenes || []).find((candidate) => candidate.sectionId === section.id && candidate.id.startsWith(pagePrefix));
  const canvas = classifyCanvas(section, scene);
  const background = classifyBackground(section, scene);
  const regions = buildRegions(section).map((region) => ({
    ...region,
    ...(region.text ? { responsiveTextGeometry: responsiveTextSamples(page, region.text) } : {}),
  }));
  const composition = classifyComposition({ section, scene, background, regions });
  const relationships = relationshipsFor(composition, regions);
  const confidence = section.layoutEvidence ? "measured" : scene ? "scene-inferred" : "heuristic";
  return {
    sectionId: section.id,
    sourceClassification: { kind: section.kind || "section", variant: section.variant || "generic" },
    composition,
    canvas,
    background,
    container: inferContainer(canvas, regions),
    regions,
    relationships,
    responsive: {
      strategy: composition === "rail" ? "retain-rail-with-touch-overflow" : composition === "split" ? "stack-at-narrow-width" : "preserve-composition",
      observedViewports: section.layoutEvidence?.viewport ? [section.layoutEvidence.viewport] : [],
      inferred: true,
    },
    identityLocks: {
      composition,
      backgroundKind: background.kind,
      mediaRole: background.layers.some((layer) => layer.role === "media") ? "background" : section.capabilities?.hasMedia ? "content" : "none",
      relationships,
      textGeometry: regions.filter((region) => region.textGeometry).map((region) => ({ role: region.role, text: region.text, ...region.textGeometry, responsive: region.responsiveTextGeometry || [] })),
      forbiddenConversions: forbiddenConversions(composition),
    },
    implementation: implementationRecipe(composition, canvas, background, regions),
    evidence: {
      confidence,
      sourceDomRef: section.domRef || null,
      sceneId: scene?.id || null,
      sourceScreenshot: scene?.sourceScreenshot || null,
      warnings: section.layoutEvidence ? [] : ["layout-evidence-unavailable; rerun extraction for measured region geometry"],
    },
  };
}

function responsiveTextSamples(page, text) {
  const target = String(text || "").replace(/\s+/g, " ").trim();
  return Object.entries(page.responsiveTextGeometry || {}).map(([viewport, samples]) => {
    const match = (samples || []).find((sample) => String(sample.text || "").replace(/\s+/g, " ").trim() === target);
    return match ? { viewport, ...match } : null;
  }).filter(Boolean);
}

function inferContainer(canvas, regions) {
  const content = regions.filter((region) => region.role !== "media" && region.normalizedRect);
  if (!content.length) return { widthMode: canvas.widthMode === "bounded" ? "bounded" : "full", maxWidthPx: null, inlineInsetRatio: null };
  const left = Math.min(...content.map((region) => region.normalizedRect.x));
  const right = Math.max(...content.map((region) => region.normalizedRect.x + region.normalizedRect.width));
  return {
    widthMode: left > 0.04 || right < 0.96 ? "bounded" : "full",
    maxWidthPx: null,
    inlineInsetRatio: { start: Number(left.toFixed(3)), end: Number((1 - right).toFixed(3)) },
  };
}

function forbiddenConversions(composition) {
  const map = {
    "layered-overlay": ["split", "stack"],
    "scroll-narrative": ["split", "static-stack"],
    rail: ["static-grid"],
    split: ["layered-overlay"],
  };
  return map[composition] || [];
}

function implementationRecipe(composition, canvas, background, regions) {
  const steps = [
    `Create one section root with ${canvas.widthMode} width and ${canvas.heightMode} height behavior.`,
    `Build background layers in declared order: ${background.layers.map((layer) => `${layer.role}:${layer.kind}`).join(" -> ") || "none"}.`,
  ];
  if (["layered-overlay", "scroll-narrative"].includes(composition)) steps.push("Use one positioning context; keep background layers full-bleed and place foreground regions above them. Do not create media and copy as peer columns.");
  if (composition === "split") steps.push("Use peer media and content regions with their captured left/right relationship; stack only at the declared narrow reflow.");
  if (composition === "rail") steps.push("Use a clipped viewport and max-content horizontal track; preserve shared item geometry and active-state behavior.");
  if (regions.length) steps.push("Place semantic regions from normalized rectangles and placement anchors before fine typography or motion polish.");
  if (regions.some((region) => region.textGeometry)) steps.push("Apply each important text region's measured inline size, max-width, line count, and wrap policy. A captured single-line desktop heading must stay one line at the canonical desktop viewport.");
  if (background.layers.some((layer) => layer.policy === "fallback-only")) steps.push("Render fallback-only posters only until primary media is ready; never leave them visibly stacked behind playing media.");
  return { steps };
}

function renderLayoutBlueprintMarkdown(contract) {
  const pages = contract.pages.map((page) => `# ${page.url}\n\n${page.sections.map((section) => `## ${section.sectionId}: ${section.composition}\n\n- Canvas: \`${section.canvas.widthMode}/${section.canvas.heightMode}\`${section.canvas.pinned ? ", pinned" : ""}\n- Background: \`${section.background.kind}\` (${section.background.layers.map((layer) => `${layer.role}:${layer.kind}`).join(" -> ") || "none"})\n- Container: \`${section.container.widthMode}\`\n- Identity locks: ${section.identityLocks.relationships.join(", ") || "composition and media role"}\n- Forbidden conversions: ${section.identityLocks.forbiddenConversions.map((item) => `\`${item}\``).join(", ") || "none"}\n\nRegions:\n${section.regions.map((region) => `- \`${region.role}\` at \`${region.placement}\`: ${JSON.stringify(region.normalizedRect)}${region.textGeometry ? `; text geometry ${JSON.stringify(region.textGeometry)}` : ""}${region.text ? ` — ${region.text}` : ""}`).join("\n") || "- no measured regions"}\n\nBuild order:\n${section.implementation.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\nEvidence: \`${section.evidence.confidence}\`${section.evidence.sourceScreenshot ? `; screenshot \`${section.evidence.sourceScreenshot}\`` : ""}`).join("\n\n")}`).join("\n\n");
  return `# Section layout blueprints\n\nControlled vocabulary version: ${contract.vocabularyVersion}. Implement each section independently. Composition and layer order are identity locks; UI normalization comes last.\n\n${pages}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
