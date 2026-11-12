import { horizontalRelation, overlapRatio, placementFor } from "./geometry.mjs";

export function classifyCanvas(section, scene) {
  const viewport = section.layoutEvidence?.viewport || { width: 1440, height: 900 };
  const rect = section.rect || {};
  const fullWidth = section.layoutHints?.fullWidth ?? Number(rect.width) >= Number(viewport.width) * 0.88;
  let heightMode = "content";
  if (scene?.implementation?.primitive === "scroll-scene") heightMode = "scroll-driven";
  else if (Number(rect.height) >= Number(viewport.height) * 0.82 && Number(rect.height) <= Number(viewport.height) * 1.35) heightMode = "viewport";
  else if (section.layoutEvidence?.canvas?.minHeight?.includes?.("vh")) heightMode = "viewport";
  return {
    widthMode: fullWidth ? "full-bleed" : "bounded",
    heightMode,
    sourceRect: rect,
    viewport,
    positioningContext: section.layoutEvidence?.canvas?.position || "static",
    overflow: {
      x: section.layoutEvidence?.canvas?.overflowX || "visible",
      y: section.layoutEvidence?.canvas?.overflowY || "visible",
    },
    pinned: scene?.implementation?.primitive === "scroll-scene",
  };
}

export function classifyBackground(section, scene) {
  const color = section.background?.color || section.layoutEvidence?.canvas?.background?.color || "";
  const cssImage = section.background?.image || section.layoutEvidence?.canvas?.background?.image || "";
  const media = (scene?.media || []).find((item) => item.role === "background") || null;
  const measuredMedia = (section.layoutEvidence?.layers || []).find((layer) =>
    ["video", "image"].includes(layer.kind)
    && layer.position === "absolute"
    && Number(layer.normalizedRect?.width) >= 0.75
    && Number(layer.normalizedRect?.height) >= 0.25
  ) || null;
  const isGradient = /gradient\(/i.test(cssImage);
  const hasColor = Boolean(color && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(color));
  const hasImage = Boolean((cssImage && cssImage !== "none") || (!media && measuredMedia?.kind === "image"));
  const hasVideo = Boolean((media && ["video", "iframe"].includes(media.tag)) || (!media && measuredMedia?.kind === "video"));
  const signalCount = [hasColor, hasImage || Boolean(media?.fallback?.src), hasVideo].filter(Boolean).length;
  const kind = signalCount > 1 ? "composite" : hasVideo ? "video" : isGradient ? "gradient" : hasImage ? "image" : hasColor ? "color" : "none";
  const layers = [];
  if (hasColor) layers.push({ role: "base", kind: "color", color });
  if (hasVideo) layers.push({
    role: "media",
    kind: "video",
    src: media?.src || measuredMedia?.src || "",
    provider: media?.provider || media?.tag || "native",
    fit: measuredMedia?.objectFit || "cover",
    position: "center",
    playback: media?.playback || {},
  });
  if (!hasVideo && hasImage) layers.push({ role: "media", kind: isGradient ? "gradient" : "image", src: cssImage || measuredMedia?.src || "", fit: measuredMedia?.objectFit || "cover", position: "center" });
  if (media?.fallback?.src) layers.push({
    role: "media",
    kind: "image",
    src: media.fallback.src,
    fit: "cover",
    position: "center",
    policy: media.fallback.policy || "fallback-only",
  });
  const scrollStates = (scene?.states || []).find((state) => state.kind === "scroll-state")?.states || [];
  const observedSceneLayers = scrollStates.flatMap((state) => state.sceneLayers || []);
  for (const layer of section.layoutEvidence?.layers || []) {
    const layerClass = (layer.classTokens || []).join(" ");
    const canvasLayer = layer.kind === "pseudo-layer"
      || (Number(layer.normalizedRect?.width) >= 0.75 && Number(layer.normalizedRect?.height) >= 0.25);
    if (canvasLayer && (layer.kind === "pseudo-layer" || /overlay|curtain|mask/i.test(layerClass))) {
      if (/curtain/i.test(layerClass) && observedSceneLayers.some((candidate) => candidate.role === "curtain")) continue;
      const scrim = layer.kind === "pseudo-layer" || /overlay|mask/i.test(layerClass);
      layers.push({ role: scrim ? "scrim" : "decoration", kind: layer.kind, ...layer });
    }
  }
  const dynamicLayerKeys = new Set();
  for (const layer of observedSceneLayers) {
    if (!['curtain', 'background'].includes(layer.role)) continue;
    const key = `${layer.role}:${layer.className || layer.tag}`;
    if (dynamicLayerKeys.has(key)) continue;
    dynamicLayerKeys.add(key);
    const peers = observedSceneLayers.filter((candidate) => `${candidate.role}:${candidate.className || candidate.tag}` === key);
    layers.push({
      role: layer.role === "curtain" ? "decoration" : "scrim",
      kind: layer.role === "curtain" ? "curtain" : "scene-layer",
      position: layer.position,
      color: layer.backgroundColor,
      motion: "scroll-driven",
      observedWidthPx: {
        minimum: Math.min(...peers.map((candidate) => Number(candidate.width) || 0)),
        maximum: Math.max(...peers.map((candidate) => Number(candidate.width) || 0)),
      },
      className: layer.className || "",
    });
  }
  const resolvedKind = new Set(layers.map((layer) => `${layer.role}:${layer.kind}`)).size > 1 ? "composite" : kind;
  return { kind: resolvedKind, color: hasColor ? color : null, layers };
}

export function buildRegions(section) {
  return (section.layoutEvidence?.regions || []).map((region, index) => ({
    id: `${section.id}-region-${String(index + 1).padStart(2, "0")}`,
    role: region.role || "content",
    text: region.text || "",
    placement: placementFor(region.normalizedRect),
    normalizedRect: region.normalizedRect,
    sourceRect: region.rect,
    positioning: region.position || "static",
    alignment: region.textAlign || "start",
    zIndex: region.zIndex || "auto",
    textGeometry: region.textGeometry || null,
    domRef: region.domRef || null,
  }));
}

export function classifyComposition({ section, scene, background, regions }) {
  const primitive = scene?.implementation?.primitive;
  if (primitive === "active-card-rail" || section.capabilities?.isCarouselLike) return "rail";
  if (primitive === "scroll-scene") return "scroll-narrative";
  if (section.kind === "card-collection") return "grid";
  const mediaIsBackground = background.layers.some((layer) => layer.role === "media" && ["video", "image", "gradient"].includes(layer.kind));
  const contentRegions = regions.filter((region) => !["media", "navigation"].includes(region.role));
  const mediaRegions = regions.filter((region) => region.role === "media");
  if (mediaIsBackground && (contentRegions.length || section.heading || section.text)) return "layered-overlay";
  if (mediaRegions.length && contentRegions.length) {
    const pairs = mediaRegions.flatMap((media) => contentRegions.map((content) => horizontalRelation(media.normalizedRect, content.normalizedRect)));
    if (pairs.some((relation) => relation === "before" || relation === "after")) return "split";
    if (mediaRegions.some((media) => contentRegions.some((content) => overlapRatio(media.normalizedRect, content.normalizedRect) >= 0.2))) return "layered-overlay";
  }
  return regions.length ? "stack" : "freeform";
}

export function relationshipsFor(composition, regions) {
  const relationships = [];
  const headings = regions.filter((region) => region.role === "heading");
  const body = regions.filter((region) => region.role === "body-copy");
  const actions = regions.filter((region) => region.role === "action");
  const tabs = regions.filter((region) => region.role === "tabs");
  if (headings.length && body.length) relationships.push("heading-before-body");
  if (actions.length && body.length) relationships.push(horizontalRelation(body[0].normalizedRect, actions[0].normalizedRect) === "before" ? "action-right-of-copy" : "action-near-copy");
  if (tabs.some((region) => region.placement.startsWith("bottom"))) relationships.push("tabs-bottom-anchored");
  if (["layered-overlay", "scroll-narrative"].includes(composition)) relationships.push("content-over-background-media");
  return [...new Set(relationships)];
}
