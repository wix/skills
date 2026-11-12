#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const file = args._[0] || args.file;
  if (!file) throw new Error("Usage: optimize-svg.mjs <file.svg>");
  const optimized = await optimizeSvg(await readFile(file, "utf8"));
  if (args.stdout) process.stdout.write(optimized);
  else await writeFile(args.out || file, optimized, "utf8");
}

export async function optimizeSvg(svg) {
  try {
    const { optimize } = await import("svgo");
    return optimize(svg, { multipass: true }).data;
  } catch {
    return svg
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/>\s+</g, "><")
      .trim();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
