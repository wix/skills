import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

export const DISCOVERY_LIMITS = {
  home: { maxUrls: 1, maxDepth: 0 },
  blog: { maxUrls: 50, maxDepth: 3, representativePosts: 3 },
  ecommerce: { maxUrls: 75, maxDepth: 3, representativeProducts: 3, representativeCategories: 3 },
  full: { maxUrls: 150, maxDepth: 3 },
  specific: { maxUrls: 150, maxDepth: 1 },
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

export function normalizeUrl(value) {
  if (!value) throw new Error("Missing URL");
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.hash = "";
  return url;
}

export function sameOrigin(sourceUrl, candidate) {
  try {
    return new URL(candidate, sourceUrl).origin === new URL(sourceUrl).origin;
  } catch {
    return false;
  }
}

export function normalizeDiscoveredUrl(sourceUrl, href) {
  try {
    const url = new URL(href, sourceUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

const NON_PAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".xml",
  ".json",
  ".txt",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

export function isAssetLikeUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const pathname = url.pathname.toLowerCase();
    const extension = path.extname(pathname);
    if (NON_PAGE_EXTENSIONS.has(extension)) return true;
    return pathname.includes("/wp-content/uploads/");
  } catch {
    return false;
  }
}

export function projectNameFromUrl(urlValue) {
  const url = normalizeUrl(urlValue);
  let host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length === 2) host = parts[0];
  return kebab(host);
}

export function kebab(value) {
  return String(value || "site")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "site";
}

export function resolveOutputDir(urlValue, out) {
  if (out) return path.normalize(out);
  return path.join("projects", projectNameFromUrl(urlValue));
}

export function docsDir(outputDir) {
  return path.join(outputDir, "docs", "site-clone");
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeText(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, data, "utf8");
}

export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 5000);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "site-clone-skill/1.0 (+https://wix-headless.dev)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

export function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const url = normalizeDiscoveredUrl(baseUrl, match[1]);
    if (!url) continue;
    links.push({
      url,
      text: stripTags(match[2]).replace(/\s+/g, " ").trim(),
    });
  }
  return dedupeBy(links, (link) => link.url);
}

export function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function classifyUrl(urlValue) {
  const url = new URL(urlValue);
  const pathValue = url.pathname.toLowerCase();
  const joined = `${pathValue} ${url.search.toLowerCase()}`;
  if (isAssetLikeUrl(urlValue)) return "asset";
  if (pathValue === "/" || pathValue === "") return "home";
  if (/(\/products?\/|\/product\/|\/shop\/[^/]+|[?&]product=)/.test(joined)) return "product";
  if (/(\/collections?\/|\/categories?\/|\/category\/|\/shop\/?$|\/store\/?$)/.test(joined)) return "product-category";
  if (/(\/blog\/[^/]+|\/posts?\/[^/]+|\/article\/)/.test(joined)) return "blog-post";
  if (/(\/blog\/?$|\/news\/?$|\/articles\/?$)/.test(joined)) return "blog-index";
  if (/(\/booking|\/bookings|\/appointments?|\/schedule)/.test(joined)) return "bookings";
  if (/(\/events?\/|\/event\/)/.test(joined)) return "events";
  if (/(\/pricing|\/plans|\/membership)/.test(joined)) return "pricing";
  if (/(\/docs|\/documentation|\/help|\/support|\/kb)/.test(joined)) return "docs";
  if (/(\/about|\/contact|\/team|\/company)/.test(joined)) return "about-contact";
  if (/(\/privacy|\/terms|\/legal|\/cookies?)/.test(joined)) return "legal";
  if (/(\/cms|\/resources?|\/guides?|\/case-stud)/.test(joined)) return "cms-content";
  return "other";
}

export function classifyTemplate(area) {
  const dynamic = {
    product: "product-detail",
    "product-category": "product-category",
    "blog-post": "blog-post",
    "blog-index": "blog-index",
    "cms-content": "cms-item",
    bookings: "booking",
    events: "event",
    pricing: "pricing-plan",
  };
  return dynamic[area] || area;
}

export function isDynamicArea(area) {
  return [
    "product",
    "product-category",
    "blog-post",
    "blog-index",
    "cms-content",
    "bookings",
    "events",
    "pricing",
  ].includes(area);
}

export function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function dedupeBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function slugForUrl(urlValue) {
  const url = new URL(urlValue);
  return kebab(`${url.hostname}${url.pathname === "/" ? "-home" : url.pathname}`);
}

export function routePathFromUrl(sourceUrl, targetUrl) {
  const url = new URL(targetUrl, sourceUrl);
  return `${url.pathname}${url.search}` || "/";
}

export function selectWixTemplate(scope, counts = {}) {
  if (scope === "ecommerce" || counts.product || counts["product-category"]) return "commerce";
  if (counts.bookings) return "scheduler";
  if (counts.events || counts.pricing) return "registration";
  return "blank";
}

export function businessNameFromProject(projectName) {
  return projectName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function wixFolderNameFromProject(projectName) {
  return kebab(projectName);
}

export function wixBusinessNameFromProject(projectName) {
  const value = businessNameFromProject(wixFolderNameFromProject(projectName));
  return value || "Site";
}

export function limitRepresentativePages(pages, scope) {
  const limits = DISCOVERY_LIMITS[scope] || DISCOVERY_LIMITS.full;
  const counts = {};
  return pages.filter((page) => {
    if (page.area === "asset") return false;
    const area = page.area;
    if (area === "product") {
      counts.product = (counts.product || 0) + 1;
      return counts.product <= (limits.representativeProducts || 3);
    }
    if (area === "product-category") {
      counts["product-category"] = (counts["product-category"] || 0) + 1;
      return counts["product-category"] <= (limits.representativeCategories || 3);
    }
    if (area === "blog-post") {
      counts["blog-post"] = (counts["blog-post"] || 0) + 1;
      return counts["blog-post"] <= (limits.representativePosts || 3);
    }
    return true;
  });
}
