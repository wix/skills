#!/usr/bin/env node
// Generate .wix/design-tokens.css and .wix/site.d.ts deterministically from
// .wix/site.json.designTokens. Invoked by the wix-headless skill orchestrator
// after the Phase 2 Design System agent's return is merged into site.json.
//
// Why a script (not agent work): both files are pure projections of the
// designTokens JSON — no judgment, no brand-context dependence. An LLM
// emitting them is wasted tokens AND a drift risk (malformed :root blocks,
// missing token groups, divergent .d.ts skeletons).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2] ?? process.cwd();
const sitePath = join(projectDir, ".wix/site.json");

let site;
try {
  site = JSON.parse(readFileSync(sitePath, "utf8"));
} catch (e) {
  console.error(`emit-design-tokens: cannot read ${sitePath} (${e.message}). Has Phase 2 Design System returned and merged?`);
  process.exit(1);
}

const tokens = site.designTokens ?? {};
if (!tokens || Object.keys(tokens).length === 0) {
  console.error("emit-design-tokens: site.json.designTokens is empty — designer return not merged.");
  process.exit(1);
}

const wixDir = join(projectDir, ".wix");
mkdirSync(wixDir, { recursive: true });

// .wix/design-tokens.css ----------------------------------------------------
const PREFIX = {
  colors: "--color-",
  fonts: "--font-",
  radii: "--radius-",
  spacing: "--spacing-",
};

const cssLines = ["/* Generated from .wix/site.json.designTokens. Do not edit. */", ":root {"];
for (const [group, prefix] of Object.entries(PREFIX)) {
  const entries = tokens[group] ?? {};
  for (const [key, value] of Object.entries(entries)) {
    cssLines.push(`  ${prefix}${key}: ${value};`);
  }
}
cssLines.push("}", "");
writeFileSync(join(wixDir, "design-tokens.css"), cssLines.join("\n"));

// .wix/site.d.ts ------------------------------------------------------------
const typeFor = (group) => {
  const keys = Object.keys(tokens[group] ?? {});
  if (keys.length === 0) return "Record<string, string>";
  const literal = keys.map((k) => JSON.stringify(k)).join(" | ");
  return `Record<${literal}, string>`;
};

const dts = `// Generated from .wix/site.json.designTokens. Do not edit.
export type Brand = { name: string; description: string };
export type DesignTokens = {
  colors: ${typeFor("colors")};
  fonts: ${typeFor("fonts")};
  radii: ${typeFor("radii")};
  spacing: ${typeFor("spacing")};
};
export type Product = { id: string; name: string; slug: string; price: number; variantId: string };
export declare const site: {
  brand: Brand;
  designTokens: DesignTokens;
  seeded: { products?: Product[]; posts?: unknown[]; collections?: Record<string, unknown[]> };
};
`;
writeFileSync(join(wixDir, "site.d.ts"), dts);

console.log(`emit-design-tokens: wrote ${join(wixDir, "design-tokens.css")} and ${join(wixDir, "site.d.ts")}`);
