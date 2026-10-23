#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, cp, readdir, readFile, rm, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { docsDir, ensureDir, normalizeUrl, parseArgs, readJson, resolveOutputDir, writeJson } from "./lib/common.mjs";
import {
  resolveBrowserToolingContext,
  resolveDesignMdGeneratorFromContext,
} from "./lib/browser-tooling.mjs";
import { extractTokens } from "./extract-tokens.mjs";

const VALID_EXTRACTORS = new Set(["auto", "design-md-generator", "local"]);

async function main() {
  const args = parseArgs();
  const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  const extractor = normalizeExtractor(args["design-extractor"]);
  const result = await extractDesignSystem({ sourceUrl, outputDir, extractor });
  await writeJson(path.join(docsDir(outputDir), "tokens.json"), result.tokens);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function extractDesignSystem({ sourceUrl, outputDir, extractor = "auto", browserTooling = null }) {
  const toolingContext = browserTooling || await resolveBrowserToolingContext({ startDir: process.cwd() });
  const selected = normalizeExtractor(extractor);
  const attempts = [];
  if (selected === "local") return extractLocal({ outputDir, reason: "local extractor selected", selectedExtractor: selected, attempts });

  const order = selected === "auto" ? ["design-md-generator"] : [selected];

  for (const mode of order) {
    try {
      const result = await extractWithDesignMdGenerator({ sourceUrl, outputDir, browserTooling: toolingContext });
      attempts.push(...(result.attempts || []));
      return finalizeExtractionResult({
        result,
        selectedExtractor: selected,
        attempts,
      });
    } catch (error) {
      const details = error?.details || null;
      attempts.push({
        extractor: mode,
        status: "failed",
        reason: error.message,
        details,
      });
      if (selected !== "auto") {
        throw new Error(`${labelForExtractor(mode)} extraction failed: ${formatExtractionFailure(error)}`);
      }
    }
  }

  const fallbackReason = attempts.length
    ? `External extractors failed: ${attempts.map((attempt) => `${attempt.extractor}: ${attempt.reason}`).join("; ")}`
    : "no external extractors attempted";
  return extractLocal({ outputDir, reason: fallbackReason, selectedExtractor: selected, attempts });
}

function normalizeExtractor(value) {
  const extractor = String(value || "auto");
  if (!VALID_EXTRACTORS.has(extractor)) {
    throw new Error(`Invalid --design-extractor "${extractor}". Expected auto, design-md-generator, or local.`);
  }
  return extractor;
}

function finalizeExtractionResult({ result, selectedExtractor, attempts }) {
  const actualExtractor = result.extractor || "local";
  const fallbackReason = actualExtractor !== selectedExtractor && attempts.some((attempt) => attempt.status === "failed")
    ? attempts.filter((attempt) => attempt.status === "failed").map((attempt) => `${attempt.extractor}: ${attempt.reason}`).join("; ")
    : result.fallbackReason || null;
  result.selectedExtractor = selectedExtractor;
  result.actualExtractor = actualExtractor;
  result.fallbackReason = fallbackReason;
  result.attempts = attempts;
  result.tokens = {
    ...(result.tokens || {}),
    extraction: {
      ...(result.tokens?.extraction || {}),
      selectedExtractor,
      source: actualExtractor,
      fallbackReason,
      attempts,
      generatedAt: new Date().toISOString(),
    },
  };
  return result;
}

async function extractLocal({ outputDir, reason, selectedExtractor = "local", attempts = [] }) {
  const tokens = await extractTokens({ outputDir });
  return finalizeExtractionResult({
    selectedExtractor,
    attempts,
    result: {
    extractor: "local",
    fallbackReason: reason,
    tokens: {
      ...tokens,
      extraction: {
        source: "local",
        fallbackReason: reason,
          attempts,
          generatedAt: new Date().toISOString(),
      },
    },
    },
  });
}

async function extractWithDesignMdGenerator({ sourceUrl, outputDir, browserTooling }) {
  const tool = await resolveDesignMdGeneratorFromContext(browserTooling);
  const toolDir = tool.rootDir;
  const generatorDir = path.join(docsDir(outputDir), "design-md-generator");
  const runRoot = path.join(docsDir(outputDir), ".design-md-generator-run");
  await rm(runRoot, { recursive: true, force: true });
  await ensureDir(runRoot);
  const attempts = [];

  const wrapper = await runDesignMdGeneratorAttempt({
    mode: "wrapper",
    sourceUrl,
    tool,
    runDir: path.join(runRoot, "wrapper"),
  });
  attempts.push(wrapper.attempt);
  if (wrapper.success) {
    return await finalizeDesignMdGeneratorSuccess({ sourceUrl, generatorDir, toolDir, selectedAttempt: wrapper.attempt, attempts, artifacts: wrapper.artifacts });
  }

  if (canAttemptDirectDesignMdGenerator(tool)) {
    const directRunDir = path.join(runRoot, "direct");
    const direct = await runDesignMdGeneratorAttempt({
      mode: "direct",
      sourceUrl,
      tool,
      runDir: directRunDir,
    });
    attempts.push(direct.attempt);
    if (direct.success) {
      return await finalizeDesignMdGeneratorSuccess({ sourceUrl, generatorDir, toolDir, selectedAttempt: direct.attempt, attempts, artifacts: direct.artifacts });
    }
  } else {
    attempts.push({
      extractor: "design-md-generator",
      mode: "direct",
      status: "skipped",
      reason: "direct retry unavailable: extractor mode does not define a retry command",
    });
  }

  await ensureDir(generatorDir);
  await writeJson(path.join(generatorDir, "metadata.json"), {
    extractor: "design-md-generator",
    sourceUrl,
    generatedAt: new Date().toISOString(),
    toolDir,
    attempts,
  });
  throw createExtractionError("design-md-generator completed but did not leave the expected artifacts in the requested output directory", {
    sourceUrl,
    toolDir,
    attempts,
  });
}

export function normalizeDesignMdGeneratorTokens({ rawTokens, report }) {
  const colors = unique(
    (rawTokens.colorTokens || [])
      .filter((token) => token?.hex && token?.stability?.layer !== "content")
      .map((token) => token.hex),
  ).slice(0, 16);
  const fontFamilies = unique(
    (rawTokens.typographyLevels || [])
      .filter((level) => level?.fontFamily && level?.stability?.layer !== "content")
      .map((level) => level.fontFamily),
  ).slice(0, 8);
  const fontSizes = unique(
    (rawTokens.typographyLevels || [])
      .filter((level) => level?.fontSize && level?.stability?.layer !== "content")
      .map((level) => level.fontSize),
  ).slice(0, 16);
  const radii = unique(
    (rawTokens.radiusTokens || [])
      .filter((token) => token?.value && token?.stability?.layer !== "content")
      .map((token) => token.value),
  ).slice(0, 12);
  const shadows = unique(
    (rawTokens.shadowTokens || [])
      .filter((token) => token?.value && token?.stability?.layer !== "content")
      .map((token) => token.value),
  ).slice(0, 12);
  const spacing = unique(
    (rawTokens.spacingSystem?.scale || [])
      .filter((value) => Number.isFinite(value))
      .map((value) => `${value}px`),
  ).slice(0, 16);
  const breakpoints = unique(
    (rawTokens.breakpoints || [])
      .filter((item) => item?.value && /(px|rem|em|vw|vh|%)$/i.test(String(item.value)))
      .map((item) => String(item.value)),
  ).slice(0, 12);

  return {
    colors,
    fontFamilies,
    fontSizes,
    radii,
    shadows,
    spacing,
    breakpoints,
    designMdGenerator: {
      summary: summarizeDesignMdGenerator(rawTokens, report),
      screenshotsAvailable: Boolean(report?.screenshotCount),
      rawDesignMdAvailable: false,
    },
    recommendedTailwindTokens: {
      colors: mapColorRecommendations(colors),
      fonts: mapFontRecommendations(fontFamilies),
      spacing: spacing.length ? `Use extracted spacing scale: ${spacing.join(", ")}.` : "Infer spacing from screenshots and extracted section rhythm.",
      radii: radii.length ? `Use extracted radius scale: ${radii.join(", ")}.` : "Infer radius from extracted controls and screenshot evidence.",
      shadows: shadows.length ? `Use extracted elevation tokens: ${shadows.slice(0, 4).join("; ")}.` : "Use source elevation only where observed.",
    },
    extraction: {
      source: "design-md-generator",
      generatedAt: new Date().toISOString(),
    },
  };
}

function collectValues(roots, predicate, limit) {
  const found = [];
  const seen = new Set();
  for (const root of roots) walk(root, (value) => {
    const normalized = normalizeValue(value);
    if (!normalized || seen.has(normalized) || !predicate(normalized)) return;
    seen.add(normalized);
    found.push(normalized);
  });
  return found.slice(0, limit);
}

function walk(value, visit) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value === "object") {
    if ("$value" in value) walk(value.$value, visit);
    if ("value" in value) walk(value.value, visit);
    for (const [key, item] of Object.entries(value)) {
      if (key === "$value" || key === "value") continue;
      walk(item, visit);
    }
  }
}

function normalizeValue(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function isColorValue(value) {
  return /^#(?:[0-9a-f]{3,8})$/i.test(value) || /^rgba?\(/i.test(value) || /^hsla?\(/i.test(value);
}

function looksLikeFontFamily(value) {
  if (isColorValue(value) || isSizeValue(value) || isShadowValue(value)) return false;
  return /(^|,)\s*[-"']?[a-z][a-z0-9 -]+/i.test(value) && /(sans|serif|mono|system|inter|rubik|arial|helvetica|font|ui-)/i.test(value);
}

function isSizeValue(value) {
  return /^-?\d*\.?\d+(px|rem|em|vw|vh|%)$/i.test(value);
}

function isRadiusValue(value) {
  return isSizeValue(value) || /^pill$/i.test(value);
}

function isShadowValue(value) {
  return /(?:\d+px\s+){2,}.*(?:rgba?\(|#|var\()/i.test(value) || value === "none";
}

function mapColorRecommendations(colors) {
  if (!colors.length) return "Map primary, secondary, background, foreground, muted, accent, border from source screenshots.";
  const [primary, foreground, background, muted, accent, border] = colors;
  return [
    primary && `--primary: ${primary}`,
    foreground && `--foreground: ${foreground}`,
    background && `--background: ${background}`,
    muted && `--muted: ${muted}`,
    accent && `--accent: ${accent}`,
    border && `--border: ${border}`,
  ].filter(Boolean).join("; ");
}

function mapFontRecommendations(fontFamilies) {
  if (!fontFamilies.length) return "Map sans/display/body from source screenshots and local downloaded fonts.";
  const [body, display] = fontFamilies;
  return [`--font-body: ${body}`, `--font-display: ${display || body}`].join("; ");
}

function summarizeDesignMdGenerator(rawTokens, report) {
  return {
    pages: report?.pagesCrawled || rawTokens?.meta?.totalPages || 0,
    elements: report?.totalElements || rawTokens?.meta?.totalElements || 0,
    colorCount: rawTokens?.colorTokens?.length || 0,
    typographyCount: rawTokens?.typographyLevels?.length || 0,
    componentCount: rawTokens?.components?.length || 0,
    shadowCount: rawTokens?.shadowTokens?.length || 0,
    radiusCount: rawTokens?.radiusTokens?.length || 0,
    designBoundary: report?.designBoundary?.relationship || null,
  };
}

function renderDesignMdGeneratorMarkdown({ sourceUrl, rawTokens, report }) {
  const colors = (rawTokens.colorTokens || []).filter((token) => token?.hex).slice(0, 10);
  const typography = (rawTokens.typographyLevels || []).filter((level) => level?.fontFamily).slice(0, 10);
  const components = rawTokens.components || [];
  const spacingScale = (rawTokens.spacingSystem?.scale || []).filter((value) => Number.isFinite(value)).slice(0, 10);
  const breakpoints = (rawTokens.breakpoints || []).filter((item) => item?.value).slice(0, 10);
  const motion = rawTokens.motionSystem || {};
  const iconSystem = rawTokens.iconSystem || {};
  const boundary = report?.designBoundary;
  const sourceHost = new URL(sourceUrl).hostname;

  return `# Design System

Source: ${sourceUrl}

## Extraction

- Source: design-md-generator
- Pages crawled: ${report?.pagesCrawled || rawTokens?.meta?.totalPages || 0}
- Total elements: ${report?.totalElements || rawTokens?.meta?.totalElements || 0}
- Screenshots captured: ${report?.screenshotCount || 0}
${boundary ? `- Design boundary: ${boundary.relationship} (${boundary.overallSimilarity}% similarity)` : "- Design boundary: not reported"}

## Brand Summary

- Site title: ${sourceHost}
- Visual position: derive from extracted screenshots, token frequencies, component primitives, and copied page evidence.
- Primary goal: preserve recognizable source brand while rebuilding against evidence-first extraction output.

## Color Tokens

${colors.length ? colors.map((token) => `- \`${token.hex}\` (${token.stability?.layer || "unknown"}, frequency ${token.frequency || 0})`).join("\n") : "- No colors extracted."}

Recommended Tailwind variables:

${[
    mapColorRecommendations(unique(colors.map((token) => token.hex)).slice(0, 8)),
    mapFontRecommendations(unique(typography.map((level) => level.fontFamily)).slice(0, 2)),
  ].map((item) => `- ${item}`).join("\n")}

## Typography

${typography.length ? typography.map((level) => `- \`${level.fontFamily}\` ${level.fontSize} / ${level.fontWeight} / ${level.lineHeight}${level.textTransform ? ` / ${level.textTransform}` : ""}`).join("\n") : "- No typography levels extracted."}

## Layout And Spacing

- Base unit: ${rawTokens.spacingSystem?.baseUnit ?? "unknown"}
${spacingScale.length ? `- Spacing scale: ${spacingScale.map((value) => `\`${value}px\``).join(", ")}.` : "- Spacing scale: not extracted."}
${breakpoints.length ? `- Breakpoints: ${breakpoints.map((item) => `\`${item.value}\``).join(", ")}.` : "- Breakpoints: not extracted."}
- Max content width: ${rawTokens.layoutPatterns?.maxContentWidth || "unknown"}
- Content alignment: ${rawTokens.layoutPatterns?.contentAlignment || "unknown"}

## Header And Navigation

- Use screenshot evidence from the extracted run for shared chrome.
- Preserve source direction and navigation order from extracted page evidence before implementing shared header/footer.
- If the source includes multiple header states, validate them manually from the captured screenshots before simplifying.

## Radii, Borders, Shadows

Radii:

${(rawTokens.radiusTokens || []).length ? rawTokens.radiusTokens.slice(0, 8).map((token) => `- \`${token.value}\` (${token.stability?.layer || "unknown"})`).join("\n") : "- No radii extracted."}

Shadows:

${(rawTokens.shadowTokens || []).length ? rawTokens.shadowTokens.slice(0, 8).map((token) => `- \`${token.value}\` (${token.stability?.layer || "unknown"})`).join("\n") : "- No shadows extracted."}

## Global CSS Recommendations

- Load extracted font families before building page sections.
- Map high-frequency infrastructure and system colors into theme variables first.
- Prefer infrastructure and system layers over campaign or content-only tokens.
- Use screenshot evidence to validate any token that appears only on a small subset of pages.

## Component Patterns

${components.length ? components.slice(0, 8).map((component) => {
    const variants = (component.variants || []).slice(0, 3).map((variant) => `  - ${variant.name}: ${variant.style?.fontSize || "?"} / ${variant.style?.fontWeight || "?"} / ${variant.style?.backgroundColor || "?"} / ${variant.style?.color || "?"}`).join("\n");
    return `- ${component.type}\n${variants}`;
  }).join("\n") : "- No component primitives extracted."}

## Accessibility And Motion Notes

- Primary timing function: ${motion.primaryTimingFunction || "unknown"}
${(motion.durationScale || []).length ? `- Duration scale: ${(motion.durationScale || []).map((item) => `\`${item.value}\``).join(", ")}.` : "- Duration scale: not extracted."}
- Reduced motion support: ${motion.prefersReducedMotion === true ? "reported" : "not reported"}
- Icon system: ${iconSystem.library || "custom or not detected"}, ${iconSystem.totalCount || 0} extracted icon instances

## Implementation Checklist

- Set Tailwind/theme variables before building pages.
- Add global CSS and font loading from extracted families.
- Use extracted screenshots to validate header, navigation, hero composition, and footer structure.
- Build shared header, footer, layout, and CTA components first.
- Run visual QA against the extracted screenshots after implementation.
`;
}

function countBranch(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 1;
}

async function findFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findFiles(filePath));
    if (entry.isFile()) out.push(filePath);
  }
  return out;
}

function newestFile(files) {
  return files.sort().at(-1);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function safeReadJson(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

async function assertReadable(filePath, errorMessage = `Missing required file: ${filePath}`) {
  try {
    await access(filePath);
  } catch {
    throw new Error(errorMessage);
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function canAttemptDirectDesignMdGenerator(tool) {
  return Boolean(tool?.retryCommand && tool?.retryArgs?.length);
}

async function runDesignMdGeneratorAttempt({ mode, sourceUrl, tool, runDir }) {
  await ensureDir(runDir);
  const command = mode === "direct" ? tool.retryCommand : tool.command;
  const baseArgs = mode === "direct" ? tool.retryArgs : tool.args;
  const outputPath = resolveDesignMdGeneratorOutputPath(runDir);
  const args = [...baseArgs, sourceUrl, "--fast", "--output", outputPath];
  const run = await runCommand(command, args, { cwd: tool.rootDir, timeoutMs: 240000 });
  const artifacts = await inspectDesignMdArtifacts(runDir);
  const attempt = {
    extractor: "design-md-generator",
    mode,
    status: run.ok ? "succeeded" : (artifacts.tokensExists ? "recovered-output" : "failed"),
    command: `${command} ${args.join(" ")}`,
    cwd: tool.rootDir,
    outputDir: outputPath,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    stdoutTail: tail(run.stdout),
    stderrTail: tail(run.stderr),
    artifacts,
  };
  await writeJson(path.join(runDir, "attempt-metadata.json"), {
    sourceUrl,
    toolDir: tool.rootDir,
    toolMode: tool.mode,
    ...attempt,
  });
  return {
    success: artifacts.tokensExists,
    artifacts,
    attempt,
  };
}

export function resolveDesignMdGeneratorOutputPath(runDir) {
  return path.resolve(runDir);
}

async function inspectDesignMdArtifacts(runDir) {
  const tokensPath = path.join(runDir, "tokens.json");
  const reportPath = path.join(runDir, "extraction-report.json");
  const rawPath = path.join(runDir, "raw-data.json");
  const screenshotsPath = path.join(runDir, "screenshots");
  return {
    tokensPath,
    reportPath,
    rawPath,
    screenshotsPath,
    tokensExists: await pathExists(tokensPath),
    reportExists: await pathExists(reportPath),
    rawExists: await pathExists(rawPath),
    screenshotsExist: await pathExists(screenshotsPath),
  };
}

async function finalizeDesignMdGeneratorSuccess({ sourceUrl, generatorDir, toolDir, selectedAttempt, attempts, artifacts }) {
  await rm(generatorDir, { recursive: true, force: true });
  await ensureDir(generatorDir);
  await copyFile(artifacts.tokensPath, path.join(generatorDir, "tokens.json"));
  if (artifacts.reportExists) await copyFile(artifacts.reportPath, path.join(generatorDir, "extraction-report.json"));
  if (artifacts.rawExists) await copyFile(artifacts.rawPath, path.join(generatorDir, "raw-data.json"));
  if (artifacts.screenshotsExist) await cp(artifacts.screenshotsPath, path.join(generatorDir, "screenshots"), { recursive: true });
  await writeJson(path.join(generatorDir, "metadata.json"), {
    extractor: "design-md-generator",
    sourceUrl,
    generatedAt: new Date().toISOString(),
    toolDir,
    selectedAttempt,
    attempts,
  });

  const rawTokens = await readJson(artifacts.tokensPath);
  const report = await safeReadJson(artifacts.reportPath, {});
  const rawData = await safeReadJson(artifacts.rawPath, {});
  return {
    extractor: "design-md-generator",
    tokens: normalizeDesignMdGeneratorTokens({ rawTokens, report }),
    designMd: renderDesignMdGeneratorMarkdown({ sourceUrl, rawTokens, report, rawData }),
    attempts,
  };
}

function createExtractionError(message, details) {
  const error = new Error(message);
  error.details = details;
  return error;
}

function labelForExtractor(value) {
  return value === "design-md-generator" ? "design-md-generator" : "local";
}

function formatExtractionFailure(error) {
  const lines = [error?.message || "unknown failure"];
  const attempts = error?.details?.attempts || [];
  for (const attempt of attempts) {
    const parts = [
      attempt.extractor,
      attempt.mode ? `/${attempt.mode}` : "",
      ` ${attempt.status || "unknown"}`,
    ];
    if (attempt.command) parts.push(` command=${attempt.command}`);
    if (attempt.reason) parts.push(` reason=${attempt.reason}`);
    if (attempt.exitCode != null) parts.push(` exitCode=${attempt.exitCode}`);
    if (attempt.timedOut) parts.push(" timedOut=true");
    if (attempt.artifacts) {
      const artifactFlags = Object.entries(attempt.artifacts)
        .filter(([key]) => /Exists$/.test(key))
        .map(([key, value]) => `${key}=${value}`);
      if (artifactFlags.length) parts.push(` artifacts[${artifactFlags.join(", ")}]`);
    }
    lines.push(parts.join(""));
  }
  return lines.join("; ");
}

function tail(value, limit = 4000) {
  return String(value || "").slice(-limit);
}

function runCommand(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        summary: timedOut
          ? `timed out after ${timeoutMs / 1000}s`
          : `exited with code ${code}: ${(stderr || stdout).trim().slice(-1000)}`,
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
