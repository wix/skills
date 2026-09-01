#!/usr/bin/env node
import path from "node:path";
import { rm } from "node:fs/promises";
import { docsDir, ensureDir, kebab, parseArgs, readJson, resolveOutputDir, writeJson, writeText } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url, args.out);
  const contract = await generateVisualAssets({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

export async function generateVisualAssets({ outputDir, pages: suppliedPages, assets: suppliedAssets } = {}) {
  const docs = docsDir(outputDir);
  const sourceMap = suppliedPages ? null : await readJson(path.join(docs, "source-map.json"));
  const pages = suppliedPages || sourceMap?.pages || [];
  let assets = suppliedAssets;
  if (!assets) {
    try { assets = await readJson(path.join(docs, "assets.json")); } catch { assets = { assets: [] }; }
  }
  const downloaded = new Map((assets?.assets || assets || []).map((asset) => [asset.sourceUrl || asset.url || "", asset.localPath || asset.path || ""]));
  const groups = new Map();
  for (const page of pages) {
    for (const record of page.visualAssets || []) {
      if (/cookielaw|onetrust|ot-sdk|cookiebot|quantcast/i.test(`${record.sourceUrl || ""} ${record.useHref || ""} ${record.domRef?.id || ""} ${(record.domRef?.classTokens || []).join(" ")}`)) continue;
      const sourceIdentity = record.sourceUrl || record.useHref || record.symbolMarkup || record.svgMarkup || `${record.domRef?.id}:${record.domRef?.classTokens?.join(".")}`;
      const key = `${record.kind}\u0000${record.sourceType}\u0000${sourceIdentity}`;
      const group = groups.get(key) || {
        id: "",
        kind: record.kind,
        sourceType: record.sourceType,
        sourceUrl: record.sourceUrl || "",
        useHref: record.useHref || "",
        accessibleName: record.accessibleName || "",
        sourceMarkup: record.svgMarkup || "",
        symbolMarkup: record.symbolMarkup || "",
        localPath: downloaded.get(record.sourceUrl) || "",
        usages: [],
      };
      group.usages.push({
        pageUrl: page.url,
        context: record.context,
        variant: record.variant,
        renderedSize: record.renderedSize,
        intrinsicSize: record.intrinsicSize,
        presentation: record.presentation,
        visible: record.visible,
      });
      groups.set(key, group);
    }
  }
  const entries = Array.from(groups.values());
  const publicDir = path.join(outputDir, "public", "site-clone", "visual-assets");
  await rm(publicDir, { recursive: true, force: true });
  await ensureDir(publicDir);
  for (const [index, entry] of entries.entries()) {
    entry.id = `${entry.kind}-${String(index + 1).padStart(3, "0")}`;
    if (!["inline-svg", "svg-sprite-use"].includes(entry.sourceType)) continue;
    const svg = standaloneSvg(entry);
    if (!svg) continue;
    const hint = kebab(entry.accessibleName || entry.useHref || entry.usages[0]?.variant || entry.id).slice(0, 60);
    const filename = `${entry.id}-${hint || "source"}.svg`;
    await writeText(path.join(publicDir, filename), svg);
    entry.localPath = `/site-clone/visual-assets/${filename}`;
    entry.materializedFromSource = true;
  }
  const contract = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceUrl: pages[0]?.url || sourceMap?.sourceUrl || "",
    logos: entries.filter((entry) => entry.kind === "logo"),
    icons: entries.filter((entry) => entry.kind === "icon"),
    policy: {
      logo: ["exact-source-file-or-materialized-svg", "all-observed-variants-and-usage-sizes-required", "never-recreate-as-text", "never-substitute-library-icon"],
      icon: ["exact-source-svg-or-image", "source-sprite-or-source-library", "style-matched-established-library-fallback"],
      fallbackLibrary: "Iconify or another established library whose family matches the captured stroke/fill style; only when no source icon is available.",
    },
  };
  await writeJson(path.join(docs, "visual-assets.json"), contract);
  await writeText(path.join(docs, "visual-assets.md"), renderMarkdown(contract));
  return contract;
}

function standaloneSvg(entry) {
  if (entry.sourceType === "inline-svg" && /^<svg\b/i.test(entry.sourceMarkup.trim())) {
    return entry.sourceMarkup.includes("xmlns=") ? `${entry.sourceMarkup.trim()}\n` : entry.sourceMarkup.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const symbol = entry.symbolMarkup.trim();
  if (!symbol) return "";
  const viewBox = symbol.match(/\bviewBox=["']([^"']+)["']/i)?.[1]
    || entry.usages.find((usage) => usage.intrinsicSize?.viewBox)?.intrinsicSize.viewBox
    || "0 0 100 100";
  const symbolId = symbol.match(/\bid=["']([^"']+)["']/i)?.[1] || String(entry.useHref || "").replace(/^#/, "source-symbol");
  const presentation = entry.usages.find((usage) => usage.visible)?.presentation || entry.usages[0]?.presentation || {};
  const style = `color:${presentation.color || "currentColor"};fill:${presentation.fill || "currentColor"};stroke:${presentation.stroke || "none"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeXml(viewBox)}" style="${escapeXml(style)}"><defs>${symbol}</defs><use href="#${escapeXml(symbolId)}"/></svg>\n`;
}

function escapeXml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(contract) {
  const render = (entry) => `- \`${entry.id}\` (${entry.sourceType}): ${entry.localPath || entry.sourceUrl || entry.useHref || "captured source markup"}; usages: ${entry.usages.map((usage) => `${usage.context}/${usage.variant} ${usage.renderedSize?.width || 0}×${usage.renderedSize?.height || 0}`).join(", ")}`;
  return `# Visual Asset Contract\n\n## Non-negotiable brand rules\n\n${contract.policy.logo.map((item) => `- ${item}`).join("\n")}\n\n## Logos\n\n${contract.logos.map(render).join("\n") || "_No logo candidate captured; this is a blocking discovery warning and requires source inspection._"}\n\n## Icons\n\nSource-first order: exact source → source library/sprite → style-matched established library fallback.\n\n${contract.icons.map(render).join("\n") || "_No standalone/source icon captured._"}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
