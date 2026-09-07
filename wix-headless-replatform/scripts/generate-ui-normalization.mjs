#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, resolveOutputDir, writeJson, writeText } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url, args.out);
  const contract = await generateUiNormalization({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

export async function generateUiNormalization({ outputDir, pages: suppliedPages, interactionMap: suppliedInteractionMap, sceneContract: suppliedSceneContract, layoutBlueprint: suppliedLayoutBlueprint } = {}) {
  const docs = docsDir(outputDir);
  const [sourceMap, interactionMap, sceneContract, layoutBlueprint] = await Promise.all([
    suppliedPages ? null : readJson(path.join(docs, "source-map.json")),
    suppliedInteractionMap || readJson(path.join(docs, "interaction-map.json")),
    suppliedSceneContract || readJson(path.join(docs, "scene-contract.json")),
    suppliedLayoutBlueprint || readJson(path.join(docs, "layout-blueprint.json")).catch(() => null),
  ]);
  const pages = suppliedPages || sourceMap?.pages || interactionMap.pages || [];
  const sections = pages.flatMap((page) => (page.sections || []).map((section) => buildSectionNormalization({
    page,
    section,
    interactionMap,
    sceneContract,
    layoutBlueprint,
  })));
  const contract = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceUrl: interactionMap.sourceUrl || pages[0]?.url || "",
    policy: identityPolicy(),
    motionDefaults: motionDefaults(),
    globalRules: globalRules(),
    globalAssertions: [
      { kind: "no-page-horizontal-overflow", maximumPixels: 2 },
      { kind: "reduced-motion-available" },
    ],
    sections,
  };
  await writeJson(path.join(docs, "ui-normalization.json"), contract);
  await writeText(path.join(docs, "ui-normalization.md"), renderNormalizationMarkdown(contract));
  return contract;
}

export function buildSectionNormalization({ page, section, interactionMap, sceneContract, layoutBlueprint }) {
  const scene = (sceneContract.scenes || []).find((candidate) => candidate.sectionId === section.id && candidate.id.startsWith(`${page.area || "page"}-`));
  const blueprint = (layoutBlueprint?.pages || []).find((candidate) => candidate.url === page.url)?.sections?.find((candidate) => candidate.sectionId === section.id);
  const interactions = (interactionMap.interactions || []).filter((interaction) =>
    scene?.interactionIds?.includes(interaction.id) || interaction.sectionIds?.includes(section.id)
  );
  const layout = layoutFor(section, scene, page, blueprint);
  const rules = baseSectionRules(section);
  const assertions = [{ kind: "section-present" }];
  const recipe = [
    `Add data-rp-section="${section.id}" to the section root and data-rp-layout="${layout}".`,
    "Preserve the extracted content, media, brand tokens, section order, and interaction primitive before applying polish.",
  ];
  const evidence = {};

  if (layout === "horizontal-card-rail" || layout === "card-grid") {
    const carousel = interactions.find((item) => item.kind === "carousel");
    const heightEvidence = repeatedItemHeightEvidence(carousel);
    evidence.repeatedItems = heightEvidence;
    rules.push(
      rule("stable-card-regions", "Reserve consistent media, body, and action regions so content length does not make peers look accidental."),
      rule("aligned-card-actions", "Align equivalent card actions to the same block edge when their semantic role is shared."),
      rule("subtle-hover", "Use hover/focus for subtle non-structural feedback; do not reflow peer cards."),
    );
    recipe.push(
      "Mark repeated cards data-rp-item, their media data-rp-media, body data-rp-body, and equivalent CTA data-rp-action.",
      "Use data-rp-motion=micro for hover/focus treatment and data-rp-motion=state for click/activation geometry.",
    );
    if (heightEvidence.sourceEqualHeight) {
      rules.push(rule("equal-repeated-item-height", `Keep all peer cards at one block size. Source spread is ${heightEvidence.spreadRatio}; active state changes inline size, not height.`));
      assertions.push(
        { kind: "repeated-item-height-spread", maximumRatio: 0.03 },
        { kind: "activation-preserves-item-height", maximumRatio: 0.03 },
      );
      recipe.push(`Set data-rp-equal-height="true" and --rp-item-block-size:${heightEvidence.medianHeight}px on the rail/grid root.`);
    }
    if (triggerType(carousel) === "click") {
      assertions.push({ kind: "hover-preserves-item-layout", maximumInlineRatio: 0.05, maximumBlockRatio: 0.03 });
    }
    assertions.push({ kind: "eased-motion-present" });
    if (layout === "horizontal-card-rail") {
      rules.push(rule("local-horizontal-overflow", "Keep intentional overflow inside the rail viewport; the document itself must not overflow horizontally."));
    }
  }

  if (scene?.implementation?.primitive === "scroll-scene") {
    rules.push(
      rule("stable-scroll-composition", "Keep media and copy in the extracted scroll relationship; polish spacing without converting the scene to an unrelated static layout."),
      rule("stable-tab-anchor", "Keep tab controls anchored while panel content changes; transition opacity/transform rather than causing abrupt horizontal movement."),
    );
    recipe.push("Use the scroll-scene markers and progress variables first; normalize text measure, control spacing, and panel transitions inside that composition.");
  }

  if (blueprint) {
    recipe.unshift(...blueprint.implementation.steps.map((step) => `Layout blueprint: ${step}`));
    rules.unshift(rule("preserve-blueprint-composition", `Keep the blueprint's \`${blueprint.composition}\` composition, ordered background layers, and declared region relationships.`));
    evidence.layoutBlueprint = {
      composition: blueprint.composition,
      backgroundKind: blueprint.background.kind,
      relationships: blueprint.relationships,
      confidence: blueprint.evidence.confidence,
    };
  }

  if (section.kind === "hero") {
    rules.push(rule("hero-identity-lock", "Preserve the hero media, headline hierarchy, copy anchor, and primary viewport footprint."));
  }
  if (section.capabilities?.hasCta) {
    rules.push(rule("clear-action-affordance", "Give equivalent actions consistent size, focus treatment, and pointer affordance without inventing a new CTA hierarchy."));
  }

  const stateTimings = interactions.map((item) => Number(item.timeline?.observedSettleMs)).filter((value) => value > 0);
  if (stateTimings.length) evidence.observedSettleMs = Math.max(...stateTimings);
  return {
    pageUrl: page.url,
    sectionId: section.id,
    kind: section.kind || "section",
    variant: section.variant || "generic",
    layout,
    markerContract: {
      section: `data-rp-section="${section.id}"`,
      layout: `data-rp-layout="${layout}"`,
      item: "data-rp-item",
      media: "data-rp-media",
      body: "data-rp-body",
      action: "data-rp-action",
      motion: "data-rp-motion",
    },
    identityLocks: sectionIdentityLocks(section, scene, layout, blueprint),
    evidence,
    rules,
    assertions,
    recipe,
  };
}

function identityPolicy() {
  return {
    priority: ["content", "section-order", "section-archetype", "brand-tokens", "media", "interaction-model"],
    allowedChanges: [
      "spacing and alignment cleanup",
      "consistent repeated-item geometry",
      "responsive reflow inside the same archetype",
      "subtle hover/focus feedback",
      "eased state transitions",
      "accessibility and reduced-motion behavior",
    ],
    forbiddenChanges: [
      "new visual style, palette, or font pairing",
      "section reordering or conversion to a different archetype",
      "new content, CTA hierarchy, or conversion pattern",
      "replacement of distinctive media or interaction intent",
      "hiding source content merely to make geometry easier",
    ],
  };
}

function motionDefaults() {
  return {
    micro: {
      durationMs: [140, 240],
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      allowed: ["color", "background-color", "border-color", "box-shadow", "opacity", "transform"],
      transformBudget: { scale: [0.98, 1.03], translatePx: 8, rotateDeg: 2 },
      mustNot: ["reflow siblings", "hide required content", "activate a major state on touch-only devices"],
    },
    state: {
      defaultDurationMs: [240, 600],
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      mayChangeLayoutWhenRequiredByInteraction: true,
      capturedTimelineOverridesDefault: true,
    },
    reducedMotion: "Remove non-essential interpolation while preserving immediate final state and focus visibility.",
  };
}

function globalRules() {
  return [
    rule("identity-before-polish", "Do not apply a best practice that changes an identity lock."),
    rule("content-reflow", "Essential text reflows without clipping at narrow widths, zoom, or text scaling."),
    rule("focus-equivalence", "Every pointer interaction has an operable keyboard path and visible focus treatment."),
    rule("intentional-overflow", "Only bounded carousels/rails may overflow horizontally; the page may not."),
    rule("interruptible-motion", "Rapid activation may interrupt animation, but final semantic state and content must remain correct."),
    rule("reduced-motion", "Respect prefers-reduced-motion without removing access to content or state."),
  ];
}

function baseSectionRules(section) {
  const rules = [
    rule("preserve-archetype", `Keep this ${section.variant || section.kind || "section"} recognizable as the same source layout archetype.`),
    rule("consistent-spacing", "Use a coherent local spacing rhythm and align equivalent edges."),
    rule("responsive-without-clipping", "Reflow content at narrow widths without clipping, accidental overlap, or page-level horizontal overflow."),
  ];
  if (section.capabilities?.hasMedia) rules.push(rule("stable-media-region", "Give source media a deliberate bounded region and preserve its crop/fill intent."));
  return rules;
}

function sectionIdentityLocks(section, scene, layout, blueprint) {
  return {
    order: section.id,
    archetype: layout,
    sourceClassification: `${section.kind || "section"}/${section.variant || "generic"}`,
    heading: section.heading || "",
    mediaRequired: Boolean(section.capabilities?.hasMedia || scene?.media?.length),
    interactionPrimitive: scene?.implementation?.primitive || null,
    backgroundKind: blueprint?.background?.kind || null,
    forbiddenConversions: blueprint?.identityLocks?.forbiddenConversions || [],
  };
}

function layoutFor(section, scene, page, blueprint) {
  if (blueprint?.composition) return blueprint.composition;
  if (scene?.implementation?.primitive === "active-card-rail" || section.capabilities?.isCarouselLike) return "horizontal-card-rail";
  if (scene?.implementation?.primitive === "scroll-scene") return "scroll-narrative";
  if (scene?.implementation?.primitive === "media-scene" && page.sections?.[0]?.id === section.id) return "hero";
  if (section.kind === "card-collection") return "card-grid";
  if (section.kind === "hero") return "hero";
  if (section.kind === "footer") return "footer";
  if (section.kind === "cta-strip") return "cta-band";
  if (section.kind === "text-media") return "text-media";
  return "content-section";
}

function repeatedItemHeightEvidence(carousel) {
  const heights = (carousel?.states || []).flatMap((state) => (state.cards || []).map((card) => Number(card.height)).filter((height) => height > 0));
  if (!heights.length) return { observed: false, sourceEqualHeight: false, heights: [] };
  const sorted = [...heights].sort((left, right) => left - right);
  const medianHeight = Math.round(sorted[Math.floor(sorted.length / 2)]);
  const spreadRatio = round((Math.max(...heights) - Math.min(...heights)) / Math.max(1, medianHeight));
  return {
    observed: true,
    heights,
    medianHeight,
    spreadRatio,
    sourceEqualHeight: spreadRatio <= 0.05,
  };
}

function triggerType(interaction) {
  return typeof interaction?.trigger === "string" ? interaction.trigger : interaction?.trigger?.type || "";
}

function rule(id, requirement) {
  return { id, requirement };
}

function renderNormalizationMarkdown(contract) {
  const sections = contract.sections.map((section) => `## ${section.sectionId}: ${section.kind}/${section.variant}\n\nLayout: \`${section.layout}\`\n\nIdentity locks:\n${Object.entries(section.identityLocks).map(([key, value]) => `- ${key}: \`${String(value)}\``).join("\n")}\n\nRecipe:\n${section.recipe.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\nRules:\n${section.rules.map((item) => `- **${item.id}:** ${item.requirement}`).join("\n")}\n\nAssertions:\n${section.assertions.map((assertion) => `- \`${assertion.kind}\`: ${JSON.stringify(assertion)}`).join("\n")}`).join("\n\n");
  return `# Identity-preserving UI normalization\n\nUse this after source structure and interaction contracts. Identity locks outrank polish.\n\n## Allowed changes\n\n${contract.policy.allowedChanges.map((item) => `- ${item}`).join("\n")}\n\n## Forbidden changes\n\n${contract.policy.forbiddenChanges.map((item) => `- ${item}`).join("\n")}\n\n## Global rules\n\n${contract.globalRules.map((item) => `- **${item.id}:** ${item.requirement}`).join("\n")}\n\n${sections}\n`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
