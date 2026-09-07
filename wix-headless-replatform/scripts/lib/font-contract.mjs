import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { dedupeBy, stripTags } from "./common.mjs";

const FONT_SOURCE_FILE_EXTENSIONS = new Set([".astro", ".css", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export function buildFontManifest({ html, baseUrl, stylesheets = [] }) {
  const inlineBlocks = extractInlineStyleBlocks(html);
  const inlineFaces = inlineBlocks.flatMap((cssText, index) =>
    extractFontFaceDeclarations(cssText, baseUrl, {
      sourceType: "inline-style",
      sourceIndex: index + 1,
      sourceUrl: baseUrl,
    }),
  );
  const stylesheetFaces = stylesheets.flatMap((stylesheet, index) =>
    extractFontFaceDeclarations(stylesheet.cssText, stylesheet.url || baseUrl, {
      sourceType: stylesheet.sourceType || "stylesheet",
      sourceIndex: index + 1,
      sourceUrl: stylesheet.url || baseUrl,
    }),
  );
  const faces = dedupeBy([...inlineFaces, ...stylesheetFaces], fontFaceKey);
  const contentScripts = detectContentScripts(stripTags(html));
  return {
    sourceUrl: baseUrl,
    inlineStyleBlockCount: inlineBlocks.length,
    stylesheetCount: stylesheets.length,
    contentScripts,
    families: Array.from(new Set(faces.map((face) => face.family))).sort(),
    faces,
  };
}

export function extractInlineStyleBlocks(html) {
  const blocks = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push(match[1]);
  return blocks;
}

export function extractFontFaceDeclarations(cssText, baseUrl, { sourceType = "stylesheet", sourceIndex = 1, sourceUrl = baseUrl } = {}) {
  const faces = [];
  const pattern = /@font-face\s*{([\s\S]*?)}/gi;
  let match;
  while ((match = pattern.exec(cssText))) {
    const declarations = parseCssDeclarations(match[1]);
    const family = normalizeFontFamily(declarations["font-family"]);
    if (!family) continue;
    const style = normalizeFontStyle(declarations["font-style"]);
    const weight = normalizeFontWeight(declarations["font-weight"]);
    const unicodeRange = normalizeUnicodeRange(declarations["unicode-range"]);
    faces.push({
      family,
      style,
      weight,
      display: normalizeDisplay(declarations["font-display"]),
      stretch: normalizeCssToken(declarations["font-stretch"]),
      unicodeRange,
      subsetHint: subsetHintFromUnicodeRange(unicodeRange),
      source: {
        type: sourceType,
        index: sourceIndex,
        url: sourceUrl,
      },
      sources: parseFontSrcList(declarations.src, baseUrl),
    });
  }
  return faces;
}

export function subsetHintFromUnicodeRange(unicodeRange) {
  const normalized = normalizeUnicodeRange(unicodeRange);
  if (!normalized) return "unknown";
  if (/0E01-0E5B/i.test(normalized)) return "thai";
  if (/1EA0-1EF9|20AB/i.test(normalized)) return "vietnamese";
  if (/0000-00FF/i.test(normalized)) return "latin";
  if (/0100-02BA|1E00-1E9F|A720-A7FF/i.test(normalized)) return "latin-ext";
  return "other";
}

export function publicFontUrlFromLocalPath(localPath) {
  const normalized = String(localPath || "").replace(/\\/g, "/");
  if (!normalized) return "";
  return normalized.startsWith("public/") ? `/${normalized.slice("public/".length)}` : normalized;
}

export async function validateProjectFontFaces({ projectRoot, fontManifest }) {
  if (!fontManifest?.faces?.length) {
    return {
      ok: false,
      filesScanned: 0,
      declarationCount: 0,
      issues: [],
      warnings: [{ code: "font-manifest-missing", message: "No extracted font manifest was provided." }],
    };
  }

  const files = await collectFontSourceFiles(projectRoot);
  const declarations = [];
  for (const filePath of files) {
    const text = await readFile(filePath, "utf8");
    declarations.push(
      ...extractFontFaceDeclarations(text, "https://project.local/", {
        sourceType: "project-source",
        sourceUrl: filePath,
      }).map((face) => ({
        ...face,
        filePath,
      })),
    );
  }

  const issues = [];
  const warnings = [];
  if (!declarations.length) {
    warnings.push({
      code: "no-local-font-face-declarations-found",
      message: `No local @font-face declarations were found under ${path.join(projectRoot, "src")}.`,
    });
  }

  const manifestByPublicUrl = new Map();
  for (const face of fontManifest.faces) {
    for (const source of face.sources || []) {
      const publicUrl = publicFontUrlFromLocalPath(source.localPath);
      if (!publicUrl) continue;
      if (!manifestByPublicUrl.has(publicUrl)) manifestByPublicUrl.set(publicUrl, []);
      manifestByPublicUrl.get(publicUrl).push(face);
    }
  }

  for (const declaration of declarations) {
    for (const source of declaration.sources.filter((entry) => entry.kind === "url")) {
      const publicUrl = normalizeProjectFontUrl(source.url);
      if (!publicUrl) continue;
      const manifestFaces = manifestByPublicUrl.get(publicUrl);
      if (!manifestFaces?.length) {
        issues.push({
          code: "untracked-local-font-source",
          filePath: declaration.filePath,
          family: declaration.family,
          style: declaration.style,
          weight: declaration.weight,
          sourceUrl: publicUrl,
          message: `Local font source ${publicUrl} is not tracked in docs/site-clone/fonts.json.`,
        });
        continue;
      }

      const exactMatch = manifestFaces.find((face) =>
        face.family === declaration.family &&
        face.style === declaration.style &&
        face.weight === declaration.weight &&
        (!declaration.unicodeRange || face.unicodeRange === declaration.unicodeRange),
      );
      if (!exactMatch) {
        issues.push({
          code: "font-face-metadata-mismatch",
          filePath: declaration.filePath,
          family: declaration.family,
          style: declaration.style,
          weight: declaration.weight,
          sourceUrl: publicUrl,
          expected: manifestFaces.map((face) => ({
            family: face.family,
            style: face.style,
            weight: face.weight,
            unicodeRange: face.unicodeRange,
            subsetHint: face.subsetHint,
          })),
          message: `Local font source ${publicUrl} is wired to the wrong family/style/weight tuple.`,
        });
        continue;
      }

      if (
        !declaration.unicodeRange &&
        fontManifest.contentScripts?.includes("latin") &&
        exactMatch.subsetHint &&
        exactMatch.subsetHint !== "unknown" &&
        exactMatch.subsetHint !== "latin" &&
        exactMatch.subsetHint !== "latin-ext"
      ) {
        issues.push({
          code: "non-latin-subset-used-without-unicode-range",
          filePath: declaration.filePath,
          family: declaration.family,
          style: declaration.style,
          weight: declaration.weight,
          sourceUrl: publicUrl,
          subsetHint: exactMatch.subsetHint,
          message: `Local font source ${publicUrl} resolves to the ${exactMatch.subsetHint} subset but the emitted @font-face has no unicode-range guard.`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    filesScanned: files.length,
    declarationCount: declarations.length,
    issues,
    warnings,
  };
}

function parseCssDeclarations(block) {
  const declarations = {};
  const pattern = /([-\w]+)\s*:\s*([^;]+);?/g;
  let match;
  while ((match = pattern.exec(block))) declarations[match[1].toLowerCase()] = match[2].trim();
  return declarations;
}

function parseFontSrcList(value, baseUrl) {
  if (!value) return [];
  const entries = [];
  const pattern = /(local|url)\(([^)]+)\)(?:\s*format\(([^)]+)\))?/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const kind = match[1].toLowerCase();
    const rawValue = stripOuterQuotes(match[2].trim());
    const format = stripOuterQuotes((match[3] || "").trim()) || "";
    entries.push({
      kind,
      format,
      value: rawValue,
      url: kind === "url" ? resolveAssetUrl(rawValue, baseUrl) : "",
    });
  }
  return entries;
}

function resolveAssetUrl(rawValue, baseUrl) {
  if (!rawValue) return "";
  if (rawValue.startsWith("/")) return rawValue;
  try {
    return new URL(rawValue, baseUrl).toString();
  } catch {
    return rawValue;
  }
}

function normalizeProjectFontUrl(value) {
  if (!value) return "";
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

async function collectFontSourceFiles(projectRoot) {
  const srcDir = path.join(projectRoot, "src");
  const files = [];
  await walk(srcDir, files);
  return files.sort();
}

async function walk(dir, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (FONT_SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
}

function fontFaceKey(face) {
  return [
    face.family,
    face.style,
    face.weight,
    face.unicodeRange,
    (face.sources || []).map((source) => `${source.kind}:${source.url || source.value}:${source.format}`).join("|"),
  ].join("::");
}

function detectContentScripts(text) {
  const scripts = [];
  if (/[A-Za-z]/.test(text)) scripts.push("latin");
  if (/[\u0E00-\u0E7F]/.test(text)) scripts.push("thai");
  return scripts;
}

function normalizeFontFamily(value) {
  return stripOuterQuotes(String(value || "").trim());
}

function normalizeFontStyle(value) {
  return normalizeCssToken(value) || "normal";
}

function normalizeFontWeight(value) {
  const normalized = normalizeCssToken(value);
  return normalized || "400";
}

function normalizeUnicodeRange(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDisplay(value) {
  return normalizeCssToken(value) || "swap";
}

function normalizeCssToken(value) {
  return String(value || "").trim().toLowerCase();
}

function stripOuterQuotes(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "");
}
