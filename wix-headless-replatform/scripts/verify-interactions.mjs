#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { loadPlaywrightFromContext, resolveBrowserToolingContext } from "./lib/browser-tooling.mjs";

async function main() {
  const args = parseArgs();
  const cloneUrl = args["clone-url"] || args.url || args._[0];
  const outputDir = path.resolve(args.out || args.output || "");
  if (!cloneUrl) throw new Error("Missing --clone-url for the running clone.");
  if (!args.out && !args.output) throw new Error("Missing --out for the generated project directory.");
  const browserTooling = await resolveBrowserToolingContext({ startDir: path.resolve(args["project-root"] || process.cwd()) });
  const report = await verifyInteractionRuntime({ outputDir, cloneUrl, browserTooling });
  await writeJson(path.join(docsDir(outputDir), "interaction-qa.json"), report);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else console.log(`Interaction QA: ${report.passedScenes}/${report.sceneCount} scenes passed`);
  if (!report.pass) process.exitCode = 1;
}

export async function verifyInteractionRuntime({ outputDir, cloneUrl, browserTooling } = {}) {
  const contract = await readJson(path.join(docsDir(outputDir), "scene-contract.json"));
  let uiNormalization = null;
  try {
    uiNormalization = await readJson(path.join(docsDir(outputDir), "ui-normalization.json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const toolingContext = browserTooling || await resolveBrowserToolingContext({ startDir: process.cwd() });
  const playwright = await loadPlaywrightFromContext(toolingContext);
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  try {
    await page.goto(cloneUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    const scenes = [];
    for (const scene of contract.scenes || []) scenes.push(await verifyScene(page, scene));
    const passedScenes = scenes.filter((scene) => scene.pass).length;
    const normalization = uiNormalization ? await verifyUiNormalization(page, uiNormalization) : null;
    const scenePass = scenes.length > 0 && passedScenes === scenes.length;
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      cloneUrl,
      sceneCount: scenes.length,
      passedScenes,
      failedScenes: scenes.length - passedScenes,
      pass: scenePass && (!normalization || normalization.pass),
      scenes,
      ...(normalization ? { normalization } : {}),
    };
  } finally {
    await browser.close();
  }
}

async function verifyUiNormalization(page, contract) {
  const globalChecks = [];
  for (const assertion of contract.globalAssertions || []) {
    if (assertion.kind === "no-page-horizontal-overflow") {
      const pixels = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
      globalChecks.push(pixels <= assertion.maximumPixels
        ? { ...assertion, pass: true, actualPixels: pixels }
        : { ...assertion, pass: false, message: `Document overflows horizontally by ${pixels}px.` });
    } else if (assertion.kind === "reduced-motion-available") {
      const present = await page.evaluate(() => Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules || []).some((rule) => String(rule.cssText || "").includes("prefers-reduced-motion"));
        } catch {
          return false;
        }
      }));
      globalChecks.push(present
        ? { ...assertion, pass: true }
        : { ...assertion, pass: false, message: "No same-origin prefers-reduced-motion rule was found." });
    }
  }
  const sections = [];
  for (const section of contract.sections || []) sections.push(await verifyNormalizedSection(page, section));
  return {
    sectionCount: sections.length,
    passedSections: sections.filter((section) => section.pass).length,
    pass: globalChecks.every((check) => check.pass) && sections.every((section) => section.pass),
    globalChecks,
    sections,
  };
}

async function verifyNormalizedSection(page, section) {
  const selector = `[data-rp-section="${escapeAttribute(section.sectionId)}"]`;
  const root = page.locator(selector).first();
  if (!await root.count()) {
    return {
      sectionId: section.sectionId,
      pass: false,
      checks: [{ kind: "section-present", pass: false, message: `Missing ${selector}.` }],
    };
  }
  const checks = [];
  for (const assertion of section.assertions || []) {
    if (assertion.kind === "section-present") {
      checks.push({ ...assertion, pass: true });
      continue;
    }
    if (assertion.kind === "repeated-item-height-spread") {
      const heights = await itemHeights(root);
      const ratio = heightSpreadRatio(heights);
      checks.push(ratio <= assertion.maximumRatio
        ? { ...assertion, pass: true, actualRatio: round(ratio), heights }
        : { ...assertion, pass: false, message: `Repeated item height spread ${round(ratio)} exceeds ${assertion.maximumRatio}.`, heights });
      continue;
    }
    if (assertion.kind === "activation-preserves-item-height") {
      const before = await itemHeights(root);
      let after = before;
      const activators = root.locator("[data-rp-activate]");
      if (await activators.count() > 1) {
        await activators.nth(1).click({ force: true });
        await page.waitForTimeout(650);
        after = await itemHeights(root);
      }
      const ratio = maximumPairedHeightDelta(before, after);
      checks.push(ratio <= assertion.maximumRatio
        ? { ...assertion, pass: true, actualRatio: round(ratio) }
        : { ...assertion, pass: false, message: `Activation changed item block size by ${round(ratio)}; maximum is ${assertion.maximumRatio}.` });
      continue;
    }
    if (assertion.kind === "hover-preserves-item-layout") {
      const before = await itemRects(root);
      const targets = root.locator("[data-rp-hover-target],[data-rp-item]");
      const count = await targets.count();
      if (!count) {
        checks.push({ ...assertion, pass: false, message: "No marked hover target exists." });
        continue;
      }
      let targetIndex = Math.max(0, count - 1);
      for (let index = 0; index < count; index += 1) {
        const active = await targets.nth(index).getAttribute("data-rp-active");
        if (active !== "true") {
          targetIndex = index;
          break;
        }
      }
      await targets.nth(targetIndex).hover({ force: true });
      await page.waitForTimeout(280);
      const after = await itemRects(root);
      const inlineRatio = maximumPairedRectDelta(before, after, "width");
      const blockRatio = maximumPairedRectDelta(before, after, "height");
      checks.push(inlineRatio <= assertion.maximumInlineRatio && blockRatio <= assertion.maximumBlockRatio
        ? { ...assertion, pass: true, actualInlineRatio: round(inlineRatio), actualBlockRatio: round(blockRatio) }
        : { ...assertion, pass: false, message: `Hover changed peer layout by inline=${round(inlineRatio)}, block=${round(blockRatio)}.` });
      continue;
    }
    if (assertion.kind === "eased-motion-present") {
      const motion = await root.locator("[data-rp-motion]").evaluateAll((nodes) => nodes.map((node) => {
        const style = getComputedStyle(node);
        return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
      }));
      const eased = motion.some((item) => item.duration.split(",").some((value) => Number.parseFloat(value) > 0)
        && item.easing.split(",").some((value) => !/^\s*(?:linear|steps\()/i.test(value)));
      checks.push(eased
        ? { ...assertion, pass: true, motion }
        : { ...assertion, pass: false, message: "No marked motion target has a non-zero eased transition." });
      continue;
    }
    checks.push({ ...assertion, pass: false, message: `Unsupported UI normalization assertion: ${assertion.kind}.` });
  }
  return { sectionId: section.sectionId, pass: checks.every((check) => check.pass), checks };
}

async function itemHeights(root) {
  return root.locator("[data-rp-item]").evaluateAll((items) => items
    .filter((item) => {
      const style = getComputedStyle(item);
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    })
    .map((item) => Math.round(item.getBoundingClientRect().height)));
}

async function itemRects(root) {
  return root.locator("[data-rp-item]").evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
}

function heightSpreadRatio(heights) {
  if (heights.length < 2) return 0;
  const sorted = [...heights].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return (Math.max(...heights) - Math.min(...heights)) / median;
}

function maximumPairedHeightDelta(before, after) {
  const length = Math.min(before.length, after.length);
  let maximum = 0;
  for (let index = 0; index < length; index += 1) maximum = Math.max(maximum, Math.abs(after[index] - before[index]) / Math.max(1, before[index]));
  return maximum;
}

function maximumPairedRectDelta(before, after, key) {
  const length = Math.min(before.length, after.length);
  let maximum = 0;
  for (let index = 0; index < length; index += 1) maximum = Math.max(maximum, Math.abs(after[index][key] - before[index][key]) / Math.max(1, before[index][key]));
  return maximum;
}

async function verifyScene(page, scene) {
  const selector = `[data-rp-scene="${escapeAttribute(scene.id)}"]`;
  const root = page.locator(selector).first();
  const present = await root.count() > 0;
  if (!present) {
    return {
      id: scene.id,
      primitive: scene.implementation?.primitive || scene.implementation?.model || "unknown",
      pass: false,
      checks: [{ kind: "scene-present", pass: false, message: `Missing ${selector}.` }],
    };
  }

  await root.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const before = await readSceneState(root);
  const assertions = scene.implementation?.assertions || [];
  const needsActivation = assertions.some((item) => [
    "activation-changes-state",
    "activation-changes-content",
    "active-item-width-ratio",
    "single-active-item",
    "transition-settles",
  ].includes(item.kind));
  let after = before;
  let settleMs = 0;
  let activationError = null;
  if (needsActivation) {
    try {
      const result = await activateAlternateState(page, root, assertions);
      after = result.after;
      settleMs = result.settleMs;
    } catch (error) {
      activationError = error.message;
    }
  }
  let scrollFrames = [];
  if (assertions.some((item) => item.kind.startsWith("scroll-") || item.kind === "visual-pins-during-scroll")) {
    scrollFrames = await sampleScrollScene(page, root);
  }
  let hoverBefore = null;
  let hoverAfter = null;
  let hoverError = null;
  if (assertions.some((item) => item.kind === "hover-changes-visual-state")) {
    try {
      const hover = await probeHoverState(page, root);
      hoverBefore = hover.before;
      hoverAfter = hover.after;
    } catch (error) {
      hoverError = error.message;
    }
  }

  const checks = assertions.map((assertion) => evaluateAssertion(assertion, {
    before,
    after,
    settleMs,
    scrollFrames,
    activationError,
    hoverBefore,
    hoverAfter,
    hoverError,
  }));
  if (!assertions.some((item) => item.kind === "scene-present")) {
    checks.unshift({ kind: "scene-present", pass: true });
  }
  return {
    id: scene.id,
    primitive: scene.implementation?.primitive || scene.implementation?.model || "unknown",
    pass: checks.every((check) => check.pass),
    settleMs,
    checks,
  };
}

async function readSceneState(root) {
  return root.evaluate((scene) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const items = Array.from(scene.querySelectorAll("[data-rp-item]")).map((node, index) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        index,
        active: node.getAttribute("data-rp-active") === "true",
        text: clean(node.textContent).slice(0, 160),
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        spacing: {
          marginLeft: parseFloat(style.marginLeft) || 0,
          marginRight: parseFloat(style.marginRight) || 0,
          paddingLeft: parseFloat(style.paddingLeft) || 0,
          paddingRight: parseFloat(style.paddingRight) || 0,
          borderLeftWidth: parseFloat(style.borderLeftWidth) || 0,
          borderRightWidth: parseFloat(style.borderRightWidth) || 0,
        },
      };
    });
    const track = scene.querySelector("[data-rp-track]");
    const viewport = scene.querySelector("[data-rp-viewport]") || track?.parentElement;
    const panels = Array.from(scene.querySelectorAll("[data-rp-panel]")).filter(visible).map((node) => clean(node.textContent).slice(0, 600));
    const mediaNodes = Array.from(scene.querySelectorAll("iframe,video"));
    const media = mediaNodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        src: node.currentSrc || node.getAttribute("src") || "",
        autoplay: node.autoplay || /(?:^|[?&])autoplay=1(?:&|$)/.test(node.getAttribute("src") || ""),
        loop: node.loop || /(?:^|[?&])loop=1(?:&|$)/.test(node.getAttribute("src") || ""),
        muted: node.muted || /(?:^|[?&])muted=1(?:&|$)/.test(node.getAttribute("src") || ""),
        background: /(?:^|[?&])background=1(?:&|$)/.test(node.getAttribute("src") || ""),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      };
    });
    const fallbackLayers = Array.from(scene.querySelectorAll("*")).slice(0, 500).filter(visible).flatMap((node) => {
      const sources = [];
      if (node.tagName === "IMG") sources.push(node.currentSrc || node.getAttribute("src") || "");
      const background = getComputedStyle(node).backgroundImage || "";
      for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) sources.push(match[1]);
      return sources.filter(Boolean).map((source) => ({ source, rect: node.getBoundingClientRect() }));
    });
    const overlappingFallbackSources = fallbackLayers
      .filter((layer) => mediaNodes.some((mediaNode) => overlapRatio(layer.rect, mediaNode.getBoundingClientRect()) >= 0.8))
      .map((layer) => layer.source);
    return {
      items,
      activeIndexes: items.filter((item) => item.active).map((item) => item.index),
      initialized: String(scene.getAttribute("data-rp-initialized") || "").split(/\s+/).filter(Boolean),
      track: track ? {
        clientWidth: viewport?.clientWidth || track.clientWidth,
        scrollWidth: Math.max(track.scrollWidth, Math.round(track.getBoundingClientRect().width), viewport?.scrollWidth || 0),
        gap: parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0,
      } : null,
      panelText: panels.join(" | "),
      phase: scene.getAttribute("data-rp-phase") || "",
      media,
      overlappingFallbackSources,
    };

    function overlapRatio(left, right) {
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      const overlap = width * height;
      const smaller = Math.min(left.width * left.height, right.width * right.height);
      return smaller > 0 ? overlap / smaller : 0;
    }
  });
}

async function probeHoverState(page, root) {
  const targets = root.locator("[data-rp-hover-target],[data-rp-item],[data-rp-direction],[data-rp-activate]");
  if (!await targets.count()) throw new Error("No hoverable data-rp control exists in the scene.");
  const target = targets.first();
  const before = await readHoverSnapshot(target);
  await target.hover({ force: true });
  await page.waitForTimeout(220);
  const after = await readHoverSnapshot(target);
  return { before, after };
}

async function readHoverSnapshot(target) {
  return target.evaluate((node) => [node, ...Array.from(node.querySelectorAll("*")).slice(0, 16)].map((part) => {
    const style = getComputedStyle(part);
    const rect = part.getBoundingClientRect();
    return {
      tag: part.tagName.toLowerCase(),
      rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
      backgroundColor: style.backgroundColor,
      color: style.color,
      opacity: style.opacity,
      transform: style.transform,
      filter: style.filter,
      boxShadow: style.boxShadow,
      borderColor: style.borderColor,
    };
  }));
}

async function activateAlternateState(page, root, assertions) {
  const activators = root.locator("[data-rp-activate]");
  const count = await activators.count();
  if (!count) throw new Error("No data-rp-activate target exists in the scene.");
  const before = await readSceneState(root);
  let targetIndex = count > 1 ? 1 : 0;
  for (let index = 0; index < count; index += 1) {
    const active = await activators.nth(index).evaluate((node) => node.closest("[data-rp-item]")?.getAttribute("data-rp-active") === "true");
    if (!active) {
      targetIndex = index;
      break;
    }
  }
  await activators.nth(targetIndex).click({ force: true });
  const maximumMs = Math.min(3000, Math.max(500, Number(assertions.find((item) => item.kind === "transition-settles")?.maximumMs) || 1800));
  const startedAt = Date.now();
  let lastSignature = "";
  let stableCount = 0;
  let after = before;
  while (Date.now() - startedAt < maximumMs) {
    await page.waitForTimeout(80);
    after = await readSceneState(root);
    const signature = JSON.stringify({ activeIndexes: after.activeIndexes, items: after.items.map((item) => item.rect), panelText: after.panelText });
    if (signature === lastSignature) stableCount += 1;
    else stableCount = 0;
    lastSignature = signature;
    if (stableCount >= 2) break;
  }
  return { before, after, settleMs: Date.now() - startedAt };
}

async function sampleScrollScene(page, root) {
  return root.evaluate(async (scene) => {
    const frames = [];
    const start = window.scrollY + scene.getBoundingClientRect().top;
    const travel = Math.max(0, scene.getBoundingClientRect().height - window.innerHeight);
    const samples = [
      { progress: -2, scrollY: Math.max(0, start - window.innerHeight * 2) },
      { progress: -1, scrollY: Math.max(0, start - window.innerHeight) },
      { progress: -0.5, scrollY: Math.max(0, start - window.innerHeight * 0.5) },
      { progress: 0, scrollY: start },
      { progress: 0.5, scrollY: start + travel * 0.5 },
      { progress: 1, scrollY: start + travel },
    ];
    for (const sample of samples) {
      window.scrollTo(0, Math.round(sample.scrollY));
      await new Promise((resolve) => setTimeout(resolve, 180));
      const visual = scene.querySelector("[data-rp-visual]");
      const content = scene.querySelector("[data-rp-content]");
      const style = visual ? getComputedStyle(visual) : null;
      const rect = visual?.getBoundingClientRect();
      const contentStyle = content ? getComputedStyle(content) : null;
      const contentRect = content?.getBoundingClientRect();
      const curtainWidths = Array.from(scene.querySelectorAll("[data-rp-curtain]")).map((curtain) => Math.round(curtain.getBoundingClientRect().width));
      frames.push({
        progress: sample.progress,
        phase: scene.getAttribute("data-rp-phase") || "",
        entryProgress: scene.style.getPropertyValue("--rp-entry-progress") || "",
        scrollProgress: scene.style.getPropertyValue("--rp-scroll-progress") || "",
        visual: visual ? { position: style.position, top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), transform: style.transform } : null,
        content: content ? { width: Math.round(contentRect.width), height: Math.round(contentRect.height), transform: contentStyle.transform } : null,
        curtainWidths,
      });
    }
    return frames;
  });
}

function evaluateAssertion(assertion, state) {
  const fail = (message) => ({ ...assertion, pass: false, message });
  const pass = (details) => ({ ...assertion, pass: true, ...(details ? { details } : {}) });
  if (assertion.kind === "scene-present") return pass();
  if (assertion.kind === "runtime-initialized") {
    return state.after.initialized.includes(assertion.primitive)
      ? pass({ initialized: state.after.initialized })
      : fail(`Runtime primitive ${assertion.primitive} did not initialize; found ${state.after.initialized.join(", ") || "none"}.`);
  }
  if (state.activationError && ["activation-changes-state", "activation-changes-content", "active-item-width-ratio", "transition-settles"].includes(assertion.kind)) {
    return fail(state.activationError);
  }
  if (assertion.kind === "minimum-item-count") {
    return state.after.items.length >= assertion.value ? pass({ actual: state.after.items.length }) : fail(`Expected at least ${assertion.value} items; found ${state.after.items.length}.`);
  }
  if (assertion.kind === "horizontal-overflow") {
    const ratio = state.after.track?.clientWidth ? state.after.track.scrollWidth / state.after.track.clientWidth : 0;
    return ratio >= assertion.minimumRatio ? pass({ actualRatio: round(ratio) }) : fail(`Expected overflow ratio >= ${assertion.minimumRatio}; got ${round(ratio)}.`);
  }
  if (assertion.kind === "single-active-item") {
    return state.after.activeIndexes.length === assertion.value ? pass({ activeIndexes: state.after.activeIndexes }) : fail(`Expected ${assertion.value} active item; found ${state.after.activeIndexes.length}.`);
  }
  if (assertion.kind === "initial-active-item-count") {
    return state.before.activeIndexes.length === assertion.value ? pass({ activeIndexes: state.before.activeIndexes }) : fail(`Expected ${assertion.value} initially active item(s); found ${state.before.activeIndexes.length}.`);
  }
  if (assertion.kind === "item-separation") {
    const gaps = state.before.items.slice(1).map((item, index) => item.rect.left - (state.before.items[index].rect.left + state.before.items[index].rect.width));
    const expected = assertion.observed || {};
    const median = (values) => values.length ? values.sort((left, right) => left - right)[Math.floor(values.length / 2)] : 0;
    let observed = Number(expected.geometricGap) || 0;
    let actual = median(gaps);
    let metric = "geometric gap";
    if (expected.mechanism === "track-gap") {
      observed = Number(expected.trackGap) || 0;
      actual = state.before.track?.gap || 0;
      metric = "track gap";
    } else if (expected.mechanism === "item-margin") {
      observed = Number(expected.itemMargin) || 0;
      actual = median(state.before.items.flatMap((item) => [item.spacing.marginLeft, item.spacing.marginRight]).filter((value) => value > 0));
      metric = "item margin";
    } else if (expected.mechanism === "divider") {
      observed = Number(expected.dividerWidth) || 0;
      actual = median(state.before.items.flatMap((item) => [item.spacing.borderLeftWidth, item.spacing.borderRightWidth]).filter((value) => value > 0));
      metric = "divider";
    } else if (Number(expected.contentInset) > 0) {
      observed = Number(expected.contentInset);
      actual = median(state.before.items.flatMap((item) => [item.spacing.paddingLeft, item.spacing.paddingRight]).filter((value) => value > 0));
      metric = "content inset";
    }
    return Math.abs(actual - observed) <= Math.max(2, Math.abs(observed) * 0.2) ? pass({ metric, actual: round(actual) }) : fail(`Expected ${metric} near ${observed}px; got ${round(actual)}px.`);
  }
  if (assertion.kind === "activation-changes-state") {
    return JSON.stringify(state.before.activeIndexes) !== JSON.stringify(state.after.activeIndexes) ? pass() : fail("Activation did not change data-rp-active state.");
  }
  if (assertion.kind === "activation-changes-content") {
    return state.before.panelText !== state.after.panelText ? pass() : fail("Activation did not change visible data-rp-panel content.");
  }
  if (assertion.kind === "active-item-width-ratio") {
    const active = state.after.items.find((item) => item.active);
    const inactiveWidths = state.after.items.filter((item) => !item.active).map((item) => item.rect.width).filter(Boolean).sort((left, right) => left - right);
    const collapsed = inactiveWidths[Math.floor(inactiveWidths.length / 2)] || 0;
    const ratio = collapsed ? active?.rect.width / collapsed : 0;
    return ratio >= assertion.minimumRatio ? pass({ actualRatio: round(ratio) }) : fail(`Expected active width ratio >= ${assertion.minimumRatio}; got ${round(ratio)}.`);
  }
  if (assertion.kind === "transition-settles") {
    return state.settleMs <= assertion.maximumMs ? pass({ actualMs: state.settleMs }) : fail(`Transition did not settle within ${assertion.maximumMs}ms.`);
  }
  if (assertion.kind === "scroll-produces-distinct-phases") {
    const signatures = new Set(state.scrollFrames.map((frame) => JSON.stringify({ phase: frame.phase, entryProgress: frame.entryProgress, scrollProgress: frame.scrollProgress, visual: frame.visual })));
    return signatures.size >= assertion.minimumPhaseCount ? pass({ actualPhaseCount: signatures.size }) : fail(`Expected ${assertion.minimumPhaseCount} scroll phases; found ${signatures.size}.`);
  }
  if (assertion.kind === "visual-pins-during-scroll") {
    return state.scrollFrames.some((frame) => frame.visual?.position === "sticky" || frame.visual?.position === "fixed") ? pass() : fail("No sticky/fixed data-rp-visual phase was observed.");
  }
  if (assertion.kind === "scroll-visual-expansion") {
    const widths = state.scrollFrames.map((frame) => frame.visual?.width || 0).filter((width) => width > 0);
    const widthRatio = widths.length ? Math.max(...widths) / Math.min(...widths) : 0;
    const curtainTotals = state.scrollFrames.map((frame) => (frame.curtainWidths || []).reduce((total, width) => total + width, 0));
    const curtainRatio = curtainTotals.length && widths.length
      ? 1 + (Math.max(...curtainTotals) - Math.min(...curtainTotals)) / Math.max(...widths)
      : 1;
    const ratio = Math.max(widthRatio, curtainRatio);
    return ratio >= assertion.minimumRatio ? pass({ actualRatio: round(ratio) }) : fail(`Expected scroll visual expansion ratio >= ${assertion.minimumRatio}; got ${round(ratio)}.`);
  }
  if (assertion.kind === "scroll-content-scale-bound") {
    const widths = state.scrollFrames.map((frame) => frame.content?.width || 0).filter((width) => width > 0);
    const heights = state.scrollFrames.map((frame) => frame.content?.height || 0).filter((height) => height > 0);
    const ratio = Math.max(
      widths.length ? Math.max(...widths) / Math.min(...widths) : 1,
      heights.length ? Math.max(...heights) / Math.min(...heights) : 1,
    );
    return ratio <= assertion.maximumRatio ? pass({ actualRatio: round(ratio) }) : fail(`Expected content scale ratio <= ${assertion.maximumRatio}; got ${round(ratio)}.`);
  }
  if (assertion.kind === "exclusive-media-layer") {
    const fallback = canonicalUrl(assertion.fallbackSource);
    const overlaps = state.after.overlappingFallbackSources.filter((source) => canonicalUrl(source) === fallback);
    return overlaps.length === 0
      ? pass()
      : fail(`Fallback layer overlaps active media: ${overlaps.join(", ")}.`);
  }
  if (assertion.kind === "hover-changes-visual-state") {
    if (state.hoverError) return fail(state.hoverError);
    return JSON.stringify(state.hoverBefore || []) !== JSON.stringify(state.hoverAfter || [])
      ? pass()
      : fail("Hover did not change any marked control's visual state.");
  }
  if (assertion.kind === "media-source-present") {
    const canonical = canonicalUrl(assertion.source);
    const matched = state.after.media.find((item) => canonicalUrl(item.src) === canonical || item.src.includes(assertion.source));
    if (!matched) return fail(`Missing required media source ${assertion.source}.`);
    const mismatches = Object.entries(assertion.playback || {}).filter(([key, value]) => typeof value === "boolean" && Boolean(matched[key]) !== value);
    return mismatches.length
      ? fail(`Media playback flags differ: ${mismatches.map(([key, value]) => `${key}=${value}`).join(", ")}.`)
      : pass({ source: matched.src });
  }
  return fail(`Unsupported interaction assertion: ${assertion.kind}`);
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function escapeAttribute(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
