#!/usr/bin/env node
import path from "node:path";
import {
  docsDir,
  ensureDir,
  fetchText,
  normalizeUrl,
  parseArgs,
  readJson,
  resolveOutputDir,
  writeJson,
} from "./lib/common.mjs";
import { extractStylesheetUrls } from "./lib/html-extract.mjs";
import { loadPlaywrightFromContext, resolveBrowserToolingContext } from "./lib/browser-tooling.mjs";
import {
  DEFAULT_INTERACTION_TIMELINE_MS,
  compactInteractionTimeline,
  deriveCarouselInvariants,
  deriveScrollInvariants,
} from "./lib/interaction-timeline.mjs";

const GENERIC_SELECTORS = new Set(["*", "body", "html", ":root", "main"]);
const CSS_SIGNAL_PROPS = [
  "transition",
  "transition-property",
  "transition-duration",
  "animation",
  "animation-name",
  "animation-duration",
  "transform",
  "opacity",
  "filter",
  "will-change",
  "scroll-behavior",
];
const SNAPSHOT_STYLE_KEYS = [
  "opacity",
  "transform",
  "backgroundColor",
  "color",
  "boxShadow",
  "filter",
  "width",
  "height",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "textDecorationLine",
  "textDecorationColor",
  "textDecorationThickness",
  "textUnderlineOffset",
  "outlineColor",
  "outlineStyle",
  "outlineWidth",
  "outlineOffset",
  "fill",
  "stroke",
  "translate",
  "scale",
  "cursor",
  "transitionProperty",
  "transitionDuration",
  "transitionTimingFunction",
];

async function main() {
  const args = parseArgs();
  const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  const docs = docsDir(outputDir);
  const pagesDir = path.join(docs, "pages");
  const pages = [];
  if (args.page) {
    pages.push(await readJson(path.resolve(args.page)));
  } else {
    try {
      const defaultPage = path.join(pagesDir, "home-home.json");
      pages.push(await readJson(defaultPage));
    } catch {
      // Page records are optional when running the extractor standalone.
    }
  }
  const interactionMap = await extractInteractions(sourceUrl, {
    outputDir,
    pages,
    browserTooling: args["project-root"]
      ? await resolveBrowserToolingContext({ startDir: path.resolve(args["project-root"]) })
      : undefined,
  });
  await writeJson(path.join(docs, "interaction-map.json"), interactionMap);
  if (pages.length) {
    for (const page of interactionMap.pages || []) {
      await writeJson(path.join(pagesDir, `${safePageName(page)}.json`), page);
    }
  }
  if (args.json) process.stdout.write(`${JSON.stringify(interactionMap, null, 2)}\n`);
}

export async function extractInteractions(sourceUrl, { outputDir, pages = [], browserTooling } = {}) {
  const url = normalizeUrl(sourceUrl).toString();
  await writeProgress(outputDir, "fetching_html");
  const html = await fetchText(url);
  await writeProgress(outputDir, "loading_stylesheets");
  const stylesheets = await loadStylesheets(html, url);
  await writeProgress(outputDir, "building_static_inventory");
  const inlineStyles = extractInlineStyles(html, url);
  const staticInventory = buildStaticInventory({ stylesheets, inlineStyles });
  await writeProgress(outputDir, "starting_dynamic_probe", {
    candidateCount: staticInventory.candidates.length,
  });
  const runtime = await runDynamicProbe({
    sourceUrl: url,
    outputDir,
    staticInventory,
    browserTooling,
  });
  await writeProgress(outputDir, "assembling_interaction_map", {
    captureCount: runtime.captures.length,
  });
  const interactions = [...runtime.captures, ...(runtime.specializedCaptures || [])].map((capture, index) => ({
    id: capture.id || `interaction-${String(index + 1).padStart(3, "0")}`,
    kind: classifyCapture(capture),
    trigger: normalizeTrigger(capture.trigger),
    importance: classifyImportance(capture),
    sources: capture.sources || [],
    changedProperties: (capture.diff?.changedProperties || []).map((item) => item.property),
    textChanged: Boolean(capture.diff?.textChanged),
    states: summarizeStates(capture),
    implementationHint: implementationHintFor(capture),
    evidence: capture.screenshot ? { screenshot: capture.screenshot } : {},
    label: capture.label || "",
    ...(capture.probeId ? { controlId: capture.probeId } : {}),
    ...(capture.controlRole ? { controlRole: capture.controlRole } : {}),
    ...(capture.controlScope ? { controlScope: capture.controlScope } : {}),
    ...(capture.scope ? { scope: capture.scope } : {}),
    ...(capture.timeline ? { timeline: capture.timeline } : {}),
    ...(capture.invariants ? { invariants: capture.invariants } : {}),
  }));
  const enrichedPages = pages.map((page) => enrichPageRecord(page, { generatedAt: new Date().toISOString(), staticInventory, runtime }));
  bindInteractionsToSections(interactions, enrichedPages);
  const summaryKinds = interactions.reduce((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});
  return {
    sourceUrl: url,
    generatedAt: new Date().toISOString(),
    staticSummary: staticInventory.summary,
    summary: {
      interactionCount: interactions.length,
      kinds: summaryKinds,
      targetCount: runtime.summary.targetCount,
      meaningfulCaptureCount: runtime.summary.meaningfulCaptureCount,
    },
    interactions,
    structural: runtime.structural,
    probeDiagnostics: runtime.probeDiagnostics || [],
    pages: enrichedPages,
  };
}

async function writeProgress(outputDir, stage, details = {}) {
  if (!outputDir) return;
  await writeJson(path.join(docsDir(outputDir), "interaction-progress.json"), {
    stage,
    updatedAt: new Date().toISOString(),
    ...details,
  });
}

async function loadStylesheets(html, sourceUrl) {
  const urls = extractStylesheetUrls(html, sourceUrl);
  const stylesheets = [];
  for (const stylesheetUrl of urls.slice(0, 24)) {
    try {
      const cssText = await fetchText(stylesheetUrl, {
        headers: { accept: "text/css,*/*;q=0.1" },
      });
      stylesheets.push({ url: stylesheetUrl, cssText, sourceType: "linked-stylesheet" });
    } catch (error) {
      stylesheets.push({ url: stylesheetUrl, cssText: "", sourceType: "linked-stylesheet", warning: error.message });
    }
  }
  return stylesheets;
}

function extractInlineStyles(html, sourceUrl) {
  const out = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(html))) {
    const cssText = String(match[1] || "").trim();
    if (!cssText) continue;
    index += 1;
    out.push({
      url: `${sourceUrl}#inline-style-${index}`,
      cssText,
      sourceType: "inline-style",
    });
  }
  return out;
}

function buildStaticInventory({ stylesheets, inlineStyles }) {
  const sources = [...stylesheets, ...inlineStyles];
  const keyframes = [];
  const rules = [];
  const candidateMap = new Map();
  for (const source of sources) {
    const cssText = source.cssText || "";
    if (!cssText) continue;
    for (const match of cssText.matchAll(/@keyframes\s+([^{\s]+)\s*\{/g)) {
      keyframes.push({ name: match[1], sourceUrl: source.url });
    }
    for (const rule of parseCssRules(cssText)) {
      const signals = extractSignals(rule.declarations);
      if (!signals.length) continue;
      const pseudos = extractPseudos(rule.selector);
      const baseSelector = normalizeSelector(rule.selector);
      rules.push({ selector: rule.selector, baseSelector, sourceUrl: source.url, pseudos, signals });
      if (!baseSelector) continue;
      const key = `${baseSelector}\u0000${pseudos.sort().join(",")}`;
      const existing = candidateMap.get(key) || {
        baseSelector,
        selectors: [],
        pseudos: new Set(),
        signals: new Set(),
      };
      existing.selectors.push(rule.selector);
      for (const pseudo of pseudos) existing.pseudos.add(pseudo);
      for (const signal of signals) existing.signals.add(signal);
      candidateMap.set(key, existing);
    }
  }
  const candidates = Array.from(candidateMap.values())
    .map((candidate) => ({
      baseSelector: candidate.baseSelector,
      selectors: candidate.selectors.slice(0, 6),
      pseudos: Array.from(candidate.pseudos),
      signals: Array.from(candidate.signals),
      likelyTriggers: inferTriggers(Array.from(candidate.pseudos), Array.from(candidate.signals)),
    }))
    .filter((candidate) => candidate.baseSelector && !GENERIC_SELECTORS.has(candidate.baseSelector))
    .slice(0, 120);
  return {
    sourceCount: sources.length,
    stylesheetCount: stylesheets.length,
    inlineStyleCount: inlineStyles.length,
    keyframes,
    rules,
    candidates,
    summary: {
      keyframeCount: keyframes.length,
      ruleCount: rules.length,
      candidateCount: candidates.length,
    },
  };
}

function parseCssRules(cssText) {
  const rules = [];
  const pattern = /([^{}@][^{}]*)\{([^{}]+)\}/g;
  let match;
  while ((match = pattern.exec(cssText))) {
    const selector = String(match[1] || "").trim();
    const declarations = String(match[2] || "").trim();
    if (!selector || !declarations) continue;
    rules.push({ selector, declarations });
  }
  return rules;
}

function extractSignals(declarations) {
  const found = [];
  const lowered = declarations.toLowerCase();
  for (const prop of CSS_SIGNAL_PROPS) {
    if (lowered.includes(`${prop}:`)) found.push(prop);
  }
  return Array.from(new Set(found));
}

function extractPseudos(selector) {
  return Array.from(new Set((selector.match(/:(hover|focus-visible|focus-within|focus|active|target|checked)/g) || [])
    .map((value) => value.slice(1))));
}

function normalizeSelector(selector) {
  const cleaned = selector
    .replace(/::?[\w-]+(?:\([^)]*\))?/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .split(",")[0]
    .trim();
  if (!cleaned || cleaned.startsWith("@")) return "";
  return cleaned;
}

function inferTriggers(pseudos, signals) {
  const triggers = new Set();
  for (const pseudo of pseudos) {
    if (pseudo === "hover") triggers.add("hover");
    if (pseudo === "focus" || pseudo === "focus-visible" || pseudo === "focus-within") triggers.add("focus");
    if (pseudo === "active") triggers.add("press");
    if (pseudo === "checked" || pseudo === "target") triggers.add("click");
  }
  if (signals.includes("animation") || signals.includes("animation-name")) triggers.add("load");
  return Array.from(triggers);
}

function redactProbeUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|password|session|email|code/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return "[unparseable-url]";
  }
}

async function runDynamicProbe({ sourceUrl, outputDir, staticInventory, browserTooling }) {
  await writeProgress(outputDir, "resolving_browser_tooling");
  const toolingContext = browserTooling || await resolveBrowserToolingContext({ startDir: process.cwd() });
  await writeProgress(outputDir, "loading_playwright", { projectRoot: toolingContext.projectRoot });
  const playwright = await loadPlaywrightFromContext(toolingContext);
  await writeProgress(outputDir, "launching_browser");
  const browser = await withTimeout(
    playwright.chromium.launch({ headless: true }),
    30_000,
    "Chromium launch",
  );
  await writeProgress(outputDir, "creating_browser_page");
  const page = await withTimeout(
    browser.newPage({ viewport: { width: 1440, height: 900 } }),
    30_000,
    "Chromium page creation",
  );
  await writeProgress(outputDir, "browser_page_ready");
  const screenshotsDir = path.join(docsDir(outputDir), "screenshots");
  await ensureDir(screenshotsDir);
  const blockedRequests = [];
  const safeProbeRoute = async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (request.isNavigationRequest() || !["GET", "HEAD", "OPTIONS"].includes(method)) {
      blockedRequests.push({ method, url: redactProbeUrl(request.url()), reason: request.isNavigationRequest() ? "navigation-blocked" : "mutating-request-blocked" });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  };
  try {
    await writeProgress(outputDir, "loading_source_page");
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await writeProgress(outputDir, "capturing_dynamic_interactions");
    await page.waitForTimeout(2600);
    await page.route("**/*", safeProbeRoute);
    const ignoredSurfaces = await markIgnoredConsentSurfaces(page);
    const liveAnimationSnapshot = await page.evaluate(() =>
      document.getAnimations().map((animation) => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
        effectTarget: animation.effect?.target?.tagName?.toLowerCase() || "",
      })),
    );
    const targets = await tagProbeTargets(page, staticInventory.candidates);
    const captures = [];
    const probeDiagnostics = [];
    for (const [targetIndex, target] of targets.slice(0, 28).entries()) {
      const triggerOrder = target.triggers.includes("hover")
        ? ["hover", ...target.triggers.filter((item) => item !== "hover")]
        : target.triggers;
      for (const trigger of triggerOrder.slice(0, 4)) {
        await writeProgress(outputDir, "capturing_dynamic_interaction", {
          targetIndex: targetIndex + 1,
          targetCount: Math.min(targets.length, 28),
          probeId: target.probeId,
          trigger,
        });
        const capture = await captureInteractionBounded(page, target, trigger, screenshotsDir);
        probeDiagnostics.push({ probeId: target.probeId, label: target.text, role: target.role, scope: target.scope, trigger, meaningful: Boolean(capture.meaningful), error: capture.error || null, changedProperties: (capture.diff?.changedProperties || []).map((item) => item.property) });
        if (capture.meaningful) captures.push(capture);
      }
    }
    // Generic probes scroll and mutate controls. Reset before scene probes so initial
    // header, tab, and carousel states are not contaminated by probe order.
    await page.evaluate(() => {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
      window.scrollTo(0, 0);
    });
    await page.unroute("**/*", safeProbeRoute);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await page.route("**/*", safeProbeRoute);
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await markIgnoredConsentSurfaces(page);
    const headerScroll = await probeHeaderScrollState(page, screenshotsDir);
    const scrollTabs = await probeScrollTabsState(page, screenshotsDir);
    const carousels = await probeCarouselStates(page, screenshotsDir);
    const specialized = {
      headerScroll,
      scrollTabs,
      carousel: carousels[0] || { missing: true },
      carousels,
    };
    const structural = await page.evaluate(() => {
      const visible = (node) => {
        if (!(node instanceof Element)) return false;
        if (node.closest("[data-rp-ignored-surface]")) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const canonicalMediaSource = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return raw;
        try {
          const url = new URL(raw, window.location.href);
          url.search = url.search.replace(/\?([^?]*)\?/g, "?$1&");
          return url.toString();
        } catch {
          return raw;
        }
      };
      const tabs = Array.from(document.querySelectorAll("[role='tab'], [aria-controls], [data-tab], [data-panel]"))
        .filter(visible)
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const media = Array.from(document.querySelectorAll("iframe, video, canvas, [data-lottie], [class*='lottie']"))
        .filter(visible)
        .map((node, index) => {
          const src = canonicalMediaSource(node.currentSrc || node.getAttribute("src") || node.getAttribute("data-src") || "");
          let provider = "";
          let playback = {};
          try {
            const url = new URL(src, window.location.href);
            provider = /vimeo\.com/i.test(url.hostname) ? "vimeo" : /youtube\.com|youtu\.be/i.test(url.hostname) ? "youtube" : url.hostname;
            playback = {
              autoplay: url.searchParams.get("autoplay") === "1",
              loop: url.searchParams.get("loop") === "1",
              muted: url.searchParams.get("muted") === "1",
              background: url.searchParams.get("background") === "1",
            };
          } catch {
            // A relative or deferred source is still useful to the implementation agent.
          }
          const parent = node.parentElement;
          const owner = node.closest("section,header,footer,main") || parent;
          const classTokens = String(node.className || "").split(/\s+/).filter(Boolean);
          const mediaStyle = getComputedStyle(node);
          let fallbackSource = canonicalMediaSource(node.getAttribute("poster") || node.getAttribute("data-poster") || "");
          let fallbackOrigin = fallbackSource ? "media-attribute" : "";
          if (!fallbackSource) {
            for (let current = parent; current && current !== owner?.parentElement; current = current.parentElement) {
              const backgroundImage = getComputedStyle(current).backgroundImage || "";
              const match = backgroundImage.match(/url\(["']?([^"')]+)["']?\)/i);
              if (match?.[1]) {
                fallbackSource = canonicalMediaSource(match[1]);
                fallbackOrigin = "ancestor-background";
                break;
              }
              if (current === owner) break;
            }
          }
          const visiblyComposite = Number(mediaStyle.opacity || 1) < 0.99 || (mediaStyle.mixBlendMode && mediaStyle.mixBlendMode !== "normal");
          return {
            id: `media-${String(index + 1).padStart(3, "0")}`,
            tag: node.tagName.toLowerCase(),
            src,
            provider,
            playback,
            role: playback.background || /hero|background|scene|scroll|cover/i.test(`${classTokens.join(" ")} ${parent?.className || ""}`) ? "background" : node.tagName.toLowerCase() === "canvas" ? "runtime-surface" : "inline",
            presentation: {
              opacity: mediaStyle.opacity,
              mixBlendMode: mediaStyle.mixBlendMode,
            },
            ...(fallbackSource ? {
              fallback: {
                src: fallbackSource,
                origin: fallbackOrigin,
                policy: visiblyComposite ? "composite" : "fallback-only",
              },
            } : {}),
            domRef: {
              id: node.id || "",
              classTokens: classTokens.slice(0, 8),
              parentClassTokens: String(parent?.className || "").split(/\s+/).filter(Boolean).slice(0, 8),
              sectionClassTokens: String(owner?.className || "").split(/\s+/).filter(Boolean).slice(0, 12),
              sectionTextFingerprint: String(owner?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
            },
          };
        });
      return {
        tabLabels: tabs.slice(0, 12),
        embedCount: media.length,
        media,
      };
    });
    structural.ignoredSurfaces = ignoredSurfaces;
    const specializedCaptures = deriveSpecializedCaptures({ ...specialized, media: structural.media });
    return {
      liveAnimationSnapshot,
      targets,
      captures,
      probeDiagnostics,
      safeProbeAudit: {
        policy: "public-presentation-controls-only",
        blockedRequests,
        actionBudget: { targetLimit: 28, triggerLimitPerTarget: 4, probeTimeoutMs: 8000 },
      },
      specialized,
      specializedCaptures,
      structural,
      summary: {
        targetCount: targets.length,
        meaningfulCaptureCount: captures.length + specializedCaptures.length,
        liveAnimationCount: liveAnimationSnapshot.length,
      },
    };
  } finally {
    await browser.close();
  }
}

async function captureInteractionBounded(page, target, trigger, screenshotsDir) {
  try {
    return await withTimeout(
      captureInteraction(page, target, trigger, screenshotsDir),
      8_000,
      `Interaction probe ${target.probeId} (${trigger})`,
    );
  } catch (error) {
    return {
      probeId: target.probeId,
      label: target.text || target.className || target.tag,
      trigger,
      sources: target.sources,
      meaningful: false,
      error: error.message,
    };
  }
}

async function withTimeout(operation, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function tagProbeTargets(page, staticCandidates) {
  return page.evaluate((staticCandidates) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      if (node.closest("[data-rp-ignored-surface]")) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const semanticSelectors = [
      { selector: "header a", limit: 10, priority: 100 },
      { selector: "footer a", limit: 10, priority: 96 },
      { selector: "a[class*='button' i],a[class*='cta' i],a[role='button']", limit: 8, priority: 98 },
      { selector: "button", limit: 8, priority: 94 },
      { selector: "details > summary", limit: 12, priority: 93 },
      { selector: "[aria-expanded='true'],[aria-expanded='false']", limit: 12, priority: 93 },
      { selector: "[role='tab']", limit: 6, priority: 92 },
      { selector: "[aria-controls]", limit: 4, priority: 90 },
      { selector: "[data-tab]", limit: 4, priority: 88 },
      { selector: "[data-carousel-card]", limit: 4, priority: 82 },
      { selector: "[role='listitem']", limit: 2, priority: 50 },
      { selector: "article", limit: 2, priority: 30 },
      { selector: "iframe", limit: 2, priority: 20 },
      { selector: "video", limit: 2, priority: 20 },
    ];
    const targetMap = new Map();
    let sequence = 0;
    const addTarget = (element, source, triggers, priority = 40) => {
      if (!element || !visible(element)) return;
      const textClone = element.cloneNode(true);
      textClone.querySelectorAll?.("svg,script,style").forEach((node) => node.remove());
      const text = clean(textClone.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent).slice(0, 120);
      if (/window\.|document\.|function\s*\(|nreum/i.test(text)) return;
      const key = element;
      if (targetMap.has(key)) {
        const existing = targetMap.get(key);
        for (const trigger of triggers) existing.triggers.add(trigger);
        existing.sources.add(source);
        existing.priority = Math.max(existing.priority || 0, priority);
        return;
      }
      sequence += 1;
      const probeId = `probe-${sequence}`;
      element.setAttribute("data-probe-id", probeId);
      targetMap.set(key, {
        probeId,
        text,
        tag: element.tagName.toLowerCase(),
        className: clean(element.className || "").slice(0, 140),
        sources: new Set([source]),
        triggers: new Set(triggers),
        priority,
        role: element.getAttribute("role") || (element.matches("a[href]") ? "link" : element.matches("button") ? "button" : element.tagName.toLowerCase()),
        scope: element.closest("header") ? "header" : element.closest("footer") ? "footer" : element.closest("nav") ? "navigation" : "content",
      });
    };
    for (const candidate of staticCandidates.slice(0, 80)) {
      if (!candidate.baseSelector) continue;
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(candidate.baseSelector)).filter(visible).slice(0, 2);
      } catch {
        matches = [];
      }
      for (const match of matches) {
        addTarget(match, `css:${candidate.baseSelector}`, candidate.likelyTriggers.length ? candidate.likelyTriggers : ["hover"], 45);
      }
    }
    for (const entry of semanticSelectors) {
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(entry.selector)).filter(visible).sort((left, right) => {
          const readable = (node) => {
            const clone = node.cloneNode(true);
            clone.querySelectorAll?.("svg,script,style").forEach((child) => child.remove());
            return clean(clone.textContent).length >= 2 ? 1 : 0;
          };
          return readable(right) - readable(left);
        }).slice(0, entry.limit);
      } catch {
        matches = [];
      }
      for (const match of matches) {
        const triggers = match.matches("button,[role='tab'],[aria-controls],summary,[aria-expanded]")
          ? ["hover", "focus", "press", "click"]
          : match.matches("a[href]") ? ["hover", "focus", "press"] : ["hover", "focus"];
        addTarget(match, `semantic:${entry.selector}`, triggers, entry.priority);
      }
    }
    return Array.from(targetMap.values()).sort((left, right) => (right.priority || 0) - (left.priority || 0)).map((target) => ({
      ...target,
      sources: Array.from(target.sources),
      triggers: Array.from(target.triggers),
    }));
  }, staticCandidates);
}

async function markIgnoredConsentSurfaces(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
    };
    const selector = [
      "#onetrust-banner-sdk",
      "#onetrust-consent-sdk",
      "[class*='onetrust' i]",
      "[id*='cookie-banner' i]",
      "[class*='cookie-banner' i]",
      "[id*='consent-banner' i]",
      "[class*='consent-banner' i]",
      "[role='dialog']",
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(selector)).filter(visible).filter((node) => {
      const text = clean(node.textContent).toLowerCase();
      const identity = `${node.id || ""} ${node.className || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
      const controls = Array.from(node.querySelectorAll("button,a,[role='button']")).map((control) => clean(control.textContent)).join(" ").toLowerCase();
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const consentSignal = /cookie|consent|privacy preferences|tracking preferences/.test(`${identity} ${text}`);
      const actionSignal = /accept|reject|decline|customi[sz]e|preferences|allow all/.test(controls);
      const overlaySignal = style.position === "fixed" || style.position === "sticky" || node.getAttribute("role") === "dialog" || rect.width >= window.innerWidth * 0.55;
      return /onetrust|cookiebot|quantcast/.test(identity) || consentSignal && actionSignal && overlaySignal;
    });
    const roots = candidates.filter((node, index, all) => !all.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(node)));
    return roots.map((node, index) => {
      node.setAttribute("data-rp-ignored-surface", "consent-management");
      const rect = node.getBoundingClientRect();
      const identity = `${node.id || ""} ${node.className || ""}`.toLowerCase();
      return {
        id: `ignored-surface-${String(index + 1).padStart(3, "0")}`,
        kind: "consent-management",
        provider: /onetrust|ot-sdk/.test(identity) ? "onetrust" : /cookiebot/.test(identity) ? "cookiebot" : /quantcast/.test(identity) ? "quantcast" : "unknown",
        creationPolicy: "ignore",
        reason: "Destination consent must be implemented as functional infrastructure, not cloned page content.",
        textFingerprint: clean(node.textContent).slice(0, 240),
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        domRef: {
          tag: node.tagName.toLowerCase(),
          id: node.id || "",
          classTokens: String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 10),
        },
      };
    });
  });
}

async function captureInteraction(page, target, trigger, screenshotsDir) {
  const selector = `[data-probe-id="${target.probeId}"]`;
  const locator = page.locator(selector).first();
  try {
    const before = await readProbeSnapshot(page, target.probeId);
    if (!before) return { probeId: target.probeId, trigger, meaningful: false };
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    if (trigger === "hover") await locator.hover({ force: true });
    else if (trigger === "focus") await locator.focus();
    else if (trigger === "press") {
      await locator.hover({ force: true });
      await page.mouse.down();
    }
    else if (trigger === "click") {
      const safety = await locator.evaluate((node) => {
        const identity = `${node.tagName} ${node.getAttribute("role") || ""} ${node.getAttribute("aria-label") || ""} ${node.id || ""} ${node.className || ""} ${node.textContent || ""}`.toLowerCase();
        const href = node.closest("a[href]")?.getAttribute("href") || "";
        const formOwner = node.closest("form");
        const unsafe = Boolean(formOwner)
          || /submit|login|sign.?in|register|checkout|cart|purchase|buy|book|upload|delete|remove|admin|account|password/.test(identity)
          || Boolean(href && !href.startsWith("#"));
        const presentation = /tab|accordion|disclosure|carousel|slider|gallery|menu|navigation/.test(identity)
          || node.hasAttribute("aria-controls")
          || node.hasAttribute("aria-expanded")
          || node.getAttribute("role") === "tab";
        return { safe: !unsafe && presentation, reason: unsafe ? "unsafe-or-business-action" : presentation ? "allowlisted-presentation-control" : "unclassified-control" };
      });
      if (!safety.safe) {
        return {
          probeId: target.probeId,
          label: target.text || target.className || target.tag,
          tag: target.tag,
          trigger,
          sources: target.sources,
          meaningful: false,
          blocked: true,
          error: `Safe probing blocked click: ${safety.reason}`,
        };
      }
      await locator.dispatchEvent("click");
    }
    if (trigger === "load") await page.waitForTimeout(120);
    if (trigger === "hover" || trigger === "focus" || trigger === "click") await page.waitForTimeout(220);
    if (trigger === "press") await page.waitForTimeout(80);
    const after = await readProbeSnapshot(page, target.probeId);
    const diff = diffSnapshots(before, after);
    const liveAnimations = await page.evaluate((probeId) => {
      const node = document.querySelector(`[data-probe-id="${probeId}"]`);
      return document.getAnimations().filter((animation) => {
        const effectTarget = animation.effect?.target;
        return effectTarget instanceof Element && (effectTarget === node || node?.contains(effectTarget) || effectTarget.contains?.(node));
      }).map((animation) => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
      }));
    }, target.probeId);
    const meaningful = diff.changedProperties.length > 0 || diff.textChanged || diff.attributeChanges.length > 0 || liveAnimations.length > 0;
    let screenshot = null;
    if (meaningful) {
      screenshot = path.join(screenshotsDir, `${target.probeId}-${trigger}.png`);
      try {
        await locator.screenshot({ path: screenshot });
      } catch {
        screenshot = null;
      }
    }
    if (trigger === "press") {
      await page.mouse.move(2, 2);
      await page.mouse.up();
    }
    if (trigger === "hover") await page.mouse.move(2, 2);
    return {
      probeId: target.probeId,
      label: target.text || target.className || target.tag,
      tag: target.tag,
      controlRole: target.role,
      controlScope: target.scope,
      trigger,
      sources: target.sources,
      meaningful,
      before,
      after,
      diff,
      liveAnimations,
      screenshot,
    };
  } catch (error) {
    if (trigger === "press") {
      await page.mouse.move(2, 2).catch(() => {});
      await page.mouse.up().catch(() => {});
    }
    return {
      probeId: target.probeId,
      label: target.text || target.className || target.tag,
      tag: target.tag,
      trigger,
      sources: target.sources,
      meaningful: false,
      error: error.message,
    };
  }
}

async function readProbeSnapshot(page, probeId) {
  return page.evaluate(({ probeId, styleKeys }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const node = document.querySelector(`[data-probe-id="${probeId}"]`);
    if (!(node instanceof Element)) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const section = node.closest("section,header,main,article,nav,footer");
    const sectionText = section ? clean(section.textContent).slice(0, 420) : "";
    const text = clean(node.textContent).slice(0, 180);
    const styleRecord = (target, pseudo = null) => {
      const computed = getComputedStyle(target, pseudo);
      const styles = {};
      for (const key of styleKeys) styles[key] = computed[key];
      return styles;
    };
    const visualChildren = Array.from(new Set([
      ...Array.from(node.children),
      ...Array.from(node.querySelectorAll("svg,use,path,i,[class*='icon' i],[aria-hidden='true']")),
    ]))
      .filter((child) => child instanceof Element)
      .slice(0, 12)
      .map((child, index) => ({
        key: `${child.tagName.toLowerCase()}:${index}`,
        tag: child.tagName.toLowerCase(),
        className: clean(child.className?.baseVal || child.className || ""),
        styles: styleRecord(child),
        pseudo: {
          before: styleRecord(child, "::before"),
          after: styleRecord(child, "::after"),
        },
      }));
    return {
      text,
      sectionText,
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      },
      styles: styleRecord(node),
      pseudo: {
        before: styleRecord(node, "::before"),
        after: styleRecord(node, "::after"),
      },
      visualChildren,
      className: clean(node.className || ""),
      ariaSelected: node.getAttribute("aria-selected") || "",
      ariaExpanded: node.getAttribute("aria-expanded") || "",
      ariaCurrent: node.getAttribute("aria-current") || "",
      ariaPressed: node.getAttribute("aria-pressed") || "",
      disabled: node.matches(":disabled,[aria-disabled='true']"),
    };
  }, { probeId, styleKeys: SNAPSHOT_STYLE_KEYS });
}

function diffSnapshots(before, after) {
  if (!before || !after) return { changedProperties: [], textChanged: false, attributeChanges: [] };
  const changedProperties = [];
  for (const key of SNAPSHOT_STYLE_KEYS) {
    if (String(before.styles[key]) !== String(after.styles[key])) {
      changedProperties.push({ property: key, before: before.styles[key], after: after.styles[key] });
    }
  }
  for (const pseudo of ["before", "after"]) {
    for (const key of SNAPSHOT_STYLE_KEYS) {
      if (String(before.pseudo?.[pseudo]?.[key]) !== String(after.pseudo?.[pseudo]?.[key])) {
        changedProperties.push({ property: `::${pseudo}.${key}`, before: before.pseudo?.[pseudo]?.[key], after: after.pseudo?.[pseudo]?.[key] });
      }
    }
  }
  const childKeys = new Set([...(before.visualChildren || []).map((child) => child.key), ...(after.visualChildren || []).map((child) => child.key)]);
  for (const childKey of childKeys) {
    const beforeChild = before.visualChildren?.find((child) => child.key === childKey);
    const afterChild = after.visualChildren?.find((child) => child.key === childKey);
    for (const key of SNAPSHOT_STYLE_KEYS) {
      if (String(beforeChild?.styles?.[key]) !== String(afterChild?.styles?.[key])) {
        changedProperties.push({ property: `child:${childKey}.${key}`, before: beforeChild?.styles?.[key], after: afterChild?.styles?.[key] });
      }
    }
    for (const pseudo of ["before", "after"]) {
      for (const key of SNAPSHOT_STYLE_KEYS) {
        if (String(beforeChild?.pseudo?.[pseudo]?.[key]) !== String(afterChild?.pseudo?.[pseudo]?.[key])) {
          changedProperties.push({ property: `child:${childKey}::${pseudo}.${key}`, before: beforeChild?.pseudo?.[pseudo]?.[key], after: afterChild?.pseudo?.[pseudo]?.[key] });
        }
      }
    }
  }
  const attributeChanges = [];
  for (const key of ["className", "ariaSelected", "ariaExpanded", "ariaCurrent", "ariaPressed", "disabled"]) {
    if (String(before[key]) !== String(after[key])) {
      attributeChanges.push({ property: key, before: before[key], after: after[key] });
    }
  }
  return {
    changedProperties,
    textChanged: before.text !== after.text || before.sectionText !== after.sectionText,
    attributeChanges,
  };
}

async function probeHeaderScrollState(page, screenshotsDir) {
  const result = await page.evaluate(async () => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const header = document.querySelector("header,[role='banner'],#header,.header,.site-header,.main-header,.masthead,.sticky-header");
    if (!visible(header)) return { missing: true };
    const snapshot = (name) => {
      const style = getComputedStyle(header);
      const rect = header.getBoundingClientRect();
      return {
        name,
        className: clean(header.className || ""),
        height: Math.round(rect.height),
        position: style.position,
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || "",
      };
    };
    const initial = snapshot("initial");
    const scrollTarget = Math.max(220, Math.min(document.documentElement.scrollHeight - window.innerHeight, Math.round(window.innerHeight * 0.75)));
    window.scrollTo(0, scrollTarget);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scrolled = snapshot("scrolled");
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { initial, scrolled };
  });
  if (!result || result.missing) return { missing: true };
  const changedProperties = [];
  for (const key of ["className", "height", "position", "backgroundColor", "backdropFilter"]) {
    if (String(result.initial[key]) !== String(result.scrolled[key])) {
      changedProperties.push({ property: key, before: result.initial[key], after: result.scrolled[key] });
    }
  }
  return {
    initial: result.initial,
    scrolled: result.scrolled,
    changedProperties,
    screenshot: await captureStateScreenshots(
      page,
      "header,[role='banner'],#header,.header,.site-header,.main-header,.masthead,.sticky-header",
      screenshotsDir,
      "header",
      async () => page.evaluate(() => {
        const scrollTarget = Math.max(220, Math.min(document.documentElement.scrollHeight - window.innerHeight, Math.round(window.innerHeight * 0.75)));
        window.scrollTo(0, scrollTarget);
      }),
    ),
    meaningful: changedProperties.length > 0,
  };
}

async function probeScrollTabsState(page, screenshotsDir) {
  const result = await page.evaluate(async () => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const roots = Array.from(document.querySelectorAll("main section, [data-scroll-section], [data-scroll-scene], [data-animation-scene]"));
    const root = roots.filter(visible).map((node) => ({ node, score: (node.querySelector("iframe,video,canvas") ? 4 : 0) + (node.querySelector("[role='tab'],[aria-controls],[data-tab],button") ? 2 : 0) + (node.getBoundingClientRect().height > innerHeight ? 1 : 0) })).sort((a, b) => b.score - a.score)[0]?.node;
    if (!visible(root)) return { missing: true };
    root.setAttribute("data-rp-scroll-probe", "true");
    const visual = root.querySelector("iframe, video, canvas, img, [data-scene-visual], [data-scroll-visual]");
    const copy = root.querySelector("[data-scene-copy], [data-scroll-copy], [role='tabpanel'], h1,h2,h3") || root;
    const snapshot = (name) => {
      const rootRect = root.getBoundingClientRect();
      const visualRect = visual?.getBoundingClientRect() || null;
      const copyRect = copy?.getBoundingClientRect() || null;
      const copyStyle = copy ? getComputedStyle(copy) : null;
      const visualChain = [];
      for (let node = visual; node && node !== root.parentElement && visualChain.length < 5; node = node.parentElement) {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        visualChain.push({
          tag: node.tagName.toLowerCase(),
          className: clean(node.className || ""),
          position: style.position,
          overflow: style.overflow,
          transform: style.transform,
          opacity: style.opacity,
          clipPath: style.clipPath,
          borderRadius: style.borderRadius,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        });
        if (node === root) break;
      }
      const sceneLayers = Array.from(root.querySelectorAll("*"))
        .map((node) => ({ node, style: getComputedStyle(node), rect: node.getBoundingClientRect() }))
        .filter(({ node, style, rect }) => rect.height >= 80 && style.display !== "none" && style.visibility !== "hidden" && (/curtain|mask|overlay|scrim|scroll-over__bg|scroll-over__frame/i.test(String(node.className || "")) || ["absolute", "fixed", "sticky"].includes(style.position)))
        .slice(0, 18)
        .map(({ node, style, rect }) => ({
          tag: node.tagName.toLowerCase(),
          className: clean(node.className || ""),
          role: /curtain|mask|scrim/i.test(String(node.className || "")) ? "curtain" : /\bbg\b|background/i.test(String(node.className || "")) ? "background" : "layer",
          position: style.position,
          transform: style.transform,
          opacity: style.opacity,
          clipPath: style.clipPath,
          backgroundColor: style.backgroundColor,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }));
      return {
        name,
        scrollY: Math.round(window.scrollY),
        rootClassName: clean(root.className || ""),
        visualClassName: clean(visual?.className || ""),
        copyClassName: clean(copy?.className || ""),
        rootTop: Math.round(rootRect.top),
        rootWidth: Math.round(rootRect.width),
        rootHeight: Math.round(rootRect.height),
        visual: visualRect ? { width: Math.round(visualRect.width), height: Math.round(visualRect.height), top: Math.round(visualRect.top) } : null,
        copy: copyRect ? {
          width: Math.round(copyRect.width),
          height: Math.round(copyRect.height),
          top: Math.round(copyRect.top),
          left: Math.round(copyRect.left),
          position: copyStyle?.position || "",
          transform: copyStyle?.transform || "none",
          opacity: copyStyle?.opacity || "1",
          fontSize: copyStyle?.fontSize || "",
          lineHeight: copyStyle?.lineHeight || "",
        } : null,
        visualChain,
        sceneLayers,
      };
    };
    const rootStart = window.scrollY + root.getBoundingClientRect().top;
    const travel = Math.min(root.getBoundingClientRect().height * 0.82, window.innerHeight * 2.5);
    const phases = [];
    const samples = [
      { progress: -2, name: "entry-offscreen", scrollY: Math.max(0, rootStart - window.innerHeight * 2) },
      { progress: -1, name: "entry-below", scrollY: Math.max(0, rootStart - window.innerHeight) },
      { progress: -0.5, name: "entry-midpoint", scrollY: Math.max(0, rootStart - window.innerHeight * 0.5) },
      ...[0, 0.2, 0.45, 0.7, 1].map((progress) => ({
        progress,
        name: `scroll-${Math.round(progress * 100)}`,
        scrollY: rootStart + travel * progress,
      })),
    ];
    for (const sample of samples) {
      window.scrollTo(0, Math.round(sample.scrollY));
      await new Promise((resolve) => setTimeout(resolve, 260));
      phases.push({ progress: sample.progress, stage: sample.progress < 0 ? "entry" : "scene", ...snapshot(sample.name) });
    }
    const beforeScroll = phases[0];
    const afterScroll = phases[phases.length - 1];
    const buttonNodes = Array.from(root.querySelectorAll("[role='tab'], [aria-controls], [data-tab], button")).filter(visible).slice(0, 8);
    const states = [];
    for (const button of buttonNodes) {
      const label = clean(button.textContent);
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 280));
      const visibleText = Array.from(root.querySelectorAll("h2,h3,p"))
        .filter(visible)
        .map((node) => clean(node.textContent))
        .filter(Boolean)
        .slice(0, 8);
      const activeTab = buttonNodes.find((node) => node.getAttribute("aria-selected") === "true" || /\bactive\b/i.test(String(node.className || "")));
      states.push({
        label,
        activeTab: clean(activeTab?.textContent || ""),
        text: visibleText,
        buttonClassName: clean(button.className || ""),
        ariaSelected: button.getAttribute("aria-selected") || "",
      });
    }
    window.scrollTo(0, 0);
    return { beforeScroll, afterScroll, phases, states };
  });
  if (!result || result.missing) return { missing: true };
  const wheelPhases = await probeWheelScrollScene(page);
  const phases = [...(result.phases || []), ...wheelPhases];
  const scrollChanges = [];
  for (const key of ["rootClassName", "visualClassName", "copyClassName", "rootTop", "rootHeight"]) {
    if (String(result.beforeScroll[key]) !== String(result.afterScroll[key])) {
      scrollChanges.push({ property: key, before: result.beforeScroll[key], after: result.afterScroll[key] });
    }
  }
  for (const key of ["visual", "copy"]) {
    if (JSON.stringify(result.beforeScroll[key]) !== JSON.stringify(result.afterScroll[key])) {
      scrollChanges.push({ property: key, before: result.beforeScroll[key], after: result.afterScroll[key] });
    }
  }
  if (JSON.stringify(result.beforeScroll.visualChain) !== JSON.stringify(result.afterScroll.visualChain)) {
    scrollChanges.push({ property: "visualChain", before: result.beforeScroll.visualChain, after: result.afterScroll.visualChain });
  }
  const uniqueStateTexts = Array.from(new Set(result.states.map((state) => state.text.join(" | "))));
  return {
    beforeScroll: result.beforeScroll,
    afterScroll: result.afterScroll,
    scrollChanges,
    states: result.states,
    uniqueStateCount: uniqueStateTexts.length,
    phases,
    invariants: deriveScrollInvariants(phases),
    screenshot: await captureSingleScreenshot(page, "[data-rp-scroll-probe='true']", screenshotsDir, "interaction-section"),
    meaningful: scrollChanges.length > 0 || uniqueStateTexts.length > 1,
  };
}

async function probeWheelScrollScene(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(320);
  const meta = await page.evaluate(() => {
    const root = document.querySelector("[data-rp-scroll-probe='true']");
    if (!(root instanceof Element)) return null;
    return {
      rootStart: window.scrollY + root.getBoundingClientRect().top,
      travel: Math.max(1, root.getBoundingClientRect().height - window.innerHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  if (!meta) return [];
  const frames = [await readWheelScrollFrame(page, meta, 0)];
  await page.mouse.move(Math.round(meta.viewportWidth * 0.85), Math.round(meta.viewportHeight * 0.75));
  for (let index = 1; index <= 10; index += 1) {
    await page.mouse.wheel(0, Math.round(meta.viewportHeight * 0.32));
    await page.waitForTimeout(220);
    frames.push(await readWheelScrollFrame(page, meta, index));
  }
  return frames.filter(Boolean);
}

async function readWheelScrollFrame(page, meta, index) {
  return page.evaluate(({ meta, index }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector("[data-rp-scroll-probe='true']");
    if (!(root instanceof Element)) return null;
    const visual = root.querySelector("iframe, video, canvas, img, [data-scene-visual], [data-scroll-visual]");
    const copy = root.querySelector("[data-scene-copy], [data-scroll-copy], [role='tabpanel'], h1,h2,h3") || root;
    const rootRect = root.getBoundingClientRect();
    const visualRect = visual?.getBoundingClientRect() || null;
    const copyRect = copy?.getBoundingClientRect() || null;
    const copyStyle = copy ? getComputedStyle(copy) : null;
    const visualChain = [];
    for (let node = visual; node && node !== root.parentElement && visualChain.length < 6; node = node.parentElement) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      visualChain.push({
        tag: node.tagName.toLowerCase(),
        className: clean(node.className || ""),
        position: style.position,
        overflow: style.overflow,
        transform: style.transform,
        opacity: style.opacity,
        clipPath: style.clipPath,
        borderRadius: style.borderRadius,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      });
      if (node === root) break;
    }
    const sceneLayers = Array.from(root.querySelectorAll("*"))
      .map((node) => ({ node, style: getComputedStyle(node), rect: node.getBoundingClientRect() }))
      .filter(({ node, style, rect }) => rect.height >= 80 && style.display !== "none" && style.visibility !== "hidden" && (/curtain|mask|overlay|scrim|scroll-over__bg|scroll-over__frame/i.test(String(node.className || "")) || ["absolute", "fixed", "sticky"].includes(style.position)))
      .slice(0, 18)
      .map(({ node, style, rect }) => ({
        tag: node.tagName.toLowerCase(),
        className: clean(node.className || ""),
        role: /curtain|mask|scrim/i.test(String(node.className || "")) ? "curtain" : /\bbg\b|background/i.test(String(node.className || "")) ? "background" : "layer",
        position: style.position,
        transform: style.transform,
        opacity: style.opacity,
        clipPath: style.clipPath,
        backgroundColor: style.backgroundColor,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      }));
    const progress = (window.scrollY - meta.rootStart) / meta.travel;
    return {
      progress: Math.round(progress * 1000) / 1000,
      stage: "wheel",
      name: `wheel-${index}`,
      scrollY: Math.round(window.scrollY),
      rootClassName: clean(root.className || ""),
      visualClassName: clean(visual?.className || ""),
      copyClassName: clean(copy?.className || ""),
      rootTop: Math.round(rootRect.top),
      rootWidth: Math.round(rootRect.width),
      rootHeight: Math.round(rootRect.height),
      visual: visualRect ? { width: Math.round(visualRect.width), height: Math.round(visualRect.height), top: Math.round(visualRect.top) } : null,
      copy: copyRect ? {
        width: Math.round(copyRect.width),
        height: Math.round(copyRect.height),
        top: Math.round(copyRect.top),
        left: Math.round(copyRect.left),
        position: copyStyle?.position || "",
        transform: copyStyle?.transform || "none",
        opacity: copyStyle?.opacity || "1",
        fontSize: copyStyle?.fontSize || "",
        lineHeight: copyStyle?.lineHeight || "",
      } : null,
      visualChain,
      sceneLayers,
    };
  }, { meta, index });
}

async function probeCarouselStates(page, screenshotsDir) {
  const candidates = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const hasActiveToken = (value) => clean(value).split(" ").some((token) => /(?:^|[-_:])(active|selected|expanded)$|^(active|selected|expanded)$/i.test(token));
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width >= 80 && rect.height >= 60 && style.display !== "none" && style.visibility !== "hidden";
    };
    const classSignature = (node) => clean(node.className).split(" ").filter(Boolean).slice(0, 3).join(".");
    const roots = Array.from(new Set(document.querySelectorAll(
      "[data-carousel], [aria-roledescription='carousel'], [class*='carousel'], [class*='slider'], [class*='rail'], [class*='swiper'], [class*='splide'], [class*='embla']",
    ))).filter(visible);
    const byTrack = new Map();
    for (const hintedRoot of roots.slice(0, 80)) {
      const scope = hintedRoot.closest("section,main,article,[role='region']") || hintedRoot;
      const nodes = [hintedRoot, ...Array.from(hintedRoot.querySelectorAll("*")).slice(0, 240)];
      for (const track of nodes) {
        if (!visible(track)) continue;
        const directChildren = Array.from(track.children).filter(visible);
        if (directChildren.length < 3 || directChildren.length > 40) continue;
        const signatureCounts = new Map();
        for (const child of directChildren) {
          const key = classSignature(child) || child.tagName.toLowerCase();
          signatureCounts.set(key, (signatureCounts.get(key) || 0) + 1);
        }
        const dominant = Array.from(signatureCounts.entries()).sort((left, right) => right[1] - left[1])[0];
        const items = dominant && dominant[1] >= 3
          ? directChildren.filter((child) => (classSignature(child) || child.tagName.toLowerCase()) === dominant[0])
          : directChildren;
        if (items.length < 3) continue;
        const rects = items.map((item) => item.getBoundingClientRect());
        const horizontalSpan = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
        const verticalSpan = Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
        const trackRect = track.getBoundingClientRect();
        const horizontal = horizontalSpan > verticalSpan * 1.15 || horizontalSpan > trackRect.width * 1.15 || track.scrollWidth > track.clientWidth * 1.05;
        if (!horizontal) continue;
        const classText = `${clean(hintedRoot.className)} ${clean(track.className)} ${clean(scope.className)}`.toLowerCase();
        let score = items.length * 2;
        if (track.scrollWidth > track.clientWidth * 1.05) score += 35;
        if (/carousel|slider|rail|track|slides|swiper|splide|embla/.test(classText)) score += 30;
        if (getComputedStyle(track).display === "flex" || getComputedStyle(track).display === "grid") score += 15;
        if (scope.querySelectorAll("button").length >= 2) score += 12;
        const existing = byTrack.get(track);
        if (!existing || existing.score < score) byTrack.set(track, { hintedRoot, scope, track, items, score });
      }
    }
    const ranked = Array.from(byTrack.values())
      .sort((left, right) => right.score - left.score)
      .filter((candidate, index, all) => !all.slice(0, index).some((earlier) => earlier.track.contains(candidate.track) || candidate.track.contains(earlier.track)))
      .slice(0, 4);
    return ranked.map((candidate, probeIndex) => {
      candidate.scope.setAttribute("data-rp-carousel-probe", String(probeIndex));
      candidate.track.setAttribute("data-rp-carousel-track", String(probeIndex));
      candidate.items.forEach((item, itemIndex) => item.setAttribute("data-rp-carousel-item", `${probeIndex}:${itemIndex}`));
      const activeIndex = candidate.items.findIndex((item) => hasActiveToken(item.className) || item.getAttribute("aria-selected") === "true");
      const targetIndex = candidate.items.length > 1 && activeIndex !== 1 ? 1 : activeIndex !== 0 ? 0 : Math.min(2, candidate.items.length - 1);
      const controls = Array.from(candidate.scope.querySelectorAll("button,[role='button']")).slice(0, 8).map((button) => ({
        label: clean(button.getAttribute("aria-label") || button.textContent).slice(0, 100),
        classTokens: clean(button.className).split(" ").filter(Boolean).slice(0, 8),
      }));
      return {
        probeIndex,
        score: candidate.score,
        targetIndex,
        itemCount: candidate.items.length,
        scope: {
          tag: candidate.scope.tagName.toLowerCase(),
          id: candidate.scope.id || "",
          classTokens: clean(candidate.scope.className).split(" ").filter(Boolean).slice(0, 12),
          textFingerprint: clean(candidate.scope.textContent).slice(0, 180),
        },
        track: {
          classTokens: clean(candidate.track.className).split(" ").filter(Boolean).slice(0, 12),
        },
        controls,
      };
    });
  });

  const results = [];
  for (const candidate of candidates) {
    const probeIndex = candidate.probeIndex;
    const itemSelector = `[data-rp-carousel-item="${probeIndex}:${candidate.targetIndex}"]`;
    const frames = [];
    try {
      const target = page.locator(itemSelector).first();
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(160);
      frames.push(await readCarouselTimelineFrame(page, probeIndex, -1));
      const safeCarouselTarget = await target.evaluate((node) => {
        const anchor = node.closest("a[href]");
        const identity = `${node.getAttribute("role") || ""} ${node.className || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
        return !anchor && !node.closest("form") && !/cart|checkout|buy|book|delete|account/.test(identity);
      });
      if (!safeCarouselTarget) {
        results.push({
          id: `carousel-${probeIndex + 1}`,
          missing: false,
          changed: false,
          blocked: true,
          reason: "Safe probing refused a carousel item that could navigate or perform a business action.",
          scope: candidate.scope,
          target: { itemIndex: candidate.targetIndex },
          controls: candidate.controls,
        });
        continue;
      }
      await target.click({ force: true });
      let elapsed = 0;
      for (const atMs of DEFAULT_INTERACTION_TIMELINE_MS) {
        if (atMs > elapsed) await page.waitForTimeout(atMs - elapsed);
        elapsed = atMs;
        frames.push(await readCarouselTimelineFrame(page, probeIndex, atMs));
      }
      const timeline = compactInteractionTimeline(frames);
      const invariants = deriveCarouselInvariants({ frames, timeline });
      const firstItems = itemFrame(frames[0]);
      const finalItems = itemFrame(frames[frames.length - 1]);
      const changed = JSON.stringify(firstItems) !== JSON.stringify(finalItems) || timeline.changedNodeCount > 0;
      const prefix = probeIndex === 0 ? "interaction-carousel" : `interaction-carousel-${probeIndex + 1}`;
      results.push({
        id: `carousel-${probeIndex + 1}`,
        missing: false,
        changed,
        scope: candidate.scope,
        target: { itemIndex: candidate.targetIndex },
        controls: candidate.controls,
        initial: legacyCarouselState(frames[0]),
        after: legacyCarouselState(frames[frames.length - 1]),
        timeline,
        invariants,
        screenshot: await captureSingleScreenshot(page, `[data-rp-carousel-probe="${probeIndex}"]`, screenshotsDir, prefix),
      });
    } catch (error) {
      results.push({
        id: `carousel-${probeIndex + 1}`,
        missing: false,
        changed: false,
        scope: candidate.scope,
        target: { itemIndex: candidate.targetIndex },
        controls: candidate.controls,
        frames,
        error: error.message,
      });
    }
  }
  return results;
}

async function readCarouselTimelineFrame(page, probeIndex, atMs) {
  return page.evaluate(({ probeIndex, atMs }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const hasActiveToken = (value) => clean(value).split(" ").some((token) => /(?:^|[-_:])(active|selected|expanded)$|^(active|selected|expanded)$/i.test(token));
    const root = document.querySelector(`[data-rp-carousel-probe="${probeIndex}"]`);
    const track = document.querySelector(`[data-rp-carousel-track="${probeIndex}"]`);
    const items = Array.from(document.querySelectorAll(`[data-rp-carousel-item^="${probeIndex}:"]`));
    if (!(root instanceof Element) || !(track instanceof Element) || items.length < 2) return null;
    const pathWithin = (node, stop) => {
      const parts = [];
      for (let current = node; current && current !== stop && parts.length < 5; current = current.parentElement) {
        const parent = current.parentElement;
        const index = parent ? Array.from(parent.children).indexOf(current) : 0;
        parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
      }
      return parts.join("/");
    };
    const snapshot = (node, path, role) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const className = clean(node.className);
      return {
        path,
        role,
        text: clean(node.textContent).slice(0, 160),
        className,
        active: className.split(/\s+/).some((token) => /(?:^|[-_:])(active|selected|expanded)$|^(active|selected|expanded)$/i.test(token)),
        ariaSelected: node.getAttribute("aria-selected") || "",
        ariaExpanded: node.getAttribute("aria-expanded") || "",
        hidden: node.hasAttribute("hidden"),
        rect: {
          left: Math.round(rect.left * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        transform: style.transform,
        width: style.width,
        height: style.height,
        flexBasis: style.flexBasis,
        gridTemplateColumns: style.gridTemplateColumns,
        overflow: style.overflow,
        clipPath: style.clipPath,
        gap: style.gap,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
        borderLeftColor: style.borderLeftColor,
        borderRightColor: style.borderRightColor,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        transitionTimingFunction: style.transitionTimingFunction,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    };
    const nodes = [snapshot(root, "scope", "scope"), snapshot(track, "track", "track")];
    items.slice(0, 12).forEach((item, index) => nodes.push(snapshot(item, `item:${index}`, "item")));
    const activeOrTarget = items.find((item) => hasActiveToken(item.className)) || items[0];
    const descendants = Array.from(activeOrTarget.querySelectorAll("*")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const className = clean(node.className);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && (className || node.matches("img,picture,video,iframe,button,a,[aria-hidden],[aria-expanded]"));
    }).slice(0, 48);
    descendants.forEach((node) => nodes.push(snapshot(node, `active/${pathWithin(node, activeOrTarget)}`, "active-descendant")));
    const animations = typeof document.getAnimations === "function"
      ? document.getAnimations().filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Node && root.contains(target);
      }).slice(0, 24).map((animation) => {
        const target = animation.effect?.target;
        const timing = animation.effect?.getTiming?.() || {};
        return {
          path: target instanceof Element ? pathWithin(target, root) : "",
          name: animation.animationName || "",
          playState: animation.playState,
          currentTime: Math.round(Number(animation.currentTime) || 0),
          duration: timing.duration,
          delay: timing.delay,
          easing: timing.easing,
          fill: timing.fill,
        };
      })
      : [];
    return { atMs, nodes, animations };
  }, { probeIndex, atMs });
}

function itemFrame(frame) {
  return (frame?.nodes || []).filter((node) => node.role === "item").map((node) => ({
    className: node.className,
    rect: node.rect,
    ariaSelected: node.ariaSelected,
    ariaExpanded: node.ariaExpanded,
  }));
}

function legacyCarouselState(frame) {
  const track = frame?.nodes?.find((node) => node.role === "track");
  return {
    clientWidth: track?.clientWidth || 0,
    scrollWidth: track?.scrollWidth || 0,
    cards: (frame?.nodes || []).filter((node) => node.role === "item").map((node, index) => ({
      index,
      className: node.className,
      width: node.rect?.width || 0,
      height: node.rect?.height || 0,
      left: node.rect?.left || 0,
    })),
  };
}

async function captureStateScreenshots(page, selector, screenshotsDir, prefix, moveToState) {
  let initial = null;
  let scrolled = null;
  try {
    initial = path.join(screenshotsDir, `${prefix}-initial.png`);
    await page.locator(selector).first().screenshot({ path: initial });
    await moveToState();
    await page.waitForTimeout(400);
    scrolled = path.join(screenshotsDir, `${prefix}-scrolled.png`);
    await page.locator(selector).first().screenshot({ path: scrolled });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
  } catch {
    // Best effort only.
  }
  return { initial, scrolled };
}

async function captureSingleScreenshot(page, selector, screenshotsDir, prefix) {
  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    const screenshot = path.join(screenshotsDir, `${prefix}.png`);
    await page.locator(selector).first().screenshot({ path: screenshot });
    return screenshot;
  } catch {
    return null;
  }
}

function deriveSpecializedCaptures(specialized) {
  const captures = [];
  if (specialized.headerScroll?.meaningful) {
    captures.push({
      id: "header-scroll",
      kind: "sticky-transform",
      label: "Header scroll state",
      tag: "header",
      trigger: "scroll",
      sources: ["specialized:header-scroll"],
      meaningful: true,
      before: specialized.headerScroll.initial,
      after: specialized.headerScroll.scrolled,
      diff: {
        changedProperties: specialized.headerScroll.changedProperties,
        textChanged: false,
        attributeChanges: [],
      },
      liveAnimations: [],
      screenshot: specialized.headerScroll.screenshot?.scrolled || specialized.headerScroll.screenshot?.initial || null,
    });
  }
  if (specialized.scrollTabs?.meaningful) {
    if (specialized.scrollTabs.scrollChanges.length) {
      captures.push({
        id: "section-scroll-state",
        kind: "scroll-state",
        label: "Section scroll-expanded state",
        tag: "section",
        trigger: "scroll",
        sources: ["specialized:scroll-scene"],
        meaningful: true,
        before: specialized.scrollTabs.beforeScroll,
        after: specialized.scrollTabs.afterScroll,
        diff: {
          changedProperties: specialized.scrollTabs.scrollChanges,
          textChanged: false,
          attributeChanges: [],
        },
        liveAnimations: [],
        screenshot: specialized.scrollTabs.screenshot || null,
        states: specialized.scrollTabs.phases || [],
        invariants: specialized.scrollTabs.invariants || {},
      });
    }
    for (const state of specialized.scrollTabs.states.slice(0, 4)) {
      captures.push({
        id: `tab-${slugify(state.label)}`,
        kind: "tabs",
        label: state.label,
        tag: "button",
        trigger: "click",
        sources: ["specialized:scroll-scene-tabs"],
        meaningful: true,
        before: null,
        after: {
          ariaSelected: state.ariaSelected,
          activeTab: state.activeTab,
          text: state.text.join(" | "),
        },
        diff: {
          changedProperties: [],
          textChanged: specialized.scrollTabs.uniqueStateCount > 1,
          attributeChanges: state.ariaSelected ? [{ property: "ariaSelected", before: "false", after: state.ariaSelected }] : [],
        },
        liveAnimations: [],
        screenshot: specialized.scrollTabs.screenshot || null,
      });
    }
  }
  const carouselStates = specialized.carousels?.length ? specialized.carousels : specialized.carousel ? [specialized.carousel] : [];
  for (const carousel of carouselStates.filter((item) => item?.changed)) {
    captures.push({
      id: `${carousel.id || "carousel"}-card-expansion`,
      kind: "carousel",
      label: "Carousel card expansion and horizontal rail",
      tag: "section",
      trigger: "click",
      sources: ["specialized:carousel-state"],
      meaningful: true,
      before: carousel.initial,
      after: carousel.after,
      diff: { changedProperties: [{ property: "cardGeometry", before: carousel.initial.cards, after: carousel.after.cards }], textChanged: false, attributeChanges: [] },
      liveAnimations: [],
      screenshot: carousel.screenshot || null,
      scope: carousel.scope,
      timeline: carousel.timeline,
      invariants: carousel.invariants,
    });
  }
  for (const media of specialized.media || []) {
    captures.push({
      id: media.id,
      kind: "embedded-media",
      label: `${media.role} ${media.provider || media.tag} media`,
      tag: media.tag,
      trigger: "load",
      sources: ["structural:media"],
      meaningful: true,
      after: media,
      diff: { changedProperties: [], textChanged: false, attributeChanges: [] },
      liveAnimations: [],
      screenshot: null,
      scope: {
        tag: "section",
        classTokens: media.domRef?.sectionClassTokens || [],
        textFingerprint: media.domRef?.sectionTextFingerprint || "",
      },
    });
  }
  return captures;
}

function enrichPageRecord(page, experiment) {
  const allCaptures = [...experiment.runtime.captures, ...(experiment.runtime.specializedCaptures || [])];
  const captures = allCaptures.map((capture) => ({
    id: capture.id || "",
    kind: classifyCapture(capture),
    label: capture.label,
    trigger: capture.trigger,
    sources: capture.sources,
    changedProperties: (capture.diff?.changedProperties || []).map((item) => item.property),
    textChanged: Boolean(capture.diff?.textChanged),
    screenshot: capture.screenshot,
    importance: classifyImportance(capture),
    ...(capture.scope ? { scope: capture.scope } : {}),
  }));
  const sectionInteractions = (page.sections || []).map((section) => {
    const heading = String(section.heading || "").toLowerCase();
    const className = `${section.className || ""} ${(section.domRef?.classTokens || []).join(" ")}`.toLowerCase();
    const relevant = captures.filter((capture) => {
      const label = String(capture.label || "").toLowerCase();
      if (capture.scope && scopeMatchesSection(capture.scope, section)) return true;
      if (!capture.scope && (className.includes("hero-video") || section.kind === "hero") && capture.kind === "embedded-media") return true;
      if (/carousel|slider|rail|gallery/.test(className) && (capture.kind === "hover-card" || capture.kind === "carousel-control" || capture.kind === "carousel")) return true;
      if (/scroll|scene|sticky|pinned/.test(className)) {
        return capture.kind === "tabs" || capture.kind === "sticky-transform" || capture.kind === "scroll-state";
      }
      return label && heading && label.includes(heading.slice(0, 12));
    });
    return {
      sectionId: section.id,
      interactions: dedupeSectionInteractions(relevant).slice(0, 12),
    };
  });
  return {
    ...page,
    interactionDiscovery: {
      generatedAt: experiment.generatedAt,
      staticSummary: experiment.staticInventory.summary,
      runtimeSummary: experiment.runtime.summary,
      captures,
      sectionInteractions,
      structural: experiment.runtime.structural,
      media: experiment.runtime.structural.media || [],
      specialized: summarizeSpecializedRuntime(experiment.runtime.specialized),
      requiredBehaviors: [
        experiment.runtime.structural.embedCount ? "preserve-embedded-media" : null,
        experiment.runtime.structural.tabLabels.length ? "preserve-content-switching-tabs" : null,
        experiment.runtime.specialized?.headerScroll?.meaningful ? "preserve-header-scroll-state" : null,
        experiment.runtime.specialized?.scrollTabs?.scrollChanges?.length ? "preserve-scroll-expanded-section-state" : null,
        (experiment.runtime.specialized?.carousels || [experiment.runtime.specialized?.carousel]).some((carousel) => carousel?.changed) ? "preserve-carousel-card-expansion" : null,
      ].filter(Boolean),
    },
  };
}

function summarizeSpecializedRuntime(specialized = {}) {
  return {
    headerScroll: specialized.headerScroll ? {
      meaningful: Boolean(specialized.headerScroll.meaningful),
      changedProperties: specialized.headerScroll.changedProperties || [],
      screenshot: specialized.headerScroll.screenshot || null,
    } : { missing: true },
    scrollTabs: specialized.scrollTabs ? {
      meaningful: Boolean(specialized.scrollTabs.meaningful),
      uniqueStateCount: specialized.scrollTabs.uniqueStateCount || 0,
      phaseCount: specialized.scrollTabs.phases?.length || 0,
      invariants: specialized.scrollTabs.invariants || {},
      screenshot: specialized.scrollTabs.screenshot || null,
    } : { missing: true },
    carousels: (specialized.carousels || []).map((carousel) => ({
      id: carousel.id,
      changed: Boolean(carousel.changed),
      scope: carousel.scope,
      invariants: carousel.invariants,
      screenshot: carousel.screenshot || null,
      ...(carousel.error ? { error: carousel.error } : {}),
    })),
  };
}

function scopeMatchesSection(scope, section) {
  const identityToken = (token) => {
    const value = String(token || "").toLowerCase();
    return value && !/^(relative|absolute|fixed|sticky|static|block|inline|flex|grid|container|hidden|visible|w-|h-|min-|max-|p[trblxy]?-|m[trblxy]?-|bg-|text-|font-|z-|overflow|object-|top-|left-|right-|bottom-|translate-|scale-|rotate-|opacity-|rounded-|border-|shadow-|transition|duration-|ease-|sm:|md:|lg:|xl:|2xl:)/.test(value);
  };
  const scopeTokens = new Set((scope.classTokens || []).map((token) => String(token).toLowerCase()).filter(identityToken));
  const sectionTokens = [
    section.className,
    ...(section.domRef?.classTokens || []),
  ].flatMap((value) => String(value || "").toLowerCase().split(/\s+/)).filter(identityToken);
  if (sectionTokens.some((token) => scopeTokens.has(token))) return true;
  const scopeText = String(scope.textFingerprint || "").toLowerCase();
  const heading = String(section.heading || "").toLowerCase().trim();
  return Boolean(heading.length >= 8 && scopeText.includes(heading.slice(0, 32)));
}

export function bindInteractionsToSections(interactions, pages) {
  for (const interaction of interactions) {
    const sectionIds = [];
    for (const page of pages || []) {
      for (const entry of page.interactionDiscovery?.sectionInteractions || []) {
        const matched = (entry.interactions || []).some((summary) => {
          if (summary.id) return summary.id === interaction.id;
          return summary.kind === interaction.kind &&
            summary.label === interaction.label &&
            normalizeTrigger(summary.trigger).type === normalizeTrigger(interaction.trigger).type;
        });
        if (matched) sectionIds.push(entry.sectionId);
      }
    }
    interaction.sectionIds = Array.from(new Set(sectionIds));
  }
}

function dedupeSectionInteractions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}\u0000${item.label}\u0000${item.trigger}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyCapture(capture) {
  if (capture.kind) return capture.kind;
  const label = `${capture.label || ""} ${capture.sources?.join(" ") || ""}`.toLowerCase();
  if (capture.tag === "iframe" || capture.tag === "video") return "embedded-media";
  if (capture.tag === "summary" || capture.tag === "details" || capture.before?.ariaExpanded || capture.after?.ariaExpanded || label.includes("accordion") || label.includes("disclosure")) return "accordion";
  if (capture.controlRole) return "control-state";
  if (label.includes("tab") || label.includes(".panel__btn") || capture.after?.ariaSelected) return "tabs";
  if (capture.kind === "carousel" || capture.sources?.some((source) => source.includes("carousel-state"))) return "carousel";
  if (label.includes("story-card") || label.includes("carousel")) return "hover-card";
  if (label.includes("header") || capture.sources?.some((source) => source.includes("header a"))) return "sticky-transform";
  if (label.includes("button") || label.includes("next") || label.includes("prev")) return "carousel-control";
  return "micro-interaction";
}

function classifyImportance(capture) {
  const kind = classifyCapture(capture);
  if (kind === "tabs" || kind === "accordion" || kind === "embedded-media" || kind === "sticky-transform" || kind === "scroll-state" || kind === "carousel") return "core";
  if (kind === "hover-card" || kind === "carousel-control") return "supportive";
  if (kind === "control-state") return "supportive";
  return "decorative";
}

function normalizeTrigger(trigger) {
  return typeof trigger === "string" ? { type: trigger } : trigger || { type: "unknown" };
}

function summarizeStates(capture) {
  if (Array.isArray(capture.states) && capture.states.length) return capture.states;
  if (capture.controlRole && (capture.before || capture.after)) {
    const properties = (capture.diff?.changedProperties || []).map((item) => item.property);
    return [
      capture.before ? compactControlSnapshot(capture.before, properties, { includeBase: true }) : null,
      capture.after ? compactControlSnapshot(capture.after, properties) : null,
    ].filter(Boolean);
  }
  if (capture.before || capture.after) return [capture.before, capture.after].filter(Boolean);
  return [];
}

function compactControlSnapshot(snapshot, properties, { includeBase = false } = {}) {
  const baseKeys = [
    "color", "backgroundColor", "borderColor", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "textDecorationLine", "textDecorationColor", "textDecorationThickness", "textUnderlineOffset",
    "outlineColor", "outlineStyle", "outlineWidth", "outlineOffset", "cursor",
    "transitionProperty", "transitionDuration", "transitionTimingFunction",
  ];
  const targetKeys = new Set(includeBase ? baseKeys : []);
  const pseudoKeys = { before: new Set(), after: new Set() };
  const childKeys = new Map();
  for (const property of properties || []) {
    const child = String(property).match(/^child:(.+?)(?:::(before|after))?\.([^.]+)$/);
    if (child) {
      const record = childKeys.get(child[1]) || { styles: new Set(), before: new Set(), after: new Set() };
      (child[2] ? record[child[2]] : record.styles).add(child[3]);
      childKeys.set(child[1], record);
      continue;
    }
    const pseudo = String(property).match(/^::(before|after)\.([^.]+)$/);
    if (pseudo) {
      pseudoKeys[pseudo[1]].add(pseudo[2]);
      continue;
    }
    if (snapshot.styles && property in snapshot.styles) targetKeys.add(property);
  }
  if (includeBase) {
    const timingKeys = ["transitionProperty", "transitionDuration", "transitionTimingFunction"];
    for (const fields of childKeys.values()) timingKeys.forEach((key) => fields.styles.add(key));
    for (const pseudo of ["before", "after"]) {
      if (pseudoKeys[pseudo].size) timingKeys.forEach((key) => pseudoKeys[pseudo].add(key));
    }
  }
  const pick = (source, keys) => Object.fromEntries(Array.from(keys).map((key) => [key, source?.[key]]));
  return {
    styles: pick(snapshot.styles, targetKeys),
    pseudo: {
      before: pick(snapshot.pseudo?.before, pseudoKeys.before),
      after: pick(snapshot.pseudo?.after, pseudoKeys.after),
    },
    visualChildren: Array.from(childKeys.entries()).map(([key, fields]) => {
      const child = (snapshot.visualChildren || []).find((item) => item.key === key) || {};
      return {
        key,
        styles: pick(child.styles, fields.styles),
        pseudo: { before: pick(child.pseudo?.before, fields.before), after: pick(child.pseudo?.after, fields.after) },
      };
    }),
    className: snapshot.className || "",
    ariaSelected: snapshot.ariaSelected || "",
    ariaExpanded: snapshot.ariaExpanded || "",
    ariaCurrent: snapshot.ariaCurrent || "",
    ariaPressed: snapshot.ariaPressed || "",
    disabled: Boolean(snapshot.disabled),
  };
}

function implementationHintFor(capture) {
  const kind = classifyCapture(capture);
  if (kind === "sticky-transform") return "Preserve the source shared-chrome scroll state rather than collapsing it to one static header.";
  if (kind === "tabs") return "Implement as an explicit content switcher keyed to the visible tab labels.";
  if (kind === "accordion") return "Build a CMS-backed accordion repeater; preserve every closed panel's complete structure, the captured initial expansion, and the observed single/multiple-open behavior.";
  if (kind === "scroll-state") return "Preserve the source section's scroll-driven visual and copy relationship rather than flattening it into a static block.";
  if (kind === "carousel") return "Implement an overflowing horizontal rail with the captured active-card expansion and controls; do not flatten it into a grid.";
  if (kind === "embedded-media") return "Keep the media interactive instead of replacing it with a static poster image.";
  if (kind === "hover-card" || kind === "carousel-control") return "Preserve the hover/control affordance closely enough to maintain scanability and emphasis.";
  if (kind === "control-state") return "Reproduce the captured state delta on its owning target, pseudo-element, or nested icon; preserve focus visibility and source timing.";
  return "Preserve this behavior when it materially affects comprehension, navigation, or brand feel.";
}

function slugify(value) {
  return String(value || "interaction")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "interaction";
}

function safePageName(page) {
  return `${page.area}-${String(page.path || "home").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "home"}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
