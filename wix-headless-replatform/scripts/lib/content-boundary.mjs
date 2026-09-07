export const CONTENT_EXTRACTION_SEMANTICS_VERSION = "rendered-content-v2";

const STRONG_CONTAMINATION_SIGNALS = [
  ["javascript-dom-api", /\b(?:document|window)\s*\.\s*(?:querySelector(?:All)?|addEventListener|removeEventListener|getElementById|createElement)\s*\(/i],
  ["javascript-function-body", /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{|\([^)]*\)\s*=>\s*\{/],
  ["javascript-browser-constructor", /\bnew\s+(?:ResizeObserver|IntersectionObserver|MutationObserver|CustomEvent)\s*\(/],
  ["stylesheet-rule", /(?:^|\s)(?:[#.][\w-]+|[a-z][\w-]*(?:\[[^\]]+\])?)(?:\s*[>+~]\s*(?:\*|[#.a-z][\w-]*))*\s*\{\s*[\w-]+\s*:\s*[^{};]+;?/i],
  ["stylesheet-at-rule", /@(?:media|supports|keyframes|font-face)\b[^{}]*\{/i],
  ["embedded-source-markup", /(?:<|&lt;)(?:script|style|link|template)\b/i],
];

export function detectContentContamination(value, { allowVisibleCode = false } = {}) {
  if (allowVisibleCode) return { contaminated: false, reasons: [] };
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { contaminated: false, reasons: [] };
  const reasons = STRONG_CONTAMINATION_SIGNALS
    .filter(([, pattern]) => pattern.test(text))
    .map(([reason]) => reason);
  return { contaminated: reasons.length > 0, reasons };
}

export function inspectContentObject(value, options = {}) {
  const findings = [];
  visitContentStrings(value, [], (text, path) => {
    const result = detectContentContamination(text, options);
    if (result.contaminated) findings.push({ path: path.join("."), reasons: result.reasons });
  });
  return {
    contaminated: findings.length > 0,
    reasons: [...new Set(findings.flatMap((finding) => finding.reasons))],
    findings,
  };
}

export function removeContaminatedContent(value, options = {}) {
  if (Array.isArray(value)) return value.map((item) => removeContaminatedContent(item, options));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === "string" && isContentBearingKey(key)) {
      return [key, detectContentContamination(item, options).contaminated ? "" : item];
    }
    return [key, removeContaminatedContent(item, options)];
  }));
}

function visitContentStrings(value, path, visit) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitContentStrings(item, [...path, String(index)], visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof item === "string" && isContentBearingKey(key)) visit(item, nextPath);
    else visitContentStrings(item, nextPath, visit);
  }
}

function isContentBearingKey(key) {
  return /^(?:text|heading|label|title|description|paragraphs?|content|copy|accessibleName|ariaLabel|legalText)$/i.test(key);
}
