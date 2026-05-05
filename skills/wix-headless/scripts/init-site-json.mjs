#!/usr/bin/env node
// Write the initial .wix/site.json shape during Setup. Site.json is the
// single source of truth that every downstream phase reads from / appends
// to. This script writes the canonical initial structure deterministically
// so the orchestrator never has to compose the shape inline (which used
// to be LLM-emitted JSON, with the obvious drift risks).
//
// Usage:
//   node init-site-json.mjs <project-dir> <brand-name> <brand-description> <verticals-csv>
//
// Example:
//   node init-site-json.mjs /tmp/proj "Acme Coffee" "Warm cream-and-forest editorial" "stores,ecom,cms,gift-cards"
//
// Behavior:
//   - Refuses to overwrite an existing .wix/site.json (exit 2). The orchestrator
//     should call this exactly once during Setup. To re-init for testing, the
//     caller can rm the file first.
//   - Creates .wix/ if it doesn't exist.
//   - Outputs a JSON summary to stdout.

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , projectDir, brandName, brandDescription, verticalsCsv] = process.argv;

if (!projectDir || !brandName || brandDescription === undefined || !verticalsCsv) {
  console.error("usage: init-site-json.mjs <project-dir> <brand-name> <brand-description> <verticals-csv>");
  process.exit(2);
}

const verticals = verticalsCsv
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

if (verticals.length === 0) {
  console.error("init-site-json: <verticals-csv> resolved to zero verticals — cms is always loaded, so this is a bug");
  process.exit(2);
}

const wixDir = join(projectDir, ".wix");
const sitePath = join(wixDir, "site.json");

if (existsSync(sitePath)) {
  console.error(`init-site-json: ${sitePath} already exists — refusing to overwrite. Setup should call this exactly once.`);
  process.exit(2);
}

mkdirSync(wixDir, { recursive: true });

const site = {
  brand: {
    name: brandName,
    description: brandDescription,
  },
  seeded: {},
  designTokens: {},
  verticals,
};

writeFileSync(sitePath, JSON.stringify(site, null, 2) + "\n");

console.log(JSON.stringify({ status: "ok", path: sitePath, verticals }, null, 2));
