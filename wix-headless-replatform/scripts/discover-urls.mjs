#!/usr/bin/env node
import path from "node:path";
import {
  DISCOVERY_LIMITS,
  classifyUrl,
  countBy,
  docsDir,
  ensureDir,
  extractLinks,
  fetchText,
  isAssetLikeUrl,
  limitRepresentativePages,
  normalizeDiscoveredUrl,
  normalizeUrl,
  parseArgs,
  resolveOutputDir,
  sameOrigin,
  writeJson,
} from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
  const scope = String(args.scope || "home");
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  const outDir = docsDir(outputDir);
  await ensureDir(outDir);

  const explicitUrls = parseUrlList(args.urls, sourceUrl);
  const discovery = await discover({ sourceUrl, scope, explicitUrls });
  await writeJson(path.join(outDir, "discovery.json"), discovery);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);
    return;
  }
  printSummary(discovery);
}

export async function discover({ sourceUrl, scope = "home", explicitUrls = [] }) {
  const normalizedScope = explicitUrls.length ? "specific" : scope;
  const limits = DISCOVERY_LIMITS[normalizedScope] || DISCOVERY_LIMITS.full;
  const source = normalizeUrl(sourceUrl).toString();
  const seedUrls = new Set([source, ...explicitUrls]);
  const queue = [{ url: source, depth: 0, inScope: true }];
  for (const url of explicitUrls) queue.push({ url, depth: 0 });

  const seen = new Set();
  const pages = [];
  const excluded = [];

  while (queue.length && pages.length < limits.maxUrls) {
    const current = queue.shift();
    if (!current || seen.has(current.url)) continue;
    seen.add(current.url);
    if (!sameOrigin(source, current.url)) {
      excluded.push({ url: current.url, reason: "external" });
      continue;
    }
    if (isAssetLikeUrl(current.url)) {
      excluded.push({ url: current.url, reason: "non-page-asset" });
      continue;
    }

    const area = classifyUrl(current.url);
    pages.push({
      url: current.url,
      path: new URL(current.url).pathname || "/",
      area,
      depth: current.depth,
      inScope: current.inScope ?? (seedUrls.has(current.url) || normalizedScope !== "specific"),
    });

    if (normalizedScope === "home" || current.depth >= limits.maxDepth) continue;

    try {
      const html = await fetchText(current.url);
      const links = extractLinks(html, current.url);
      for (const link of links) {
        if (pages.length + queue.length >= limits.maxUrls * 2) break;
        if (!sameOrigin(source, link.url)) {
          excluded.push({ url: link.url, reason: "external" });
          continue;
        }
        if (isAssetLikeUrl(link.url)) {
          excluded.push({ url: link.url, reason: "non-page-asset" });
          continue;
        }
        if (!seen.has(link.url)) queue.push({ url: link.url, depth: current.depth + 1, inScope: normalizedScope !== "specific" });
      }
    } catch (error) {
      excluded.push({ url: current.url, reason: `fetch-failed: ${error.message}` });
    }
  }

  const inScopePages = pages.filter((page) => page.inScope);
  const preservedPages = pages.filter((page) => !page.inScope);
  const representativePages = normalizedScope === "specific"
    ? inScopePages
    : limitRepresentativePages(pages, normalizedScope);
  return {
    sourceUrl: source,
    scope: normalizedScope,
    limits,
    totalDiscovered: pages.length,
    countsByArea: countBy(pages, (page) => page.area),
    pages,
    inScopePages,
    preservedPages,
    representativePages,
    excluded,
    requiresConfirmation: normalizedScope !== "home" && normalizedScope !== "specific",
    generatedAt: new Date().toISOString(),
  };
}

function parseUrlList(value, sourceUrl) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => normalizeDiscoveredUrl(sourceUrl, item.trim()))
    .filter((item) => item && !isAssetLikeUrl(item))
    .filter(Boolean);
}

function printSummary(discovery) {
  console.log(`Discovered ${discovery.totalDiscovered} same-origin URL(s).`);
  for (const [area, count] of Object.entries(discovery.countsByArea)) {
    console.log(`- ${area}: ${count}`);
  }
  if (discovery.requiresConfirmation) {
    console.log("");
    console.log("Confirmation required before extraction/building.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
