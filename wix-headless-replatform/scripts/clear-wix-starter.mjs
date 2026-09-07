#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { ensureDir, parseArgs, resolveOutputDir, writeText } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = args.out ? path.normalize(args.out) : resolveOutputDir(args._[0] || args.url, args.out);
  const result = await clearWixStarter({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Cleared Wix starter files in ${outputDir}`);
    for (const item of result.removed) console.log(`- removed ${item}`);
    for (const item of result.written) console.log(`- wrote ${item}`);
  }
}

export async function clearWixStarter({ outputDir }) {
  const removed = [];
  const written = [];
  const relativeRemovals = [
    "src/components/AppIsland.jsx",
    "src/pages/about.astro",
  ];

  for (const relative of relativeRemovals) {
    await rm(path.join(outputDir, relative), { force: true });
    removed.push(relative);
  }

  await ensureDir(path.join(outputDir, "src", "components"));
  await ensureDir(path.join(outputDir, "src", "layouts"));
  await ensureDir(path.join(outputDir, "src", "pages"));

  await writeText(path.join(outputDir, "src", "layouts", "Layout.astro"), `---
const { title = "Site Clone", description = "Generated site clone." } = Astro.props;
---

<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="UTF-8" />
\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />
\t\t<meta name="description" content={description} />
\t\t<meta name="generator" content={Astro.generator} />
\t\t<title>{title}</title>
\t</head>
\t<body>
\t\t<slot />
\t</body>
</html>

<style is:global>
\t* {
\t\tbox-sizing: border-box;
\t}

\tbody {
\t\tmargin: 0;
\t\tmin-width: 320px;
\t\tfont-family: system-ui, sans-serif;
\t}
</style>
`);
  written.push("src/layouts/Layout.astro");

  await writeText(path.join(outputDir, "src", "pages", "index.astro"), `---
import Layout from "../layouts/Layout.astro";
---

<Layout>
\t<main>
\t\t<h1>Site clone starter cleared</h1>
\t</main>
</Layout>
`);
  written.push("src/pages/index.astro");

  return { outputDir, removed, written };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
