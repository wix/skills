#!/usr/bin/env node
import path from "node:path";
import {
  classifyTemplate,
  docsDir,
  isDynamicArea,
  isAssetLikeUrl,
  normalizeUrl,
  parseArgs,
  readJson,
  resolveOutputDir,
  routePathFromUrl,
  writeJson,
} from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const routes = await generateRoutePlan({ sourceUrl: url, outputDir });
  await writeJson(path.join(docsDir(outputDir), "routes.json"), routes);
  if (args.json) process.stdout.write(`${JSON.stringify(routes, null, 2)}\n`);
}

export async function generateRoutePlan({ sourceUrl, outputDir }) {
  const dir = docsDir(outputDir);
  const discovery = await safeRead(path.join(dir, "discovery.json"), { pages: [] });
  const pages = (discovery.pages || []).filter((page) => page?.url && !isAssetLikeUrl(page.url));
  const inScopeUrls = new Set((discovery.inScopePages || pages.filter((page) => page.inScope))
    .filter((page) => page?.url && !isAssetLikeUrl(page.url))
    .map((page) => page.url));
  const routes = [];
  const inScopeRoutes = [];
  const preservedFallbackLinks = [];
  const dynamicSeen = new Set();
  for (const page of pages) {
    const inScope = inScopeUrls.has(page.url) || discovery.scope !== "specific";
    if (!inScope) {
      const route = notMigratedRouteFor({ sourceUrl, page });
      routes.push(route);
      preservedFallbackLinks.push(route);
      continue;
    }
    if (isDynamicArea(page.area)) {
      const template = classifyTemplate(page.area);
      if (dynamicSeen.has(template)) {
        const existing = routes.find((route) => route.template === template);
        existing?.representativeUrls?.push(page.url);
        continue;
      }
      dynamicSeen.add(template);
      const route = dynamicRouteFor(page, template);
      routes.push(route);
      inScopeRoutes.push(route);
      continue;
    }
    if (page.area === "home" || inStaticScope(page.area)) {
      const route = {
        sourceUrl: page.url,
        sourcePath: routePathFromUrl(sourceUrl, page.url),
        targetRoute: routePathFromUrl(sourceUrl, page.url) || "/",
        kind: "static",
        area: page.area,
        representativeUrls: [page.url],
      };
      routes.push(route);
      inScopeRoutes.push(route);
      continue;
    }
    const route = notMigratedRouteFor({ sourceUrl, page });
    routes.push(route);
    preservedFallbackLinks.push(route);
  }
  return {
    sourceUrl,
    routes,
    inScopeRoutes,
    preservedFallbackLinks,
    dynamicRouteCount: routes.filter((route) => route.kind === "dynamic").length,
    notMigratedCount: routes.filter((route) => route.kind === "not-migrated").length,
    generatedAt: new Date().toISOString(),
  };
}

function notMigratedRouteFor({ sourceUrl, page }) {
  const sourcePath = routePathFromUrl(sourceUrl, page.url);
  return {
    sourceUrl: page.url,
    sourcePath,
    targetRoute: `/not-migrated?from=${encodeURIComponent(sourcePath)}`,
    kind: "not-migrated",
    area: page.area,
    representativeUrls: [page.url],
  };
}

function dynamicRouteFor(page, template) {
  const config = {
    "product-detail": { targetRoute: "/products/[slug]", dataSource: "wix-stores" },
    "product-category": { targetRoute: "/categories/[slug]", dataSource: "wix-stores" },
    "blog-post": { targetRoute: "/blog/[slug]", dataSource: "wix-blog" },
    "blog-index": { targetRoute: "/blog", dataSource: "wix-blog" },
    "cms-item": { targetRoute: "/content/[slug]", dataSource: "wix-cms" },
    booking: { targetRoute: "/bookings/[slug]", dataSource: "wix-bookings" },
    event: { targetRoute: "/events/[slug]", dataSource: "wix-events" },
    "pricing-plan": { targetRoute: "/pricing", dataSource: "wix-pricing-plans" },
  }[template] || { targetRoute: `/${page.area}/[slug]`, dataSource: "wix-sdk" };
  return {
    sourcePattern: patternFor(page),
    sourcePath: page.path,
    targetRoute: config.targetRoute,
    kind: "dynamic",
    area: page.area,
    template,
    dataSource: config.dataSource,
    representativeUrls: [page.url],
  };
}

function patternFor(page) {
  const parts = String(page.path || "/").split("/").filter(Boolean);
  if (parts.length <= 1) return page.path || "/";
  return `/${parts.slice(0, -1).join("/")}/*`;
}

function inStaticScope(area) {
  return ["about-contact", "legal", "docs", "other"].includes(area);
}

async function safeRead(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
