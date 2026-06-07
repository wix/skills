#!/usr/bin/env node
// ── compose.mjs — the deterministic Composer (astro design-system phase) ──────
//
// Replaces the former `design-system-composer` LLM subagent (this script is now
// the sole spec). The Composer's job is MECHANICAL: take the Designer's framework-
// agnostic spec + the application inputs and SUBSTITUTE them into six pinned
// skeletons at references/astro/templates/. There is no judgment in re-emitting
// the fixed bulk (View-Transitions script, @utility btn family, view-transition
// CSS), so an LLM is pure cost + run-to-run variance. This script does it in
// sub-second, byte-reproducibly.
//
// It is a sibling of emit-design-tokens.mjs / patch-decorative-slots.mjs and,
// like them, reads its input as a JSON object on stdin and takes the project
// dir as argv[2]. It locates the skeletons relative to its own path (no
// SKILL_ROOT needed).
//
// Usage:
//   node compose.mjs <project-dir> <<'JSON'
//   { "shell": {...}, "brand": {...}, "navLinks": [...],
//     "loadedPacks": [...], "packsWithComponents": [...], "disabledPacks": [...] }
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
//   - designMdPath   — optional path to the DESIGN.md (default <project-dir>/DESIGN.md).
//   - shell          — { heroHeadline, heroSub, footerTagline, navBrandMark }.
//   - brand          — { name, description }.
//   - navLinks       — [ { href, label } ]; labels used VERBATIM.
//   - loadedPacks    — string[] of loaded vertical packs.
//   - packsWithComponents — string[]; one components-<pack>.css import per entry,
//                       in order (COMPOSE § Layout.astro).
//   - disabledPacks  — string[]; dormant packs still get their home/nav markers,
//                       never a visible entry point.
//
// What it writes (the 6 design-system files), by substituting {{…}} slots into
// the pinned skeletons — the fixed bulk is copied byte-for-byte:
//   1. src/styles/global.css            — {{theme}} ← @theme palette
//   2. astro.config.mjs                 — MERGE (anchored codemod, not clobber)
//   3. src/layouts/Layout.astro         — imports, fonts href, brand title
//   4. src/components/Navigation.astro  — brand mark, nav links
//   5. src/components/Footer.astro      — brand, tagline, nav links
//   6. src/pages/index.astro            — hero copy, brand, home markers
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
import { join, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(SCRIPT_DIR, "..", "references", "astro", "templates");

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
    spacing: fm.spacing ?? {},
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
const shell = input.shell ?? {};
const brand = input.brand ?? {};
const navLinks = Array.isArray(input.navLinks) ? input.navLinks : [];
const loadedPacks = Array.isArray(input.loadedPacks) ? input.loadedPacks : [];
const packsWithComponents = Array.isArray(input.packsWithComponents) ? input.packsWithComponents : [];
const disabledPacks = Array.isArray(input.disabledPacks) ? input.disabledPacks : [];

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
const spacing = { ...(designTokens.spacing ?? {}) };
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

// Spacing — full 2xs..4xl scale.
const SPACING_DEFAULTS = {
  "2xs": "0.25rem", xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem",
  xl: "2rem", "2xl": "3rem", "3xl": "4rem", "4xl": "6rem",
};
for (const [k, v] of Object.entries(SPACING_DEFAULTS)) ensure(spacing, k, v, "--spacing-");

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
emitGroup("--spacing-", spacing);
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
  ...["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"].map((k) => `--spacing-${k}`),
  "--radius-sm", "--radius-md",
  ...["prose", "md", "3xl", "6xl"].map((k) => `--container-${k}`),
];
const present = new Set([
  ...Object.keys(colors).map((k) => `--color-${k}`),
  ...Object.keys(fonts).map((k) => `--font-${k}`),
  ...Object.keys(spacing).map((k) => `--spacing-${k}`),
  ...Object.keys(radii).map((k) => `--radius-${k}`),
  ...Object.keys(containers).map((k) => `--container-${k}`),
]);
for (const tok of REQUIRED) {
  if (!present.has(tok)) errors.push({ code: "MISSING_REQUIRED_TOKEN", token: tok });
}

// Container ≠ spacing: a --container-* value must never equal a --spacing-* value.
const spacingValues = new Set(Object.values(spacing));
for (const [k, v] of Object.entries(containers)) {
  if (spacingValues.has(v)) errors.push({ code: "CONTAINER_EQUALS_SPACING", token: `--container-${k}`, value: v });
}

// ── skeleton load + substitution helpers ──────────────────────────────────────
function readTemplate(name) {
  const p = join(TEMPLATES, name);
  if (!existsSync(p)) die("TEMPLATE_MISSING", `skeleton not found at ${p}`);
  return readFileSync(p, "utf8");
}
function writeProject(rel, content) {
  const dest = join(projectDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
function escAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}
// Strip the leading "// ── Composer skeleton: … ──" authoring-comment block from
// an .astro skeleton's frontmatter. Those lines document the {{…}} slots (and
// thus contain placeholder text that must NOT be substituted) and are not part
// of the shipped site — the real Composer output drops them too. Removes the
// contiguous run of `//` comment lines immediately after the opening `---`.
function stripAstroHeader(src) {
  return src.replace(/^(---\n)((?:[ \t]*\/\/.*\n)+)/, "$1");
}

// ── Google Fonts href ─────────────────────────────────────────────────────────
// Prefer the Designer-supplied href; otherwise build one deterministically with
// a standard weight set. Returns ""
// when both families are system fonts (caller drops the <link>).
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

// ── 1. global.css ──────────────────────────────────────────────────────────────
{
  const skeleton = readTemplate("global.css");
  // Replace the first `@theme { … }` block (its comment has no braces, so the
  // first `}` is its close). Everything else is literal fixed bulk.
  const out = skeleton.replace(/@theme\s*\{[\s\S]*?\n\}/, `@theme {\n${themeBlock}\n}`);
  if (out === skeleton) die("ANCHOR_THEME", "could not locate the @theme block in global.css skeleton");
  writeProject("src/styles/global.css", out);
}

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
  let out = stripAstroHeader(readTemplate("Layout.astro"));
  // {{components-css-imports}} — one import per pack, or drop the whole line.
  if (componentCssImports.length) {
    out = out.replace(/^\{\{components-css-imports\}\}\s*$/m, componentCssImports.join("\n"));
  } else {
    out = out.replace(/^\{\{components-css-imports\}\}\s*\n/m, "");
  }
  // {{fonts.googleHref}} — drop the <link> when no web fonts.
  const href = buildGoogleHref();
  if (href) {
    out = out.replace(/\{\{fonts\.googleHref\}\}/g, escAttr(href));
  } else {
    out = out.replace(/^.*\{\{fonts\.googleHref\}\}.*\n/m, "");
  }
  out = out.replaceAll("{{brand.name}}", brandName);
  writeProject("src/layouts/Layout.astro", out);
}

// ── nav-link rendering ──────────────────────────────────────────────────────────
const navItems = navLinks
  .filter((l) => l && l.href != null && l.label != null)
  .map((l) => ({ href: String(l.href), label: String(l.label) }));

// ── 4. Navigation.astro ──────────────────────────────────────────────────────────
{
  let out = stripAstroHeader(readTemplate("Navigation.astro"));
  out = out.replaceAll("{{shell.navBrandMark}}", shell.navBrandMark ?? brandName);
  const links = navItems
    .map((l) => `        <li class="site-nav-item"><a href="${escAttr(l.href)}">${l.label}</a></li>`)
    .join("\n");
  out = out.replace(/^\s*\{\{nav\.links\}\}\s*$/m, links);
  writeProject("src/components/Navigation.astro", out);
}

// ── 5. Footer.astro ──────────────────────────────────────────────────────────────
{
  let out = stripAstroHeader(readTemplate("Footer.astro"));
  out = out.replaceAll("{{brand.name}}", brandName);
  out = out.replaceAll("{{shell.footerTagline}}", shell.footerTagline ?? "");
  const links = navItems
    .map((l) => `        <li><a href="${escAttr(l.href)}">${l.label}</a></li>`)
    .join("\n");
  out = out.replace(/^\s*\{\{nav\.links\}\}\s*$/m, links);
  writeProject("src/components/Footer.astro", out);
}

// ── 6. index.astro ────────────────────────────────────────────────────────────────
// Home markers: one `<!-- home:<pack> -->` per contributing pack. Today
// stores + bookings + gift-cards contribute a home section. Disabled packs
// (gift-cards) still get their marker (markers are their only acceptable touchpoint).
const HOME_CONTRIBUTING = ["stores", "bookings", "gift-cards"]; // canonical order
const homePool = new Set([...loadedPacks, ...disabledPacks]);
const homeMarkerPacks = HOME_CONTRIBUTING.filter((p) => homePool.has(p));
{
  let out = stripAstroHeader(readTemplate("index.astro"));
  out = out.replaceAll("{{shell.heroHeadline}}", shell.heroHeadline ?? brandName);
  out = out.replaceAll("{{shell.heroSub}}", shell.heroSub ?? "");
  out = out.replaceAll("{{brand.name}}", brandName);
  const markers = homeMarkerPacks.map((p) => `  <!-- home:${p} -->`).join("\n");
  out = out.replace(/^\s*\{\{home-markers\}\}\s*$/m, markers);
  writeProject("src/pages/index.astro", out);
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
    componentCssImports: packsWithComponents,
    homeMarkers: homeMarkerPacks.map((p) => `home:${p}`),
    tokensApplied: {
      colors: Object.keys(colors).length,
      spacing: Object.keys(spacing).length,
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
