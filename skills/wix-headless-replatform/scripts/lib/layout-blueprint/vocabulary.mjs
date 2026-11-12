export const LAYOUT_VOCABULARY_VERSION = 2;

export const VOCABULARY = Object.freeze({
  composition: ["layered-overlay", "split", "stack", "grid", "rail", "scroll-narrative", "freeform"],
  canvasWidth: ["full-bleed", "bounded"],
  canvasHeight: ["viewport", "content", "fixed-ratio", "scroll-driven"],
  backgroundKind: ["none", "color", "gradient", "image", "video", "composite"],
  container: ["full", "bounded"],
  regionRole: ["heading", "body-copy", "media", "action", "tabs", "tab", "navigation", "content"],
  placement: [
    "top-left", "top-center", "top-right",
    "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right",
  ],
  layerRole: ["base", "media", "scrim", "decoration", "content"],
  mediaFit: ["cover", "contain", "fill", "natural"],
  textWrapPolicy: ["single-line", "wrapped", "clipped-or-overflowing"],
});
