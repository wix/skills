#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import {
  dedupeBy,
  docsDir,
  ensureDir,
  fetchText,
  normalizeUrl,
  parseArgs,
  resolveOutputDir,
  slugForUrl,
  writeJson,
} from "./lib/common.mjs";
import { extractAssetsFromHtml, extractStylesheetUrls } from "./lib/html-extract.mjs";
import { buildFontManifest } from "./lib/font-contract.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const manifest = await extractAssets(url, { outputDir, download: args.download !== "false" });
  await writeJson(path.join(docsDir(outputDir), "assets.json"), manifest);
  await writeJson(path.join(docsDir(outputDir), "fonts.json"), manifest.fonts);
  if (args.json) process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

export async function extractAssets(url, { outputDir, download = true } = {}) {
  const html = await fetchText(url);
  const stylesheets = await loadStylesheets(html, url);
  const fonts = buildFontManifest({ html, baseUrl: url, stylesheets });
  const discovered = dedupeBy(
    [
      ...extractAssetsFromHtml(html, url),
      ...fonts.faces.flatMap((face) =>
        (face.sources || [])
          .filter((source) => source.kind === "url" && source.url)
          .map((source) => ({ sourceUrl: source.url, type: "font-face" })),
      ),
    ].filter((asset) => usefulAsset(asset.sourceUrl)),
    (asset) => asset.sourceUrl,
  );
  const assets = [];
  for (const asset of discovered.slice(0, 120)) {
    const localPath = path.join("public", "site-clone", "assets", localAssetName(asset.sourceUrl));
    const record = { ...asset, localPath };
    if (download && outputDir) {
      try {
        await downloadAsset(asset.sourceUrl, path.join(outputDir, localPath));
        record.downloaded = true;
      } catch (error) {
        record.downloaded = false;
        record.error = error.message;
      }
    }
    assets.push(record);
  }
  const assetByUrl = new Map(assets.map((asset) => [asset.sourceUrl, asset]));
  const hydratedFonts = {
    ...fonts,
    faces: fonts.faces.map((face) => ({
      ...face,
      sources: (face.sources || []).map((source) => {
        const downloaded = assetByUrl.get(source.url);
        return downloaded
          ? {
              ...source,
              localPath: downloaded.localPath,
              downloaded: downloaded.downloaded === true,
            }
          : source;
      }),
    })),
  };
  return { url, assets, fonts: hydratedFonts, generatedAt: new Date().toISOString() };
}

async function loadStylesheets(html, url) {
  const urls = extractStylesheetUrls(html, url);
  const stylesheets = [];
  for (const stylesheetUrl of urls.slice(0, 24)) {
    try {
      const cssText = await fetchText(stylesheetUrl, {
        headers: {
          accept: "text/css,*/*;q=0.1",
        },
      });
      stylesheets.push({ url: stylesheetUrl, cssText, sourceType: "linked-stylesheet" });
    } catch {
      // Preserve recoverability; unresolved stylesheets stay out of the deterministic manifest.
    }
  }
  return stylesheets;
}

async function downloadAsset(url, filePath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await ensureDir(path.dirname(filePath));
  await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, buffer));
}

function localAssetName(urlValue) {
  const pathname = assetPathname(urlValue);
  const ext = path.extname(pathname).split("?")[0] || ".bin";
  return `${assetSlug(urlValue).slice(0, 70)}-${createHash("sha1").update(urlValue).digest("hex").slice(0, 8)}${ext}`;
}

function usefulAsset(urlValue) {
  return /\.(png|jpe?g|webp|gif|svg|ico|avif|mp4|webm|woff2?|ttf|otf)(\?|$)/i.test(urlValue);
}

function assetPathname(urlValue) {
  try {
    return new URL(urlValue).pathname || "";
  } catch {
    try {
      return new URL(urlValue, "https://local.invalid").pathname || "";
    } catch {
      const sanitized = String(urlValue || "").split("#")[0].split("?")[0];
      return sanitized.startsWith("/") ? sanitized : `/${sanitized}`;
    }
  }
}

function assetSlug(urlValue) {
  try {
    return slugForUrl(urlValue);
  } catch {
    return slugForUrl(`https://local.invalid${assetPathname(urlValue) || "/asset"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
