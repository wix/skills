export function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

export function normalizedRect(rect, frame) {
  if (!rect || !frame) return null;
  return {
    x: round((Number(rect.left ?? rect.x) - Number(frame.left ?? frame.x ?? 0)) / Math.max(Number(frame.width), 1)),
    y: round((Number(rect.top ?? rect.y) - Number(frame.top ?? frame.y ?? 0)) / Math.max(Number(frame.height), 1)),
    width: round(Number(rect.width) / Math.max(Number(frame.width), 1)),
    height: round(Number(rect.height) / Math.max(Number(frame.height), 1)),
  };
}

export function placementFor(rect) {
  if (!rect) return "center";
  const centerX = Number(rect.x) + (Number(rect.width) / 2);
  const centerY = Number(rect.y) + (Number(rect.height) / 2);
  const horizontal = centerX < 0.38 ? "left" : centerX > 0.62 ? "right" : "center";
  const vertical = centerY < 0.38 ? "top" : centerY > 0.62 ? "bottom" : "center";
  return vertical === "center" && horizontal === "center" ? "center" : `${vertical}-${horizontal}`;
}

export function overlapRatio(first, second) {
  if (!first || !second) return 0;
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return round(intersection / Math.max(Math.min(first.width * first.height, second.width * second.height), 0.0001));
}

export function horizontalRelation(first, second) {
  if (!first || !second) return "unknown";
  const gap = 0.025;
  if (first.x + first.width + gap <= second.x) return "before";
  if (second.x + second.width + gap <= first.x) return "after";
  return "overlap";
}

