const DEFAULT_STYLE_KEYS = [
  "className",
  "ariaSelected",
  "ariaExpanded",
  "hidden",
  "display",
  "visibility",
  "opacity",
  "transform",
  "width",
  "height",
  "flexBasis",
  "gridTemplateColumns",
  "overflow",
  "clipPath",
  "gap",
  "rowGap",
  "columnGap",
  "marginLeft",
  "marginRight",
  "paddingLeft",
  "paddingRight",
  "borderLeftWidth",
  "borderRightWidth",
  "borderLeftColor",
  "borderRightColor",
];

export const DEFAULT_INTERACTION_TIMELINE_MS = [0, 80, 180, 400, 900, 1400];

export function compactInteractionTimeline(frames, { maxChangedNodes = 36 } = {}) {
  const normalized = (frames || []).filter(Boolean).map((frame, index) => ({
    ...frame,
    atMs: Number.isFinite(frame.atMs) ? frame.atMs : index === 0 ? -1 : 0,
    nodes: Array.isArray(frame.nodes) ? frame.nodes : [],
  }));
  if (normalized.length < 2) {
    return {
      sampledAtMs: normalized.map((frame) => frame.atMs),
      observedSettleMs: 0,
      changedNodeCount: 0,
      changes: [],
    };
  }

  const paths = new Set(normalized.flatMap((frame) => frame.nodes.map((node) => node.path).filter(Boolean)));
  const changes = [];
  for (const path of paths) {
    const states = normalized.map((frame) => {
      const node = frame.nodes.find((candidate) => candidate.path === path);
      return node ? { atMs: frame.atMs, ...pickState(node) } : { atMs: frame.atMs, missing: true };
    });
    const changedProperties = changedKeys(states);
    if (!changedProperties.length) continue;
    changes.push({
      path,
      role: states.find((state) => state.role)?.role || "descendant",
      changedProperties,
      states: compactStates(states, changedProperties),
    });
  }

  changes.sort((left, right) => changePriority(right) - changePriority(left));
  const retained = changes.slice(0, maxChangedNodes);
  return {
    sampledAtMs: normalized.map((frame) => frame.atMs),
    observedSettleMs: observedSettleMs(retained),
    changedNodeCount: changes.length,
    truncated: changes.length > retained.length,
    changes: retained,
    animations: compactAnimations(normalized),
  };
}

export function deriveCarouselInvariants({ frames, timeline } = {}) {
  const normalized = (frames || []).filter(Boolean);
  const before = normalized[0] || {};
  const after = normalized[normalized.length - 1] || {};
  const beforeItems = itemNodes(before);
  const afterItems = itemNodes(after);
  const beforeWidths = beforeItems.map(widthOf).filter((value) => value > 0);
  const afterWidths = afterItems.map(widthOf).filter((value) => value > 0);
  const collapsedWidth = median(beforeWidths);
  const expandedWidth = afterWidths.length ? Math.max(...afterWidths) : 0;
  const initialActiveIndexes = beforeItems.map((item, index) => isActive(item) ? index : -1).filter((index) => index >= 0);
  const activeIndexes = afterItems.map((item, index) => isActive(item) ? index : -1).filter((index) => index >= 0);
  const activeCount = afterItems.filter(isActive).length;
  const beforeTrack = before.nodes?.find((node) => node.role === "track");
  const afterTrack = after.nodes?.find((node) => node.role === "track") || beforeTrack;
  const clientWidth = numberOr(afterTrack?.clientWidth, 0);
  const scrollWidth = numberOr(afterTrack?.scrollWidth, 0);
  const geometricGaps = consecutiveGaps(beforeItems);
  const measuredGap = median(geometricGaps);
  const trackGap = px(beforeTrack?.columnGap || beforeTrack?.gap);
  const borderWidths = beforeItems.flatMap((item) => [px(item.borderLeftWidth), px(item.borderRightWidth)]).filter((value) => value > 0);
  const marginWidths = beforeItems.flatMap((item) => [px(item.marginLeft), px(item.marginRight)]).filter((value) => value > 0);
  const separationMechanism = trackGap > 0 ? "track-gap"
    : measuredGap > 0.5 ? "geometric-gap"
      : marginWidths.length ? "item-margin"
        : borderWidths.length ? "divider"
          : "flush";
  return {
    itemCount: Math.max(beforeItems.length, afterItems.length),
    activeCount,
    activeIndexes,
    singleActive: activeCount === 1,
    initialState: initialActiveIndexes.length === 0 ? "all-collapsed" : initialActiveIndexes.length === 1 ? "single-active" : "multiple-active",
    initialActiveCount: initialActiveIndexes.length,
    initialActiveIndexes,
    collapsedItemWidth: round(collapsedWidth),
    expandedItemWidth: round(expandedWidth),
    expandedWidthRatio: collapsedWidth > 0 ? round(expandedWidth / collapsedWidth, 3) : 0,
    horizontalOverflowRatio: clientWidth > 0 ? round(scrollWidth / clientWidth, 3) : 0,
    separation: {
      mechanism: separationMechanism,
      trackGap: round(trackGap, 2),
      geometricGap: round(measuredGap, 2),
      minimumGeometricGap: geometricGaps.length ? round(Math.min(...geometricGaps), 2) : 0,
      maximumGeometricGap: geometricGaps.length ? round(Math.max(...geometricGaps), 2) : 0,
      dividerWidth: round(median(borderWidths), 2),
      itemMargin: round(median(marginWidths), 2),
      contentInset: round(median(beforeItems.flatMap((item) => [px(item.paddingLeft), px(item.paddingRight)]).filter((value) => value > 0)), 2),
    },
    observedSettleMs: timeline?.observedSettleMs || 0,
  };
}

export function deriveScrollInvariants(phases = []) {
  const samples = (phases || []).filter(Boolean);
  const chainCount = Math.max(0, ...samples.map((phase) => phase.visualChain?.length || 0));
  let strongest = null;
  for (let index = 0; index < chainCount; index += 1) {
    const nodes = samples.map((phase) => phase.visualChain?.[index]).filter(Boolean);
    const widths = nodes.map((node) => numberOr(node.width, 0)).filter((value) => value > 0);
    const scales = nodes.map((node) => transformScale(node.transform)).filter((value) => value > 0);
    const widthRatio = rangeRatio(widths);
    const scaleRatio = rangeRatio(scales);
    const score = Math.max(widthRatio, scaleRatio);
    if (!strongest || score > strongest.score) {
      const representative = nodes.find((node) => node.className) || nodes[0] || {};
      strongest = {
        score,
        chainIndex: index,
        tag: representative.tag || "",
        classTokens: String(representative.className || "").split(/\s+/).filter(Boolean).slice(0, 6),
        minimumWidth: widths.length ? Math.min(...widths) : 0,
        maximumWidth: widths.length ? Math.max(...widths) : 0,
        widthRatio: round(widthRatio, 3),
        transformScaleRatio: round(scaleRatio, 3),
      };
    }
  }
  const curtainTotals = samples.map((phase) => (phase.sceneLayers || [])
    .filter((layer) => layer.role === "curtain")
    .reduce((total, layer) => total + Math.max(0, numberOr(layer.width, 0)), 0));
  const rootWidths = samples.map((phase) => numberOr(phase.rootWidth, 0)).filter((value) => value > 0);
  const viewportWidth = median(rootWidths);
  const curtainRevealFraction = curtainTotals.length && viewportWidth > 0
    ? (Math.max(...curtainTotals) - Math.min(...curtainTotals)) / viewportWidth
    : 0;
  const curtainRevealRatio = 1 + Math.max(0, curtainRevealFraction);
  const contentWidths = samples.map((phase) => numberOr(phase.copy?.width, 0)).filter((value) => value > 0);
  const contentHeights = samples.map((phase) => numberOr(phase.copy?.height, 0)).filter((value) => value > 0);
  const contentScales = samples.map((phase) => transformScale(phase.copy?.transform)).filter((value) => value > 0);
  const contentWidthRatio = rangeRatio(contentWidths);
  const contentHeightRatio = rangeRatio(contentHeights);
  const contentScaleRatio = rangeRatio(contentScales);
  if (strongest && curtainRevealRatio > strongest.score) {
    strongest = {
      ...strongest,
      score: round(curtainRevealRatio, 3),
      mechanism: "curtain-reveal",
    };
  } else if (strongest) {
    strongest.mechanism = strongest.widthRatio >= strongest.transformScaleRatio ? "geometry" : "transform";
  }
  return {
    entryPhaseCount: samples.filter((phase) => Number(phase.progress) < 0).length,
    pinnedPhaseCount: samples.filter((phase) => (phase.visualChain || []).some((node) => node.position === "fixed" || node.position === "sticky")).length,
    visualExpansion: strongest || {
      score: 1,
      chainIndex: 0,
      tag: "",
      classTokens: [],
      minimumWidth: 0,
      maximumWidth: 0,
      widthRatio: 1,
      transformScaleRatio: 1,
      mechanism: "none",
    },
    curtainReveal: {
      observed: curtainRevealFraction > 0.05,
      maximumCombinedWidth: curtainTotals.length ? Math.max(...curtainTotals) : 0,
      minimumCombinedWidth: curtainTotals.length ? Math.min(...curtainTotals) : 0,
      viewportFraction: round(Math.max(0, curtainRevealFraction), 3),
    },
    motionOwnership: {
      visual: {
        expands: Number(strongest?.score || 1) > 1.05,
        mechanism: strongest?.mechanism || "none",
      },
      content: {
        widthRatio: round(contentWidthRatio, 3),
        heightRatio: round(contentHeightRatio, 3),
        transformScaleRatio: round(contentScaleRatio, 3),
        scales: Math.max(contentWidthRatio, contentHeightRatio, contentScaleRatio) > 1.05,
        maximumAllowedScaleRatio: Math.max(contentWidthRatio, contentHeightRatio, contentScaleRatio) > 1.05 ? null : 1.03,
      },
    },
  };
}

function consecutiveGaps(items) {
  return items.slice(1).map((item, index) => {
    const previous = items[index];
    return numberOr(item?.rect?.left, 0) - (numberOr(previous?.rect?.left, 0) + numberOr(previous?.rect?.width, 0));
  }).filter((value) => Number.isFinite(value) && value >= -0.5);
}

function px(value) {
  const numeric = Number.parseFloat(String(value || "0"));
  return Number.isFinite(numeric) ? numeric : 0;
}

function pickState(node) {
  const state = {
    role: node.role || "descendant",
    text: String(node.text || "").slice(0, 160),
    rect: node.rect || null,
  };
  for (const key of DEFAULT_STYLE_KEYS) {
    if (node[key] !== undefined) state[key] = node[key];
  }
  if (node.clientWidth !== undefined) state.clientWidth = node.clientWidth;
  if (node.scrollWidth !== undefined) state.scrollWidth = node.scrollWidth;
  return state;
}

function changedKeys(states) {
  const keys = new Set(states.flatMap((state) => Object.keys(state)).filter((key) => !["atMs", "role"].includes(key)));
  return Array.from(keys).filter((key) => {
    const values = states.map((state) => stable(state[key]));
    return values.some((value) => value !== values[0]);
  });
}

function compactStates(states, changedProperties) {
  let previous = null;
  const compacted = [];
  for (const state of states) {
    const next = { atMs: state.atMs };
    for (const key of changedProperties) next[key] = state[key];
    const signature = stable(next, ["atMs"]);
    if (signature === previous) continue;
    compacted.push(next);
    previous = signature;
  }
  return compacted;
}

function observedSettleMs(changes) {
  let settled = 0;
  for (const change of changes) {
    const states = change.states || [];
    if (states.length < 2) continue;
    settled = Math.max(settled, numberOr(states[states.length - 1].atMs, 0));
  }
  return settled;
}

function compactAnimations(frames) {
  const seen = new Map();
  for (const frame of frames) {
    for (const animation of frame.animations || []) {
      const key = `${animation.path || "unknown"}\u0000${animation.name || ""}\u0000${animation.duration || 0}\u0000${animation.easing || ""}`;
      const existing = seen.get(key) || { ...animation, firstSeenAtMs: frame.atMs, lastSeenAtMs: frame.atMs };
      existing.lastSeenAtMs = frame.atMs;
      seen.set(key, existing);
    }
  }
  return Array.from(seen.values()).slice(0, 24);
}

function itemNodes(frame) {
  return (frame?.nodes || []).filter((node) => node.role === "item");
}

function widthOf(node) {
  return numberOr(node?.rect?.width, numberOr(node?.width?.replace?.("px", ""), 0));
}

function isActive(node) {
  return node?.ariaSelected === "true" || node?.ariaExpanded === "true" || node?.active === true || hasActiveToken(node?.className);
}

function hasActiveToken(value) {
  return String(value || "").split(/\s+/).some((token) => /(?:^|[-_:])(active|selected|expanded)$|^(active|selected|expanded)$/i.test(token));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function changePriority(change) {
  const properties = new Set(change.changedProperties || []);
  let score = change.role === "item" ? 30 : change.role === "track" ? 25 : 0;
  if (properties.has("className") || properties.has("ariaSelected") || properties.has("ariaExpanded")) score += 20;
  if (properties.has("rect") || properties.has("transform") || properties.has("opacity")) score += 15;
  if (properties.has("text") || properties.has("display") || properties.has("visibility")) score += 10;
  return score;
}

function stable(value, ignoredKeys = []) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, ignoredKeys)).join(",")}]`;
  return `{${Object.keys(value).filter((key) => !ignoredKeys.includes(key)).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key], ignoredKeys)}`).join(",")}}`;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function rangeRatio(values) {
  if (!values.length) return 1;
  const minimum = Math.min(...values);
  return minimum > 0 ? Math.max(...values) / minimum : 1;
}

function transformScale(value) {
  const text = String(value || "");
  const matrix = text.match(/^matrix\(([^)]+)\)$/);
  if (matrix) {
    const [a, b] = matrix[1].split(",").map(Number);
    return Math.sqrt((a || 0) ** 2 + (b || 0) ** 2) || 1;
  }
  const scale = text.match(/scale(?:X)?\(([-+\d.]+)\)/);
  return scale ? Number(scale[1]) || 1 : 1;
}
