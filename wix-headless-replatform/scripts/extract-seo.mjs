#!/usr/bin/env node
import path from "node:path";
import { docsDir, fetchText, normalizeUrl, parseArgs, resolveOutputDir, writeJson } from "./lib/common.mjs";
import { extractSeo } from "./lib/html-extract.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const seo = await extractSeoForUrl(url);
  await writeJson(path.join(docsDir(outputDir), "seo.json"), seo);
  if (args.json) process.stdout.write(`${JSON.stringify(seo, null, 2)}\n`);
}

export async function extractSeoForUrl(url) {
  const html = await fetchText(url);
  return extractSeo(html, url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
