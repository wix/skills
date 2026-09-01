import { stripTags } from "./common.mjs";

export function extractTitle(html) {
  return matchContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || "";
}

export function extractMeta(html) {
  const metas = [];
  const pattern = /<meta\b([^>]+)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = parseAttrs(match[1]);
    metas.push(attrs);
  }
  return metas;
}

export function extractSeo(html, url) {
  const metas = extractMeta(html);
  const metaBy = (field, value) => metas.find((meta) => meta[field] === value)?.content || "";
  const canonical = matchAttr(html, /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i, "href");
  const icons = [];
  const linkPattern = /<link\b([^>]+)>/gi;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(html))) {
    const attrs = parseAttrs(linkMatch[1]);
    if ((attrs.rel || "").toLowerCase().includes("icon")) icons.push(attrs.href);
  }
  const schema = [];
  const schemaPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let schemaMatch;
  while ((schemaMatch = schemaPattern.exec(html))) schema.push(schemaMatch[1].trim());
  return {
    url,
    title: extractTitle(html),
    description: metaBy("name", "description"),
    robots: metaBy("name", "robots"),
    canonical,
    openGraph: Object.fromEntries(metas.filter((m) => m.property?.startsWith("og:")).map((m) => [m.property, m.content || ""])),
    twitter: Object.fromEntries(metas.filter((m) => m.name?.startsWith("twitter:")).map((m) => [m.name, m.content || ""])),
    icons,
    schema,
  };
}

export function extractSectionsFromHtml(html) {
  const body = rawMatchContent(html, /<body[^>]*>([\s\S]*?)<\/body>/i) || html;
  const sectionPattern = /<(header|main|section|article|footer|nav)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const sections = [];
  let match;
  while ((match = sectionPattern.exec(body)) && sections.length < 40) {
    const text = visibleHtmlText(match[3]);
    if (!text) continue;
    sections.push({
      tag: match[1].toLowerCase(),
      id: parseAttrs(match[2]).id || "",
      className: parseAttrs(match[2]).class || "",
      text: text.slice(0, 1600),
      heading: firstHeading(match[3]),
    });
  }
  if (!sections.length) {
    const text = visibleHtmlText(body);
    sections.push({ tag: "body", id: "", className: "", heading: "", text: text.slice(0, 3000) });
  }
  return sections;
}

export function extractAssetsFromHtml(html, baseUrl) {
  const assets = [];
  const add = (value, type) => {
    try {
      const url = new URL(value, baseUrl);
      if (/^https?:$/.test(url.protocol)) assets.push({ sourceUrl: url.toString(), type });
    } catch {
      // Ignore invalid asset URLs.
    }
  };
  for (const pattern of [
    { re: /<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, type: "image" },
    { re: /<source\b[^>]*srcset\s*=\s*["']([^"']+)["'][^>]*>/gi, type: "image" },
    { re: /<video\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, type: "video" },
    { re: /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, type: "linked" },
  ]) {
    let match;
    while ((match = pattern.re.exec(html))) {
      const candidates = String(match[1]).split(",").map((part) => part.trim().split(/\s+/)[0]);
      for (const candidate of candidates) add(candidate, pattern.type);
    }
  }
  const bgPattern = /url\((['"]?)([^'")]+)\1\)/gi;
  let bgMatch;
  while ((bgMatch = bgPattern.exec(html))) add(bgMatch[2], "background");
  return dedupeAssets(assets);
}

export function extractStylesheetUrls(html, baseUrl) {
  const urls = [];
  const pattern = /<link\b([^>]+)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = parseAttrs(match[1]);
    if (!/\bstylesheet\b/i.test(attrs.rel || "")) continue;
    if (!attrs.href) continue;
    try {
      urls.push(new URL(attrs.href, baseUrl).toString());
    } catch {
      // Ignore invalid stylesheet URLs.
    }
  }
  return Array.from(new Set(urls));
}

export function inferTokensFromHtml(html) {
  const colors = Array.from(new Set((html.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((c) => c.toLowerCase()))).slice(0, 24);
  const fontFamilies = Array.from(
    new Set(
      (html.match(/font-family\s*:\s*([^;"}]+)/gi) || [])
        .map((value) => value.split(":").slice(1).join(":").trim().replace(/^['"]|['"]$/g, "")),
    ),
  ).slice(0, 12);
  const radii = Array.from(new Set(html.match(/border-radius\s*:\s*[^;"}]+/gi) || [])).slice(0, 12);
  const shadows = Array.from(new Set(html.match(/box-shadow\s*:\s*[^;"}]+/gi) || [])).slice(0, 12);
  return { colors, fontFamilies, radii, shadows };
}

export function parseAttrs(raw) {
  const attrs = {};
  const pattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(raw || ""))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function matchContent(html, pattern) {
  const match = pattern.exec(html);
  return match ? visibleHtmlText(match[1]) : "";
}

function rawMatchContent(html, pattern) {
  return pattern.exec(html)?.[1] || "";
}

function visibleHtmlText(html) {
  const withoutNonContent = String(html || "").replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return stripTags(withoutNonContent).replace(/\s+/g, " ").trim();
}

function matchAttr(html, tagPattern, attr) {
  const match = tagPattern.exec(html);
  if (!match) return "";
  return parseAttrs(match[0])[attr] || "";
}

function firstHeading(html) {
  return matchContent(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
}

function dedupeAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    if (seen.has(asset.sourceUrl)) return false;
    seen.add(asset.sourceUrl);
    return true;
  });
}
