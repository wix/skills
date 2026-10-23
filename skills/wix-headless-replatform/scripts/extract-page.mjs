#!/usr/bin/env node
import path from "node:path";
import {
  DEFAULT_VIEWPORTS,
  classifyUrl,
  docsDir,
  ensureDir,
  extractLinks,
  fetchText,
  normalizeUrl,
  parseArgs,
  resolveOutputDir,
  slugForUrl,
  writeJson,
} from "./lib/common.mjs";
import { loadPlaywrightFromContext, resolveBrowserToolingContext } from "./lib/browser-tooling.mjs";
import { extractSeo, extractSectionsFromHtml, inferTokensFromHtml } from "./lib/html-extract.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const page = await extractPage(url, { outputDir, screenshots: args.screenshots !== "false" });
  const pageDir = path.join(docsDir(outputDir), "pages");
  await writeJson(path.join(pageDir, `${slugForUrl(url)}.json`), page);
  if (args.json) process.stdout.write(`${JSON.stringify(page, null, 2)}\n`);
}

export async function extractPage(url, options = {}) {
  try {
    return await extractWithPlaywright(url, options);
  } catch (error) {
    throw new Error(
      `Browser extraction failed for ${url}. The site clone skill now requires Playwright-based extraction instead of HTML fallback because shared chrome, first-viewport evidence, and repeater detection depend on a real browser. Details: ${error.message}`,
    );
  }
}

async function extractWithPlaywright(url, { outputDir, screenshots = true, browserTooling, screenshotDir: suppliedScreenshotDir, screenshotPrefix = "source" } = {}) {
  const toolingContext = browserTooling || await resolveBrowserToolingContext({ startDir: process.cwd() });
  const playwright = await loadPlaywrightFromContext(toolingContext);
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const screenshotMap = {};
  try {
    const htmlByViewport = {};
    const navigationProfiles = [];
    const responsiveTextGeometry = {};
    for (const viewport of DEFAULT_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const navigation = await navigateWithAdaptiveProfile(page, url);
      navigationProfiles.push({ viewport: viewport.name, ...navigation });
      responsiveTextGeometry[viewport.name] = await captureImportantTextGeometry(page);
      if (screenshots && outputDir) {
        const screenshotDir = suppliedScreenshotDir || path.join(docsDir(outputDir), "screenshots");
        await ensureDir(screenshotDir);
        const screenshotPath = path.join(screenshotDir, `${screenshotPrefix}-${slugForUrl(url)}-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotMap[viewport.name] = screenshotPath;
      }
      htmlByViewport[viewport.name] = await page.content();
    }
    const html = htmlByViewport.desktop || Object.values(htmlByViewport)[0];
    const seo = extractSeo(html, url);
    const desktopViewport = DEFAULT_VIEWPORTS.find((viewport) => viewport.name === "desktop") || DEFAULT_VIEWPORTS[0];
    await page.setViewportSize({ width: desktopViewport.width, height: desktopViewport.height });
    const desktopNavigation = await navigateWithAdaptiveProfile(page, url);
    const repeaterPlan = await detectRepeaterSignals(page);
    const browserData = await page.evaluate(async (repeaterPlan) => {
      const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const nonContentSelector = "script,style,noscript,template";
      const semanticText = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE || node.matches(nonContentSelector)) return "";
        const clone = node.cloneNode(true);
        clone.querySelectorAll(nonContentSelector).forEach((child) => child.remove());
        return cleanText(clone.textContent);
      };
      const renderedText = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE || node.matches(nonContentSelector)) return "";
        const excludedSelector = `${nonContentSelector},[hidden],[inert],[aria-hidden='true' i]`;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const values = [];
        for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
          if (!cleanText(textNode.nodeValue)) continue;
          const parent = textNode.parentElement;
          if (!parent || parent.closest(excludedSelector)) continue;
          let current = parent;
          let excluded = false;
          while (current) {
            const styles = getComputedStyle(current);
            if (styles.display === "none" || styles.visibility === "hidden" || Number(styles.opacity || 1) <= 0) {
              excluded = true;
              break;
            }
            if (current === node) break;
            current = current.parentElement;
          }
          if (!excluded) values.push(textNode.nodeValue);
        }
        return cleanText(values.join(" "));
      };
      const rectFor = (node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
      };
      const isRawVisible = (node) => {
        const rect = node.getBoundingClientRect();
        const styles = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && styles.display !== "none" && styles.visibility !== "hidden" && Number(styles.opacity || 1) > 0;
      };
      const visibleCodeTexts = (node) => Array.from(node?.querySelectorAll?.("pre,code") || [])
        .filter((candidate) => isRawVisible(candidate))
        .map((candidate) => renderedText(candidate))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 12);
      const consentSelectors = [
        "#onetrust-banner-sdk",
        "#onetrust-consent-sdk",
        "[class*='onetrust' i]",
        "[id*='cookie-banner' i]",
        "[class*='cookie-banner' i]",
        "[id*='consent-banner' i]",
        "[class*='consent-banner' i]",
        "[role='dialog']",
      ].join(",");
      const consentCandidates = Array.from(document.querySelectorAll(consentSelectors)).filter(isRawVisible).filter((node) => {
        const text = renderedText(node).toLowerCase();
        const identity = `${node.id || ""} ${node.className || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
        const controls = Array.from(node.querySelectorAll("button,a,[role='button']")).map((control) => renderedText(control)).join(" ").toLowerCase();
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const consentSignal = /cookie|consent|privacy preferences|tracking preferences/.test(`${identity} ${text}`);
        const actionSignal = /accept|reject|decline|customi[sz]e|preferences|allow all/.test(controls);
        const overlaySignal = style.position === "fixed" || style.position === "sticky" || node.getAttribute("role") === "dialog" || rect.width >= window.innerWidth * 0.55;
        return /onetrust|cookiebot|quantcast/.test(identity) || consentSignal && actionSignal && overlaySignal;
      });
      const consentRoots = consentCandidates.filter((node, index, all) => !all.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(node)));
      const ignoredSurfaces = consentRoots.map((node, index) => {
        node.setAttribute("data-rp-ignored-surface", "consent-management");
        const rect = node.getBoundingClientRect();
        const identity = `${node.id || ""} ${node.className || ""}`.toLowerCase();
        return {
          id: `ignored-surface-${String(index + 1).padStart(3, "0")}`,
          kind: "consent-management",
          provider: /onetrust|ot-sdk/.test(identity) ? "onetrust" : /cookiebot/.test(identity) ? "cookiebot" : /quantcast/.test(identity) ? "quantcast" : "unknown",
          creationPolicy: "ignore",
          reason: "Destination consent must be implemented as functional infrastructure, not cloned page content.",
          textFingerprint: renderedText(node).slice(0, 240),
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
          domRef: {
            tag: node.tagName.toLowerCase(),
            id: node.id || "",
            classTokens: String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 10),
          },
        };
      });
      const isVisible = (node) => {
        if (!(node instanceof Element) || node.closest("[data-rp-ignored-surface]")) return false;
        return isRawVisible(node);
      };
      const headerSelectors = "header,[role='banner'],#header,.header,.site-header,.main-header,.masthead,.sticky-header";
      const navSelectors = "nav,[role='navigation'],.menu,.nav,.navbar,.navigation";
      const visualAssetSelectors = "img,svg";

      function pickHeader() {
        const candidates = Array.from(document.querySelectorAll(headerSelectors))
          .filter(isVisible)
          .map((node) => ({ node, rect: node.getBoundingClientRect(), styles: getComputedStyle(node) }))
          .filter(({ rect }) => rect.bottom > -8 && rect.top < Math.max(window.innerHeight * 0.55, 260));
        candidates.sort((a, b) => {
          const aTop = Math.abs(a.rect.top);
          const bTop = Math.abs(b.rect.top);
          if (aTop !== bTop) return aTop - bTop;
          return b.rect.height - a.rect.height;
        });
        return candidates[0] || null;
      }

      function visualAssetRecord(node, context = "page") {
        if (!(node instanceof Element)) return null;
        const rect = node.getBoundingClientRect();
        const styles = getComputedStyle(node);
        const tag = node.tagName.toLowerCase();
        const use = tag === "svg" ? node.querySelector("use") : null;
        const useHref = use?.getAttribute("href") || use?.getAttribute("xlink:href") || "";
        const sourceUrl = tag === "img" ? (node.currentSrc || node.src || "") : useHref;
        const accessibleName = cleanText(node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("alt") || node.closest("a,button")?.getAttribute("aria-label") || "");
        const identity = `${node.id || ""} ${node.className?.baseVal || node.className || ""} ${sourceUrl} ${accessibleName}`.toLowerCase();
        if (/cookielaw|onetrust|ot-sdk|cookiebot|quantcast/.test(identity)) return null;
        const owner = node.closest("header,footer,button,a,[role='button']");
        const ownerIdentity = `${owner?.className || ""} ${owner?.id || ""} ${owner?.getAttribute?.("aria-label") || ""} ${owner ? semanticText(owner) : ""}`.toLowerCase();
        const homeLink = node.closest("a")?.href && new URL(node.closest("a").href, location.href).pathname.replace(/\/+$/, "") === "";
        const social = /linkedin|instagram|facebook|twitter|youtube|tiktok|x\.com|social/.test(`${identity} ${ownerIdentity}`);
        const looksLikeLogo = /logo|wordmark|brandmark|brand-mark/.test(identity)
          || (!social && homeLink && (rect.width >= 72 || Number(node.getAttribute("width")) >= 72))
          || (!social && rect.width >= 120 && rect.width >= rect.height * 1.8 && /header|footer/.test(context));
        const kind = looksLikeLogo ? "logo" : "icon";
        const fragmentId = useHref.startsWith("#") ? useHref.slice(1) : "";
        const symbol = fragmentId ? document.getElementById(fragmentId) : null;
        const variantText = `${identity} ${context}`;
        const variant = /footer/.test(variantText) ? "footer"
          : /solid/.test(variantText) ? "solid"
            : /dark|black/.test(variantText) ? "dark"
              : /light|white/.test(variantText) ? "light"
                : /mobile|menu|drawer/.test(variantText) ? "menu"
                  : "default";
        return {
          kind,
          context,
          variant,
          sourceType: tag === "img" ? (/\.svg(?:$|[?#])/i.test(sourceUrl) ? "external-svg" : "image") : useHref ? "svg-sprite-use" : "inline-svg",
          sourceUrl,
          useHref,
          accessibleName,
          visible: isRawVisible(node),
          renderedSize: { width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 },
          intrinsicSize: {
            width: node.getAttribute("width") || "",
            height: node.getAttribute("height") || "",
            viewBox: node.getAttribute("viewBox") || symbol?.getAttribute?.("viewBox") || "",
          },
          presentation: {
            color: styles.color,
            fill: styles.fill,
            stroke: styles.stroke,
          },
          svgMarkup: tag === "svg" ? node.outerHTML.slice(0, 24000) : "",
          symbolMarkup: symbol?.outerHTML?.slice(0, 24000) || "",
          domRef: {
            tag,
            id: node.id || "",
            classTokens: String(node.className?.baseVal || node.className || "").split(/\s+/).filter(Boolean).slice(0, 10),
          },
        };
      }

      function collectVisualAssets() {
        const records = [];
        const seen = new Set();
        const scopes = [
          ...Array.from(document.querySelectorAll("header,[role='banner']")).map((scope) => ({ scope, context: "header" })),
          ...Array.from(document.querySelectorAll("footer,[role='contentinfo']")).map((scope) => ({ scope, context: "footer" })),
          ...Array.from(document.querySelectorAll("button,[role='button'],a[href]")).map((scope) => ({ scope, context: scope.closest("footer") ? "footer-control" : scope.closest("header") ? "header-control" : "control" })),
        ];
        for (const { scope, context } of scopes) {
          const nodes = scope.matches?.(visualAssetSelectors) ? [scope] : Array.from(scope.querySelectorAll(visualAssetSelectors));
          for (const node of nodes) {
            if (node.closest("[data-rp-ignored-surface]")) continue;
            const record = visualAssetRecord(node, context);
            if (!record) continue;
            if (record.kind === "icon" && !record.visible && !record.useHref && !record.sourceUrl) continue;
            const key = `${record.kind}\u0000${record.sourceType}\u0000${record.sourceUrl}\u0000${record.domRef.id}\u0000${record.domRef.classTokens.join(".")}\u0000${context}`;
            if (seen.has(key)) continue;
            seen.add(key);
            records.push(record);
            if (records.length >= 120) return records;
          }
        }
        return records;
      }

      function headerVariant(name) {
        const candidate = pickHeader();
        if (!candidate) return { name, position: "unknown", height: 0, visibleAtScrollY: window.scrollY, visible: false };
        const { node, rect, styles } = candidate;
        const logo = Array.from(node.querySelectorAll(visualAssetSelectors))
          .map((asset) => ({ asset, record: visualAssetRecord(asset, `header-${name}`) }))
          .find(({ record }) => record?.kind === "logo") || null;
        const logoNode = logo?.asset || null;
        const logoRect = logoNode?.getBoundingClientRect();
        return {
          name,
          position: styles.position || "static",
          height: Math.round(rect.height),
          visibleAtScrollY: Math.round(window.scrollY),
          visible: true,
          rect: rectFor(node),
          logo: logoNode && logoRect ? {
            ...logo.record,
            sourceUrl: logo.record.sourceUrl,
            alt: logoNode.getAttribute("alt") || logo.record.accessibleName || "",
            renderedWidth: Math.round(logoRect.width),
            renderedHeight: Math.round(logoRect.height),
          } : null,
        };
      }

      function linkRecord(anchor) {
        return {
          label: semanticText(anchor).slice(0, 120),
          href: anchor.href || anchor.getAttribute("href") || "",
        };
      }

      function isSameOriginHref(href) {
        try {
          return new URL(href, window.location.href).origin === window.location.origin;
        } catch {
          return false;
        }
      }

      function navScore(scope, headerNode) {
        const anchors = Array.from(scope.querySelectorAll("a[href]")).filter(isVisible);
        if (!anchors.length) return Number.NEGATIVE_INFINITY;
        const records = anchors.map(linkRecord);
        const sameOriginCount = records.filter((item) => isSameOriginHref(item.href)).length;
        const nonEmptyLabelCount = records.filter((item) => item.label).length;
        const longLabelCount = records.filter((item) => item.label.length >= 2).length;
        const externalCount = records.length - sameOriginCount;
        const socialCount = anchors.filter((anchor) => {
          const text = semanticText(anchor).toLowerCase();
          const classText = `${anchor.className || ""} ${anchor.parentElement?.className || ""}`.toLowerCase();
          const href = String(anchor.href || "").toLowerCase();
          return /facebook|instagram|pinterest|youtube|tiktok|whatsapp|social|icon-/.test(`${text} ${classText} ${href}`);
        }).length;
        const topLevelListItems = Array.from(scope.querySelectorAll(":scope > ul > li, :scope > ol > li, :scope > li"))
          .filter(isVisible);
        const nestedListItems = Array.from(scope.querySelectorAll("li li")).filter(isVisible);
        const uniqueHrefs = new Set(records.map((item) => item.href)).size;
        const inHeader = Boolean(headerNode && headerNode.contains(scope));
        const ariaLabel = cleanText(scope.getAttribute("aria-label") || "").toLowerCase();
        const classText = `${scope.className || ""} ${scope.id || ""}`.toLowerCase();
        const textSample = semanticText(scope).toLowerCase();

        let score = 0;
        score += sameOriginCount * 10;
        score += nonEmptyLabelCount * 6;
        score += longLabelCount * 3;
        score += Math.min(topLevelListItems.length, 12) * 8;
        score += Math.min(nestedListItems.length, 24) * 3;
        score += Math.min(uniqueHrefs, 20) * 2;
        if (inHeader) score += 30;
        if (/main|primary|menu|navigation/.test(`${ariaLabel} ${classText}`)) score += 20;
        if (/social/.test(`${ariaLabel} ${classText}`)) score -= 40;
        if (sameOriginCount <= 1 && externalCount > 0) score -= 35;
        score -= externalCount * 6;
        score -= socialCount * 25;
        if (records.length <= 2 && sameOriginCount === 0) score -= 50;
        if (!topLevelListItems.length && records.length <= 3) score -= 15;
        if (/facebook|instagram/.test(textSample) && sameOriginCount === 0) score -= 50;
        return score;
      }

      function navigationItems() {
        const scopes = Array.from(document.querySelectorAll(`header ${navSelectors}, ${navSelectors}`)).filter(isVisible);
        const headerNode = pickHeader()?.node || null;
        const scoredScopes = scopes
          .map((scope) => ({ scope, score: navScore(scope, headerNode) }))
          .sort((a, b) => b.score - a.score);
        const scope = scoredScopes[0]?.scope;
        if (!scope) return [];
        const listItems = Array.from(scope.querySelectorAll("li")).filter((item) => {
          const parentLi = item.parentElement?.closest("li");
          return !parentLi || !scope.contains(parentLi);
        });
        const items = listItems.length ? listItems.map((item) => {
          const anchor = Array.from(item.children).find((child) => child.matches?.("a[href]")) || item.querySelector("a[href]");
          if (!anchor) return null;
          const children = Array.from(item.querySelectorAll("li a[href]"))
            .filter((childAnchor) => childAnchor !== anchor)
            .map(linkRecord)
            .filter((child) => child.label || child.href);
          return { ...linkRecord(anchor), children: dedupeNav(children).slice(0, 24) };
        }) : Array.from(scope.querySelectorAll("a[href]")).map((anchor) => ({ ...linkRecord(anchor), children: [] }));
        return dedupeNav(items.filter((item) => item && (item.label || item.href))).slice(0, 40);
      }

      function dedupeNav(items) {
        const seen = new Set();
        return items.filter((item) => {
          const key = `${item.label}\u0000${item.href}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function firstViewportText() {
        const nodes = Array.from(document.querySelectorAll("main *:not(script):not(style), body > *:not(header):not(nav):not(footer):not(script):not(style)"));
        const texts = [];
        const seen = new Set();
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          if (node.closest("header,nav,footer")) continue;
          const rect = node.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
          if (Array.from(node.children).some((child) => renderedText(child) === renderedText(node))) continue;
          const text = renderedText(node);
          if (!text || text.length < 2 || seen.has(text)) continue;
          seen.add(text);
          texts.push(text.slice(0, 180));
          if (texts.length >= 80) break;
        }
        return texts;
      }

      const initialHeader = headerVariant("initial");
      const navigation = navigationItems();
      const visibleText = firstViewportText();
      const scrollTarget = Math.max(260, Math.min(document.documentElement.scrollHeight - window.innerHeight, window.innerHeight * 0.75));
      window.scrollTo(0, scrollTarget);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const scrolledHeader = headerVariant("scrolled");
      window.scrollTo(0, 0);

      function domPath(node, stopNode) {
        if (!node) return "";
        const parts = [];
        let current = node;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== stopNode && parts.length < 8) {
          const tag = current.tagName.toLowerCase();
          const id = current.id ? `#${current.id}` : "";
          const classTokens = String(current.className || "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((token) => `.${token}`)
            .join("");
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
            : [];
          const nthOfType = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
          parts.unshift(`${tag}${id}${classTokens}${id ? "" : nthOfType}`);
          current = current.parentElement;
        }
        return parts.join(" > ");
      }

      function visibleChildren(node) {
        return Array.from(node?.children || []).filter((child) => isVisible(child));
      }

      function visibleHeadingText(node) {
        return Array.from(node.querySelectorAll("h1,h2,h3,h4"))
          .filter(isVisible)
          .map((heading) => renderedText(heading))
          .find(Boolean) || "";
      }

      function visibleHeadings(node) {
        return Array.from(node.querySelectorAll("h1,h2,h3,h4"))
          .filter(isVisible)
          .map((heading) => ({
            level: Number(heading.tagName.replace(/^H/i, "")) || null,
            text: renderedText(heading),
          }))
          .filter((heading) => heading.text);
      }

      function isTransparentColor(value) {
        const normalized = String(value || "").replace(/\s+/g, "").toLowerCase();
        return !normalized || normalized === "transparent" || normalized === "rgba(0,0,0,0)";
      }

      function backgroundInfo(node) {
        const styles = getComputedStyle(node);
        return {
          color: styles.backgroundColor,
          image: styles.backgroundImage && styles.backgroundImage !== "none" ? styles.backgroundImage : "",
        };
      }

      function roundedBox(rect) {
        return {
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }

      function normalizedBox(rect, sectionRect) {
        return {
          x: Number(((rect.left - sectionRect.left) / Math.max(sectionRect.width, 1)).toFixed(3)),
          y: Number(((rect.top - sectionRect.top) / Math.max(sectionRect.height, 1)).toFixed(3)),
          width: Number((rect.width / Math.max(sectionRect.width, 1)).toFixed(3)),
          height: Number((rect.height / Math.max(sectionRect.height, 1)).toFixed(3)),
        };
      }

      function textGeometry(node, rect) {
        const styles = getComputedStyle(node);
        const lineTops = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
          acceptNode(textNode) {
            return cleanText(textNode.nodeValue).length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          for (const lineRect of range.getClientRects()) {
            if (lineRect.width > 0 && lineRect.height > 0 && !lineTops.some((top) => Math.abs(top - lineRect.top) <= 2)) lineTops.push(lineRect.top);
          }
        }
        const lineCount = Math.max(1, lineTops.length);
        const maxWidth = styles.maxWidth;
        return {
          inlineSize: Math.round(rect.width * 100) / 100,
          blockSize: Math.round(rect.height * 100) / 100,
          lineCount,
          wrapPolicy: lineCount === 1 ? "single-line" : styles.whiteSpace === "nowrap" ? "clipped-or-overflowing" : "wrapped",
          whiteSpace: styles.whiteSpace,
          maxWidth,
          minWidth: styles.minWidth,
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          letterSpacing: styles.letterSpacing,
        };
      }

      function layoutRole(node) {
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute("role") || "";
        const classText = `${node.className || ""} ${node.id || ""}`.toLowerCase();
        const peerControls = Array.from(node.parentElement?.children || []).filter((candidate) => {
          const candidateTag = candidate.tagName?.toLowerCase?.();
          return candidateTag === "button" || candidate.getAttribute?.("role") === "tab";
        });
        const childControls = Array.from(node.children || []).filter((candidate) => {
          const candidateTag = candidate.tagName?.toLowerCase?.();
          return candidateTag === "button" || candidate.getAttribute?.("role") === "tab";
        });
        if (role === "tablist" || /\btabs?\b|tab-list|tablist/.test(classText) || childControls.length >= 3) return "tabs";
        if (role === "tab" || /tab__btn|tab-button/.test(classText) || (tag === "button" && peerControls.length >= 3)) return "tab";
        if (/^h[1-6]$/.test(tag)) return "heading";
        if (tag === "p" || tag === "blockquote") return "body-copy";
        if (tag === "video" || tag === "iframe" || tag === "picture" || tag === "img") return "media";
        if (tag === "button" || role === "button" || (tag === "a" && /button|cta|contact|learn|read|discover|explore/.test(classText))) return "action";
        if (tag === "nav" || role === "navigation") return "navigation";
        return "content";
      }

      const STYLEABLE_CATEGORY_PROPERTIES = {
        text: ["color", "font-family", "font-size", "font-style", "font-weight", "letter-spacing", "line-height", "text-align", "text-decoration", "text-transform", "white-space"],
        action: ["color", "background-color", "border-color", "border-radius", "border-style", "border-width", "box-shadow", "cursor", "min-height", "padding", "transition"],
        media: ["aspect-ratio", "border-radius", "height", "object-fit", "object-position", "opacity", "width"],
        container: ["align-items", "background-color", "background-image", "border-color", "border-radius", "box-shadow", "display", "gap", "grid-template-columns", "justify-content", "overflow", "padding", "position", "z-index"],
      };

      function styleableCategories(role) {
        if (["heading", "body-copy", "tab"].includes(role)) return role === "tab" ? ["text", "action"] : ["text"];
        if (role === "action") return ["text", "action"];
        if (["media", "background-media"].includes(role)) return ["media"];
        return ["container"];
      }

      function computedPropertyUnion(styles, categories) {
        const properties = [...new Set(categories.flatMap((category) => STYLEABLE_CATEGORY_PROPERTIES[category] || []))].sort();
        return Object.fromEntries(properties.map((property) => [property, styles.getPropertyValue(property)]));
      }

      function authoredCssContext(node, categories) {
        const allowed = new Set(categories.flatMap((category) => STYLEABLE_CATEGORY_PROPERTIES[category] || []));
        const matches = [];
        for (const sheet of Array.from(document.styleSheets).slice(0, 80)) {
          let rules;
          try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
          for (const rule of rules.slice(0, 800)) {
            if (!rule.selectorText || !rule.style) continue;
            let matched = false;
            try { matched = node.matches(rule.selectorText); } catch { continue; }
            if (!matched) continue;
            const declarations = {};
            for (const property of Array.from(rule.style)) if (allowed.has(property)) declarations[property] = rule.style.getPropertyValue(property);
            if (Object.keys(declarations).length) matches.push({ selector: rule.selectorText, href: sheet.href || "inline", declarations });
            if (matches.length >= 20) return matches;
          }
        }
        return matches;
      }

      function collectLayoutEvidence(sectionRoot) {
        const sectionRect = sectionRoot.getBoundingClientRect();
        const sectionStyles = getComputedStyle(sectionRoot);
        const selector = [
          "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote",
          "a[href]", "button", "[role='button']", "[role='tablist']", "[role='tab']",
          "nav", "[class*='tabs' i]", "[class*='tab-list' i]",
          "video", "iframe", "picture", "img",
        ].join(",");
        const semanticCandidates = Array.from(sectionRoot.querySelectorAll(selector));
        const repeatedControlGroups = [...new Set(Array.from(sectionRoot.querySelectorAll("button, [role='tab']"))
          .map((control) => control.parentElement)
          .filter(Boolean)
          .filter((parent) => Array.from(parent.children).filter((child) => child.tagName?.toLowerCase?.() === "button" || child.getAttribute?.("role") === "tab").length >= 3))];
        const regionCandidates = [...new Set([...semanticCandidates, ...repeatedControlGroups])]
          .filter(isVisible)
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 12) return false;
            if (["p", "blockquote"].includes(node.tagName.toLowerCase()) && renderedText(node).length < 16) return false;
            return true;
          });
        const regions = [];
        for (const node of regionCandidates) {
          const role = layoutRole(node);
          if (role === "tab" && regionCandidates.some((candidate) => candidate !== node && layoutRole(candidate) === "tabs" && candidate.contains(node))) continue;
          let rect = node.getBoundingClientRect();
          if (role === "tabs") {
            const tabRects = Array.from(node.querySelectorAll("[role='tab'], button, a"))
              .filter(isVisible)
              .filter((candidate) => layoutRole(candidate) === "tab")
              .map((candidate) => candidate.getBoundingClientRect());
            if (tabRects.length >= 2) {
              const left = Math.min(...tabRects.map((candidate) => candidate.left));
              const top = Math.min(...tabRects.map((candidate) => candidate.top));
              const right = Math.max(...tabRects.map((candidate) => candidate.right));
              const bottom = Math.max(...tabRects.map((candidate) => candidate.bottom));
              rect = { left, top, right, bottom, width: right - left, height: bottom - top };
            }
          }
          const styles = getComputedStyle(node);
          const categories = styleableCategories(role);
          regions.push({
            role,
            text: ["heading", "body-copy", "action", "tab", "tabs"].includes(role) ? renderedText(node).slice(0, 180) : "",
            rect: roundedBox(rect),
            normalizedRect: normalizedBox(rect, sectionRect),
            position: styles.position,
            display: styles.display,
            textAlign: styles.textAlign,
            zIndex: styles.zIndex,
            styleableCategories: categories,
            computedStyle: computedPropertyUnion(styles, categories),
            authoredCss: authoredCssContext(node, categories),
            ...(["heading", "body-copy", "action", "tab", "tabs"].includes(role) ? { textGeometry: textGeometry(node, rect) } : {}),
            domRef: {
              tag: node.tagName.toLowerCase(),
              id: node.id || "",
              classTokens: String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 6),
            },
          });
          if (regions.length >= 36) break;
        }

        const layerCandidates = Array.from(sectionRoot.querySelectorAll("video, iframe, picture, img, [class*='background' i], [class*='overlay' i], [class*='curtain' i], [class*='mask' i], [class*='panel' i], [class*='frame' i], [class*='border' i]"))
          .filter(isVisible)
          .map((node) => ({ node, rect: node.getBoundingClientRect(), styles: getComputedStyle(node) }))
          .filter(({ rect, styles }) => {
            const areaRatio = (rect.width * rect.height) / Math.max(sectionRect.width * Math.min(sectionRect.height, window.innerHeight), 1);
            return areaRatio >= 0.18 || ["absolute", "fixed", "sticky"].includes(styles.position);
          })
          .slice(0, 20)
          .map(({ node, rect, styles }) => {
            const classText = String(node.className || "").toLowerCase();
            const kind = ["video", "iframe"].includes(node.tagName.toLowerCase()) ? "video" : ["picture", "img"].includes(node.tagName.toLowerCase()) ? "image" : "decorative-layer";
            const role = /partial.*border|border.*frame|\bframe\b/.test(classText) ? "partial-border-frame"
              : /copy.*panel|content.*panel/.test(classText) ? "copy-panel"
                : /overlay|curtain|mask|scrim/.test(classText) ? "overlay"
                  : /background|\bbg\b/.test(classText) ? "background"
                    : kind === "image" || kind === "video" ? "media" : "decoration";
            return {
            kind,
            role,
            rect: roundedBox(rect),
            normalizedRect: normalizedBox(rect, sectionRect),
            position: styles.position,
            zIndex: styles.zIndex,
            opacity: styles.opacity,
            objectFit: styles.objectFit,
            overflow: styles.overflow,
            background: backgroundInfo(node),
            src: node.currentSrc || node.src || "",
            classTokens: String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 8),
          };
          });

        const pseudoLayers = ["::before", "::after"].map((pseudo) => {
          const styles = getComputedStyle(sectionRoot, pseudo);
          if (!styles || styles.content === "none" || (isTransparentColor(styles.backgroundColor) && (!styles.backgroundImage || styles.backgroundImage === "none"))) return null;
          return {
            kind: "pseudo-layer",
            pseudo,
            position: styles.position,
            zIndex: styles.zIndex,
            opacity: styles.opacity,
            background: {
              color: styles.backgroundColor,
              image: styles.backgroundImage && styles.backgroundImage !== "none" ? styles.backgroundImage : "",
            },
          };
        }).filter(Boolean);

        return {
          vocabularyVersion: 1,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          canvas: {
            display: sectionStyles.display,
            position: sectionStyles.position,
            overflowX: sectionStyles.overflowX,
            overflowY: sectionStyles.overflowY,
            minHeight: sectionStyles.minHeight,
            background: backgroundInfo(sectionRoot),
          },
          regions,
          layers: [...layerCandidates, ...pseudoLayers],
        };
      }

      function nodeFingerprint(node) {
        const heading = visibleHeadingText(node);
        const textPrefix = renderedText(node).slice(0, 160);
        return {
          heading,
          textPrefix,
          imageCount: node.querySelectorAll("img").length,
          linkCount: node.querySelectorAll("a[href]").length,
        };
      }

      function findContentRoot() {
        const candidateDefs = [
          { selector: "main", label: "main" },
          { selector: "[role='main']", label: "role-main" },
          { selector: "article", label: "article" },
          { selector: "#primary", label: "primary-id" },
          { selector: ".content-area", label: "content-area" },
          { selector: ".site-main", label: "site-main" },
          { selector: "body", label: "body" },
        ];
        const candidates = [];
        for (const def of candidateDefs) {
          for (const node of Array.from(document.querySelectorAll(def.selector)).filter(isVisible).slice(0, 3)) {
            const rect = node.getBoundingClientRect();
            const headingCount = node.querySelectorAll("h1,h2,h3,h4").length;
            const imageCount = node.querySelectorAll("img").length;
            const linkCount = node.querySelectorAll("a[href]").length;
            let score = 0;
            score += 40;
            score += Math.min(rect.width / Math.max(window.innerWidth, 1), 1.2) * 35;
            score += Math.min(rect.height / Math.max(window.innerHeight, 1), 4) * 10;
            score += Math.min(headingCount, 8) * 4;
            score += Math.min(imageCount, 20) * 1.5;
            if (linkCount > 3) score += 5;
            if (def.label === "main") score += 20;
            else if (def.label === "role-main") score += 18;
            else if (def.label === "article") score += 10;
            else if (def.label === "body") score -= 30;
            if (rect.height > document.documentElement.scrollHeight * 0.9) score -= 25;
            candidates.push({ node, label: def.label, score });
          }
        }
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] || { node: document.body, label: "body", score: 0 };
      }

      function collectModuleStats(node, root) {
        const rect = node.getBoundingClientRect();
        const children = visibleChildren(node);
        const headings = visibleHeadings(node);
        const images = Array.from(node.querySelectorAll("img")).filter((img) => isVisible(img));
        const links = Array.from(node.querySelectorAll("a[href]")).filter((link) => isVisible(link));
        const buttons = Array.from(node.querySelectorAll("button")).filter((button) => isVisible(button));
        const paragraphs = Array.from(node.querySelectorAll("p, li, blockquote, figcaption")).filter((item) => isVisible(item));
        const childRects = children.map((child) => child.getBoundingClientRect());
        const rowCountEstimate = new Set(childRects.map((item) => Math.round(item.top / 24))).size;
        const background = backgroundInfo(node);
        const role = node.getAttribute("role") || "";
        const classText = `${node.className || ""} ${node.id || ""}`.toLowerCase();
        const ancestorText = [];
        let ancestor = node.parentElement;
        for (let depth = 0; ancestor && depth < 4; depth += 1) {
          ancestorText.push(`${ancestor.className || ""} ${ancestor.id || ""}`.toLowerCase());
          if (ancestor === root) break;
          ancestor = ancestor.parentElement;
        }
        const ancestryText = ancestorText.join(" ");
        const reviewPattern = /review|testimonial|verified customer|productreview|based on [\d,.\s]+ reviews|what our customers/i;
        const reviewLike = reviewPattern.test(classText)
          || headings.some((heading) => reviewPattern.test(heading.text))
          || reviewPattern.test(renderedText(node))
          || reviewPattern.test(ancestryText);
        const pricePattern = /\$\s?\d|\bprice\b|original price|current price|sale\b/i;
        const addToCartPattern = /add to cart|quantity|buy now|shop now/i;
        const productLike = pricePattern.test(renderedText(node))
          || addToCartPattern.test(renderedText(node))
          || /product|products|woocommerce|add-to-cart|price|shopify-buy/.test(`${classText} ${ancestryText}`);
        const reviewWidgetLike = /reviewsio|judge\.me|stamped|loox|yotpo|trustpilot|productreview/.test(`${classText} ${ancestryText}`);
        const galleryLike = /gallery|slider|embla|swiper|carousel|featured/.test(classText);
        const logoLikeChildren = images.filter((image) => {
          const imageRect = image.getBoundingClientRect();
          return imageRect.width <= 240 && imageRect.height <= 140;
        }).length;
        return {
          node,
          tag: node.tagName.toLowerCase(),
          role,
          rect,
          heading: headings[0]?.text || "",
          headings,
          text: renderedText(node).slice(0, 1800) || "",
          textLength: renderedText(node).length,
          visibleCodeTexts: visibleCodeTexts(node),
          imageCount: images.length,
          linkCount: links.length,
          buttonCount: buttons.length,
          paragraphCount: paragraphs.length,
          childCount: children.length,
          cardLikeChildren: children.filter((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.width >= 140 && childRect.height >= 90;
          }).length,
          rowCountEstimate,
          background,
          hasBackgroundChange: !isTransparentColor(background.color) || Boolean(background.image),
          reviewLike,
          reviewWidgetLike,
          productLike,
          galleryLike,
          logoLikeChildren,
          path: domPath(node, root?.parentElement || document.body.parentElement),
          parentPath: domPath(node.parentElement, root?.parentElement || document.body.parentElement),
          nthOfType: node.parentElement
            ? Array.from(node.parentElement.children).filter((sibling) => sibling.tagName === node.tagName).indexOf(node) + 1
            : 1,
          fingerprint: nodeFingerprint(node),
        };
      }

      function statsClassText(stats) {
        return `${stats.node?.className || ""} ${stats.node?.id || ""} ${stats.path || ""}`.toLowerCase();
      }

      function sectionCapabilities({ hasCta, hasMedia, repeatingItems = false, isCarouselLike = false }) {
        return { hasCta, hasMedia, repeatingItems, isCarouselLike };
      }

      const SECTION_DETECTORS = [
        {
          kind: "header",
          match: ({ stats, classText, hasCta }) => (stats.tag === "header" || /\bheader\b|masthead|top-bar|site-header/.test(classText))
            ? {
                kind: "header",
                variant: /top-bar/.test(classText) ? "top-bar" : "generic",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1 }),
              }
            : null,
        },
        {
          kind: "footer",
          match: ({ stats, classText, hasCta }) => (stats.tag === "footer" || /\bfooter\b|site-info|copyright|privacy|terms|site-map/.test(classText))
            ? {
                kind: "footer",
                variant: "site-footer",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1 }),
              }
            : null,
        },
        {
          kind: "hero",
          match: ({ stats, classText, hasCta, atTopOfPage, hasStrongHeroMedia }) => (
            hasStrongHeroMedia
            && hasCta
            && stats.rect.height >= Math.max(window.innerHeight * 0.22, 220)
            && (atTopOfPage || /\bhero\b|banner|masthead|billboard|home-section/.test(classText) || stats.headings.some((heading) => heading.level === 1))
          )
            ? {
                kind: "hero",
                variant: stats.galleryLike || stats.cardLikeChildren >= 2 ? "carousel-hero" : "generic-hero",
                capabilities: sectionCapabilities({ hasCta: true, hasMedia: true, repeatingItems: stats.cardLikeChildren >= 2, isCarouselLike: stats.galleryLike }),
              }
            : null,
        },
        {
          kind: "reviews",
          match: ({ stats, hasCta }) => (
            (stats.reviewWidgetLike || stats.reviewLike)
            && !(stats.productLike && !stats.reviewWidgetLike)
            && (stats.cardLikeChildren >= 1 || stats.imageCount >= 2 || stats.textLength >= 80)
          )
            ? {
                kind: "reviews",
                variant: stats.galleryLike || stats.cardLikeChildren >= 2 ? "review-carousel" : "review-list",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1, repeatingItems: true, isCarouselLike: stats.galleryLike }),
              }
            : null,
        },
        {
          kind: "category-strip",
          match: ({ stats }) => (
            stats.imageCount === 0
            && stats.linkCount === 0
            && stats.buttonCount === 0
            && stats.paragraphCount >= 4
            && stats.textLength >= 40
            && stats.textLength <= 280
          )
            ? {
                kind: "category-strip",
                variant: "text-category-grid",
                capabilities: sectionCapabilities({ hasCta: false, hasMedia: false, repeatingItems: true }),
              }
            : null,
        },
        {
          kind: "card-collection",
          match: ({ stats, hasCta }) => (
            (stats.logoLikeChildren >= 4 && stats.imageCount >= 4 && stats.textLength < 420)
            || (stats.galleryLike && stats.imageCount >= 5 && stats.textLength < 180)
          )
            ? {
                kind: "card-collection",
                variant: "logo-gallery",
                capabilities: sectionCapabilities({ hasCta, hasMedia: true, repeatingItems: true, isCarouselLike: stats.galleryLike }),
              }
            : null,
        },
        {
          kind: "card-collection",
          match: ({ stats }) => (stats.productLike && (stats.cardLikeChildren >= 3 || stats.imageCount >= 4) && (stats.buttonCount >= 2 || stats.linkCount >= 6))
            ? {
                kind: "card-collection",
                variant: stats.galleryLike ? "product-carousel" : "product-grid",
                capabilities: sectionCapabilities({ hasCta: true, hasMedia: true, repeatingItems: true, isCarouselLike: stats.galleryLike }),
              }
            : null,
        },
        {
          kind: "card-collection",
          match: ({ stats, hasCta }) => (stats.cardLikeChildren >= 3 && (stats.imageCount >= 3 || stats.linkCount >= 3))
            ? {
                kind: "card-collection",
                variant: stats.galleryLike ? "card-carousel" : "card-grid",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1, repeatingItems: true, isCarouselLike: stats.galleryLike }),
              }
            : null,
        },
        {
          kind: "text-media",
          match: ({ stats, classText, hasCta }) => (stats.imageCount >= 1 && stats.headings.length >= 1 && stats.paragraphCount >= 1)
            ? {
                kind: "text-media",
                variant: /has-media-on-the-right|media-right/.test(classText) ? "media-right" : "media-left",
                capabilities: sectionCapabilities({ hasCta, hasMedia: true }),
              }
            : null,
        },
        {
          kind: "stat-group",
          match: ({ stats }) => (stats.headings.length >= 3 && stats.imageCount === 0 && stats.linkCount === 0 && stats.buttonCount === 0)
            ? {
                kind: "stat-group",
                variant: "step-strip",
                capabilities: sectionCapabilities({ hasCta: false, hasMedia: false, repeatingItems: true }),
              }
            : null,
        },
        {
          kind: "promo-band",
          match: ({ stats, hasCta }) => (
            stats.imageCount <= 1
            && stats.textLength >= 40
            && stats.textLength <= 220
            && stats.paragraphCount <= 2
            && stats.headings.length <= 1
            && (stats.hasBackgroundChange || stats.imageCount >= 1)
          )
            ? {
                kind: "promo-band",
                variant: hasCta ? "value-prop-cta" : "value-prop-band",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1 }),
              }
            : null,
        },
        {
          kind: "cta-strip",
          match: ({ stats, hasCta }) => (
            stats.imageCount === 0
            && hasCta
            && stats.textLength <= 220
            && stats.paragraphCount <= 1
            && stats.headings.length <= 2
          )
            ? {
                kind: "cta-strip",
                variant: "inline-cta-strip",
                capabilities: sectionCapabilities({ hasCta: true, hasMedia: false }),
              }
            : null,
        },
        {
          kind: "cta-strip",
          match: ({ stats, hasCta, atTopOfPage }) => ((stats.buttonCount + stats.linkCount) >= 2 && stats.imageCount >= 1 && stats.rect.height >= 120)
            ? {
                kind: "cta-strip",
                variant: atTopOfPage ? "promo-hero-strip" : "promo-strip",
                capabilities: sectionCapabilities({ hasCta: true, hasMedia: true }),
              }
            : null,
        },
        {
          kind: "cta-strip",
          match: ({ stats, hasCta }) => (stats.headings.length === 1 && stats.imageCount === 0 && stats.paragraphCount === 0)
            ? {
                kind: "cta-strip",
                variant: "centered-heading-strip",
                capabilities: sectionCapabilities({ hasCta, hasMedia: false }),
              }
            : null,
        },
        {
          kind: "rich-text",
          match: ({ stats, hasCta }) => (stats.textLength >= 60 || stats.headings.length || stats.imageCount)
            ? {
                kind: "rich-text",
                variant: "generic",
                capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1 }),
              }
            : null,
        },
      ];

      function classifySection(stats) {
        const classText = statsClassText(stats);
        const atTopOfPage = (stats.rect.top + window.scrollY) < Math.max(window.innerHeight * 0.35, 320);
        const hasCta = (stats.buttonCount + stats.linkCount) >= 1;
        const hasStrongHeroMedia = stats.imageCount >= 1 || stats.hasBackgroundChange;
        for (const detector of SECTION_DETECTORS) {
          const matched = detector.match({ stats, classText, atTopOfPage, hasCta, hasStrongHeroMedia });
          if (matched) return matched;
        }
        return { kind: "unknown", variant: "generic", capabilities: sectionCapabilities({ hasCta, hasMedia: stats.imageCount >= 1 }) };
      }

      function sectionScore(stats, root) {
        let score = 0;
        score += 30;
        score += Math.min(stats.rect.width / Math.max(root.getBoundingClientRect().width, 1), 1.2) * 30;
        score += Math.min(stats.rect.height / Math.max(window.innerHeight, 1), 1.5) * 20;
        score += Math.min(stats.headings.length, 4) * 10;
        score += Math.min(stats.imageCount, 6) * 4;
        score += Math.min(stats.cardLikeChildren, 6) * 5;
        if (stats.hasBackgroundChange) score += 10;
        if (stats.rect.width < root.getBoundingClientRect().width * 0.55) score -= 20;
        if (stats.rect.height < 80) score -= 40;
        if (stats.textLength < 15 && stats.imageCount === 0) score -= 60;
        if (/nav|menu|breadcrumb|popup|modal|drawer|cookie/.test(`${stats.role} ${stats.path}`.toLowerCase())) score -= 35;
        if (stats.tag === "main" || stats.tag === "article") score -= 20;
        if (stats.rect.height > root.getBoundingClientRect().height * 0.8) score -= 50;
        if (stats.childCount === 1 && stats.cardLikeChildren <= 1 && stats.headings.length <= 1 && !stats.hasBackgroundChange) score -= 40;
        if (stats.textLength > 3200 && stats.rect.height > root.getBoundingClientRect().height * 0.55 && !stats.hasBackgroundChange) score -= 45;
        return score;
      }

      function isWrapperLike(stats, root) {
        return (
          stats.childCount <= 2
          && stats.cardLikeChildren <= 1
          && stats.headings.length <= 1
          && !stats.hasBackgroundChange
          && stats.rect.height > Math.max(window.innerHeight * 1.25, root.getBoundingClientRect().height * 0.45)
        );
      }

      function findSegmentationRoot(contentRoot) {
        const warnings = [];
        let current = contentRoot;
        for (let depth = 0; depth < 10; depth += 1) {
          const scopedContentChild = Array.from(current.children || []).find((child) => {
            if (!isVisible(child)) return false;
            const classText = `${child.className || ""} ${child.id || ""}`.toLowerCase();
            return /single-content|entry-content|post-content|article-content|main-content/.test(classText);
          });
          if (scopedContentChild) {
            const childStats = collectModuleStats(scopedContentChild, contentRoot);
            current = scopedContentChild;
            warnings.push(`segmentation-root-descended:${childStats.path}`);
            continue;
          }
          const children = visibleChildren(current).filter((child) => {
            const rect = child.getBoundingClientRect();
            return rect.height >= 24 && (renderedText(child).length >= 20 || child.querySelector("img,svg,a[href],button") || rect.height >= 120);
          });
          if (!children.length) break;
          if (children.length === 1) {
            const childStats = collectModuleStats(children[0], contentRoot);
            if (childStats.rect.width >= current.getBoundingClientRect().width * 0.72) {
              current = children[0];
              warnings.push(`segmentation-root-descended:${childStats.path}`);
              continue;
            }
          }
          const dominant = children.find((child) => {
            const rect = child.getBoundingClientRect();
            return rect.width >= current.getBoundingClientRect().width * 0.72 && rect.height >= current.getBoundingClientRect().height * 0.72;
          });
          if (children.length <= 3 && dominant) {
            const dominantStats = collectModuleStats(dominant, contentRoot);
            if (!dominantStats.hasBackgroundChange && dominantStats.cardLikeChildren <= 1) {
              current = dominant;
              warnings.push(`segmentation-root-descended:${dominantStats.path}`);
              continue;
            }
          }
          const dominantCandidate = children
            .map((child) => ({ child, rect: child.getBoundingClientRect() }))
            .sort((a, b) => b.rect.height - a.rect.height)[0];
          if (dominantCandidate && children.length <= 5) {
            const otherHeight = children
              .filter((child) => child !== dominantCandidate.child)
              .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
            const dominantClassText = `${dominantCandidate.child.className || ""} ${dominantCandidate.child.id || ""}`.toLowerCase();
            if (dominantCandidate.rect.height >= current.getBoundingClientRect().height * 0.6 && otherHeight <= dominantCandidate.rect.height * 0.35) {
              const dominantStats = collectModuleStats(dominantCandidate.child, contentRoot);
              if (!dominantStats.hasBackgroundChange) {
                current = dominantCandidate.child;
                warnings.push(`segmentation-root-descended:${dominantStats.path}`);
                continue;
              }
            }
            if (
              dominantCandidate.rect.width >= current.getBoundingClientRect().width * 0.68
              && dominantCandidate.rect.height >= current.getBoundingClientRect().height * 0.45
              && otherHeight <= dominantCandidate.rect.height * 0.8
              && /content|entry|article|post|main/.test(dominantClassText)
            ) {
              const dominantStats = collectModuleStats(dominantCandidate.child, contentRoot);
              current = dominantCandidate.child;
              warnings.push(`segmentation-root-descended:${dominantStats.path}`);
              continue;
            }
          }
          break;
        }
        return { node: current, warnings };
      }

      function isStructuralBand(stats, segmentationRoot) {
        const lowerTag = stats.tag.toLowerCase();
        if (/^h[1-6]$/.test(lowerTag) || lowerTag === "p") return false;
        if (lowerTag === "div" && stats.rect.height < 100 && !stats.hasBackgroundChange && stats.imageCount === 0 && stats.cardLikeChildren === 0) return false;
        if (stats.rect.width < segmentationRoot.getBoundingClientRect().width * 0.55 && stats.imageCount === 0 && stats.headings.length === 0) return false;
        return true;
      }

      function overlaps(a, b) {
        const top = Math.max(a.rect.top, b.rect.top);
        const bottom = Math.min(a.rect.top + a.rect.height, b.rect.top + b.rect.height);
        const overlapHeight = Math.max(0, bottom - top);
        return overlapHeight >= Math.min(a.rect.height, b.rect.height) * 0.6;
      }

      function classifyModule(stats, sectionType = null) {
        const classText = statsClassText(stats);
        const text = String(stats.text || "").toLowerCase();
        const hasCta = stats.linkCount + stats.buttonCount >= 1;
        const sectionKey = sectionType ? `${sectionType.kind}:${sectionType.variant || "*"}` : "";
        const moduleDetectors = {
          "reviews:*": () => ({ kind: "review-card", variant: "customer-review", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } }),
          "stat-group:*": () => ({ kind: "stat-item", variant: "step-or-stat", capabilities: { hasCta: false, hasMedia: false } }),
          "category-strip:*": () => ({ kind: "text-block", variant: "category-item", capabilities: { hasCta, hasMedia: false } }),
          "promo-band:*": () => (stats.imageCount >= 1 && stats.headings.length === 0 && stats.paragraphCount === 0
            ? { kind: "media-item", variant: "promo-media", capabilities: { hasCta, hasMedia: true } }
            : { kind: "text-block", variant: "promo-copy", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } }),
          "cta-strip:*": () => ({ kind: "text-block", variant: hasCta ? "cta-copy" : "strip-copy", capabilities: { hasCta, hasMedia: false } }),
          "text-media:*": () => {
            if (stats.imageCount >= 1 && stats.paragraphCount === 0 && stats.headings.length === 0) return { kind: "media-item", variant: "image-tile", capabilities: { hasCta, hasMedia: true } };
            if (stats.headings.length >= 1 || stats.paragraphCount >= 1) return { kind: "text-block", variant: "copy-block", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
            return null;
          },
          "card-collection:logo-gallery": () => ({ kind: "logo-item", variant: "brand-mark", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } }),
          "card-collection:*": () => ({ kind: "card", variant: /product|price|add to cart|book rental|rent/.test(text) ? "product-card" : "content-card", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } }),
          "footer:*": () => ({ kind: "link-group", variant: "footer-links", capabilities: { hasCta: stats.linkCount >= 1, hasMedia: false } }),
          "hero:*": () => {
            if (stats.headings.length >= 1 || stats.paragraphCount >= 1) return { kind: "text-block", variant: "hero-copy", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
            if (stats.imageCount >= 1) return { kind: "media-item", variant: "hero-media", capabilities: { hasCta, hasMedia: true } };
            return null;
          },
        };
        const specialized = (moduleDetectors[sectionKey] || moduleDetectors[`${sectionType?.kind}:*`])?.();
        if (specialized) return specialized;
        if (stats.reviewLike || /review|testimonial|verified customer/.test(`${classText} ${text}`)) return { kind: "review-card", variant: "customer-review", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
        if (stats.productLike) return { kind: "card", variant: "product-card", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
        if (stats.logoLikeChildren >= 1 || (stats.imageCount >= 1 && stats.textLength < 40 && stats.rect.width <= 260)) return { kind: "logo-item", variant: "brand-mark", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
        if (stats.imageCount >= 1 && stats.headings.length === 0 && stats.paragraphCount === 0) return { kind: "media-item", variant: "image-tile", capabilities: { hasCta, hasMedia: true } };
        if (stats.headings.length >= 1 || stats.paragraphCount >= 1) return { kind: "text-block", variant: "copy-block", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
        return { kind: "unknown", variant: "generic", capabilities: { hasCta, hasMedia: stats.imageCount >= 1 } };
      }

      function moduleSummary(stats, sectionRoot, sectionType = null) {
        const moduleType = classifyModule(stats, sectionType);
        return {
          id: "",
          kind: moduleType.kind,
          variant: moduleType.variant,
          capabilities: moduleType.capabilities,
          heading: stats.heading,
          visibleCodeTexts: stats.visibleCodeTexts,
          order: 0,
          confidence: Number(Math.max(0.2, Math.min(0.95, 0.45 + ((stats.imageCount + stats.headings.length + stats.cardLikeChildren) * 0.04))).toFixed(2)),
          rect: {
            top: Math.round(stats.rect.top + window.scrollY),
            left: Math.round(stats.rect.left),
            width: Math.round(stats.rect.width),
            height: Math.round(stats.rect.height),
          },
          counts: {
            headings: stats.headings.length,
            paragraphs: stats.paragraphCount,
            images: stats.imageCount,
            links: stats.linkCount,
            buttons: stats.buttonCount,
          },
          domRef: {
            tag: stats.tag,
            id: stats.node.id || "",
            classTokens: String(stats.node.className || "").split(/\s+/).filter(Boolean).slice(0, 6),
            path: domPath(stats.node, sectionRoot.parentElement || document.body.parentElement),
            parentPath: domPath(stats.node.parentElement, sectionRoot.parentElement || document.body.parentElement),
            nthOfType: stats.nthOfType,
            fingerprint: stats.fingerprint,
          },
          warnings: [],
        };
      }

      function moduleCandidatesFrom(containerRoot, sectionRoot, filters = {}) {
        const minHeight = filters.minHeight || 60;
        const minWidth = filters.minWidth || Math.min(sectionRoot.getBoundingClientRect().width * 0.22, 220);
        return visibleChildren(containerRoot)
          .map((child) => collectModuleStats(child, sectionRoot))
          .filter((stats) => stats.rect.height >= minHeight)
          .filter((stats) => stats.rect.width >= minWidth || stats.imageCount >= 1 || stats.headings.length >= 1)
          .filter((stats) => stats.textLength >= 10 || stats.imageCount >= 1)
          .slice(0, 36);
      }

      function resolveRepeatingContainer(sectionRoot) {
        let current = sectionRoot;
        for (let depth = 0; depth < 3; depth += 1) {
          const children = visibleChildren(current);
          if (!children.length) return current;
          const repeatedChild = children.find((child) => {
            const classText = `${child.className || ""} ${child.id || ""}`.toLowerCase();
            return /slider|carousel|embla|swiper|viewport|container|grid|gallery|reviews|products|list/.test(classText);
          });
          if (repeatedChild) {
            current = repeatedChild;
            continue;
          }
          if (children.length === 1) {
            current = children[0];
            continue;
          }
          return current;
        }
        return current;
      }

      function extractRepeatingItemModules(sectionRoot, sectionType) {
        const container = resolveRepeatingContainer(sectionRoot);
        const children = moduleCandidatesFrom(container, sectionRoot, { minHeight: 80, minWidth: 120 });
        const accepted = [];
        for (const stats of children) {
          if (stats.rect.height > sectionRoot.getBoundingClientRect().height * 0.95 && stats.cardLikeChildren <= 1) continue;
          if (accepted.some((existing) => overlaps(existing, stats))) continue;
          accepted.push(stats);
        }
        return accepted.slice(0, 12).map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        }).filter((module) => module.kind !== "unknown");
      }

      function dedupeModuleStats(statsList) {
        const accepted = [];
        for (const stats of statsList) {
          if (accepted.some((existing) => overlaps(existing, stats))) continue;
          accepted.push(stats);
        }
        return accepted;
      }

      function extractLogoModules(sectionRoot, sectionType) {
        const imageNodes = uniqueElements(
          Array.from(sectionRoot.querySelectorAll("img"))
            .filter(isVisible)
            .map((image) => image.closest("a, figure, li, div") || image),
        );
        const statsList = imageNodes
          .map((node) => collectModuleStats(node, sectionRoot))
          .filter((stats) => stats.imageCount >= 1)
          .filter((stats) => stats.rect.width >= 40 && stats.rect.height >= 24)
          .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
        return dedupeModuleStats(statsList).slice(0, 16).map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        }).filter((module) => module.kind !== "unknown");
      }

      function extractReviewModules(sectionRoot, sectionType) {
        const reviewNodes = uniqueElements(
          Array.from(sectionRoot.querySelectorAll("[class*='review'], [id*='review'], [class*='testimonial'], [class*='customer']"))
            .filter(isVisible),
        );
        const statsList = reviewNodes
          .map((node) => collectModuleStats(node, sectionRoot))
          .filter((stats) => stats.textLength >= 30 || stats.imageCount >= 1)
          .filter((stats) => stats.rect.height >= 60)
          .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
        const accepted = dedupeModuleStats(statsList)
          .filter((stats) => !stats.node.contains(sectionRoot))
          .slice(0, 12);
        return accepted.map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        }).filter((module) => module.kind !== "unknown");
      }

      function resolveTextMediaScope(sectionRoot) {
        let current = sectionRoot;
        for (let depth = 0; depth < 3; depth += 1) {
          const children = visibleChildren(current).filter((child) => child.getBoundingClientRect().height >= 24);
          if (children.length !== 1) return current;
          const onlyChild = children[0];
          const onlyRect = onlyChild.getBoundingClientRect();
          if (onlyRect.width < current.getBoundingClientRect().width * 0.72) return current;
          current = onlyChild;
        }
        return current;
      }

      function extractTextMediaModules(sectionRoot, sectionType) {
        const scope = resolveTextMediaScope(sectionRoot);
        const children = moduleCandidatesFrom(scope, sectionRoot, { minHeight: 90, minWidth: 120 })
          .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
        const accepted = [];
        for (const stats of children) {
          const moduleType = classifyModule(stats, sectionType);
          if (moduleType.kind === "unknown") continue;
          if (accepted.some((existing) => existing.node.contains(stats.node) && classifyModule(existing, sectionType).kind === moduleType.kind)) continue;
          if (accepted.some((existing) => overlaps(existing, stats))) continue;
          accepted.push(stats);
        }
        return accepted.slice(0, 6).map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        });
      }

      function extractStatModules(sectionRoot, sectionType) {
        const children = visibleChildren(sectionRoot)
          .map((child) => collectModuleStats(child, sectionRoot))
          .filter((stats) => stats.headings.length >= 1 || stats.textLength >= 20)
          .filter((stats) => stats.rect.height >= 40)
          .slice(0, 12);
        return children.map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        }).filter((module) => module.kind !== "unknown");
      }

      function extractGenericModules(sectionRoot, sectionType) {
        const children = visibleChildren(sectionRoot)
          .map((child) => collectModuleStats(child, sectionRoot))
          .filter((stats) => stats.rect.width >= Math.min(sectionRoot.getBoundingClientRect().width * 0.22, 220) || stats.imageCount >= 1)
          .filter((stats) => stats.rect.height >= 90)
          .filter((stats) => stats.textLength >= 10 || stats.imageCount >= 1)
          .slice(0, 16);
        const accepted = [];
        for (const stats of children) {
          if (stats.rect.height > sectionRoot.getBoundingClientRect().height * 0.92 && stats.cardLikeChildren <= 1) continue;
          if (accepted.some((existing) => overlaps(existing, stats))) continue;
          accepted.push(stats);
        }
        return accepted.slice(0, 8).map((stats, index) => {
          const module = moduleSummary(stats, sectionRoot, sectionType);
          module.id = `module-${index + 1}`;
          module.order = index + 1;
          return module;
        }).filter((module) => module.kind !== "unknown");
      }

      const MODULE_EXTRACTORS = {
        "reviews:*": extractReviewModules,
        "card-collection:logo-gallery": extractLogoModules,
        "card-collection:*": extractRepeatingItemModules,
        "text-media:*": extractTextMediaModules,
        "hero:*": extractTextMediaModules,
        "stat-group:*": extractStatModules,
        "footer:*": extractStatModules,
        "category-strip:*": extractStatModules,
        "cta-strip:*": extractStatModules,
        "promo-band:*": extractStatModules,
      };

      function extractSectionModules(sectionRoot, sectionType) {
        const exact = MODULE_EXTRACTORS[`${sectionType.kind}:${sectionType.variant}`];
        const family = MODULE_EXTRACTORS[`${sectionType.kind}:*`];
        const extractor = exact || family || extractGenericModules;
        return extractor(sectionRoot, sectionType);
      }

      function extractSections() {
        const contentRootChoice = findContentRoot();
        const contentRoot = contentRootChoice.node || document.body;
        const segmentationRootChoice = findSegmentationRoot(contentRoot);
        const segmentationRoot = segmentationRootChoice.node || contentRoot;
        const diagnostics = {
          source: "dom-layout+a11y",
          contentRoot: contentRootChoice.label || "body",
          segmentationRootPath: domPath(segmentationRoot, contentRoot.parentElement || document.body.parentElement),
          accessibilitySnapshotAvailable: Boolean(repeaterPlan?.accessibilitySnapshotAvailable),
          accessibilityRoot: repeaterPlan?.accessibilityRoot || null,
          candidateCount: 0,
          acceptedSectionCount: 0,
          acceptedModuleCount: 0,
          warnings: [],
        };
        if (contentRootChoice.label !== "main" && contentRootChoice.label !== "role-main") {
          diagnostics.warnings.push(`content-root-fallback-used:${contentRootChoice.label}`);
        }
        diagnostics.warnings.push(...segmentationRootChoice.warnings);
        const primaryChildren = visibleChildren(segmentationRoot)
          .map((node) => collectModuleStats(node, segmentationRoot))
          .filter((stats) => stats.rect.height >= 24)
          .filter((stats) => stats.textLength >= 10 || stats.imageCount >= 1 || stats.buttonCount >= 1 || stats.linkCount >= 1);
        const primaryBandStats = primaryChildren
          .filter((stats) => isStructuralBand(stats, segmentationRoot))
          .map((stats) => ({
            ...stats,
            score: sectionScore(stats, segmentationRoot) + 22,
            isDirectChild: true,
          }))
          .filter((stats) => stats.score >= 30)
          .filter((stats) => stats.rect.height >= 40)
          .sort((a, b) => a.rect.top - b.rect.top);
        const candidateNodes = uniqueElements([
          ...primaryBandStats.map((stats) => stats.node),
          ...Array.from(segmentationRoot.querySelectorAll("section, article, aside, [role='region'], [data-testid], div"))
            .filter(isVisible)
            .slice(0, 260),
        ]).filter((node) => node !== contentRoot && node !== segmentationRoot);
        const candidateStats = candidateNodes
          .map((node) => collectModuleStats(node, segmentationRoot))
          .filter((stats) => stats.rect.width >= Math.min(segmentationRoot.getBoundingClientRect().width * 0.45, 520))
          .filter((stats) => stats.rect.height >= 80)
          .filter((stats) => stats.textLength >= 20 || stats.imageCount >= 1)
          .map((stats) => {
            let score = sectionScore(stats, segmentationRoot);
            if (stats.node.parentElement === segmentationRoot) score += 18;
            if (isStructuralBand(stats, segmentationRoot)) score += 8;
            return { ...stats, score, isDirectChild: stats.node.parentElement === segmentationRoot };
          })
          .sort((a, b) => a.rect.top - b.rect.top || b.score - a.score);
        diagnostics.candidateCount = candidateStats.length;
        const accepted = [...primaryBandStats];
        for (const stats of candidateStats) {
          if (stats.score < 35) continue;
          if (isWrapperLike(stats, segmentationRoot)) continue;
          const duplicate = accepted.find((existing) => overlaps(existing, stats));
          if (!duplicate) {
            accepted.push(stats);
            continue;
          }
          if (duplicate.isDirectChild && !stats.isDirectChild && duplicate.score >= stats.score - 15) continue;
          if (stats.isDirectChild && !duplicate.isDirectChild && stats.score >= duplicate.score - 15) {
            accepted.splice(accepted.indexOf(duplicate), 1, stats);
            continue;
          }
          const statsContainsDuplicate = stats.node.contains(duplicate.node);
          const duplicateContainsStats = duplicate.node.contains(stats.node);
          if (isWrapperLike(duplicate, segmentationRoot) && duplicateContainsStats) {
            accepted.splice(accepted.indexOf(duplicate), 1, stats);
          } else if (isWrapperLike(stats, segmentationRoot) && statsContainsDuplicate) {
            diagnostics.warnings.push(`nested-candidates-collapsed:${stats.path}`);
            continue;
          } else if (duplicateContainsStats && duplicate.rect.height > stats.rect.height * 1.5 && stats.score >= duplicate.score - 8) {
            accepted.splice(accepted.indexOf(duplicate), 1, stats);
          } else if (statsContainsDuplicate && stats.rect.height > duplicate.rect.height * 1.5) {
            diagnostics.warnings.push(`nested-candidates-collapsed:${stats.path}`);
            continue;
          } else if (stats.score > duplicate.score) {
            accepted.splice(accepted.indexOf(duplicate), 1, stats);
          }
        }
        if (!accepted.length) {
          diagnostics.warnings.push("no-strong-section-boundaries");
        }
        const sections = accepted.slice(0, 18).map((stats, index) => {
          const sectionRoot = stats.node;
          const sectionType = classifySection(stats);
          const modules = extractSectionModules(sectionRoot, sectionType).map((module, moduleIndex) => ({
            ...module,
            id: `section-${String(index + 1).padStart(3, "0")}-module-${String(moduleIndex + 1).padStart(3, "0")}`,
            order: moduleIndex + 1,
          }));
          diagnostics.acceptedModuleCount += modules.length;
          return {
            id: `section-${String(index + 1).padStart(3, "0")}`,
            kind: sectionType.kind,
            variant: sectionType.variant,
            capabilities: sectionType.capabilities,
            source: "dom-layout+a11y",
            tag: stats.tag,
            idAttr: sectionRoot.id || "",
            className: sectionRoot.className?.toString?.() || "",
            heading: stats.heading,
            text: stats.text,
            visibleCodeTexts: stats.visibleCodeTexts,
            order: index + 1,
            confidence: Number(Math.max(0.3, Math.min(0.98, stats.score / 100)).toFixed(2)),
            rect: {
              x: Math.round(stats.rect.x),
              y: Math.round(stats.rect.y),
              width: Math.round(stats.rect.width),
              height: Math.round(stats.rect.height),
              top: Math.round(stats.rect.top + window.scrollY),
              left: Math.round(stats.rect.left),
            },
            layoutHints: {
              fullWidth: stats.rect.width >= segmentationRoot.getBoundingClientRect().width * 0.85,
              columnCount: Math.max(1, Math.min(stats.rowCountEstimate > 1 ? Math.ceil(stats.cardLikeChildren / stats.rowCountEstimate) : stats.cardLikeChildren, 4)) || 1,
              hasGrid: stats.cardLikeChildren >= 3 && stats.rowCountEstimate >= 1,
              hasRepeatingChildren: stats.cardLikeChildren >= 3,
            },
            counts: {
              headings: stats.headings.length,
              paragraphs: stats.paragraphCount,
              images: stats.imageCount,
              links: stats.linkCount,
              buttons: stats.buttonCount,
            },
            background: stats.background,
            layoutEvidence: collectLayoutEvidence(sectionRoot),
            domRef: {
              tag: stats.tag,
              id: sectionRoot.id || "",
              classTokens: String(sectionRoot.className || "").split(/\s+/).filter(Boolean).slice(0, 6),
              path: stats.path,
              parentPath: stats.parentPath,
              nthOfType: stats.nthOfType,
              fingerprint: stats.fingerprint,
            },
            a11y: {
              role: stats.role || null,
              headingLevels: stats.headings.map((heading) => heading.level).filter(Boolean),
              containsList: sectionRoot.querySelectorAll("ul,ol,[role='list']").length > 0,
            },
            modules,
            warnings: [],
          };
        });
        diagnostics.acceptedSectionCount = sections.length;
        return { sections, diagnostics };
      }

      const sectionResult = extractSections();
      const footer = (() => {
        const node = Array.from(document.querySelectorAll("footer, .site-footer, [role='contentinfo']")).find(isVisible);
        if (!node) return null;
        const links = Array.from(node.querySelectorAll("a[href]")).filter(isVisible).map(linkRecord);
        const cleanNodeText = (source) => renderedText(source);
        const text = cleanNodeText(node).slice(0, 6000);
        const legalText = Array.from(node.querySelectorAll("p, small, [class*='legal' i], [class*='disclaimer' i]"))
          .filter(isVisible)
          .map(cleanNodeText)
          .filter((value) => value.length >= 120 || /disclaimer|portfolio companies|copyright|©/i.test(value))
          .filter((value, index, values) => values.indexOf(value) === index)
          .join("\n\n") || text;
        return {
          text,
          legalText: legalText.slice(0, 6000),
          links: dedupeNav(links).slice(0, 80),
          domRef: {
            tag: node.tagName.toLowerCase(),
            id: node.id || "",
            classTokens: String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 8),
            path: domPath(node, document.body.parentElement),
          },
        };
      })();
      const computedTokens = Array.from(document.querySelectorAll("body, h1, h2, h3, p, a, button")).slice(0, 80).map((node) => {
        const styles = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          text: renderedText(node).slice(0, 120) || "",
          color: styles.color,
          backgroundColor: styles.backgroundColor,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          borderRadius: styles.borderRadius,
          boxShadow: styles.boxShadow,
        };
      });
      const direction = document.documentElement.dir || document.body.dir || getComputedStyle(document.body).direction || "ltr";
      function nextVisibleNonHeadingSibling(node) {
        let current = node?.nextElementSibling || null;
        while (current) {
          if (isVisible(current) && !/^H[1-6]$/.test(current.tagName)) return current;
          current = current.nextElementSibling;
        }
        return null;
      }

      function findContentContainerForHeading(heading) {
        const direct = nextVisibleNonHeadingSibling(heading);
        if (direct) return direct;
        const parentDirect = nextVisibleNonHeadingSibling(heading.parentElement);
        if (parentDirect) return parentDirect;
        return null;
      }

      function nearestCommonAncestor(a, b, limit) {
        let current = a || null;
        while (current) {
          if (current.contains(b)) return current;
          if (limit && current === limit) break;
          current = current.parentElement;
        }
        return null;
      }

      function uniqueElements(nodes) {
        const seen = new Set();
        const result = [];
        for (const node of nodes || []) {
          if (!node || seen.has(node)) continue;
          seen.add(node);
          result.push(node);
        }
        return result;
      }

      function queryScopeNodes(scopeNodes, selector) {
        const seen = new Set();
        const matches = [];
        for (const node of scopeNodes || []) {
          if (node?.matches?.(selector) && !seen.has(node)) {
            seen.add(node);
            matches.push(node);
          }
          for (const child of node?.querySelectorAll?.(selector) || []) {
            if (seen.has(child)) continue;
            seen.add(child);
            matches.push(child);
          }
        }
        return matches;
      }

      function collectContentNodes(content, nextHeadingNode) {
        if (!content) return [];
        const nodes = [];
        if (nextHeadingNode && content.parentElement && nextHeadingNode.parentElement === content.parentElement) {
          let current = content;
          while (current && current !== nextHeadingNode) {
            if (isVisible(current)) nodes.push(current);
            current = current.nextElementSibling;
          }
        }
        if (!nodes.length) nodes.push(content);
        return uniqueElements(nodes);
      }

      function nodeSignature(node) {
        if (!node) return "";
        const tag = node.tagName.toLowerCase();
        const classTokens = String(node.className || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4)
          .sort()
          .join(".");
        const childTags = Array.from(node.children).slice(0, 8).map((child) => child.tagName.toLowerCase()).join(",");
        return `${tag}:${classTokens}:${childTags}`;
      }

      function normalized(value) {
        return cleanText(value).toLowerCase();
      }

      function extractParagraphs(scopeNodes, heading) {
        const seen = new Set();
        const paragraphs = [];
        const candidates = queryScopeNodes(scopeNodes, "p, li, blockquote, figcaption").filter(isVisible);
        for (const node of candidates) {
          const text = renderedText(node);
          if (!text || text.length < 20) continue;
          const key = normalized(text);
          if (seen.has(key)) continue;
          seen.add(key);
          paragraphs.push(text);
        }
        if (!paragraphs.length) {
          const fallbackBlocks = queryScopeNodes(scopeNodes, "div, span").filter((node) => {
            if (!isVisible(node) || node === heading || heading?.contains(node)) return false;
            if (node.querySelector("p, li, blockquote, figcaption")) return false;
            if (node.querySelector("img")) return false;
            const text = renderedText(node);
            if (!text || text.length < 30) return false;
            if (Array.from(node.children).some((child) => renderedText(child) === text)) return false;
            const display = getComputedStyle(node).display;
            return /block|flex|grid|inline-block|table/.test(display);
          });
          for (const node of fallbackBlocks) {
            const text = renderedText(node);
            const key = normalized(text);
            if (seen.has(key)) continue;
            seen.add(key);
            paragraphs.push(text);
          }
        }
        if (paragraphs.length) return paragraphs;
        const fallback = cleanText(scopeNodes.map((node) => renderedText(node)).join(" "));
        return fallback ? [fallback] : [];
      }

      function extractImages(scopeNodes) {
        function bestSrcFromSet(value) {
          const candidates = String(value || "")
            .split(",")
            .map((item) => item.trim())
            .map((item) => {
              const match = item.match(/^(\S+)(?:\s+(\d+)w)?/);
              return match ? { url: match[1], width: Number(match[2] || 0) } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.width - a.width);
          return candidates[0]?.url || "";
        }

        function bestImageSrc(img) {
          return (
            img.getAttribute("data-src")
            || img.getAttribute("data-lazy-src")
            || bestSrcFromSet(img.getAttribute("data-srcset"))
            || bestSrcFromSet(img.getAttribute("srcset"))
            || img.currentSrc
            || img.src
            || ""
          );
        }

        const seen = new Set();
        return queryScopeNodes(scopeNodes, "img")
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            return (isVisible(img) || Boolean(bestImageSrc(img))) && rect.width >= 24 && rect.height >= 24;
          })
          .map((img) => {
            const rect = img.getBoundingClientRect();
            return {
              src: bestImageSrc(img),
              alt: cleanText(img.getAttribute("alt") || ""),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              rect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
            };
          })
          .filter((image) => image.src && !image.src.startsWith("data:image/svg+xml"))
          .filter((image) => {
            if (seen.has(image.src)) return false;
            seen.add(image.src);
            return true;
          });
      }

      function extractLinksFromContainer(scopeNodes) {
        const seen = new Set();
        return queryScopeNodes(scopeNodes, "a[href]")
          .map((anchor) => ({
            href: anchor.href || anchor.getAttribute("href") || "",
            label: semanticText(anchor).slice(0, 160),
          }))
          .filter((link) => link.href)
          .filter((link) => {
            const key = `${link.label}\u0000${link.href}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 24);
      }

      function inferItemLayoutHints(heading, scopeNodes, images, paragraphs) {
        const descendants = queryScopeNodes(scopeNodes, "img, p, li, blockquote, figcaption, div, span").filter((node) => {
          const text = renderedText(node);
          if (node.tagName === "IMG") return true;
          return text.length >= 20 && isVisible(node);
        });
        const firstKind = descendants[0]?.tagName === "IMG" ? "media-first" : descendants[0] ? "text-first" : "unknown";
        const textNodes = queryScopeNodes(scopeNodes, "p, li, blockquote, figcaption, div, span").filter((node) => {
          if (!isVisible(node) || node === heading || heading?.contains(node)) return false;
          const text = renderedText(node);
          if (!text || text.length < 20) return false;
          if (Array.from(node.children).some((child) => renderedText(child) === text)) return false;
          return true;
        });
        const averageCenter = (nodes) => {
          if (!nodes.length) return null;
          const centers = nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left + (rect.width / 2);
          });
          return centers.reduce((sum, value) => sum + value, 0) / centers.length;
        };
        const textCenter = averageCenter(textNodes);
        const imageCenter = images.length
          ? images.reduce((sum, image) => sum + (image.rect.left + (image.rect.width / 2)), 0) / images.length
          : null;
        let textPosition = "stacked";
        let mediaPosition = "stacked";
        if (textCenter != null && imageCenter != null) {
          const delta = imageCenter - textCenter;
          const scopeWidth = Math.max(...scopeNodes.map((node) => node.getBoundingClientRect().width), 0);
          const threshold = Math.max(scopeWidth * 0.12, 60);
          if (Math.abs(delta) > threshold) {
            mediaPosition = delta < 0 ? "left" : "right";
            textPosition = delta < 0 ? "right" : "left";
          }
        }
        return {
          mediaCount: images.length,
          paragraphCount: paragraphs.length,
          firstContentKind: firstKind,
          headingLevel: Number(heading.tagName.replace(/^H/i, "")) || null,
          textPosition,
          mediaPosition,
        };
      }

      function scoreItemContainer(node, { heading, content, main }) {
        if (!node || !main.contains(node)) return Number.NEGATIVE_INFINITY;
        if (!node.contains(heading) || !node.contains(content)) return Number.NEGATIVE_INFINITY;
        const rect = node.getBoundingClientRect();
        if (rect.width < 180 || rect.height < 80) return Number.NEGATIVE_INFINITY;
        const classText = `${node.className || ""} ${node.id || ""}`.toLowerCase();
        const imageCount = node.querySelectorAll("img").length;
        const paragraphCount = node.querySelectorAll("p, li, blockquote, figcaption").length;
        const headingCount = node.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
        let score = 0;
        score += 40;
        score += Math.min(imageCount, 6) * 6;
        score += Math.min(paragraphCount, 6) * 5;
        if (headingCount === 1) score += 18;
        else score -= Math.max(0, headingCount - 1) * 12;
        if (node === content) score -= 10;
        if (/slider|carousel|gallery|nav|menu|footer|share/.test(classText)) score -= 35;
        if (rect.height > window.innerHeight * 2.5) score -= 25;
        if (rect.width < Math.min(window.innerWidth * 0.45, 320)) score -= 20;
        return score;
      }

      function findItemContainerForHeading(heading, main) {
        const content = findContentContainerForHeading(heading);
        if (!content) return null;
        const common = nearestCommonAncestor(heading, content, main) || nearestCommonAncestor(heading, content, document.body);
        const candidates = uniqueElements([
          common,
          content,
          content.parentElement,
          heading.parentElement,
          heading.parentElement?.parentElement,
          heading.closest("section,article,li,[data-testid],[class]"),
          content.closest("section,article,li,[data-testid],[class]"),
        ]).filter((node) => node && main.contains(node));
        const scored = candidates
          .map((node) => ({ node, score: scoreItemContainer(node, { heading, content, main }) }))
          .filter((entry) => Number.isFinite(entry.score))
          .sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best) return null;
        return { container: best.node, content, score: best.score, signature: nodeSignature(best.node) };
      }

      function dominantParentGroup(matches) {
        const groups = [];
        for (const match of matches) {
          const parent = match.container.parentElement;
          if (!parent) continue;
          const existing = groups.find((group) => group.parent === parent);
          if (existing) existing.items.push(match);
          else groups.push({ parent, items: [match] });
        }
        groups.sort((a, b) => b.items.length - a.items.length);
        return groups[0] || null;
      }

      function extractRepeaters(plan) {
        const signals = Array.isArray(plan?.signals) ? plan.signals : [];
        const main = document.querySelector("main");
        const diagnostics = {
          source: "accessibility+dom",
          accessibilitySnapshotAvailable: Boolean(plan?.accessibilitySnapshotAvailable),
          signalCount: signals.length,
          candidateCount: plan?.candidateCount || signals.length,
          acceptedRepeaterCount: 0,
          signals: [],
          warnings: [...(plan?.warnings || [])],
        };
        if (!main) {
          diagnostics.warnings.push("main-content-missing: manual repeater review required");
          return { repeaters: [], diagnostics };
        }
        const headingNodes = Array.from(main.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter((node) => renderedText(node));
        const headingRegistry = headingNodes.map((node, index) => ({
          node,
          index,
          text: renderedText(node),
          normalized: normalized(renderedText(node)),
          level: Number(node.tagName.replace(/^H/i, "")) || 0,
        }));
        const repeaters = signals.map((signal, signalIndex) => {
          let minIndex = -1;
          const matched = [];
          for (const expected of signal.items || []) {
            const expectedText = normalized(expected.heading);
            const match = headingRegistry.find((entry) => entry.index > minIndex && entry.level === signal.headingLevel && entry.normalized === expectedText);
            if (!match) continue;
            minIndex = match.index;
            const resolved = findItemContainerForHeading(match.node, main);
            if (!resolved) continue;
            matched.push({ ...resolved, heading: match });
          }
          const dominantParent = dominantParentGroup(matched);
          const resolvedItems = dominantParent && dominantParent.items.length >= 3 ? dominantParent.items : matched;
          const items = resolvedItems.map((resolved, resolvedIndex) => {
            const nextHeadingNode = resolvedItems[resolvedIndex + 1]?.heading?.node || null;
            const scopeNodes = collectContentNodes(resolved.content, nextHeadingNode);
            const paragraphs = extractParagraphs(scopeNodes, resolved.heading.node);
            const images = extractImages(scopeNodes);
            return {
              heading: resolved.heading.text,
              paragraphs,
              images,
              links: extractLinksFromContainer(scopeNodes),
              layoutHints: inferItemLayoutHints(resolved.heading.node, scopeNodes, images, paragraphs),
            };
          }).filter((item) => item.paragraphs.length && item.images.length);
          const signalDiagnostics = {
            label: signal.label || `main-repeater-${signalIndex + 1}`,
            roleSignature: signal.roleSignature || null,
            headingLevel: signal.headingLevel || null,
            expectedItemCount: signal.items?.length || 0,
            matchedHeadingCount: matched.length,
            resolvedItemCount: items.length,
            dominantParentTag: dominantParent?.parent?.tagName?.toLowerCase() || null,
            dominantParentClass: dominantParent?.parent?.className?.toString?.() || "",
            containerSignatures: Array.from(new Set(resolvedItems.map((item) => item.signature))).slice(0, 6),
            warnings: [],
          };
          diagnostics.signals.push(signalDiagnostics);
          if (items.length < 3) {
            signalDiagnostics.warnings.push("dom-resolution-ambiguous");
            diagnostics.warnings.push(`repeater-resolution-ambiguous:${signalDiagnostics.label}`);
            return null;
          }
          const mediaCounts = items.map((item) => item.images.length);
          const repeater = {
            kind: "content-repeater",
            source: "accessibility+dom",
            label: signal.label || `main-repeater-${signalIndex + 1}`,
            itemCount: items.length,
            schema: {
              hasHeading: items.every((item) => Boolean(item.heading)),
              hasParagraphs: items.every((item) => item.paragraphs.length > 0),
              hasImages: items.every((item) => item.images.length > 0),
              maxImagesPerItem: Math.max(...mediaCounts),
            },
            layoutHints: {
              alternating: new Set(items.map((item) => item.layoutHints.textPosition || item.layoutHints.firstContentKind)).size > 1,
            },
            items,
          };
          diagnostics.acceptedRepeaterCount += 1;
          return repeater;
        }).filter(Boolean);
        if (!signals.length) {
          const mainHeadingCount = main.querySelectorAll("h2,h3,h4,h5,h6").length;
          const mainImageCount = main.querySelectorAll("img").length;
          if (mainHeadingCount >= 4 && mainImageCount >= 4) {
            diagnostics.warnings.push("possible-repeated-content-without-high-confidence-structure: manual review required");
          }
        } else if (!repeaters.length) {
          diagnostics.warnings.push("accessibility-signals-found-but-no-structured-repeaters-resolved: manual review required");
        }
        return { repeaters, diagnostics };
      }

      function extractAccordionRepeaters(main) {
        if (!main) return [];
        const groups = [];
        const candidates = Array.from(main.querySelectorAll("details")).filter((node) => renderedText(node.querySelector("summary")));
        for (const node of candidates) {
          const parent = node.parentElement;
          if (!parent) continue;
          const existing = groups.find((group) => group.parent === parent);
          if (existing) existing.items.push(node);
          else groups.push({ parent, items: [node] });
        }
        const nativeRecords = groups.filter((group) => group.items.length >= 2).map((group, groupIndex) => {
          const items = group.items.map((node) => {
            const summary = node.querySelector("summary");
            const clone = node.cloneNode(true);
            clone.querySelector("summary")?.remove();
            const paragraphs = Array.from(clone.querySelectorAll("p,li")).map((child) => semanticText(child)).filter(Boolean);
            const fallbackText = semanticText(clone);
            const images = Array.from(clone.querySelectorAll("img")).map((image) => ({ src: image.currentSrc || image.src || "", alt: image.alt || "" })).filter((image) => image.src && !/(emoji|twemoji|wp-smiley)/i.test(image.src));
            const links = Array.from(clone.querySelectorAll("a[href]")).map((link) => ({ text: semanticText(link), url: link.href })).filter((link) => link.url);
            const content = paragraphs.length ? paragraphs : fallbackText ? [fallbackText] : [];
            return {
              heading: renderedText(summary),
              paragraphs: content,
              images,
              links,
              initialExpanded: Boolean(node.open),
              itemStructure: images.length ? content.length ? "media-and-text" : "media-only" : "text-only",
              layoutHints: { mediaCount: images.length, paragraphCount: content.length, firstContentKind: images.length ? "media-first" : "text-first", headingLevel: null },
            };
          });
          const mediaCounts = items.map((item) => item.images.length);
          const expanded = items.map((item, index) => item.initialExpanded ? index : null).filter((index) => index !== null);
          return {
            kind: "accordion-repeater",
            source: "dom:details",
            label: cleanText(group.parent.getAttribute("aria-label")) || `accordion-${groupIndex + 1}`,
            itemCount: items.length,
            schema: { hasHeading: true, hasParagraphs: items.every((item) => item.paragraphs.length > 0), hasImages: items.some((item) => item.images.length > 0), maxImagesPerItem: Math.max(...mediaCounts, 0) },
            state: { initialExpandedIndices: expanded, multipleOpen: expanded.length > 1, openBehavior: "requires-interaction-probe" },
            items,
          };
        });
        const customRoots = Array.from(main.querySelectorAll(".tatsu-accordion, [class*='accordion' i]")).filter((root, index, all) =>
          root.querySelectorAll(".accordion-head").length >= 2 && !all.some((other) => other !== root && other.contains(root) && other.querySelectorAll(".accordion-head").length >= 2),
        );
        const customRecords = customRoots.map((root, rootIndex) => {
          const heads = Array.from(root.querySelectorAll(".accordion-head")).filter((head) => renderedText(head));
          const items = heads.map((head) => {
            const contentRoot = head.nextElementSibling?.matches?.(".accordion-content,[role='region']") ? head.nextElementSibling : document.getElementById(head.getAttribute("aria-controls") || "");
            const paragraphs = Array.from(contentRoot?.querySelectorAll?.("p,li") || []).map((child) => semanticText(child)).filter(Boolean);
            const fallbackText = contentRoot ? semanticText(contentRoot) : "";
            const content = paragraphs.length ? paragraphs : fallbackText ? [fallbackText] : [];
            const images = Array.from(contentRoot?.querySelectorAll?.("img") || []).map((image) => ({ src: image.currentSrc || image.src || "", alt: image.alt || "" })).filter((image) => image.src && !/(emoji|twemoji|wp-smiley)/i.test(image.src));
            const links = Array.from(contentRoot?.querySelectorAll?.("a[href]") || []).map((link) => ({ text: semanticText(link), url: link.href })).filter((link) => link.url);
            const expanded = head.getAttribute("aria-expanded") === "true" || contentRoot && getComputedStyle(contentRoot).display !== "none" && getComputedStyle(contentRoot).visibility !== "hidden" && contentRoot.getBoundingClientRect().height > 0;
            return { heading: renderedText(head), paragraphs: content, images, links, initialExpanded: Boolean(expanded), itemStructure: images.length ? content.length ? "media-and-text" : "media-only" : "text-only", layoutHints: { mediaCount: images.length, paragraphCount: content.length, firstContentKind: images.length ? "media-first" : "text-first", headingLevel: Number(head.tagName.slice(1)) || null } };
          });
          const expanded = items.map((item, index) => item.initialExpanded ? index : null).filter((index) => index !== null);
          return { kind: "accordion-repeater", source: "dom:accordion-head", label: cleanText(root.getAttribute("aria-label")) || `accordion-${rootIndex + 1}`, itemCount: items.length, schema: { hasHeading: true, hasParagraphs: items.every((item) => item.paragraphs.length > 0), hasImages: items.some((item) => item.images.length > 0), maxImagesPerItem: Math.max(0, ...items.map((item) => item.images.length)) }, state: { initialExpandedIndices: expanded, multipleOpen: expanded.length > 1, openBehavior: root.classList.contains("tatsu-accordion") ? "single" : "requires-interaction-probe" }, items };
        }).filter((record) => record.itemCount >= 2 && record.items.every((item) => item.paragraphs.length));
        return [...nativeRecords, ...customRecords];
      }

      const repeaterResult = extractRepeaters(repeaterPlan);
      const accordionRepeaters = extractAccordionRepeaters(document.querySelector("main, [role='main'], #main, #content") || document.body);
      const visualAssets = collectVisualAssets();
      const visibleLinks = dedupeNav(Array.from(document.querySelectorAll("a[href]")).filter(isVisible).map(linkRecord)).slice(0, 240)
        .map((link) => ({ text: link.label, url: link.href }));
      return {
        sections: sectionResult.sections,
        sectionDiagnostics: sectionResult.diagnostics,
        footer,
        computedTokens,
        repeaters: [...repeaterResult.repeaters, ...accordionRepeaters],
        repeaterDiagnostics: repeaterResult.diagnostics,
        ignoredSurfaces,
        visualAssets,
        links: visibleLinks,
        chrome: {
          direction,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          header: {
            variants: [initialHeader, scrolledHeader],
            maxStickyViewportRatio: 0.16,
          },
          navigation,
          heroEvidence: {
            visibleText,
            forbiddenSeoOnlyText: [],
          },
        },
      };
    }, repeaterPlan);
    const normalizedDesktopDom = await page.content();
    browserData.chrome.heroEvidence.forbiddenSeoOnlyText = seoOnlyText({ seo, visibleText: browserData.chrome.heroEvidence.visibleText });
    const extractionWarnings = [
      ...((desktopNavigation.warnings || []).map((warning) => `navigation: ${warning}`)),
      ...(browserData.sectionDiagnostics?.warnings || []),
      ...(browserData.repeaterDiagnostics?.warnings || []),
    ];
    return {
      url,
      path: new URL(url).pathname || "/",
      area: classifyUrl(url),
      title: seo.title,
      seo,
      navigation: desktopNavigation,
      sections: browserData.sections.length ? browserData.sections : extractSectionsFromHtml(html),
      sectionDiagnostics: browserData.sectionDiagnostics || {
        source: "dom-layout+a11y",
        contentRoot: "unknown",
        accessibilitySnapshotAvailable: Boolean(repeaterPlan?.accessibilitySnapshotAvailable),
        accessibilityRoot: repeaterPlan?.accessibilityRoot || null,
        candidateCount: 0,
        acceptedSectionCount: 0,
        acceptedModuleCount: 0,
        warnings: ["no-strong-section-boundaries"],
      },
      repeaters: browserData.repeaters || [],
      repeaterDiagnostics: browserData.repeaterDiagnostics || { source: "accessibility+dom", signalCount: 0, acceptedRepeaterCount: 0, warnings: [] },
      footer: browserData.footer || null,
      ignoredSurfaces: browserData.ignoredSurfaces || [],
      normalizationActions: (browserData.ignoredSurfaces || []).flatMap((surface) => [
        {
          phase: "before-scroll-sweep",
          action: "quarantine-obstructive-surface",
          surfaceId: surface.id,
          kind: surface.kind,
          reason: surface.reason,
          reversible: true,
        },
        {
          phase: "after-scroll-sweep",
          action: "verify-surface-remains-quarantined",
          surfaceId: surface.id,
          kind: surface.kind,
          reversible: true,
        },
      ]),
      visualAssets: browserData.visualAssets || [],
      links: browserData.links?.length ? browserData.links : extractLinks(html, url),
      tokens: { ...inferTokensFromHtml(html), computed: browserData.computedTokens },
      chrome: browserData.chrome,
      responsiveTextGeometry,
      screenshots: screenshotMap,
      navigationProfiles,
      rawDomSnapshots: htmlByViewport,
      normalizedDomSnapshots: { desktop: normalizedDesktopDom },
      accessibilityEvidence: {
        snapshotAvailable: Boolean(repeaterPlan?.accessibilitySnapshotAvailable),
        root: repeaterPlan?.accessibilityRoot || null,
        signalCount: repeaterPlan?.signals?.length || 0,
      },
      extractionWarnings: extractionWarnings.length ? extractionWarnings : undefined,
      extractedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

async function captureImportantTextGeometry(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
    };
    const lineCount = (node) => {
      const tops = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
        if (!clean(textNode.nodeValue)) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0 && !tops.some((top) => Math.abs(top - rect.top) <= 2)) tops.push(rect.top);
        }
      }
      return Math.max(1, tops.length);
    };
    return Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(visible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const lines = lineCount(node);
        return {
          text: clean(node.textContent).slice(0, 240),
          tag: node.tagName.toLowerCase(),
          inlineSize: Math.round(rect.width * 100) / 100,
          blockSize: Math.round(rect.height * 100) / 100,
          lineCount: lines,
          wrapPolicy: lines === 1 ? "single-line" : style.whiteSpace === "nowrap" ? "clipped-or-overflowing" : "wrapped",
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          maxWidth: style.maxWidth,
        };
      })
      .filter((item) => item.text)
      .slice(0, 48);
  });
}

async function extractWithFetch(url) {
  const html = await fetchText(url);
  const seo = extractSeo(html, url);
  return {
    url,
    path: new URL(url).pathname || "/",
    area: classifyUrl(url),
    title: seo.title,
    seo,
    sections: extractSectionsFromHtml(html),
    sectionDiagnostics: {
      source: "none",
      contentRoot: "none",
      accessibilitySnapshotAvailable: false,
      accessibilityRoot: null,
      candidateCount: 0,
      acceptedSectionCount: 0,
      acceptedModuleCount: 0,
      warnings: ["browser-unavailable: section extraction requires browser-based DOM, layout, and accessibility evidence"],
    },
    repeaters: [],
    repeaterDiagnostics: {
      source: "none",
      accessibilitySnapshotAvailable: false,
      signalCount: 0,
      acceptedRepeaterCount: 0,
      warnings: ["browser-unavailable: repeater extraction requires browser-based accessibility and DOM evidence"],
    },
    footer: null,
    links: extractLinks(html, url),
    tokens: inferTokensFromHtml(html),
    chrome: {
      direction: "unknown",
      header: { variants: [], maxStickyViewportRatio: 0.16 },
      navigation: [],
      heroEvidence: {
        visibleText: [],
        forbiddenSeoOnlyText: seoOnlyText({ seo, visibleText: [] }),
      },
      warnings: ["browser-unavailable: header behavior, dropdown hierarchy, logo footprint, and hero visible-text evidence require manual screenshot review"],
    },
    screenshots: {},
    extractionWarnings: ["browser-unavailable: repeater extraction requires browser-based accessibility and DOM evidence"],
    extractedAt: new Date().toISOString(),
  };
}

async function detectRepeaterSignals(page) {
  const candidates = [
    { selector: 'main, [role="main"]', label: "main" },
    { selector: "article", label: "article" },
    { selector: "body", label: "body" },
  ];
  const failures = [];
  for (const candidate of candidates) {
    const locator = page.locator(candidate.selector).first();
    const count = await locator.count();
    if (count === 0) {
      failures.push(`${candidate.label}: selector did not match any element`);
      continue;
    }
    try {
      const snapshot = await locator.ariaSnapshot({ mode: "ai" });
      const detection = detectRepeaterSignalsFromAria(snapshot);
      return {
        accessibilitySnapshotAvailable: true,
        accessibilityRoot: candidate.label,
        candidateCount: detection.candidateCount,
        signals: detection.signals,
        warnings: detection.signals.length
          ? []
          : [`accessibility-snapshot-captured-on-${candidate.label}-but-no-high-confidence-repeater-patterns-found`],
      };
    } catch (error) {
      failures.push(`${candidate.label}: ${error.message}`);
    }
  }
  return {
    accessibilitySnapshotAvailable: false,
    accessibilityRoot: null,
    candidateCount: 0,
    signals: [],
    warnings: [`accessibility-snapshot-unavailable: ${failures.join("; ")}`],
  };
}

async function navigateWithAdaptiveProfile(page, url) {
  const profiles = [
    { name: "normal", waitUntil: "networkidle", timeoutMs: 45000, settleMs: 0 },
    { name: "slow-site", waitUntil: "domcontentloaded", timeoutMs: 90000, settleMs: 2000 },
  ];
  const warnings = [];
  let lastError = null;
  for (const profile of profiles) {
    try {
      await page.goto(url, { waitUntil: profile.waitUntil, timeout: profile.timeoutMs });
      if (profile.settleMs > 0) {
        await page.waitForTimeout(profile.settleMs);
      }
      if (profile.name !== "normal") {
        warnings.push(`used ${profile.name} navigation profile after the default profile did not settle cleanly`);
      }
      return {
        profile: profile.name,
        waitUntil: profile.waitUntil,
        timeoutMs: profile.timeoutMs,
        warnings,
      };
    } catch (error) {
      lastError = error;
      warnings.push(`${profile.name} failed: ${error.message}`);
    }
  }
  throw lastError;
}

function detectRepeaterSignalsFromAria(snapshot) {
  const tree = parseAriaSnapshot(snapshot);
  if (!tree) return { signals: [], candidateCount: 0 };
  const mains = [];
  walkAriaTree(tree, (node) => {
    if (node.role === "main") mains.push(node);
  });
  const root = mains.at(-1) || tree;
  const candidates = [];
  walkAriaTree(root, (node) => {
    const grouped = groupHeadingContentPairs(node.children || []);
    for (const group of grouped) {
      if (group.items.length >= 3) candidates.push(group);
    }
  });
  candidates.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return averageMediaCount(b.items) - averageMediaCount(a.items);
  });
  return {
    candidateCount: candidates.length,
    signals: candidates.slice(0, 3).map((candidate, index) => ({
      label: `main-repeated-content-${index + 1}`,
      headingLevel: candidate.headingLevel,
      roleSignature: `heading-${candidate.headingLevel}+generic`,
      items: candidate.items.map((item) => ({
        heading: item.heading,
        paragraphCount: item.paragraphCount,
        imageCount: item.imageCount,
      })),
    })),
  };
}

function averageMediaCount(items) {
  return items.reduce((sum, item) => sum + item.imageCount, 0) / Math.max(items.length, 1);
}

function groupHeadingContentPairs(children = []) {
  const grouped = new Map();
  for (let index = 0; index < children.length - 1; index += 1) {
    const heading = children[index];
    const content = children[index + 1];
    if (heading.role !== "heading" || content.role !== "generic") continue;
    const headingLevel = heading.level || 0;
    if (headingLevel < 2) continue;
    const paragraphCount = countAriaRole(content, "paragraph");
    const imageCount = countAriaRole(content, "img");
    if (!heading.name || paragraphCount < 1 || imageCount < 1) continue;
    const key = String(headingLevel);
    if (!grouped.has(key)) grouped.set(key, { headingLevel, items: [] });
    grouped.get(key).items.push({
      heading: heading.name,
      paragraphCount,
      imageCount,
    });
  }
  return Array.from(grouped.values());
}

function countAriaRole(node, role) {
  let count = 0;
  walkAriaTree(node, (current) => {
    if (current.role === role) count += 1;
  });
  return count;
}

function walkAriaTree(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.children || []) walkAriaTree(child, visit);
}

function parseAriaSnapshot(snapshot) {
  const lines = String(snapshot || "")
    .split("\n")
    .map((line) => line.match(/^(\s*)- (.*)$/))
    .filter(Boolean)
    .map(([, indent, content]) => ({ depth: Math.floor(indent.length / 2), content }));
  if (!lines.length) return null;
  const root = { role: "root", children: [] };
  const stack = [root];
  for (const line of lines) {
    const node = parseAriaLine(line.content);
    if (!node) continue;
    while (stack.length > line.depth + 1) stack.pop();
    const parent = stack[stack.length - 1];
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function parseAriaLine(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("text:")) {
    return { role: "text", name: trimmed.slice(5).trim(), children: [] };
  }
  const roleMatch = trimmed.match(/^([a-zA-Z0-9-]+)/);
  if (!roleMatch) return null;
  const role = roleMatch[1];
  const nameMatch = trimmed.match(/"([^"]+)"/);
  const levelMatch = trimmed.match(/\[level=(\d+)\]/);
  return {
    role,
    name: nameMatch?.[1] || "",
    level: levelMatch ? Number(levelMatch[1]) : null,
    raw: trimmed,
    children: [],
  };
}

function seoOnlyText({ seo, visibleText }) {
  const visible = new Set((visibleText || []).map(normalizeEvidenceText));
  return [
    seo?.title,
    seo?.openGraph?.["og:title"],
    seo?.jsonLd?.name,
    seo?.jsonLd?.description,
    seo?.description,
  ]
    .flat()
    .filter(Boolean)
    .map((value) => String(value).replace(/&#039;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((value) => !visible.has(normalizeEvidenceText(value)));
}

function normalizeEvidenceText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
