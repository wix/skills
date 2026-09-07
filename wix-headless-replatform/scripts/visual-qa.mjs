#!/usr/bin/env node
import path from "node:path";
import { docsDir, normalizeUrl, parseArgs, readJson, resolveOutputDir, writeJson } from "./lib/common.mjs";
import { verifyFrozenManifest } from "./lib/extraction-contract.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const report = await visualQa({ outputDir });
  await writeJson(path.join(docsDir(outputDir), "qa", "visual-qa.json"), report);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else console.log(`Visual QA heuristic score: ${report.score}/100`);
}

export async function visualQa({ outputDir }) {
  const dir = docsDir(outputDir);
  const latest = await safeRead(path.join(dir, "extraction", "latest.json"), null);
  if (!latest?.captureId) return missingManifestReport();
  const extractionDir = path.join(dir, "extraction", latest.captureId);
  const integrity = await verifyFrozenManifest(extractionDir);
  const observations = path.join(extractionDir, "observations");
  const page = await safeRead(path.join(observations, "page.json"), {});
  const seo = await safeRead(path.join(observations, "seo.json"), {});
  const sourceMap = { pages: [page], seo };
  const interactionMap = await safeRead(path.join(observations, "interaction-map.json"), { interactions: [], structural: {} });
  const sceneContract = await safeRead(path.join(observations, "scene-contract.json"), { scenes: [] });
  const controlStateContract = await safeRead(path.join(observations, "control-state-contract.json"), { controls: [] });
  const visualAssets = await safeRead(path.join(observations, "visual-assets.json"), { logos: [], icons: [] });
  const layoutBlueprint = await safeRead(path.join(observations, "layout-blueprint.json"), { pages: [] });
  const buildPlan = await safeRead(path.join(dir, "build", "build-plan.json"), { units: [] });
  const ledger = await safeRead(path.join(dir, "build", "section-implementation.json"), { units: [] });
  const specIndex = await safeRead(path.join(extractionDir, "spec-index.json"), {});
  const extractionGaps = await safeRead(path.join(extractionDir, "extraction-gaps.json"), { gaps: [] });
  const chromePages = (sourceMap.pages || []).filter((page) => page.chrome);
  const implementationText = await readImplementationText(outputDir);
  const chromeWarnings = chromeReviewWarnings({ chromePages, implementationText });
  const repeaterWarnings = repeaterReviewWarnings({ pages: sourceMap.pages || [], implementationText });
  const interactionWarnings = interactionReviewWarnings({ pages: sourceMap.pages || [], interactionMap, implementationText });
  const checks = [];
  checks.push(check("frozen manifest integrity", integrity.ok && integrity.manifest.manifestHash === latest.manifestHash, 20, integrity.failures));
  checks.push(check("home build plan matches manifest", buildPlan.manifestHash === latest.manifestHash, 10));
  checks.push(check("every planned unit has a build ledger entry", buildPlan.units?.every((unit) => ledger.units?.some((entry) => entry.id === unit.id && entry.specHash === unit.hash)), 10));
  checks.push(check("source pages extracted", sourceMap.pages?.length > 0, 10));
  checks.push(check("text content captured", sourceMap.pages?.some((p) => p.sections?.some((s) => s.text?.length > 80)), 15));
  checks.push(check("seo captured", Boolean(sourceMap.seo?.title || sourceMap.pages?.some((p) => p.seo?.title)), 10));
  checks.push(check("screenshots captured or fallback recorded", sourceMap.pages?.some((p) => Object.keys(p.screenshots || {}).length > 0 || p.extractionWarnings?.length), 5));
  checks.push(check("stateful scene contract generated", Array.isArray(sceneContract.scenes) && sceneContract.scenes.length > 0, 10));
  checks.push(check("control state contract generated", Array.isArray(controlStateContract.controls) && controlStateContract.controls.length > 0, 10));
  checks.push(check("source logo assets materialized", (visualAssets.logos || []).length > 0 && (visualAssets.logos || []).every((logo) => Boolean(logo.localPath || logo.sourceUrl)), 10));
  checks.push(check("important text geometry captured", (layoutBlueprint.pages || []).some((page) => page.sections?.some((section) => section.regions?.some((region) => region.textGeometry?.lineCount))), 10));
  checks.push(check("chrome evidence captured or fallback warning recorded", chromeEvidenceAvailable(sourceMap.pages), 10));
  checks.push(check("repeaters preserved or manually flagged", !repeaterWarnings.some((warning) => warning.kind === "collapsed-repeater"), 5, repeaterWarnings.filter((warning) => warning.kind === "collapsed-repeater").map((warning) => warning.message)));
  checks.push(check("repeater headings preserved or manually flagged", !repeaterWarnings.some((warning) => warning.kind === "missing-repeater-headings"), 5, repeaterWarnings.filter((warning) => warning.kind === "missing-repeater-headings").map((warning) => warning.message)));
  checks.push(check("multi-image repeaters preserved or manually flagged", !repeaterWarnings.some((warning) => warning.kind === "collapsed-multi-image-repeater"), 5, repeaterWarnings.filter((warning) => warning.kind === "collapsed-multi-image-repeater").map((warning) => warning.message)));
  checks.push(check("dropdown hierarchy preserved or manually flagged", !chromeWarnings.some((warning) => warning.kind === "flattened-dropdown"), 10, chromeWarnings.filter((warning) => warning.kind === "flattened-dropdown").map((warning) => warning.message)));
  checks.push(check("sticky header footprint reviewed", !chromeWarnings.some((warning) => warning.kind === "sticky-header-footprint"), 5, chromeWarnings.filter((warning) => warning.kind === "sticky-header-footprint").map((warning) => warning.message)));
  checks.push(check("seo-only hero text reviewed", !chromeWarnings.some((warning) => warning.kind === "seo-only-hero-text"), 5, chromeWarnings.filter((warning) => warning.kind === "seo-only-hero-text").map((warning) => warning.message)));
  checks.push(check("core interaction evidence consumed", !interactionWarnings.some((warning) => warning.kind !== "manual-interaction-review"), 20, interactionWarnings.filter((warning) => warning.kind !== "manual-interaction-review").map((warning) => warning.message)));
  checks.push(check("source footer content preserved", !interactionWarnings.some((warning) => warning.kind === "missing-footer-content" || warning.kind === "clone-process-copy"), 10, interactionWarnings.filter((warning) => warning.kind === "missing-footer-content" || warning.kind === "clone-process-copy").map((warning) => warning.message)));
  const rawScore = checks.reduce((sum, item) => sum + (item.pass ? item.points : 0), 0);
  const possiblePoints = checks.reduce((sum, item) => sum + item.points, 0);
  const unitAcceptance = await acceptanceResults({
    extractionDir,
    buildPlan,
    ledger,
    specIndex,
    gaps: extractionGaps.gaps || [],
  });
  return {
    score: possiblePoints ? Math.round((rawScore / possiblePoints) * 100) : 0,
    rawScore,
    possiblePoints,
    checks,
    unitAcceptance,
    pageAcceptance: checks.map(({ name, pass, warnings = [] }) => ({
      criterion: name,
      status: pass ? "verified" : "failed-or-pending",
      warnings,
    })),
    warnings: [...chromeWarnings, ...repeaterWarnings, ...interactionWarnings].map((warning) => warning.message),
    manifestHash: latest.manifestHash,
    provisionalUnits: buildPlan.units?.filter((unit) => unit.status === "provisional").map((unit) => unit.id) || [],
    note: "Frozen-spec preflight only. Run browser-backed result comparison and report unresolved local gaps without blocking unrelated units.",
    generatedAt: new Date().toISOString(),
  };
}

async function acceptanceResults({ extractionDir, buildPlan, ledger, specIndex, gaps }) {
  const gapById = new Map(gaps.map((gap) => [gap.id, gap]));
  const ledgerById = new Map((ledger.units || []).map((entry) => [entry.id, entry]));
  const results = [];
  for (const unit of buildPlan.units || []) {
    const relativePath = specIndex[unit.id];
    const spec = relativePath ? await safeRead(path.join(extractionDir, relativePath), {}) : {};
    const ledgerEntry = ledgerById.get(unit.id);
    const ownedGaps = (unit.gapRefs || []).map((id) => gapById.get(id)).filter(Boolean);
    const unresolvedGapRefs = ownedGaps
      .filter((gap) => !["resolved", "user-accepted"].includes(gap.status))
      .map((gap) => gap.id);
    const viewports = Object.values(ledgerEntry?.verification || {});
    const browserVerified = viewports.length > 0 && viewports.every((status) => status === "passed");
    const implementationMatches = Boolean(ledgerEntry && ledgerEntry.specHash === unit.hash);
    const required = Array.isArray(spec.acceptance?.required) ? spec.acceptance.required : [];
    const criteria = required.map((criterion) => ({
      criterion,
      status: !implementationMatches
        ? "not-implemented"
        : unresolvedGapRefs.length
          ? "provisional-gap-backed"
          : browserVerified
            ? "verified"
            : "pending-browser-verification",
      ...(unresolvedGapRefs.length ? { gapRefs: unresolvedGapRefs } : {}),
    }));
    results.push({
      unitId: unit.id,
      specHash: unit.hash,
      implementationMatches,
      status: criteria.length && criteria.every((entry) => entry.status === "verified")
        ? "verified"
        : unresolvedGapRefs.length
          ? "provisional"
          : implementationMatches
            ? "verification-pending"
            : "not-implemented",
      criteria,
      sourceAssertions: spec.acceptance?.sourceAssertions || [],
      gapRefs: unresolvedGapRefs,
    });
  }
  return results;
}

function missingManifestReport() {
  return {
    score: 0,
    rawScore: 0,
    possiblePoints: 20,
    checks: [{ name: "frozen manifest integrity", pass: false, points: 20, warnings: ["No frozen extraction manifest exists."] }],
    warnings: ["No frozen extraction manifest exists."],
    provisionalUnits: [],
    note: "Extraction must freeze before build QA.",
    generatedAt: new Date().toISOString(),
  };
}

function interactionReviewWarnings({ pages, interactionMap, implementationText }) {
  const warnings = [];
  if (!implementationText) return [{ kind: "manual-interaction-review", message: "No implementation source exists yet; verify every core interaction after UI code is written." }];
  const required = new Set((pages || []).flatMap((page) => page.interactionDiscovery?.requiredBehaviors || []));
  const media = interactionMap.structural?.media || (pages || []).flatMap((page) => page.interactionDiscovery?.media || []);
  for (const item of media.filter((entry) => entry.src && entry.role === "background")) {
    if (!mediaReferenced(implementationText, item.src)) {
      warnings.push({ kind: "missing-embedded-media", message: `Required ${item.provider || item.tag} background media is not referenced by the implementation: ${item.src}` });
    }
  }
  if (required.has("preserve-carousel-card-expansion") && !(/carousel|story-rail|rail-track|case-card/i.test(implementationText) && /overflow-x|overflow\s*:\s*auto|scrollLeft|scrollWidth|translateX/i.test(implementationText) && /active|expanded/i.test(implementationText))) {
    warnings.push({ kind: "flattened-carousel", message: "Source carousel has an active-card expansion state, but implementation does not show an overflowing rail with active/expanded state handling." });
  }
  if (required.has("preserve-scroll-expanded-section-state") && !(/position\s*:\s*(sticky|fixed)|scrolltrigger|intersectionobserver/i.test(implementationText) && /scroll/i.test(implementationText))) {
    warnings.push({ kind: "flattened-scroll-state", message: "Source scroll-state section is required, but implementation does not show pinned/sticky scroll-state handling." });
  }
  if (/this cloned homepage|development reconstruction|first-pass clone|video background unavailable/i.test(implementationText)) {
    warnings.push({ kind: "clone-process-copy", message: "Implementation contains clone/migration-process copy that must not appear on a migrated source page." });
  }
  for (const page of pages || []) {
    const legalText = String(page.footer?.legalText || "").replace(/\s+/g, " ").trim();
    const meaningful = legalText.split(/(?<=[.!?])\s+/).find((sentence) => sentence.length >= 80);
    if (meaningful && !implementationText.includes(meaningful.slice(0, 80))) {
      warnings.push({ kind: "missing-footer-content", message: "Source footer legal text was extracted but is not present in implementation source." });
    }
  }
  return warnings;
}

function mediaReferenced(implementationText, source) {
  const canonicalSource = canonicalMediaUrl(source);
  if (implementationText.includes(source) || implementationText.includes(canonicalSource)) return true;
  return canonicalSource ? implementationText.includes(canonicalSource.replace(/&amp;/g, "&")) : false;
}

function canonicalMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.search = url.search.replace(/\?([^?]*)\?/g, "?$1&");
    return url.toString();
  } catch {
    return raw.replace(/\?([^?]*)\?/g, "?$1&");
  }
}

function repeaterReviewWarnings({ pages, implementationText }) {
  const warnings = [];
  for (const page of pages || []) {
    for (const warning of page.repeaterDiagnostics?.warnings || []) {
      warnings.push({
        kind: "manual-repeater-review",
        message: `Source page ${page.path || page.url}: ${warning}`,
      });
    }
    for (const repeater of page.repeaters || []) {
      if (!implementationText) {
        warnings.push({
          kind: "manual-repeater-review",
          message: `Source page ${page.path || page.url} has structured repeater content (${repeater.itemCount || repeater.items?.length || 0} items); verify the implementation consumes repeaters instead of flattening the content.`,
        });
        continue;
      }
      const headings = (repeater.items || []).map((item) => item.heading).filter(Boolean);
      const matchedHeadings = headings.filter((heading) => implementationText.includes(heading)).length;
      const hasRepeaterStructure = /\brepeaters\b|\bstories\b|\bitems\b|\bmap\s*\(/.test(implementationText);
      if (headings.length && matchedHeadings < Math.min(3, headings.length)) {
        warnings.push({
          kind: "missing-repeater-headings",
          message: `Source page ${page.path || page.url} has ${headings.length} repeater heading(s), but fewer than ${Math.min(3, headings.length)} appear in implementation files.`,
        });
      }
      if (matchedHeadings >= Math.min(3, headings.length) && !hasRepeaterStructure) {
        warnings.push({
          kind: "collapsed-repeater",
          message: `Source page ${page.path || page.url} has structured repeater items, but implementation files contain multiple repeater headings without an obvious repeated-content structure.`,
        });
      }
      if ((repeater.schema?.maxImagesPerItem || 0) > 1) {
        const supportsMultipleImages = /\bimages\b|\bgallery\b|\bcarousel\b|map\s*\(\s*\(?image\b|image[s2-9]/.test(implementationText);
        if (!supportsMultipleImages) {
          warnings.push({
            kind: "collapsed-multi-image-repeater",
            message: `Source page ${page.path || page.url} has repeater items with up to ${repeater.schema.maxImagesPerItem} images each, but implementation files do not show an obvious multi-image item structure.`,
          });
        }
      }
    }
  }
  return warnings;
}

function check(name, pass, points, warnings = []) {
  return { name, pass: Boolean(pass), points, ...(warnings.length ? { warnings } : {}) };
}

async function existsJsonOrText(filePath) {
  try {
    await import("node:fs/promises").then(({ access }) => access(filePath));
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

function chromeEvidenceAvailable(pages = []) {
  return pages.some((page) => {
    if (!page.chrome) return false;
    if (page.chrome.warnings?.length) return true;
    return Boolean(page.chrome.header?.variants?.length || page.chrome.navigation?.length || page.chrome.heroEvidence);
  });
}

function chromeReviewWarnings({ chromePages, implementationText }) {
  const warnings = [];
  if (!chromePages.length) {
    warnings.push({
      kind: "manual-chrome-review",
      message: "No chrome evidence is available; manually review header behavior, menu hierarchy, logo size, and hero text before completion.",
    });
    return warnings;
  }
  for (const page of chromePages) {
    for (const warning of page.chrome?.warnings || []) {
      warnings.push({ kind: "manual-chrome-review", message: warning });
    }
    const dropdowns = (page.chrome?.navigation || []).filter((item) => item.children?.length);
    if (dropdowns.length && implementationText) {
      for (const dropdown of dropdowns) {
        const childLabels = dropdown.children.map((child) => child.label).filter(Boolean);
        const hasStructuredChildren = /children\s*[:=]|\bsubmenu\b|\bdropdown\b|<details\b|aria-haspopup/.test(implementationText);
        const flattenedCount = childLabels.filter((label) => implementationText.includes(label)).length;
        if (!hasStructuredChildren && flattenedCount >= Math.min(3, childLabels.length)) {
          warnings.push({
            kind: "flattened-dropdown",
            message: `Navigation dropdown "${dropdown.label || dropdown.href}" has ${childLabels.length} source child item(s), but implementation files contain child labels without an obvious submenu structure.`,
          });
        }
      }
    } else if (dropdowns.length && !implementationText) {
      warnings.push({
        kind: "manual-chrome-review",
        message: `Source navigation has dropdowns (${dropdowns.map((item) => item.label || item.href).join(", ")}); verify implementation preserves them as submenus after UI code exists.`,
      });
    }

    const variants = page.chrome?.header?.variants || [];
    const initial = variants.find((variant) => variant.name === "initial");
    const scrolled = variants.find((variant) => variant.name === "scrolled");
    const viewportHeight = page.chrome?.viewport?.height || 1200;
    const limit = page.chrome?.header?.maxStickyViewportRatio || 0.16;
    if (implementationText && initial?.height && initial.height / viewportHeight > limit && /position\s*:\s*sticky|position\s*:\s*fixed/.test(implementationText)) {
      const hasCompactState = /scrolled|compact|is-sticky|shrink|small-header|sticky-header/.test(implementationText);
      if (!hasCompactState && (!scrolled?.height || scrolled.height < initial.height * 0.75)) {
        warnings.push({
          kind: "sticky-header-footprint",
          message: `Source initial header is large (${initial.height}px); implementation appears to use sticky/fixed positioning without an obvious compact scrolled state.`,
        });
      }
    }

    const seoOnly = page.chrome?.heroEvidence?.forbiddenSeoOnlyText || [];
    if (implementationText && seoOnly.some((text) => text.length > 12 && implementationText.includes(text))) {
      warnings.push({
        kind: "seo-only-hero-text",
        message: "Implementation contains SEO-only title/tagline text that was not confirmed as visible first-viewport hero content.",
      });
    } else if (!implementationText && seoOnly.length) {
      warnings.push({
        kind: "manual-chrome-review",
        message: "SEO-only title/tagline text was detected; verify it is not rendered as hero copy without visual source evidence.",
      });
    }
  }
  return warnings;
}

async function readImplementationText(outputDir) {
  const srcDir = path.join(outputDir, "src");
  const files = await listSourceFiles(srcDir);
  const chunks = [];
  for (const file of files.slice(0, 80)) {
    try {
      const { readFile } = await import("node:fs/promises");
      chunks.push(await readFile(file, "utf8"));
    } catch {
      // Ignore unreadable generated files during heuristic QA.
    }
  }
  return chunks.join("\n").slice(0, 500000);
}

async function listSourceFiles(dir) {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await listSourceFiles(fullPath));
      else if (/\.(astro|tsx?|jsx?|css|scss)$/.test(entry.name)) files.push(fullPath);
    }
    return files;
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
