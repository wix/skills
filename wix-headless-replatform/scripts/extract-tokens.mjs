#!/usr/bin/env node
import path from "node:path";
import { docsDir, normalizeUrl, parseArgs, readJson, resolveOutputDir, writeJson } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const tokens = await extractTokens({ outputDir });
  await writeJson(path.join(docsDir(outputDir), "tokens.json"), tokens);
  if (args.json) process.stdout.write(`${JSON.stringify(tokens, null, 2)}\n`);
}

export async function extractTokens({ outputDir }) {
  const sourceMapPath = path.join(docsDir(outputDir), "source-map.json");
  let sourceMap = { pages: [] };
  try {
    sourceMap = await readJson(sourceMapPath);
  } catch {
    // Allow standalone use before source-map exists.
  }
  const colors = new Set();
  const fonts = new Set();
  const radii = new Set();
  const shadows = new Set();
  const fontSizes = new Set();

  for (const page of sourceMap.pages || []) {
    for (const color of page.tokens?.colors || []) colors.add(color);
    for (const font of page.tokens?.fontFamilies || []) fonts.add(font);
    for (const radius of page.tokens?.radii || []) radii.add(radius);
    for (const shadow of page.tokens?.shadows || []) shadows.add(shadow);
    for (const item of page.tokens?.computed || []) {
      if (item.color && item.color !== "rgba(0, 0, 0, 0)") colors.add(item.color);
      if (item.backgroundColor && item.backgroundColor !== "rgba(0, 0, 0, 0)") colors.add(item.backgroundColor);
      if (item.fontFamily) fonts.add(item.fontFamily);
      if (item.fontSize) fontSizes.add(item.fontSize);
      if (item.borderRadius && item.borderRadius !== "0px") radii.add(item.borderRadius);
      if (item.boxShadow && item.boxShadow !== "none") shadows.add(item.boxShadow);
    }
  }

  return {
    colors: Array.from(colors).slice(0, 32),
    fontFamilies: Array.from(fonts).slice(0, 16),
    fontSizes: Array.from(fontSizes).slice(0, 16),
    radii: Array.from(radii).slice(0, 16),
    shadows: Array.from(shadows).slice(0, 16),
    recommendedTailwindTokens: {
      colors: "Map primary, secondary, background, foreground, muted, accent, border from extracted colors.",
      fonts: "Map sans/display/body from extracted font families and local downloaded fonts.",
      spacing: "Infer from section rhythm; start with Tailwind defaults and add container widths.",
    },
    generatedAt: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
