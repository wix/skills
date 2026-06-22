#!/usr/bin/env node
// Project .wix/design-tokens.css + .wix/site.d.ts from the Designer's DESIGN.md.
//
// The Designer authors DESIGN.md directly (the run is single-folder — CWD is the
// project — so the Designer can write it during Phase 2). This script does NOT
// write DESIGN.md; it reads the frontmatter the Designer wrote and projects the
// two MECHANICAL artifacts an LLM must not hand-write (a malformed :root block or
// divergent type union is a silent build/drift bug):
//   .wix/design-tokens.css  — :root custom properties (build-consumed; any frontend imports it).
//   .wix/site.d.ts          — typed token-name unions.
//
// DESIGN.md frontmatter is the single design source — compose.mjs (astro) reads
// the same file. Runs in the Setup-window bridge, after the Designer returns. On
// the own-build (SPA) path it runs too (the SPA imports design-tokens.css);
// compose.mjs does NOT run there (it is astro-only).
//
// Usage:
//   node emit-design-tokens.mjs <project-dir>                    # reads <project-dir>/DESIGN.md
//   node emit-design-tokens.mjs <project-dir> --design-md <path> # explicit DESIGN.md path

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let designMdPath = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--design-md") designMdPath = argv[++i];
  else if (argv[i].startsWith("--design-md=")) designMdPath = argv[i].slice("--design-md=".length);
  else positional.push(argv[i]);
}
const projectDir = positional[0] ?? process.cwd();
const designMd = designMdPath ?? join(projectDir, "DESIGN.md");

// ── DESIGN.md frontmatter parser ──────────────────────────────────────────────
// Mirrors compose.mjs's parser for the restricted DESIGN.md shape (groups of
// `key: scalar`, typography tokens with an indented or flow-style fontFamily).
// The format contract is references/shared/DESIGN_MD.md; both readers must agree.
// Color values are quoted because an unquoted `#hex` after `: ` is a YAML comment.
function unquote(v) {
  v = v.trim();
  const qc = v[0];
  if (qc === '"' || qc === "'") {
    let out = "";
    for (let i = 1; i < v.length; i++) {
      const c = v[i];
      if (qc === '"' && c === "\\" && i + 1 < v.length) { out += v[++i]; continue; }
      if (c === qc) break;
      out += c;
    }
    return out;
  }
  const hash = v.search(/\s#/); // strip trailing inline comment on bare scalars
  if (hash !== -1) v = v.slice(0, hash).trim();
  return v;
}
function parseInlineObject(s) {
  const inner = s.trim().replace(/^\{/, "").replace(/\}$/, "");
  const obj = {};
  let buf = "", inq = null;
  const parts = [];
  for (const ch of inner) {
    if (inq) { if (ch === inq) inq = null; buf += ch; continue; }
    if (ch === '"' || ch === "'") { inq = ch; buf += ch; continue; }
    if (ch === ",") { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) {
    const ci = p.indexOf(":");
    if (ci === -1) continue;
    obj[p.slice(0, ci).trim()] = unquote(p.slice(ci + 1));
  }
  return obj;
}
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const root = {};
  let group = null, sub = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    const ci = raw.indexOf(":");
    if (ci === -1) continue;
    const key = raw.slice(0, ci).trim();
    const rest = raw.slice(ci + 1).trim();
    if (indent === 0) {
      if (rest === "") { root[key] = {}; group = key; sub = null; }
      else if (rest.startsWith("{")) { root[key] = parseInlineObject(rest); group = null; sub = null; }
      else { root[key] = unquote(rest); group = null; sub = null; }
    } else if (indent === 2 && group) {
      if (rest === "") { root[group][key] = {}; sub = key; }
      else if (rest.startsWith("{")) { root[group][key] = parseInlineObject(rest); sub = null; }
      else { root[group][key] = unquote(rest); sub = null; }
    } else if (indent >= 4 && group && sub) {
      if (typeof root[group][sub] !== "object") root[group][sub] = {};
      root[group][sub][key] = unquote(rest);
    }
  }
  return root;
}

// ── read + validate the Designer's DESIGN.md ──────────────────────────────────
if (!existsSync(designMd)) {
  console.error(`emit-design-tokens: no DESIGN.md at ${designMd} — the Designer must author it first`);
  process.exit(2);
}
const design = parseFrontmatter(readFileSync(designMd, "utf8"));
if (!design || typeof design !== "object" || Object.keys(design).length === 0) {
  console.error(`emit-design-tokens: could not parse YAML frontmatter from ${designMd} (check it starts with '---', values are quoted, 2-space indent)`);
  process.exit(2);
}

const colors = design.colors ?? {};
const typography = design.typography ?? {};
const rounded = design.rounded ?? {};
const containers = design.containers ?? {};
const fontFamilyOf = (lvl) => (typography[lvl] && typeof typography[lvl] === "object" ? typography[lvl].fontFamily : typography[lvl]);

if (Object.keys(colors).length === 0) {
  console.error(`emit-design-tokens: DESIGN.md frontmatter has no 'colors' group — cannot project tokens (${designMd})`);
  process.exit(2);
}

const wixDir = join(projectDir, ".wix");
mkdirSync(wixDir, { recursive: true });

// ── .wix/design-tokens.css ────────────────────────────────────────────────────
const cssLines = ["/* Generated by emit-design-tokens.mjs. Do not edit. */", ":root {"];
for (const [k, v] of Object.entries(colors)) cssLines.push(`  --color-${k}: ${v};`);
for (const lvl of Object.keys(typography)) {
  const fam = fontFamilyOf(lvl);
  if (fam) cssLines.push(`  --font-${lvl}: ${fam};`);
}
for (const [k, v] of Object.entries(rounded)) cssLines.push(`  --radius-${k}: ${v};`);
for (const [k, v] of Object.entries(containers)) cssLines.push(`  --container-${k}: ${v};`);
cssLines.push("}", "");
writeFileSync(join(wixDir, "design-tokens.css"), cssLines.join("\n"));

// ── .wix/site.d.ts ────────────────────────────────────────────────────────────
const recordType = (keys) => {
  if (keys.length === 0) return "Record<string, string>";
  return `Record<${keys.map((k) => JSON.stringify(k)).join(" | ")}, string>`;
};
const dts = `// Generated by emit-design-tokens.mjs. Do not edit.
export type DesignTokens = {
  colors: ${recordType(Object.keys(colors))};
  fonts: ${recordType(Object.keys(typography))};
  radii: ${recordType(Object.keys(rounded))};
  containers: ${recordType(Object.keys(containers))};
};
`;
writeFileSync(join(wixDir, "site.d.ts"), dts);

console.log(`emit-design-tokens: projected ${join(wixDir, "design-tokens.css")} and ${join(wixDir, "site.d.ts")} from ${designMd}`);
