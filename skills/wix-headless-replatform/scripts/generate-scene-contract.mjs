#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, resolveOutputDir, writeJson } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url, args.out);
  const contract = await generateSceneContract({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

export async function generateSceneContract({ outputDir, pages: suppliedPages, interactionMap: suppliedInteractionMap } = {}) {
  const docs = docsDir(outputDir);
  const interactionMap = suppliedInteractionMap || await readJson(path.join(docs, "interaction-map.json"));
  let sourceMap = null;
  if (!suppliedPages) {
    try {
      sourceMap = await readJson(path.join(docs, "source-map.json"));
    } catch {
      // Standalone interaction extraction embeds enriched pages in interaction-map.json.
    }
  }
  const pages = suppliedPages || sourceMap?.pages || interactionMap.pages || [];
  const interactions = interactionMap.interactions || [];
  const media = interactionMap.structural?.media || [];
  const scenes = pages.flatMap((page) => (page.sections || []).map((section) => buildScene({ page, section, interactions, media }))).filter(Boolean);
  const contract = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    sourceUrl: interactionMap.sourceUrl || pages[0]?.url || "",
    scenes,
  };
  await writeJson(path.join(docs, "scene-contract.json"), contract);
  return contract;
}

export function buildScene({ page, section, interactions, media }) {
  const sectionInteractions = page.interactionDiscovery?.sectionInteractions?.find((entry) => entry.sectionId === section.id)?.interactions || [];
  const kinds = new Set(sectionInteractions.map((item) => item.kind));
  const classText = `${section.kind || ""} ${section.className || ""} ${(section.domRef?.classTokens || []).join(" ")} ${section.heading || ""}`.toLowerCase();
  const isHero = section.kind === "hero" || /hero/.test(classText) || section === page.sections?.[0];
  if (isHero && media.some((item) => item.role === "background")) kinds.add("embedded-media");
  if (/carousel|slider|rail|gallery/.test(classText)) kinds.add("carousel");
  if (/scroll|scene|sticky|pinned/.test(classText)) {
    if (interactions.some((item) => item.kind === "scroll-state")) kinds.add("scroll-state");
    if (interactions.some((item) => item.kind === "tabs")) kinds.add("tabs");
  }
  if (!kinds.size) return null;

  const sceneInteractions = interactions.filter((item) =>
    item.sectionIds?.includes(section.id) || sectionInteractions.some((summary) => interactionMatchesSummary(item, summary))
  );
  const sceneMedia = media.filter((item) => {
    const tokenText = `${item.domRef?.id || ""} ${(item.domRef?.classTokens || []).join(" ")} ${(item.domRef?.parentClassTokens || []).join(" ")} ${(item.domRef?.sectionClassTokens || []).join(" ")}`.toLowerCase();
    if (isHero) return item.id === media.find((candidate) => candidate.role === "background")?.id;
    if (kinds.has("scroll-state")) return item.role === "background" && /scroll|scene|sticky|pin|embed/.test(tokenText);
    return false;
  });
  const activeKinds = Array.from(kinds);
  const primitive = modelFor(activeKinds);
  const requirements = [];
  if (sceneMedia.some((item) => item.src)) requirements.push("Render each listed source-backed media surface with the recorded playback flags and scene role.");
  if (sceneMedia.some((item) => item.fallback?.policy === "fallback-only")) requirements.push("Treat recorded posters/backgrounds as loading, blocked-media, or error fallbacks only; do not visibly blend them behind active media.");
  if (sceneMedia.some((item) => !item.src)) requirements.push("Recreate the recorded runtime visual surface and its scene behavior; do not replace it with unrelated static imagery.");
  if (kinds.has("carousel")) requirements.push("Render a finite-width data-rp-viewport that clips or scrolls a wider data-rp-track, preserve the captured card geometry, separation mechanism, and exact initial active state, then manage the captured active-card state on click plus every captured hover state.");
  if (kinds.has("scroll-state")) requirements.push("Implement both entry progress and internal scroll progress: preserve media framing/sideways expansion through the captured entry and pinned phases, while applying transforms only to the measured motion owner and keeping static copy outside the visual scale scope.");
  if (kinds.has("tabs")) requirements.push("Implement visible labels as buttons and switch the captured content state without replacing the scene background.");
  const acceptance = [];
  if (sceneMedia.some((item) => item.src)) acceptance.push("The implementation references the exact source URLs and preserves applicable playback flags.");
  if (sceneMedia.some((item) => item.fallback?.policy === "fallback-only")) acceptance.push("No full-cover poster or image remains visibly composited with the active video/iframe.");
  if (sceneMedia.some((item) => !item.src)) acceptance.push("The implementation preserves the runtime surface's visual role and recorded state changes.");
  if (kinds.has("carousel")) acceptance.push("The viewport is narrower than the content track, and clicking a card changes its active/expanded state rather than only scrolling.");
  if (kinds.has("scroll-state")) acceptance.push("Each captured scroll phase produces the corresponding distinct media/copy geometry; add a midpoint phase if source evidence has only endpoints.");
  if (kinds.has("tabs")) acceptance.push("Each visible tab changes the text/content state while the section remains a single scene.");
  return {
    id: `${safeId(page)}-${section.id}`,
    sectionId: section.id,
    heading: section.heading || section.tag || "Untitled scene",
    sourceScreenshot: screenshotFor(section, page),
    interactionIds: sceneInteractions.map((item) => item.id),
    media: sceneMedia,
    states: sceneInteractions.map(sceneStateFor),
    implementation: {
      model: primitive,
      primitive,
      runtimeAdapter: runtimeAdapterFor(primitive),
      runtimeModule: "/site-clone/rp-interactions-bootstrap.mjs",
      bootstrap: "<script type=\"module\" src=\"/site-clone/rp-interactions-bootstrap.mjs\"></script>",
      markerContract: markerContractFor(primitive, sceneInteractions),
      initialState: initialStateFor(primitive, sceneInteractions),
      assertions: assertionsFor({ primitive, interactions: sceneInteractions, media: sceneMedia }),
      recipe: recipeFor(primitive),
      requirements,
      acceptance,
    },
    manualContentInventory: kinds.has("carousel") && !(page.repeaters || []).length,
  };
}

function sceneStateFor(item) {
  return {
    id: item.id,
    kind: item.kind,
    trigger: item.trigger,
    importance: item.importance,
    interactionMapRef: `interaction-map.json#${item.id}`,
    states: item.states,
    ...(item.scope ? { scope: item.scope } : {}),
    ...(item.timeline ? {
      timelineSummary: {
        sampledAtMs: item.timeline.sampledAtMs,
        observedSettleMs: item.timeline.observedSettleMs,
        changedNodeCount: item.timeline.changedNodeCount,
        changedNodes: (item.timeline.changes || []).slice(0, 16).map((change) => ({
          path: change.path,
          role: change.role,
          changedProperties: change.changedProperties,
        })),
        animations: item.timeline.animations || [],
      },
    } : {}),
    ...(item.invariants ? { invariants: item.invariants } : {}),
    screenshot: item.evidence?.screenshot || null,
  };
}

function interactionMatchesSummary(interaction, summary) {
  if (summary.id) return summary.id === interaction.id;
  const interactionTrigger = typeof interaction.trigger === "string" ? interaction.trigger : interaction.trigger?.type;
  const summaryTrigger = typeof summary.trigger === "string" ? summary.trigger : summary.trigger?.type;
  return interaction.kind === summary.kind && interaction.label === summary.label && interactionTrigger === summaryTrigger;
}

function markerContractFor(primitive, interactions = []) {
  const base = { scene: "data-rp-scene", initialized: "data-rp-initialized" };
  if (primitive === "active-card-rail") {
    const mode = interactions.find((item) => item.kind === "carousel")?.invariants?.initialState || "single-active";
    return { ...base, initialState: `data-rp-initial-state=\"${mode}\"`, viewport: "data-rp-viewport", track: "data-rp-track", item: "data-rp-item", hoverTarget: "data-rp-hover-target", activate: "data-rp-activate", control: "data-rp-direction", active: "data-rp-active=true" };
  }
  if (primitive === "content-switcher") {
    return { ...base, item: "data-rp-item", activate: "data-rp-activate", active: "data-rp-active=true", panel: "data-rp-panel", state: "data-rp-state" };
  }
  if (primitive === "scroll-scene") {
    return { ...base, phase: "data-rp-phase", visual: "data-rp-visual", content: "data-rp-content", curtain: "data-rp-curtain", panel: "data-rp-panel", item: "data-rp-item", activate: "data-rp-activate", active: "data-rp-active=true", state: "data-rp-state" };
  }
  return base;
}

function initialStateFor(primitive, interactions) {
  if (primitive !== "active-card-rail") return null;
  const invariants = interactions.find((item) => item.kind === "carousel")?.invariants || {};
  return {
    mode: invariants.initialState || "single-active",
    activeIndexes: invariants.initialActiveIndexes || [],
  };
}

function runtimeAdapterFor(primitive) {
  if (primitive === "active-card-rail") return "bindActiveItemRail";
  if (primitive === "content-switcher") return "bindContentSwitcher";
  if (primitive === "scroll-scene") return "bindScrollScene + bindContentSwitcher";
  return null;
}

function assertionsFor({ primitive, interactions, media }) {
  const assertions = [];
  if (primitive === "active-card-rail") {
    const observed = interactions.find((item) => item.kind === "carousel")?.invariants || {};
    assertions.push(
      { kind: "scene-present" },
      { kind: "runtime-initialized", primitive: "active-card-rail" },
      { kind: "minimum-item-count", value: Math.max(3, Number(observed.itemCount) || 3) },
      { kind: "horizontal-overflow", minimumRatio: roundTolerance(observed.horizontalOverflowRatio, 0.8, 1.05) },
      { kind: "initial-active-item-count", value: Number(observed.initialActiveCount) || 0 },
      { kind: "single-active-item", value: 1 },
      { kind: "activation-changes-state" },
    );
    if (Number(observed.expandedWidthRatio) > 1.1) {
      assertions.push({ kind: "active-item-width-ratio", minimumRatio: roundTolerance(observed.expandedWidthRatio, 0.8, 1.15) });
    }
    if (Number(observed.observedSettleMs) > 0) {
      assertions.push({ kind: "transition-settles", maximumMs: Math.ceil(Number(observed.observedSettleMs) * 1.5 + 100) });
    }
    if (observed.separation) assertions.push({ kind: "item-separation", observed: observed.separation });
    if (interactions.some((item) => (typeof item.trigger === "string" ? item.trigger : item.trigger?.type) === "hover")) {
      assertions.push({ kind: "hover-changes-visual-state" });
    }
  }
  if (primitive === "content-switcher" || primitive === "scroll-scene" && interactions.some((item) => item.kind === "tabs")) {
    assertions.push({ kind: "runtime-initialized", primitive: "content-switcher" });
    assertions.push({ kind: "activation-changes-content" }, { kind: "single-active-item", value: 1 });
  }
  if (primitive === "scroll-scene") {
    assertions.push({ kind: "runtime-initialized", primitive: "scroll-scene" });
    assertions.push({ kind: "scroll-produces-distinct-phases", minimumPhaseCount: 2 });
    const scrollInteraction = interactions.find((item) => item.kind === "scroll-state") || {};
    const phases = scrollInteraction.states || [];
    if (JSON.stringify(phases).includes('"position":"fixed"')) assertions.push({ kind: "visual-pins-during-scroll" });
    const expansion = scrollInteraction.invariants?.visualExpansion;
    const expansionRatio = Math.max(Number(expansion?.score) || 1, Number(expansion?.widthRatio) || 1, Number(expansion?.transformScaleRatio) || 1);
    if (expansionRatio > 1.1) {
      assertions.push({
        kind: "scroll-visual-expansion",
        minimumRatio: rangeRatioTolerance(expansionRatio, 0.8, 1.05),
      });
    }
    const contentMotion = scrollInteraction.invariants?.motionOwnership?.content;
    if (contentMotion && contentMotion.scales === false) {
      assertions.push({ kind: "scroll-content-scale-bound", maximumRatio: Number(contentMotion.maximumAllowedScaleRatio) || 1.03 });
    }
  }
  for (const item of media.filter((entry) => entry.src)) {
    assertions.push({ kind: "media-source-present", source: item.src, playback: item.playback || {} });
    if (item.fallback?.policy === "fallback-only") assertions.push({ kind: "exclusive-media-layer", fallbackSource: item.fallback.src });
  }
  return assertions;
}

function recipeFor(primitive) {
  const common = {
    bootstrap: "Add exactly once near the end of the document: <script type=\"module\" src=\"/site-clone/rp-interactions-bootstrap.mjs\"></script>",
    warning: "A raw browser script must not import a relative module from src/. Use the public bootstrap above, or use the framework's compiled source import without type=module.",
  };
  if (primitive === "active-card-rail") return {
    ...common,
    steps: [
      "Put data-rp-viewport on a finite-width overflow-x:auto or overflow:hidden element.",
      "Put data-rp-track on its wider max-content flex/grid row; never put overflow on a max-content track.",
      "Put data-rp-item on every card and data-rp-activate on the card activation control.",
      "Set data-rp-initial-state to the captured invariant. Use all-collapsed when the source has no active item; never pre-open a card for visual variety.",
      "Reproduce the recorded separation mechanism (track gap, margins, divider, or inner inset) rather than guessing a generic gap.",
      "Mark the element with the source hover treatment as data-rp-hover-target and reproduce that treatment with :hover/:focus-visible CSS.",
      "Style data-rp-active=true to reproduce the observed expanded/collapsed ratio; keep active links above any activation hit target.",
    ],
  };
  if (primitive === "scroll-scene") return {
    ...common,
    steps: [
      "Give the scene enough scroll height and mark only the measured pinned/scaled wrapper with data-rp-visual.",
      "Mark independently positioned copy with data-rp-content. Do not nest it inside a scaling visual wrapper unless the source evidence explicitly records content scaling.",
      "Use --rp-entry-progress for the approach expansion and --rp-scroll-progress for pinned/release phases.",
      "When the source uses side curtains/masks, mark both with data-rp-curtain and reduce their widths as entry progress increases.",
      "If tabs exist, give controls and panels matching data-rp-state values.",
      "Do not render a fallback poster at the same time as an opaque active video/iframe.",
    ],
  };
  if (primitive === "content-switcher") return {
    ...common,
    steps: [
      "Give each visible control data-rp-item, data-rp-activate, and a unique data-rp-state.",
      "Give its content panel the matching data-rp-panel and data-rp-state.",
    ],
  };
  return common;
}

function roundTolerance(value, factor, floor) {
  const numeric = Number(value) || 0;
  return Math.round(Math.max(floor, numeric * factor) * 1000) / 1000;
}

function rangeRatioTolerance(value, factor, floor) {
  const numeric = Math.max(1, Number(value) || 1);
  return Math.round(Math.max(floor, 1 + (numeric - 1) * factor) * 1000) / 1000;
}

function modelFor(kinds) {
  if (kinds.includes("scroll-state")) return "scroll-scene";
  if (kinds.includes("carousel")) return "active-card-rail";
  if (kinds.includes("tabs")) return "content-switcher";
  return "media-scene";
}

function screenshotFor(section, page) {
  if (section.kind === "hero") return page.screenshots?.desktop || null;
  return page.screenshots?.desktop || page.screenshots?.tablet || null;
}

function safeId(page) {
  return `${page.area || "page"}-${String(page.path || "home").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "home"}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
