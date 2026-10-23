#!/usr/bin/env node
import path from "node:path";

import { docsDir, parseArgs, readJson, resolveOutputDir, writeJson } from "./lib/common.mjs";
import { validateProjectFontFaces } from "./lib/font-contract.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url || args.out, args.out);
  const projectRoot = path.resolve(args["project-root"] || outputDir);
  const fontsPath = path.join(docsDir(outputDir), "fonts.json");
  const fontManifest = await readJson(fontsPath);
  const result = await validateProjectFontFaces({ projectRoot, fontManifest });
  await writeJson(path.join(docsDir(outputDir), "font-validation.json"), result);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`[font-contract] scanned ${result.filesScanned} file(s), found ${result.declarationCount} @font-face declaration(s)`);
    for (const warning of result.warnings || []) console.log(`[font-contract] warning ${warning.code}: ${warning.message}`);
    for (const issue of result.issues || []) console.log(`[font-contract] issue ${issue.code}: ${issue.message}`);
  }
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
