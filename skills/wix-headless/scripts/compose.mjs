#!/usr/bin/env node
// ── compose.mjs — the deterministic Composer (astro design-system phase) ──────
//
// Replaces the former `design-system-composer` LLM subagent (this script is now
// the sole spec). The Composer's job is MECHANICAL: take the Designer's framework-
// agnostic spec + the application inputs and WRITE the design-system files —
// global.css (theme tokens + fixed bulk) and Layout.astro (html/head shell) —
// from inline content. There are no template files on disk; all fixed bulk is
// inlined here so an LLM and a filesystem read are both unnecessary.
//
// It is a sibling of emit-design-tokens.mjs / patch-decorative-slots.mjs and,
// like them, reads its input as a JSON object on stdin and takes the project
// dir as argv[2].
//
// Usage:
//   node compose.mjs <project-dir> <<'JSON'
//   { "brand": {...}, "loadedPacks": [...], "packsWithComponents": [...],
//     "disabledPacks": [...], "navPath": "...", "footerPath": "...", "homePath": "..." }
//   JSON
//
// Tokens come from DESIGN.md — the single design format (no inline token JSON).
// compose reads `<project-dir>/DESIGN.md` (or `designMdPath`), parses its
// FRONTMATTER ONLY (the markdown body is documentation, never read), and applies
// a role-translation table (references/shared/DESIGN_MD.md) so a DESIGN.md
// authored with standard roles (primary/surface/on-surface/…) maps onto the wix
// `--color-*` vocabulary; wix-native keys pass through losslessly. `rounded` →
// radii; a custom `containers` group + a `googleFontsHref` key are honored.
// The Designer authors that DESIGN.md directly; emit-design-tokens.mjs projects
// the token CSS/types from it. DESIGN.md exists on disk before compose runs.
//
// stdin JSON (the application inputs — NOT the design tokens, which live in DESIGN.md):
//   - designMdPath       — optional path to the DESIGN.md (default <project-dir>/DESIGN.md).
//   - brand              — { name, description }.
//   - loadedPacks        — string[] of loaded vertical packs.
//   - packsWithComponents — string[]; one components-<pack>.css import per entry,
//                          in order (Layout.astro frontmatter).
//   - disabledPacks      — string[]; dormant packs still get home markers.
//   - navPath            — path to LLM-generated Navigation.astro (required).
//   - footerPath         — path to LLM-generated Footer.astro (required).
//   - homePath           — path to LLM-generated index.astro (required).
//
// What it writes:
//   1. src/styles/global.css            — @theme palette + fixed bulk (inline)
//   2. astro.config.mjs                 — MERGE (anchored codemod, not clobber)
//   3. src/layouts/Layout.astro         — html/head shell (inline)
//   4. src/components/Navigation.astro  — LLM-generated (verbatim from navPath)
//   5. src/components/Footer.astro      — LLM-generated (verbatim from footerPath)
//   6. src/pages/index.astro            — LLM-generated (verbatim from homePath)
//
// Token contract: guarantees the required-token set (STYLING.md § "Required
// tokens — the component-CSS template contract") resolves in @theme. Missing
// roles are DERIVED as a fail-safe (the Designer is expected to emit a complete
// set + a googleFontsHref; derivation is a safety net, not the hot path).
//
// Output: a single manifest JSON object on stdout (the orchestrator parses it
// the same way it parsed the subagent's return — same { status, phase, data,
// files } shape). Diagnostics go to stderr. Exit 0 on complete, 1 on a hard
// failure (missing scaffold / unrecoverable token gap / missing config anchor).
//
// astro only. Custom (non-astro) frontends never reach the Composer — the
// orchestrator only invokes this when frontend === "astro".

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { execSync } from "node:child_process";

const projectDir = process.argv[2] ?? process.cwd();

function die(code, message) {
  // Emit a structured failure manifest on stdout so the orchestrator parses a
  // return either way, plus a human line on stderr. Hard-fail with exit 1.
  console.error(`compose: ${message}`);
  console.log(JSON.stringify({ status: "failed", phase: "compose", data: {}, files: [], errors: [{ code, message }] }, null, 2));
  process.exit(1);
}

// ── read + validate input ─────────────────────────────────────────────────────
if (process.stdin.isTTY) die("NO_INPUT", "expected the compose input JSON on stdin");
let input;
try {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) die("EMPTY_INPUT", "stdin was empty — pass the compose input JSON object");
  input = JSON.parse(raw);
} catch (e) {
  die("BAD_JSON", `stdin is not valid JSON (${e.message})`);
}

// ── token source: DESIGN.md frontmatter (portable) ───────────────────────────
// Minimal frontmatter parser for the restricted DESIGN.md shape (groups of
// `key: scalar`, plus typography tokens with an indented `fontFamily:`). Not a
// general YAML parser — the body is never read. Color values are quoted in the
// emitted DESIGN.md because an unquoted `#hex` after `: ` is a YAML comment.
function unquote(v) {
  v = v.trim();
  const qc = v[0];
  if (qc === '"' || qc === "'") {
    // Return the quoted content up to the closing quote (handles a trailing
    // ` # comment` after the closing quote, and \" / \\ escapes in "…").
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
// Parse a flow-style inline object — `{ fontFamily: "X", fontWeight: 600 }` —
// splitting top-level commas while respecting quotes (so `"Helvetica, Arial"`
// stays one value). Used for typography tokens authored in flow style.
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
// Standard DESIGN.md color roles → wix editorial `--color-*` names. wix-native
// keys (paper/ink/accent/…) are NOT in this table and pass through unchanged,
// winning on any conflict — so our own emission is lossless.
const COLOR_ROLE_TABLE = {
  primary: "accent", secondary: "paper-warm", tertiary: "ink-soft", neutral: "mute",
  surface: "paper", "on-surface": "ink", background: "paper", "on-background": "ink",
  outline: "rule", error: "error",
};
function designMdToTokens(fm) {
  // Single pass preserving source key order: each key maps via the role table
  // (standard DESIGN.md role → wix name) or passes through unchanged (wix-native
  // keys aren't in the table). Order-preserving so our own round-trip is
  // byte-identical to the JSON path. (A file mixing a standard role and its wix
  // synonym — e.g. both `surface` and `paper` — is pathological; last wins.)
  const colors = {};
  for (const [k, v] of Object.entries(fm.colors ?? {})) colors[COLOR_ROLE_TABLE[k] ?? k] = v;
  const typ = fm.typography ?? {};
  const famOf = (...keys) => { for (const key of keys) if (typ[key] && typ[key].fontFamily) return typ[key].fontFamily; return undefined; };
  const fonts = {};
  const disp = famOf("display", "h1", "heading", "title");
  const body = famOf("body", "p", "text", "base", "paragraph");
  if (disp) fonts.display = disp;
  if (body) fonts.body = body;
  if (typ.mono && typ.mono.fontFamily) fonts.mono = typ.mono.fontFamily;
  return {
    colors,
    fonts,
    radii: fm.rounded ?? {},        // DESIGN.md calls corner radii `rounded`
    containers: fm.containers ?? {}, // custom group
    ...(typeof fm.googleFontsHref === "string" ? { googleFontsHref: fm.googleFontsHref } : {}),
  };
}

// DESIGN.md is the single token source — read it, parse frontmatter only.
const designMdRel = input.designMdPath ?? "DESIGN.md";
const designMdPath = isAbsolute(designMdRel) ? designMdRel : join(projectDir, designMdRel);
if (!existsSync(designMdPath)) die("DESIGN_MD_MISSING", `no DESIGN.md at ${designMdPath} — the Designer must author it first`);
const fm = parseFrontmatter(readFileSync(designMdPath, "utf8"));
if (!fm) die("DESIGN_MD_BAD", `could not parse YAML frontmatter from ${designMdPath}`);
const designTokens = designMdToTokens(fm);
const brand = input.brand ?? {};
const loadedPacks = Array.isArray(input.loadedPacks) ? input.loadedPacks : [];
const packsWithComponents = Array.isArray(input.packsWithComponents) ? input.packsWithComponents : [];
const disabledPacks = Array.isArray(input.disabledPacks) ? input.disabledPacks : [];

// Full-page LLM generation: the LLM authors the entire visible page —
// header (Navigation.astro), footer (Footer.astro), and home page (index.astro).
// compose writes each verbatim; there are no templates for them.
const resolveIn = (p) => { const s = typeof p === "string" ? p.trim() : ""; return s ? (isAbsolute(s) ? s : join(projectDir, s)) : null; };
const navPath = resolveIn(input.navPath);
const footerPath = resolveIn(input.footerPath);
const homePath = resolveIn(input.homePath);

const brandName = brand.name ?? "Brand";

// ── small color helper (derivation fail-safe only) ────────────────────────────
function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function toHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
// mix `a` toward `b` by weight w (0..1). Falls back to `a` if either unparseable.
function mix(a, b, w) {
  const ca = parseHex(a), cb = parseHex(b);
  if (!ca || !cb) return a ?? b ?? "#000000";
  return toHex(ca.map((v, i) => v + (cb[i] - v) * w));
}

// ── build the @theme palette + guarantee the required-token contract ──────────
const SYSTEM_FONTS = new Set([
  "system-ui", "-apple-system", "blinkmacsystemfont", "segoe ui", "sans-serif",
  "serif", "monospace", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit",
]);

const colors = { ...(designTokens.colors ?? {}) };
const fonts = { ...(designTokens.fonts ?? {}) };
const radii = { ...(designTokens.radii ?? {}) };
const containers = { ...(designTokens.containers ?? {}) };

const derived = [];
function ensure(group, key, value, prefix) {
  if (group[key] === undefined || group[key] === null || group[key] === "") {
    group[key] = value;
    derived.push(`${prefix}${key}`);
  }
}

// Colors — required core first (sane neutral defaults if the Designer omitted a
// core role), then warm/soft derivations described in COMPOSE § Token contract.
ensure(colors, "paper", "#ffffff", "--color-");
ensure(colors, "ink", "#1a1a1a", "--color-");
ensure(colors, "accent", colors.ink, "--color-");
ensure(colors, "mute", mix(colors.ink, colors.paper, 0.45), "--color-");
ensure(colors, "rule", mix(colors.ink, colors.paper, 0.85), "--color-");
ensure(colors, "paper-warm", mix(colors.paper, colors.accent, 0.06), "--color-"); // paper warmed
ensure(colors, "ink-soft", mix(colors.ink, colors.paper, 0.25), "--color-");      // ink lightened
// NOTE: cream is derived but not in REQUIRED; gift-cards CSS expects
// --color-cream-deep (undeclared) and relies on the var() fallback — reconcile
// with STYLING.md token contract.
ensure(colors, "cream", mix(colors.paper, "#fbf3e0", 0.5), "--color-");
ensure(colors, "error", "#c0392b", "--color-");

// Fonts — display + body required.
ensure(fonts, "display", "Georgia, serif", "--font-");
ensure(fonts, "body", "system-ui, sans-serif", "--font-");

// Spacing is NOT a named scale — Tailwind v4's built-in numeric spacing
// (`--spacing` base → gap-4, py-24, …) is used directly. Emitting named
// --spacing-<t-shirt> tokens collided with the width utilities (max-w-3xl etc.
// drew from --spacing-3xl), so the named scale was removed (CODEAI-696).

// Radii — sm + md required.
ensure(radii, "sm", "0.25rem", "--radius-");
ensure(radii, "md", "0.5rem", "--radius-");

// Containers — content widths, a separate axis from spacing.
const CONTAINER_DEFAULTS = { prose: "42rem", md: "48rem", "3xl": "60rem", "6xl": "72rem" };
for (const [k, v] of Object.entries(CONTAINER_DEFAULTS)) ensure(containers, k, v, "--container-");

// Assemble the @theme block, grouped + ordered for readability.
const themeLines = [];
const emitGroup = (prefix, obj) => {
  for (const [k, v] of Object.entries(obj)) themeLines.push(`  ${prefix}${k}: ${v};`);
};
emitGroup("--color-", colors);
themeLines.push("");
emitGroup("--font-", fonts);
themeLines.push("");
emitGroup("--radius-", radii);
themeLines.push("");
emitGroup("--container-", containers);
const themeBlock = themeLines.join("\n");

// ── self-checks (assertions) ──────────────────────────────────────────────────
const errors = [];

// Required-token coverage (after derivation, every required role must resolve).
const REQUIRED = [
  ...["paper", "paper-warm", "ink", "mute", "rule", "accent"].map((k) => `--color-${k}`),
  "--font-display", "--font-body",
  "--radius-sm", "--radius-md",
  ...["prose", "md", "3xl", "6xl"].map((k) => `--container-${k}`),
];
const present = new Set([
  ...Object.keys(colors).map((k) => `--color-${k}`),
  ...Object.keys(fonts).map((k) => `--font-${k}`),
  ...Object.keys(radii).map((k) => `--radius-${k}`),
  ...Object.keys(containers).map((k) => `--container-${k}`),
]);
for (const tok of REQUIRED) {
  if (!present.has(tok)) errors.push({ code: "MISSING_REQUIRED_TOKEN", token: tok });
}

function writeProject(rel, content) {
  const dest = join(projectDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

// ── Google Fonts href ─────────────────────────────────────────────────────────
// Prefer the Designer-supplied href; otherwise build one deterministically with
// a standard weight set. Returns "" when both families are system fonts (caller
// drops the <link>).
function buildGoogleHref() {
  if (typeof designTokens.googleFontsHref === "string" && designTokens.googleFontsHref.trim()) {
    return designTokens.googleFontsHref.trim();
  }
  const families = [];
  for (const fam of [fonts.display, fonts.body]) {
    if (typeof fam !== "string") continue;
    const first = fam.split(",")[0].trim();
    if (!first || SYSTEM_FONTS.has(first.toLowerCase())) continue;
    if (!families.includes(first)) families.push(first);
  }
  if (families.length === 0) return "";
  const q = families
    .map((f) => `family=${f.replace(/\s+/g, "+")}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

// ── 1. global.css ─────────────────────────────────────────────────────────────
writeProject("src/styles/global.css", `@import "tailwindcss";

@theme {
${themeBlock}
}

/* Reading-width helper so prose pages center without guessing Tailwind sizes. */
@utility container-reading {
  max-width: var(--container-prose);
  margin-inline: auto;
}

/* Shared button primitive — declared with @utility so the variants below can
   @apply it (a plain contract class is NOT @apply-able in Tailwind v4). */
@utility btn {
  @apply inline-flex items-center justify-center px-6 py-4 rounded-md font-medium;
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;
}

@layer base {
  * {
    box-sizing: border-box;
  }
  html {
    -webkit-text-size-adjust: 100%;
  }
  body {
    margin: 0;
    background: var(--color-paper);
    color: var(--color-ink);
    font-family: var(--font-body);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    line-height: 1.15;
    margin: 0;
  }
  p {
    margin: 0;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  input, textarea, select {
    font: inherit;
  }
  img {
    display: block;
    max-width: 100%;
    height: auto;
  }
  ul, ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

/* ── Button family — used on every page in every vertical ─────────────────── */
.btn-primary {
  @apply btn;
  background: var(--color-ink);
  color: var(--color-paper);
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-accent);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  @apply btn;
  background: transparent;
  color: var(--color-ink);
  border: 1px solid var(--color-rule);
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  @apply btn;
  background: transparent;
  color: var(--color-ink);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--color-paper-warm);
}
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Cross-cutting decorative patterns ────────────────────────────────────── */
[data-decorative-slot] {
  position: relative;
  overflow: hidden;
}
[data-decorative-slot] > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.editorial-rule {
  border: 0;
  height: 1px;
  background: var(--color-accent);
  opacity: 0.6;
  margin-block: 1.5rem;
}

/* ── Universal site chrome ────────────────────────────────────────────────── */
.site-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--color-paper) 88%, transparent);
  backdrop-filter: saturate(1.1) blur(8px);
  border-bottom: 1px solid var(--color-rule);
}
.site-footer {
  border-top: 1px solid var(--color-rule);
  background: var(--color-paper-warm);
  color: var(--color-mute);
}

/* ── View Transitions wiring (paired with Layout.astro <script>) ──────────────
   Disable the default ClientRouter root cross-fade; the progress bar + grid-dim
   carry navigation feedback instead. Do not split into a separate file. */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

.nav-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-accent, currentColor);
  transform: scaleX(0);
  transform-origin: left;
  z-index: 1000;
  pointer-events: none;
  opacity: 0;
}
.nav-progress[data-state="loading"] {
  opacity: 1;
  transform: scaleX(0.85);
  transition: transform 1.6s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms ease;
}
.nav-progress[data-state="done"] {
  opacity: 0;
  transform: scaleX(1);
  transition: transform 200ms ease, opacity 240ms ease 60ms;
}

/* ── Navigation submenu + CategoryRail/pagination (stores pack) ───────────────
   These reference declared tokens and stay inert when stores is not loaded (no
   markup uses them), so they ship unconditionally as fixed bulk. */
.site-nav-item.has-submenu {
  position: relative;
}
.site-nav-submenu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 12rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  background: var(--color-paper);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-md);
  opacity: 0;
  visibility: hidden;
  transform: translateY(4px);
  transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
}
.site-nav-item.has-submenu:hover .site-nav-submenu,
.site-nav-item.has-submenu:focus-within .site-nav-submenu {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.site-nav-sublink {
  font-size: 0.875rem;
  color: var(--color-ink-soft, var(--color-mute));
  padding-block: 0.25rem;
}
.site-nav-sublink:hover,
.site-nav-sublink[aria-current="page"] {
  color: var(--color-accent);
}

.category-rail {
  background: var(--color-paper-warm);
  border-bottom: 1px solid var(--color-rule);
}
.category-rail-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-block: 1rem;
}
.category-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 1rem;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-ink-soft, var(--color-ink));
  transition: border-color 160ms ease, color 160ms ease, background-color 160ms ease;
}
.category-pill:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.category-pill[aria-current="page"] {
  background: var(--color-ink);
  color: var(--color-paper);
  border-color: var(--color-ink);
}
.pagination {
  margin-block: 2rem;
}
.pagination-inner {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.pagination-link {
  color: var(--color-ink);
}
.pagination-link:hover {
  color: var(--color-accent);
}
.pagination-link.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}
.breadcrumbs {
  font-size: 0.8125rem;
  color: var(--color-mute);
  margin-bottom: 0.75rem;
}
`);

// ── 2. astro.config.mjs (anchored MERGE, fail loud on missing anchor) ─────────
{
  const dest = join(projectDir, "astro.config.mjs");
  // The scaffold may briefly be in flight; the new wiring invokes compose only
  // after Setup Step 1 awaited the scaffold, so a short retry is belt-and-braces.
  let src = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (existsSync(dest)) { src = readFileSync(dest, "utf8"); break; }
    try { execSync("sleep 1"); } catch { /* ignore */ }
  }
  if (src === null) die("SCAFFOLD_NOT_COMPLETE", `astro.config.mjs not found at ${dest} after retries`);

  const hasImport = /import\s+tailwindcss\s+from\s+["']@tailwindcss\/vite["']/.test(src);
  const hasCall = /tailwindcss\s*\(\s*\)/.test(src);

  // (1a) import — insert after the last top-level import statement.
  if (!hasImport) {
    const importRe = /^import\b.*$/gm;
    let last = null, m;
    while ((m = importRe.exec(src)) !== null) last = m;
    if (!last) die("ANCHOR_IMPORT", "no import statement found in astro.config.mjs to anchor the @tailwindcss/vite import");
    const insertAt = last.index + last[0].length;
    src = src.slice(0, insertAt) + `\nimport tailwindcss from "@tailwindcss/vite";` + src.slice(insertAt);
  }

  // (1b) merge tailwindcss() into vite.plugins (idempotent on hasCall).
  if (!hasCall) {
    if (/plugins\s*:\s*\[/.test(src)) {
      src = src.replace(/plugins\s*:\s*\[/, (mm) => `${mm}tailwindcss(), `);
    } else if (/\bvite\s*:\s*\{/.test(src)) {
      src = src.replace(/(\bvite\s*:\s*\{)/, `$1\n    plugins: [tailwindcss()],`);
    } else if (/defineConfig\s*\(\s*\{/.test(src)) {
      src = src.replace(/(defineConfig\s*\(\s*\{)/, `$1\n  vite: { plugins: [tailwindcss()] },`);
    } else {
      die("ANCHOR_VITE", "could not find vite.plugins, a vite block, or defineConfig({ to register @tailwindcss/vite");
    }
  }

  // (2) process.env → globalThis guard (TS-safe under strict tsc --noEmit).
  const GUARD = `const isBuild =\n  (/** @type {any} */ (globalThis)).process?.env?.NODE_ENV === "production";`;
  const alreadyGuarded = /\(globalThis\)\)\.process\?\.env\?\.NODE_ENV/.test(src);
  const bareRe = /const\s+isBuild\s*=\s*process\.env\.NODE_ENV\s*===?\s*["']production["']\s*;/;
  if (!alreadyGuarded) {
    if (bareRe.test(src)) {
      src = src.replace(bareRe, GUARD);
    } else if (/process\.env/.test(src)) {
      die("ANCHOR_PROCESS_ENV", "found a bare process.env reference but not the expected `const isBuild = process.env.NODE_ENV …` line to guard");
    }
    // else: no process.env at all — nothing to guard, leave as-is.
  }

  writeProject("astro.config.mjs", src);
}

// ── 3. Layout.astro ────────────────────────────────────────────────────────────
const componentCssImports = packsWithComponents.map(
  (pack) => `import '../styles/components-${pack}.css';`,
);
{
  const cssImportBlock = componentCssImports.length
    ? componentCssImports.join("\n") + "\n"
    : "";
  const href = buildGoogleHref();
  const fontLine = href
    ? `    <link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}" />\n`
    : "";
  writeProject("src/layouts/Layout.astro", `---
import '../styles/global.css';
${cssImportBlock}import { ClientRouter } from 'astro:transitions';
import Navigation from '../components/Navigation.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title?: string;
  description?: string;
  hasSeoTags?: boolean;
}
const { title, description, hasSeoTags = false } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fontLine}    {!hasSeoTags && (
      <>
        <title>{title ? \`\${title} · ${brandName}\` : "${brandName}"}</title>
        {description && <meta name="description" content={description} />}
      </>
    )}
    <slot name="head" />
    <ClientRouter />
  </head>
  <body>
    <div class="nav-progress" data-nav-progress aria-hidden="true"></div>
    <Navigation />
    <main><slot /></main>
    <Footer />
    <script>
      // Persisted rail aria-current sync + top loading bar + rail-anchored
      // scroll across listing-to-listing navigation. Stores pack relies on
      // all three; do not split into separate scripts.
      function syncCategoryRail() {
        const path = window.location.pathname;
        const activeSlug = path.startsWith("/category/")
          ? path.slice("/category/".length).replace(/\\/$/, "")
          : path === "/products" || path === "/products/"
            ? ""
            : null;
        if (activeSlug === null) return;
        const pills = document.querySelectorAll<HTMLAnchorElement>(
          "[data-category-rail] .category-pill",
        );
        for (const pill of pills) {
          const slug = pill.dataset.categorySlug ?? "";
          if (slug === activeSlug) pill.setAttribute("aria-current", "page");
          else pill.removeAttribute("aria-current");
        }
      }
      // Eager click feedback — flip aria-current before the network call.
      document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const pill = target?.closest<HTMLAnchorElement>(
          "[data-category-rail] .category-pill",
        );
        if (!pill) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const pills = document.querySelectorAll<HTMLAnchorElement>(
          "[data-category-rail] .category-pill",
        );
        for (const p of pills) p.removeAttribute("aria-current");
        pill.setAttribute("aria-current", "page");
      }, true);
      const progress = document.querySelector<HTMLElement>("[data-nav-progress]");
      function startProgress() {
        if (!progress) return;
        progress.dataset.state = "loading";
        document.body.dataset.navigating = "true";
      }
      function endProgress() {
        if (!progress) return;
        progress.dataset.state = "done";
        delete document.body.dataset.navigating;
        window.setTimeout(() => {
          if (progress.dataset.state === "done") delete progress.dataset.state;
        }, 320);
      }
      // Anchor the persisted rail across listing-to-listing navigation. The
      // page-header above the rail differs between /products and /category/[slug]
      // (breadcrumbs, lede, optional image), so naive scroll preservation reads
      // as a jump. Capture rail.getBoundingClientRect().top before the swap and
      // re-equalize after.
      const isListing = (p: string) =>
        p === "/products" || p === "/products/" || p.startsWith("/category/");
      let railAnchorTop: number | null = null;
      document.addEventListener("astro:before-preparation", (event: any) => {
        const from = window.location.pathname;
        const to = event?.to?.pathname ?? from;
        const rail = document.querySelector<HTMLElement>("[data-category-rail]");
        railAnchorTop =
          rail && isListing(from) && isListing(to)
            ? rail.getBoundingClientRect().top
            : null;
        startProgress();
      });
      document.addEventListener("astro:after-swap", () => {
        syncCategoryRail();
        if (railAnchorTop !== null) {
          const rail = document.querySelector<HTMLElement>("[data-category-rail]");
          if (rail) {
            const delta = rail.getBoundingClientRect().top - railAnchorTop;
            if (Math.abs(delta) > 0.5) {
              window.scrollBy({ top: delta, left: 0, behavior: "instant" as ScrollBehavior });
            }
          }
        }
        railAnchorTop = null;
        endProgress();
      });
      document.addEventListener("astro:page-load", endProgress);
      syncCategoryRail();
    </script>
  </body>
</html>
`);
}

// ── 4. Navigation.astro (LLM-generated, verbatim) ─────────────────────────────
{
  if (!navPath || !existsSync(navPath)) die("NO_NAV", `LLM-generated header required via navPath (none at ${navPath ?? "<unset>"})`);
  writeProject("src/components/Navigation.astro", readFileSync(navPath, "utf8"));
}

// ── 5. Footer.astro (LLM-generated, verbatim) ─────────────────────────────────
{
  if (!footerPath || !existsSync(footerPath)) die("NO_FOOTER", `LLM-generated footer required via footerPath (none at ${footerPath ?? "<unset>"})`);
  writeProject("src/components/Footer.astro", readFileSync(footerPath, "utf8"));
}

// ── 6. index.astro (LLM-generated, verbatim) ─────────────────────────────────
// Home markers: one `<!-- home:<pack> -->` per contributing pack. Today
// stores + bookings + gift-cards contribute a home section. Disabled packs
// (gift-cards) still get their marker (markers are their only acceptable touchpoint).
const HOME_CONTRIBUTING = ["stores", "bookings", "gift-cards"]; // canonical order
const homePool = new Set([...loadedPacks, ...disabledPacks]);
const homeMarkerPacks = HOME_CONTRIBUTING.filter((p) => homePool.has(p));
{
  if (!homePath || !existsSync(homePath)) die("NO_HOME", `LLM-generated home page required via homePath (none at ${homePath ?? "<unset>"})`);
  writeProject("src/pages/index.astro", readFileSync(homePath, "utf8"));
}

// ── manifest (the orchestrator parses this off stdout) ────────────────────────
const filesWritten = [
  "src/styles/global.css",
  "astro.config.mjs",
  "src/layouts/Layout.astro",
  "src/components/Navigation.astro",
  "src/components/Footer.astro",
  "src/pages/index.astro",
];
const manifest = {
  status: errors.length ? "partial" : "complete",
  phase: "compose",
  data: {
    filesWritten,
    nav: "llm-generated",
    footer: "llm-generated",
    home: "llm-generated",
    componentCssImports: packsWithComponents,
    homeMarkers: homeMarkerPacks.map((p) => `home:${p}`),
    tokensApplied: {
      colors: Object.keys(colors).length,
      containers: Object.keys(containers).length,
      radii: Object.keys(radii).length,
      fonts: Object.keys(fonts).length,
    },
    ...(derived.length ? { derivedTokens: derived } : {}),
  },
  files: filesWritten,
  ...(errors.length ? { errors } : {}),
};
console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
